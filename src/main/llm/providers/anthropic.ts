/**
 * Провайдер Anthropic (architecture.md §7).
 *
 * Актуально на 2026-06 — цих правил тримаємось буквально:
 * - `temperature` / `top_p` / `top_k` на Opus 5 і Sonnet 5 ВИДАЛЕНІ → 400.
 *   Детермінізм дає строга схема + низький effort, не температура.
 * - `thinking: { type: 'adaptive' }`; `budget_tokens` видалено → 400.
 * - глибина роздумів — `output_config.effort`, а не top-level поле.
 * - assistant prefill видалено → 400.
 * - Citations НЕСУМІСНІ з `output_config.format` → там, де потрібні і докази,
 *   і структура, працює strict tool use (`strict: true` на визначенні інструмента).
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { Stage } from '@shared/domain';
import { estimateCost } from '../cost';
import {
  LlmError,
  LlmNotConfiguredError,
  LlmRefusalError,
  LlmSchemaError,
  LlmUnsupportedError,
} from '../errors';
import type {
  Citation,
  CompleteRequest,
  CompleteResult,
  LlmDocument,
  LlmProvider,
  LlmUsage,
  OutputMode,
  ProviderCaps,
} from '../types';

export const ANTHROPIC_PROVIDER_ID = 'anthropic';

/** ID дослівні — жодних суфіксів із датами. */
export const ANTHROPIC_MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'] as const;

export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-5';

/** Понад цей max_tokens стрімінг обов'язковий, інакше HTTP-таймаут. */
export const STREAMING_THRESHOLD_TOKENS = 8_000;

/** Adaptive thinking доступний не всім моделям — на решті просто не передаємо. */
const ADAPTIVE_THINKING_MODELS = new Set<string>(['claude-opus-5', 'claude-sonnet-5']);

type MessageParams = Anthropic.Messages.MessageCreateParamsNonStreaming;
type AnyMessage = Anthropic.Messages.Message & { parsed_output?: unknown };

interface RequestOptionsLike {
  signal?: AbortSignal | null | undefined;
}

/** Мінімальна поверхня клієнта — щоб у тестах підставити заглушку без мережі. */
export interface AnthropicMessagesLike {
  create(params: MessageParams, options?: RequestOptionsLike): Promise<AnyMessage>;
  parse(params: MessageParams, options?: RequestOptionsLike): Promise<AnyMessage>;
  stream(
    params: Anthropic.Messages.MessageStreamParams,
    options?: RequestOptionsLike,
  ): { finalMessage(): Promise<AnyMessage> };
}

export interface AnthropicClientLike {
  messages: AnthropicMessagesLike;
}

export interface AnthropicProviderOptions {
  /** Ключ приходить ззовні (safeStorage), з диска цей шар нічого не читає. */
  getApiKey: () => string | null | undefined;
  /** Готовий клієнт — для тестів. Має пріоритет над `getApiKey`. */
  client?: AnthropicClientLike;
  createClient?: (apiKey: string) => AnthropicClientLike;
  defaultModel?: string;
  maxRetries?: number;
  timeoutMs?: number;
}

export class AnthropicProvider implements LlmProvider {
  readonly id = ANTHROPIC_PROVIDER_ID;
  readonly label = 'Anthropic (Claude)';
  readonly models: readonly string[] = ANTHROPIC_MODELS;

  readonly caps: ProviderCaps = {
    contextWindow: 1_000_000,
    promptCaching: true,
    structuredOutput: 'schema',
    citations: true,
    documentInput: ['pdf', 'text'],
    maxOutputTokens: 64_000,
    cloud: true,
  };

  private readonly opts: AnthropicProviderOptions;
  private cached: { key: string; client: AnthropicClientLike } | null = null;

  constructor(opts: AnthropicProviderOptions) {
    this.opts = opts;
  }

  get defaultModel(): string {
    return this.opts.defaultModel ?? ANTHROPIC_DEFAULT_MODEL;
  }

