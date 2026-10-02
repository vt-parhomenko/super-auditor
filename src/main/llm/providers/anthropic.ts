/**
 * Провайдер Anthropic (architecture.md §7).
 *
 * Актуально на 2026-10 — цих правил тримаємось буквально:
 * - `temperature` / `top_p` / `top_k` на Opus 5.5 / Fable 5.1 / Opus 5 / Sonnet 5
 *   ВИДАЛЕНІ → 400. Детермінізм дає строга схема + низький effort, не температура.
 * - `thinking: { type: 'adaptive' }`; `budget_tokens` і `{type:'disabled'}`
 *   не шлемо ніколи (на Opus 5.5 і Fable 5.1 роздуми не вимикаються взагалі).
 * - глибина роздумів — `output_config.effort`, а не top-level поле;
 *   на Haiku 4.5 effort дає помилку → там його мовчки не передаємо.
 * - assistant prefill видалено → 400.
 * - примусовий `tool_choice` (`any` / `tool`) на Opus 5.5 і Fable 5.1 → 400,
 *   тому там `auto` + інструкція в промпті + `strict: true` на інструменті.
 * - Citations НЕСУМІСНІ з `output_config.format` → там, де потрібні і докази,
 *   і структура, працює strict tool use (`strict: true` на визначенні інструмента).
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { Effort, IsoDate, ModelInfo, ModelTier, Stage } from '@shared/domain';
import { EFFORTS } from '@shared/domain';
import { addUsage, estimateCost, getPricing, type ModelPricing } from '../cost';
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

/**
 * Статичний список для вибору моделі. ID дослівні — жодних суфіксів із датами.
 * Порядок — від найсильнішої до найдешевшої; живий `/v1/models` лише ДОДАЄ
 * моделі в кінець і нічого звідси не прибирає.
 */
export const ANTHROPIC_MODELS = [
  'claude-opus-5-5',
  'claude-fable-5-1',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-haiku-4-5',
] as const;

export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-5';

/**
 * Мінімальний max_tokens для моделей із thinking. На Opus 5 / Sonnet 5 thinking
 * увімкнений за замовчуванням, на Opus 5.5 / Fable 5.1 його не вимкнути взагалі,
 * а роздуми рахуються в max_tokens: критик із лімітом 2 000 на effort high
 * ризикує витратити все на роздуми й обірвати JSON. Платимо лише за фактичні
 * токени, тож запас нічого не коштує.
 */
export const THINKING_MIN_MAX_TOKENS = 16_000;

/** Понад цей max_tokens стрімінг обов'язковий, інакше HTTP-таймаут. */
export const STREAMING_THRESHOLD_TOKENS = 8_000;

interface StaticModelSpec {
  label: string;
  tier: ModelTier;
  maxOutputTokens: number;
}

const STATIC_MODEL_SPECS: Readonly<Record<(typeof ANTHROPIC_MODELS)[number], StaticModelSpec>> = {
  'claude-opus-5-5': { label: 'Claude Opus 5.5', tier: 'top', maxOutputTokens: 128_000 },
  'claude-fable-5-1': { label: 'Claude Fable 5.1', tier: 'top', maxOutputTokens: 128_000 },
  'claude-opus-5': { label: 'Claude Opus 5', tier: 'top', maxOutputTokens: 128_000 },
  'claude-sonnet-5': { label: 'Claude Sonnet 5', tier: 'balanced', maxOutputTokens: 128_000 },
  'claude-haiku-4-5': { label: 'Claude Haiku 4.5', tier: 'budget', maxOutputTokens: 64_000 },
};

/**
 * Моделі, на яких ПЕРЕВІРЕНО, що примусовий `tool_choice` працює.
 * Opus 5.5 і Fable 5.1 відповідають на нього 400, і невідомі майбутні моделі
 * теж вважаємо такими: `auto` працює скрізь, а примус — ні.
 */
const FORCED_TOOL_CHOICE_MODELS = new Set<string>(['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']);

/**
 * Старі покоління: effort або не приймають (Haiku 4.5, Sonnet 4.5 → помилка),
 * або не знають adaptive thinking. Можуть прийти лише з живого `/v1/models`.
 */
