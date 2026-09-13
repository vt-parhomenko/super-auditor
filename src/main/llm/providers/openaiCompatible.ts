/**
 * Адаптер під OpenAI-сумісний `/v1/chat/completions`: Ollama, LM Studio,
 * vLLM, llama.cpp — один код на всіх (architecture.md §7 «Локальні моделі»).
 *
 * Обмеження закладені в адаптер, а не в кожен виклик:
 * - мале вікно (8–32k) → великі документи доведеться чанкувати вище за течією;
 * - слабкий structured output → JSON-режим + retry-repair: помилка валідації
 *   Zod повертається в промпт наступної спроби (до 3 спроб);
 * - немає citations → тільки `model_quote` + обов'язкова пост-верифікація
 *   через `verifyEvidence`.
 */

import { z } from 'zod';
import { estimateCost, FREE_PRICING, type ModelPricing } from '../cost';
import { LlmError, LlmNotConfiguredError, LlmSchemaError } from '../errors';
import type {
  CompleteRequest,
  CompleteResult,
  LlmProvider,
  LlmUsage,
  ProviderCaps,
} from '../types';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface OpenAiCompatibleOptions {
  id?: string;
  label?: string;
  /** Напр. 'http://127.0.0.1:11434/v1' — без завершального слеша. */
  baseUrl: string;
  model: string;
  models?: string[];
  /** Локальні сервери зазвичай без ключа; хмарні OpenAI-сумісні — з ключем. */
  getApiKey?: () => string | null | undefined;
  /** true → без ключа провайдер вважається неналаштованим. Локальним не треба. */
  requiresApiKey?: boolean;
  fetchImpl?: FetchLike;
  contextWindow?: number;
  maxOutputTokens?: number;
  /** Скільки разів чинити відповідь. 1 = без repair. */
  maxRepairAttempts?: number;
  /**
   * Локальні моделі за замовчуванням мають temperature ~0.8, що на строгій
   * задачі шкодить. Тут параметр НЕ видалений (це не Claude), тож ставимо 0.
   */
  temperature?: number | null;
  pricing?: ModelPricing;
  cloud?: boolean;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly id: string;
  readonly label: string;
  readonly models: readonly string[];
  readonly caps: ProviderCaps;

  private readonly opts: OpenAiCompatibleOptions;

  constructor(opts: OpenAiCompatibleOptions) {
    this.opts = opts;
    this.id = opts.id ?? 'openai-compatible';
    this.label = opts.label ?? 'Local (OpenAI-compatible)';
    this.models = opts.models ?? [opts.model];
    this.caps = {
      contextWindow: opts.contextWindow ?? 32_768,
      promptCaching: false,
      structuredOutput: 'json_mode',
      citations: false,
      documentInput: ['text'],
      maxOutputTokens: opts.maxOutputTokens ?? 4_096,
      cloud: opts.cloud ?? false,
    };
  }

  get defaultModel(): string {
    return this.opts.model;
  }

  isConfigured(): boolean {
    if (!this.opts.baseUrl) return false;
    // Ollama / LM Studio / llama.cpp ключа не мають — вимагаємо його лише явно.
    if (!this.opts.requiresApiKey) return true;
    const key = this.opts.getApiKey?.();
    return typeof key === 'string' && key.length > 0;
  }

  /**
   * Системний блок: інструкції + стабільний префікс + документи текстом +
   * очікувана JSON-схема. Prompt caching тут немає, тому «префікс» — просто текст.
   */
  buildSystemPrompt<T>(req: CompleteRequest<T>): string {
    const parts: string[] = [req.system];

    if (req.cachedPrefix) parts.push(req.cachedPrefix);

    for (const doc of req.documents ?? []) {
      const text =
        doc.mime === 'text/plain'
          ? Buffer.from(doc.base64, 'base64').toString('utf8')
          : '[binary document omitted: this provider accepts plain text only]';
      parts.push(`<document name="${doc.name}">\n${text}\n</document>`);
    }

    if (req.tool) {
      parts.push(
        `You must answer by producing the input of the tool "${req.tool.name}".\n${req.tool.description}`,
      );
    }

    const lines = [
      'Reply with a single JSON object and nothing else. No prose, no markdown fence.',
      'The object must validate against this JSON Schema:',
      jsonSchemaFor(req),
      req.tool?.multiCall
        ? `Wrap the results as {"${req.tool.name}": [ ... one object per item ... ]}.`
        : null,
      'Quotes must be copied character for character from the supplied text: this provider has no citations API, so every quote is verified mechanically afterwards and an unverifiable quote voids the verdict.',
    ].filter((line): line is string => line !== null);

    parts.push(lines.join('\n'));
    return parts.join('\n\n');
  }

  async complete<T>(req: CompleteRequest<T>, signal: AbortSignal): Promise<CompleteResult<T>> {
    if (!this.isConfigured()) throw new LlmNotConfiguredError(this.id);

    const model = req.model ?? this.opts.model;
    const startedAt = Date.now();
    const maxAttempts = Math.max(1, this.opts.maxRepairAttempts ?? 3);

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: this.buildSystemPrompt(req) },
      ...req.messages.map((message) => ({ role: message.role, content: message.content })),
    ];

    const usage: LlmUsage = { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 };
    let lastIssues = 'no attempt was made';
    let lastRaw = '';
    let lastResponse: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await this.postChat(model, messages, req, signal);
      lastResponse = response;
      usage.input += response.usage?.prompt_tokens ?? 0;
      usage.output += response.usage?.completion_tokens ?? 0;

      const content = response.choices?.[0]?.message?.content ?? '';
      lastRaw = content;

      const decoded = decodeJson(content);
      if (!decoded.ok) {
        lastIssues = decoded.error;
      } else {
        const parsed = req.schema.safeParse(unwrap(decoded.value, req));
        if (parsed.success) {
          return {
            data: parsed.data,
            citations: [], // немає citations API — докази верифікуються механічно
            usage,
            costUsd: estimateCost(model, usage, this.opts.pricing ?? FREE_PRICING),
            modelId: model,
            providerId: this.id,
            latencyMs: Date.now() - startedAt,
            raw: lastResponse,
            fromCache: false,
          };
        }
        lastIssues = z.prettifyError(parsed.error);
      }

      if (attempt < maxAttempts) {
        // Помилку валідації повертаємо в промпт наступної спроби.
        messages.push({ role: 'assistant', content });
        messages.push({
          role: 'user',
          content: `That response was rejected by the schema validator:\n\n${lastIssues}\n\nReturn the corrected JSON object only. Do not explain the change.`,
        });
      }
    }

    throw new LlmSchemaError(this.id, {
      stage: req.stage,
      issues: lastIssues,
      rawText: lastRaw.slice(0, 4_000),
      attempts: maxAttempts,
    });
  }

  private async postChat<T>(
    model: string,
    messages: Array<{ role: string; content: string }>,
    req: CompleteRequest<T>,
    signal: AbortSignal,
  ): Promise<ChatCompletionResponse> {
    const url = `${this.opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const apiKey = this.opts.getApiKey?.();
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;

    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: Math.min(req.maxOutputTokens, this.caps.maxOutputTokens),
      response_format: { type: 'json_object' },
      stream: false,
    };
    const temperature = this.opts.temperature === undefined ? 0 : this.opts.temperature;
    if (temperature !== null) body.temperature = temperature;

    const doFetch = this.opts.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
    if (!doFetch) {
      throw new LlmError('transport', 'global fetch is unavailable', {
        providerId: this.id,
        stage: req.stage,
      });
    }

    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal.aborted) {
        throw new LlmError('aborted', 'Request aborted', { providerId: this.id, stage: req.stage });
      }
      throw new LlmError('transport', `Cannot reach ${url}`, {
        providerId: this.id,
        stage: req.stage,
        retryable: true,
        cause: err,
      });
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new LlmError('api', `${response.status} ${response.statusText}: ${text.slice(0, 500)}`, {
        providerId: this.id,
        stage: req.stage,
        retryable: response.status >= 500,
      });
    }

    return (await response.json()) as ChatCompletionResponse;
  }
}

// ─── Хелпери ─────────────────────────────────────────────────────────────────

/** JSON Schema для промпта. Слабкі моделі без неї не тримають форму. */
function jsonSchemaFor(req: CompleteRequest<unknown>): string {
  if (req.tool) return JSON.stringify(req.tool.inputSchema, null, 2);
  try {
    return JSON.stringify(z.toJSONSchema(req.schema, { io: 'output' }), null, 2);
  } catch {
    return '{ "type": "object" }';
  }
}

type Decoded = { ok: true; value: unknown } | { ok: false; error: string };

function decodeJson(text: string): Decoded {
  const trimmed = stripFence(text).trim();
  if (trimmed.length === 0) return { ok: false, error: 'empty response body' };
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch (err) {
    return { ok: false, error: `response is not valid JSON: ${(err as Error).message}` };
  }
}

function stripFence(text: string): string {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n?```/.exec(text);
  return fenced?.[1] ?? text;
}

/**
 * JSON-режим завжди повертає об'єкт, а батч-інструмент чекає масив —
 * розгортаємо обгортку `{ "<tool>": [...] }`.
 */
function unwrap(value: unknown, req: CompleteRequest<unknown>): unknown {
  if (!req.tool?.multiCall) return value;
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const byToolName = record[req.tool.name];
    if (Array.isArray(byToolName)) return byToolName;
    const arrays = Object.values(record).filter(Array.isArray);
    if (arrays.length === 1) return arrays[0];
  }
  return value;
}