  isConfigured(): boolean {
    if (this.opts.client) return true;
    const key = this.opts.getApiKey();
    return typeof key === 'string' && key.length > 0;
  }

  /** Citations вимагають tool-режиму — інакше 400 у парі з `output_config.format`. */
  resolveOutputMode(req: CompleteRequest<unknown>): OutputMode {
    const wantsCitations = (req.documents ?? []).some((doc) => doc.citations);
    if (req.outputMode) {
      if (req.outputMode === 'structured' && wantsCitations) {
        throw new LlmUnsupportedError(
          this.id,
          'Citations are incompatible with output_config.format; use outputMode "tool".',
        );
      }
      if (req.outputMode === 'tool' && !req.tool) {
        throw new LlmUnsupportedError(this.id, 'outputMode "tool" requires a tool definition.');
      }
      return req.outputMode;
    }
    if (wantsCitations && !req.tool) {
      throw new LlmUnsupportedError(
        this.id,
        'Citations require strict tool use: supply `tool` in the request.',
      );
    }
    return req.tool ? 'tool' : 'structured';
  }

  /**
   * Тіло запиту. Публічний метод свідомо: його перевіряють тести
   * (немає temperature, cache_control на системному блоці, tool-режим при citations).
   */
  buildParams<T>(req: CompleteRequest<T>, model: string): MessageParams {
    const mode = this.resolveOutputMode(req);

    // Порядок рендерингу tools → system → messages: усе стабільне — в system.
    const system: Anthropic.Messages.TextBlockParam[] = [{ type: 'text', text: req.system }];
    if (req.cachedPrefix) system.push({ type: 'text', text: req.cachedPrefix });
    const lastSystem = system[system.length - 1];
    if (lastSystem) lastSystem.cache_control = { type: 'ephemeral' };

    const documents = (req.documents ?? []).map(toDocumentBlock);
    const lastDocument = documents[documents.length - 1];
    if (lastDocument) lastDocument.cache_control = { type: 'ephemeral' };

    const messages: Anthropic.Messages.MessageParam[] = req.messages.map((message, index) => {
      // Документи кладемо в перше user-повідомлення, перед текстом.
      if (index === 0 && documents.length > 0 && message.role === 'user') {
        return {
          role: 'user',
          content: [...documents, { type: 'text', text: message.content }],
        };
      }
      return { role: message.role, content: message.content };
    });

    if (documents.length > 0 && (messages.length === 0 || messages[0]?.role !== 'user')) {
      messages.unshift({ role: 'user', content: documents });
    }

    const params: MessageParams = {
      model,
      max_tokens: req.maxOutputTokens,
      system,
      messages,
    };

    const outputConfig: Anthropic.Messages.OutputConfig = {};
    if (req.effort) outputConfig.effort = req.effort;
    if (mode === 'structured') outputConfig.format = zodOutputFormat(req.schema);
    if (Object.keys(outputConfig).length > 0) params.output_config = outputConfig;

    // budget_tokens видалено; глибина керується output_config.effort.
    if (req.effort && ADAPTIVE_THINKING_MODELS.has(model)) {
      params.thinking = { type: 'adaptive' };
    }

    if (mode === 'tool') {
      const tool = req.tool;
      if (!tool) throw new LlmUnsupportedError(this.id, 'Tool mode requires a tool definition.');
      params.tools = [
        {
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
          strict: true,
        },
      ];
      params.tool_choice = tool.multiCall
        ? { type: 'any' }
        : { type: 'tool', name: tool.name, disable_parallel_tool_use: true };
    }

    return params;
  }