function isLegacyClaude(model: string): boolean {
  return (
    model.startsWith('claude-3') ||
    model.startsWith('claude-haiku-') ||
    /^claude-(opus|sonnet)-4(-[0-5])?(-\d{8})?$/.test(model)
  );
}

/** `output_config.effort` — на Haiku 4.5 і старших поколіннях дає помилку. */
export function anthropicSupportsEffort(model: string): boolean {
  return model.startsWith('claude-') && !isLegacyClaude(model);
}

/** `thinking: {type:'adaptive'}` — Opus 5.5, Fable 5.1, Opus 5, Sonnet 5 і невідомі нові `claude-*`. */
export function anthropicSupportsAdaptiveThinking(model: string): boolean {
  return anthropicSupportsEffort(model);
}

export function anthropicSupportsForcedToolChoice(model: string): boolean {
  return FORCED_TOOL_CHOICE_MODELS.has(model);
}

type MessageParams = Anthropic.Messages.MessageCreateParamsNonStreaming;
type AnyMessage = Anthropic.Messages.Message & { parsed_output?: unknown };

interface RequestOptionsLike {
  signal?: AbortSignal | null | undefined;
}

/** Поля `GET /v1/models`, які нам потрібні. */
export interface AnthropicLiveModel {
  id: string;
  display_name?: string | null;
  max_input_tokens?: number | null;
  max_tokens?: number | null;
}

export interface AnthropicModelsLike {
  /** SDK віддає PagePromise — він async-iterable і сам гортає сторінки. */
  list(params?: { limit?: number }, options?: RequestOptionsLike): AsyncIterable<AnthropicLiveModel>;
}

/** Що зберігаємо між запусками (`llm.catalogue.anthropic`). */
export interface StoredAnthropicCatalogue {
  version: 1;
  fetchedAt: IsoDate;
  models: Array<{ id: string; displayName: string | null; maxInputTokens: number | null; maxTokens: number | null }>;
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
  /** Потрібен лише для оновлення списку моделей. */
  models?: AnthropicModelsLike;
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
  /** Збережений живий список моделей (той самий механізм, що й у OpenRouter). */
  loadCatalogue?: () => unknown;
  saveCatalogue?: (value: StoredAnthropicCatalogue) => void;
  now?: () => number;
}

export class AnthropicProvider implements LlmProvider {
  readonly id = ANTHROPIC_PROVIDER_ID;
  readonly label = 'Anthropic (Claude)';
  /** Лише перелічені моделі: first-party id не вгадуємо. */
  readonly allowCustomModel = false;
  readonly supportsBalance = false;

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
  private live: StoredAnthropicCatalogue | null;

  constructor(opts: AnthropicProviderOptions) {
    this.opts = opts;
    this.live = loadStoredCatalogue(opts.loadCatalogue);
  }

  get defaultModel(): string {
    return this.opts.defaultModel ?? ANTHROPIC_DEFAULT_MODEL;
  }

  /** Статичний список + те, що повернув живий `/v1/models`. */
  get models(): readonly string[] {
    return this.listModelInfo().map((info) => info.id);
  }

  isConfigured(): boolean {
    if (this.opts.client) return true;
    const key = this.opts.getApiKey();
    return typeof key === 'string' && key.length > 0;
  }

  pricingFor(model: string): ModelPricing | null {
    return getPricing(model);
  }

  listModelInfo(): ModelInfo[] {
    const infos: ModelInfo[] = ANTHROPIC_MODELS.map((id) => {
      const spec = STATIC_MODEL_SPECS[id];
      return anthropicModelInfo(id, {
        label: spec.label,
        contextWindow: getPricing(id)?.contextWindow ?? null,
        maxOutputTokens: spec.maxOutputTokens,
        recommended: true,
        tier: spec.tier,
      });
    });

    const known = new Set<string>(ANTHROPIC_MODELS);
    for (const model of this.live?.models ?? []) {
      if (known.has(model.id)) continue;
      known.add(model.id);
      infos.push(
        anthropicModelInfo(model.id, {
          label: model.displayName ?? model.id,
          contextWindow: model.maxInputTokens ?? getPricing(model.id)?.contextWindow ?? null,
          maxOutputTokens: model.maxTokens,
          recommended: false,
          tier: tierOf(model.id),
        }),
      );
    }
    return infos;
  }

  catalogueUpdatedAt(): IsoDate | null {
    return this.live?.fetchedAt ?? null;
  }

  /**
   * `GET /v1/models` — без токенів, але з ключем. Нові id додаються в кінець
   * списку; ціна невідомої моделі лишається null (не вигадуємо).
   */
  async refreshModels(signal?: AbortSignal): Promise<void> {
    const client = this.resolveClient();
    if (!client.models) {
      throw new LlmUnsupportedError(this.id, 'This Anthropic client cannot list models.');
    }

    const models: StoredAnthropicCatalogue['models'] = [];
    try {
      for await (const model of client.models.list({ limit: 100 }, signal ? { signal } : {})) {
        if (typeof model.id !== 'string' || model.id.length === 0) continue;
        models.push({
          id: model.id,
          displayName: typeof model.display_name === 'string' ? model.display_name : null,
          maxInputTokens: typeof model.max_input_tokens === 'number' ? model.max_input_tokens : null,
          maxTokens: typeof model.max_tokens === 'number' ? model.max_tokens : null,
        });
      }
    } catch (err) {
      throw this.mapError(err, null);
    }

    const now = this.opts.now?.() ?? Date.now();
    this.live = { version: 1, fetchedAt: new Date(now).toISOString(), models };
    try {
      this.opts.saveCatalogue?.(this.live);
    } catch (err) {
      // Не збереглось — список однаково живе в памʼяті до перезапуску.
      console.error('[llm] не вдалося зберегти каталог Anthropic:', err);
    }
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

    const maxTokens = anthropicSupportsAdaptiveThinking(model)
      ? Math.max(req.maxOutputTokens, THINKING_MIN_MAX_TOKENS)
      : req.maxOutputTokens;

    const params: MessageParams = {
      model,
      max_tokens: maxTokens,
      system,
      messages,
    };

    // Haiku 4.5 відповідає помилкою на будь-який effort — мовчки не передаємо.
    const effort = req.effort && anthropicSupportsEffort(model) ? req.effort : undefined;

    const outputConfig: Anthropic.Messages.OutputConfig = {};
    if (effort) outputConfig.effort = effort;
    if (mode === 'structured') outputConfig.format = zodOutputFormat(req.schema);
    if (Object.keys(outputConfig).length > 0) params.output_config = outputConfig;

    // budget_tokens і {type:'disabled'} не шлемо ніколи; глибина — це effort.
    if (effort && anthropicSupportsAdaptiveThinking(model)) {
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
      params.tool_choice = toolChoiceFor(model, tool.name, tool.multiCall === true);
    }

    return params;
  }