  async complete<T>(req: CompleteRequest<T>, signal: AbortSignal): Promise<CompleteResult<T>> {
    const model = req.model ?? this.defaultModel;
    const mode = this.resolveOutputMode(req);
    const params = this.buildParams(req, model);
    const client = this.resolveClient();
    const startedAt = Date.now();

    let message: AnyMessage;
    try {
      if (req.maxOutputTokens > STREAMING_THRESHOLD_TOKENS) {
        message = await client.messages.stream(params, { signal }).finalMessage();
      } else if (mode === 'structured') {
        message = await client.messages.parse(params, { signal });
      } else {
        message = await client.messages.create(params, { signal });
      }
    } catch (err) {
      throw this.mapError(err, req.stage);
    }

    // stop_details заповнене тільки при refusal — і читати content тоді не можна.
    if (message.stop_reason === 'refusal') {
      throw new LlmRefusalError(this.id, {
        stage: req.stage,
        category: message.stop_details?.category ?? null,
        explanation: message.stop_details?.explanation ?? null,
      });
    }

    const citations = collectCitations(message);
    const candidate = mode === 'tool' ? extractToolInput(req, message, this.id) : extractStructured(req, message, this.id);

    const parsed = req.schema.safeParse(candidate);
    if (!parsed.success) {
      throw new LlmSchemaError(this.id, {
        stage: req.stage,
        issues: z.prettifyError(parsed.error),
        rawText: JSON.stringify(candidate).slice(0, 4_000),
      });
    }

    const usage = toUsage(message.usage);
    return {
      data: parsed.data,
      citations,
      usage,
      costUsd: estimateCost(model, usage),
      modelId: model,
      providerId: this.id,
      latencyMs: Date.now() - startedAt,
      raw: message,
      fromCache: false,
    };
  }

  private resolveClient(): AnthropicClientLike {
    if (this.opts.client) return this.opts.client;
    const apiKey = this.opts.getApiKey();
    if (!apiKey) throw new LlmNotConfiguredError(this.id, 'Anthropic API key is not set.');
    if (this.cached && this.cached.key === apiKey) return this.cached.client;

    const client = this.opts.createClient
      ? this.opts.createClient(apiKey)
      : new Anthropic({
          apiKey,
          maxRetries: this.opts.maxRetries ?? 2,
          ...(this.opts.timeoutMs ? { timeout: this.opts.timeoutMs } : {}),
        });
    this.cached = { key: apiKey, client };
    return client;
  }

  /** Від конкретного до загального — оркестратор розрізняє ретраїбельні випадки. */
  private mapError(err: unknown, stage: Stage): unknown {
    if (err instanceof LlmError) return err;
    if (err instanceof Anthropic.APIUserAbortError) {
      return new LlmError('aborted', 'Request aborted', { providerId: this.id, stage });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return new LlmError('rate_limit', err.message, { providerId: this.id, stage, retryable: true, cause: err });
    }
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      return new LlmError('auth', err.message, { providerId: this.id, stage, cause: err });
    }
    if (err instanceof Anthropic.NotFoundError) {
      return new LlmError('model_not_found', err.message, { providerId: this.id, stage, cause: err });
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return new LlmError('transport', err.message, { providerId: this.id, stage, retryable: true, cause: err });
    }
    if (err instanceof Anthropic.APIError) {
      // Вичерпаний баланс приходить як звичайний 400 `invalid_request_error`,
      // тож без перевірки тексту він виглядав би як помилка запиту — і прогін
      // сумлінно повторив би ту саму приречену спробу для кожного завдання.
      if (isCreditBalanceError(err)) {
        return new LlmError('insufficient_credit', err.message, {
          providerId: this.id,
          stage,
          cause: err,
        });
      }
      const retryable = typeof err.status === 'number' && err.status >= 500;
      return new LlmError('api', err.message, { providerId: this.id, stage, retryable, cause: err });
    }
    return err;
  }
}

// ─── Хелпери ─────────────────────────────────────────────────────────────────

/**
 * Формулювання Anthropic: «Your credit balance is too low to access the
 * Anthropic API». Ловимо за змістом, а не за кодом — код тут звичайний 400.
 */
function isCreditBalanceError(err: { message?: string }): boolean {
  return /credit balance|insufficient.{0,20}credit|billing|quota exceeded/i.test(err.message ?? '');
}