  async complete<T>(req: CompleteRequest<T>, signal: AbortSignal): Promise<CompleteResult<T>> {
    const model = req.model ?? this.defaultModel;
    const mode = this.resolveOutputMode(req);
    const client = this.resolveClient();
    const startedAt = Date.now();

    const send = async (request: CompleteRequest<T>): Promise<AnyMessage> => {
      const params = this.buildParams(request, model);
      try {
        if (params.max_tokens > STREAMING_THRESHOLD_TOKENS) {
          return await client.messages.stream(params, { signal }).finalMessage();
        }
        if (mode === 'structured') return await client.messages.parse(params, { signal });
        return await client.messages.create(params, { signal });
      } catch (err) {
        throw this.mapError(err, req.stage);
      }
    };

    let message = await send(req);
    let usage = toUsage(message.usage);

    // Без примусового tool_choice (Opus 5.5, Fable 5.1 — там він дає 400) модель
    // інколи відповідає текстом і не викликає інструмент. Для батчу судження це
    // «порожній результат», який інакше пройшов би схему масиву, а завдання
    // позначилось би виконаним. Один повтор із прямою вимогою, і лише потім — помилка.
    if (
      mode === 'tool' &&
      req.tool &&
      !anthropicSupportsForcedToolChoice(model) &&
      message.stop_reason !== 'refusal' &&
      !hasToolCall(message, req.tool.name)
    ) {
      message = await send(withToolNudge(req, req.tool.name, req.tool.multiCall === true));
      usage = addUsage(usage, toUsage(message.usage));
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
  private mapError(err: unknown, stage: Stage | null): unknown {
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
 * Примус викликати інструмент — лише там, де він перевірено працює.
 * Деінде `auto`: промпт і так каже «викличи `report_finding` рівно раз на
 * вимогу», а `strict: true` на інструменті тримає форму аргументів.
 */
function toolChoiceFor(model: string, toolName: string, multiCall: boolean): Anthropic.Messages.ToolChoice {
  if (anthropicSupportsForcedToolChoice(model)) {
    return multiCall ? { type: 'any' } : { type: 'tool', name: toolName, disable_parallel_tool_use: true };
  }
  return multiCall ? { type: 'auto' } : { type: 'auto', disable_parallel_tool_use: true };
}

function tierOf(model: string): ModelTier | null {
  if (/^claude-(fable|opus|mythos)-/.test(model)) return 'top';
  if (model.startsWith('claude-sonnet-')) return 'balanced';
  if (model.startsWith('claude-haiku-')) return 'budget';
  return null;
}

function anthropicModelInfo(
  id: string,
  over: Pick<ModelInfo, 'label' | 'contextWindow' | 'maxOutputTokens' | 'recommended' | 'tier'>,
): ModelInfo {
  const price = getPricing(id);
  // [] — effort для цієї моделі не передаємо взагалі (Haiku 4.5, старі покоління).
  const efforts: Effort[] = anthropicSupportsEffort(id) ? [...EFFORTS] : [];
  return {
    id,
    label: over.label,
    vendor: 'Anthropic',
    contextWindow: over.contextWindow,
    maxOutputTokens: over.maxOutputTokens,
    inputPerMTok: price?.inputPerMTok ?? null,
    outputPerMTok: price?.outputPerMTok ?? null,
    cacheReadPerMTok: price?.cacheReadPerMTok ?? null,
    efforts,
    recommended: over.recommended,
    tier: over.tier,
  };
}

/** Зіпсований або чужий запис просто ігноруємо — є статичний список. */
function loadStoredCatalogue(load: (() => unknown) | undefined): StoredAnthropicCatalogue | null {
  let raw: unknown;
  try {
    raw = load?.();
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Partial<StoredAnthropicCatalogue>;
  if (record.version !== 1 || typeof record.fetchedAt !== 'string' || !Array.isArray(record.models)) return null;
  const models = record.models.filter(
    (model): model is StoredAnthropicCatalogue['models'][number] =>
      !!model && typeof model === 'object' && typeof (model as { id?: unknown }).id === 'string',
  );
  return { version: 1, fetchedAt: record.fetchedAt, models };
}

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

  // Порожній масив пройшов би схему батчу як «нуль висновків» — це помилка, а не результат.
  if (inputs.length === 0) {
    throw new LlmSchemaError(providerId, {
      stage: req.stage,
      issues: `model did not call tool "${name ?? '?'}"`,
      rawText: textOf(message).slice(0, 4_000),
    });
  }
  return req.tool?.multiCall ? inputs : inputs[0];
}

function hasToolCall(message: AnyMessage, toolName: string): boolean {
  return message.content.some((block) => block.type === 'tool_use' && block.name === toolName);
}

/** Той самий запит із прямою вимогою відповісти викликом інструмента. */
function withToolNudge<T>(req: CompleteRequest<T>, toolName: string, multiCall: boolean): CompleteRequest<T> {
  const nudge = multiCall
    ? `Respond only by calling the \`${toolName}\` tool, once for each item. Do not answer in plain text.`
    : `Respond only by calling the \`${toolName}\` tool. Do not answer in plain text.`;
  const messages = [...req.messages];
  const lastUser = messages.map((m) => m.role).lastIndexOf('user');
  const target = lastUser >= 0 ? messages[lastUser] : undefined;
  if (target) messages[lastUser] = { ...target, content: `${target.content}\n\n${nudge}` };
  else messages.push({ role: 'user', content: nudge });
  return { ...req, messages };
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