/** PDF: base64 без переносів рядків, ліміт 32 МБ / 600 сторінок. */
function toDocumentBlock(doc: LlmDocument): Anthropic.Messages.DocumentBlockParam {
  const source: Anthropic.Messages.DocumentBlockParam['source'] =
    doc.mime === 'application/pdf'
      ? { type: 'base64', media_type: 'application/pdf', data: doc.base64.replace(/\s+/g, '') }
      : {
          type: 'text',
          media_type: 'text/plain',
          data: Buffer.from(doc.base64, 'base64').toString('utf8'),
        };

  const block: Anthropic.Messages.DocumentBlockParam = {
    type: 'document',
    source,
    title: doc.name,
  };
  if (doc.citations) block.citations = { enabled: true };
  if (doc.context) block.context = doc.context;
  return block;
}

function toUsage(usage: Anthropic.Messages.Usage | undefined): LlmUsage {
  return {
    input: usage?.input_tokens ?? 0,
    cachedInput: usage?.cache_read_input_tokens ?? 0,
    cacheWrite: usage?.cache_creation_input_tokens ?? 0,
    output: usage?.output_tokens ?? 0,
  };
}

/** Цитати живуть на text-блоках; page_location 1-індексований. */
function collectCitations(message: AnyMessage): Citation[] {
  const citations: Citation[] = [];
  for (const block of message.content) {
    if (block.type !== 'text' || !block.citations) continue;
    for (const citation of block.citations) {
      if (citation.type === 'page_location') {
        citations.push({
          quote: citation.cited_text,
          documentName: citation.document_title,
          documentIndex: citation.document_index,
          pageFrom: citation.start_page_number,
          pageTo: citation.end_page_number,
          charStart: null,
          charEnd: null,
          source: 'citations_api',
        });
      } else if (citation.type === 'char_location') {
        citations.push({
          quote: citation.cited_text,
          documentName: citation.document_title,
          documentIndex: citation.document_index,
          pageFrom: null,
          pageTo: null,
          charStart: citation.start_char_index,
          charEnd: citation.end_char_index,
          source: 'citations_api',
        });
      } else if (citation.type === 'content_block_location') {
        citations.push({
          quote: citation.cited_text,
          documentName: citation.document_title,
          documentIndex: citation.document_index,
          pageFrom: null,
          pageTo: null,
          charStart: null,
          charEnd: null,
          source: 'citations_api',
        });
      }
      // web_search / search_result у цьому конвеєрі не використовуються.
    }
  }
  return citations;
}

function extractToolInput<T>(req: CompleteRequest<T>, message: AnyMessage, providerId: string): unknown {
  const name = req.tool?.name;
  const inputs = message.content
    .filter((block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use')
    .filter((block) => !name || block.name === name)
    .map((block) => block.input);

  if (req.tool?.multiCall) return inputs;

  if (inputs.length === 0) {
    throw new LlmSchemaError(providerId, {
      stage: req.stage,
      issues: `model did not call tool "${name ?? '?'}"`,
      rawText: textOf(message).slice(0, 4_000),
    });
  }
  return inputs[0];
}

function extractStructured<T>(req: CompleteRequest<T>, message: AnyMessage, providerId: string): unknown {
  // parsed_output може бути null — завжди перевіряємо.
  if (message.parsed_output !== undefined && message.parsed_output !== null) {
    return message.parsed_output;
  }
  const text = textOf(message).trim();
  if (text.length === 0) {
    throw new LlmSchemaError(providerId, {
      stage: req.stage,
      issues: 'empty response: no parsed_output and no text blocks',
      rawText: '',
    });
  }
  try {
    return JSON.parse(stripCodeFence(text)) as unknown;
  } catch {
    throw new LlmSchemaError(providerId, {
      stage: req.stage,
      issues: 'parsed_output was null and the text body is not valid JSON',
      rawText: text.slice(0, 4_000),
    });
  }
}

function textOf(message: AnyMessage): string {
  return message.content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

/** Локальні моделі люблять обгортати JSON у ```json — Claude ні, але дешево підстрахуватись. */
export function stripCodeFence(text: string): string {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?\s*```\s*$/.exec(text);
  return fenced?.[1] ?? text;
}
