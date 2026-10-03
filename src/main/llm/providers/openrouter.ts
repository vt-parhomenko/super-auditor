/**
 * Провайдер OpenRouter — один ключ на моделі багатьох розробників
 * (Claude, GPT-6, DeepSeek, Gemini, Qwen, Kimi, GLM, Grok…) через
 * OpenAI-сумісний `POST /api/v1/chat/completions`.
 *
 * Рішення, які тут закладено:
 * - ЗАВЖДИ стрімимо (SSE). Довгий high-effort виклик без стріму впирається в
 *   300-секундний таймаут заголовків у fetch Node; у стрімі OpenRouter шле
 *   keep-alive коментарі `: OPENROUTER PROCESSING`.
 * - Структура відповіді — `response_format: json_schema` зі строгою схемою і
 *   `provider.require_parameters: true` (запит іде лише туди, де схему
 *   справді вміють). Якщо модель цього не вміє — один раз переходимо на
 *   `json_object` зі схемою в інструкціях і памʼятаємо це до перезапуску.
 *   Остаточне слово — за zod; при помилці валідації до 2 ходів repair.
 * - Citations API тут немає: цитати перевіряються механічно
 *   (`verifyEvidence`), тому інструкція вимагає копіювати їх дослівно.
 * - Приватність за замовчуванням: `provider.data_collection: 'deny'` —
 *   стандарти замовника «лише для отримувача» (ADR-8). Якщо такого ендпоінта
 *   немає, кажемо про це прямо, а не тихо знімаємо обмеження.
 * - `prompt_tokens` OpenRouter ВКЛЮЧАЄ кешовані токени, а наше `usage.input`
 *   означає некешований вхід (як у Anthropic) — віднімаємо.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Effort, IsoDate, ModelInfo, Stage } from '@shared/domain';
import type { ProviderBalance } from '@shared/ipc';
import { estimateCost, type ModelPricing } from '../cost';
import { LlmError, LlmNotConfiguredError, LlmRefusalError, LlmSchemaError, LlmUnsupportedError } from '../errors';
import type { CompleteRequest, CompleteResult, LlmDocument, LlmProvider, LlmUsage, ProviderCaps } from '../types';
import { emptyLlmUsage } from '../types';
import { strictifySchema, stripOptionalNulls, type JsonSchema } from './jsonSchema';
import type { FetchLike } from './openaiCompatible';
import { OpenRouterAccount } from './openrouterAccount';
import {
  OPENROUTER_API_BASE,
  OpenRouterCatalogue,
  pricingOfEntry,
  type OpenRouterModelEntry,
  type StoredOpenRouterCatalogue,
} from './openrouterCatalogue';
import { SseParser } from './sse';

export const OPENROUTER_PROVIDER_ID = 'openrouter';
/** Дзеркало дефолту Anthropic: збалансована модель для етапів без явного вибору. */
export const OPENROUTER_DEFAULT_MODEL = 'anthropic/claude-sonnet-5.5';
/** Id management-ключа в сховищі секретів. Лише для `GET /credits`. */
export const OPENROUTER_MANAGEMENT_KEY_ID = 'openrouter:management';

/** Без стріму довгі виклики з роздумами вбиває таймаут; тут лише межі на випадок без каталогу. */
const DEFAULT_REASONING_MAX_TOKENS = 64_000;
const MIN_REASONING_MAX_TOKENS = 32_000;
const MAX_RETRY_DELAY_MS = 60_000;

export interface OpenRouterProviderOptions {
  /** Ключ приходить ззовні (safeStorage), з диска цей шар нічого не читає. */
  getApiKey: () => string | null | undefined;
  /** Management-ключ — ЛИШЕ для залишку на рахунку (`/credits`). */
  getManagementKey?: () => string | null | undefined;
  fetchImpl?: FetchLike;
  baseUrl?: string;
  defaultModel?: string;
  /** false → каталог сам не ходить у мережу (виклики моделей це не зачіпає). */
  allowNetwork?: boolean;
  loadCatalogue?: () => unknown;
  saveCatalogue?: (value: StoredOpenRouterCatalogue) => void;
  now?: () => number;
  /** Скільки разів просимо модель виправити відповідь після помилки zod. */
  maxRepairTurns?: number;
  /** Повтори на 408 / 429 / 5xx / обрив мережі. */
  maxRetries?: number;
  retryBaseDelayMs?: number;
  /** Пауза між повторами — підміняється в тестах. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** ADR-8: за замовчуванням лише провайдери, що не збирають дані. */
  dataCollection?: 'deny' | 'allow';
  balanceTtlMs?: number;
}

/** Як просимо структуру: строга схема або «просто JSON» + схема в тексті. */
export type OpenRouterOutputMode = 'json_schema' | 'json_object';

interface TextPart {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

interface FilePart {
  type: 'file';
  file: { filename: string; file_data: string };
  cache_control?: { type: 'ephemeral' };
}

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<TextPart | FilePart>;
}

/** Як відповідь лягає на `req.schema`. */
interface OutputPlan {
  /** Схема об'єкта відповіді (не строга) — для json_object і як основа строгої. */
  responseSchema: JsonSchema;
  /** Відповідь загорнута в `{ items: [...] }` — розгортаємо перед zod. */
  wrapped: boolean;
  /** Схема розгорнутого значення — по ній прибираємо null необовʼязкових полів. */
  valueSchema: JsonSchema;
  name: string;
}

interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } | null;
  completion_tokens_details?: { reasoning_tokens?: number | null } | null;
  cost?: number | null;
  is_byok?: boolean;
  cost_details?: { upstream_inference_cost?: number | null } | null;
}

interface OpenRouterErrorBody {
  code?: number | string;
  message?: string;
  metadata?: Record<string, unknown>;
}

/** Що вдалося зібрати з одного HTTP-виклику. */
export interface StreamOutcome {
  id: string | null;
  model: string | null;
  upstreamProvider: string | null;
  content: string;
  refusal: string;
  finishReason: string | null;
  nativeFinishReason: string | null;
  usage: OpenRouterUsage | null;
  error: OpenRouterErrorBody | null;
}

/** Помилка HTTP або потоку до перетворення на `LlmError`. `status: null` — мережа. */
export class OpenRouterApiError extends Error {
  readonly status: number | null;
  readonly errorType: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly retryAfterMs: number | null;
  readonly retryable: boolean;

  constructor(opts: {
    status: number | null;
    message: string;
    errorType?: string | null;
    metadata?: Record<string, unknown> | null;
    retryAfterMs?: number | null;
    cause?: unknown;
  }) {
    super(opts.message);
    this.name = 'OpenRouterApiError';
    this.status = opts.status;
    this.errorType = opts.errorType ?? null;
    this.metadata = opts.metadata ?? null;
    this.retryAfterMs = opts.retryAfterMs ?? null;
    this.cause = opts.cause;
    this.retryable = isRetryable(this);
  }
}

export class OpenRouterProvider implements LlmProvider {
  readonly id = OPENROUTER_PROVIDER_ID;
  readonly label = 'OpenRouter';
  readonly allowCustomModel = true;
  readonly supportsBalance = true;
  readonly managementKeyId = OPENROUTER_MANAGEMENT_KEY_ID;

  readonly caps: ProviderCaps = {
    contextWindow: 1_000_000,
    promptCaching: true,
    structuredOutput: 'schema',
    citations: false,
    documentInput: ['text', 'pdf'],
    maxOutputTokens: 128_000,
    cloud: true,
  };

  readonly catalogue: OpenRouterCatalogue;
  private readonly account: OpenRouterAccount;
  /** Моделі, що не прийняли json_schema, — до кінця процесу йдемо в json_object. */
  private readonly jsonObjectOnly = new Set<string>();

  constructor(private readonly opts: OpenRouterProviderOptions) {
    this.catalogue = new OpenRouterCatalogue({
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
      allowNetwork: opts.allowNetwork === true,
      ...(opts.loadCatalogue ? { load: opts.loadCatalogue } : {}),
      ...(opts.saveCatalogue ? { save: opts.saveCatalogue } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    });
    this.account = new OpenRouterAccount({
      getApiKey: opts.getApiKey,
      getManagementKey: opts.getManagementKey ?? (() => null),
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
      ...(opts.now ? { now: opts.now } : {}),
      ...(opts.balanceTtlMs !== undefined ? { ttlMs: opts.balanceTtlMs } : {}),
    });
  }

  get defaultModel(): string {
    return this.opts.defaultModel ?? OPENROUTER_DEFAULT_MODEL;
  }

  /** Модель за замовчуванням першою, далі каталог. */
  get models(): readonly string[] {
    const ids = this.catalogue.listModelInfo().map((info) => info.id);
    return [this.defaultModel, ...ids.filter((id) => id !== this.defaultModel)];
  }

  isConfigured(): boolean {
    const key = this.opts.getApiKey();
    return typeof key === 'string' && key.length > 0;
  }

  pricingFor(model: string): ModelPricing | null {
    const entry = this.catalogue.lookup(model);
    return entry ? pricingOfEntry(entry) : null;
  }

  listModelInfo(): ModelInfo[] {
    return this.catalogue.listModelInfo();
  }

  catalogueUpdatedAt(): IsoDate | null {
    return this.catalogue.updatedAt();
  }

  refreshModels(signal?: AbortSignal): Promise<void> {
    return this.catalogue.refresh(signal);
  }

  refreshModelsInBackground(): void {
    this.catalogue.refreshInBackground();
  }

  managementKeyConfigured(): boolean {
    return this.account.managementKeyConfigured();
  }

  balance(signal?: AbortSignal): Promise<ProviderBalance | null> {
    return this.account.balance(signal);
  }

  /** Чи памʼятаємо модель як «лише json_object» (для тестів і діагностики). */
  isJsonObjectOnly(model: string): boolean {
    return this.jsonObjectOnly.has(model);
  }

  // ─── Виклик ────────────────────────────────────────────────────────────────

  async complete<T>(req: CompleteRequest<T>, signal: AbortSignal): Promise<CompleteResult<T>> {
    const apiKey = this.opts.getApiKey();
    if (!apiKey) throw new LlmNotConfiguredError(this.id, 'OpenRouter API key is not set.');

    // Застарілий каталог оновлюється у фоні — виклик на це не чекає.
    this.catalogue.refreshInBackground();

    const model = req.model ?? this.defaultModel;
    const entry = this.catalogue.lookup(model);
    const plan = this.outputPlan(req);
    const startedAt = Date.now();

    let mode: OpenRouterOutputMode =
      this.jsonObjectOnly.has(model) || entry?.structuredOutputs === false ? 'json_object' : 'json_schema';
    let fellBack = false;

    const maxTurns = 1 + Math.max(0, this.opts.maxRepairTurns ?? 2);
    const repairs: OpenRouterMessage[] = [];
    const usage: LlmUsage = emptyLlmUsage();
    let costUsd = 0;
    /** Сирі відповіді кожної спроби — підуть у `llm_call.response_json`. */
    const calls: Array<StreamOutcome & { mode: OpenRouterOutputMode }> = [];
    let lastIssues = 'no attempt was made';
    let lastRaw = '';

    for (let turn = 1; turn <= maxTurns; ) {
      const body = this.buildBody(req, model, mode, repairs);
      let outcome: StreamOutcome;
      try {
        outcome = await this.send(body, apiKey, req.stage, signal);
      } catch (err) {
        if (signal.aborted) throw abortedError(this.id, req.stage);
        if (
          err instanceof OpenRouterApiError &&
          mode === 'json_schema' &&
          !fellBack &&
          isStructuredOutputRejection(err)
        ) {
          // Схему не прийняли — один раз пробуємо json_object і більше не мучимо модель.
          this.jsonObjectOnly.add(model);
          mode = 'json_object';
          fellBack = true;
          continue;
        }
        throw this.toLlmError(err, req.stage, model, mode);
      }

      const callUsage = openRouterUsageToLlm(outcome.usage);
      usage.input += callUsage.input;
      usage.cachedInput += callUsage.cachedInput;
      usage.cacheWrite += callUsage.cacheWrite;
      usage.output += callUsage.output;
      costUsd += this.costOf(model, outcome.usage, callUsage);
      calls.push({ ...outcome, mode });

      if (outcome.finishReason === 'content_filter' || outcome.refusal.trim().length > 0) {
        throw new LlmRefusalError(this.id, {
          stage: req.stage,
          category: outcome.nativeFinishReason ?? outcome.finishReason ?? 'refusal',
          explanation: outcome.refusal.trim() || null,
        });
      }

      const decoded = decodeJson(outcome.content);
      if (!decoded.ok) {
        if (outcome.finishReason === 'length') {
          throw new LlmSchemaError(this.id, {
            stage: req.stage,
            issues: `the response was truncated at max_tokens (${String(body.max_tokens)}) before the JSON was complete (finish_reason: length)`,
            rawText: outcome.content.slice(0, 4_000),
            attempts: turn,
          });
        }
        lastIssues = decoded.error;
      } else {
        const candidate = this.normalizeValue(decoded.value, req, plan);
        const parsed = req.schema.safeParse(candidate);
        if (parsed.success) {
          return {
            data: parsed.data,
            citations: [], // citations API немає — докази перевіряє verifyEvidence
            usage,
            costUsd,
            modelId: model,
            providerId: this.id,
            latencyMs: Date.now() - startedAt,
            raw: { provider: this.id, model, calls },
            fromCache: false,
          };
        }
        lastIssues = z.prettifyError(parsed.error);
      }

      lastRaw = outcome.content;
      if (turn < maxTurns) {
        // Порожню відповідь асистента не повертаємо в розмову: апстріми Anthropic
        // відхиляють порожній content з 400, і ремонт зламався б сам.
        if (outcome.content.trim().length > 0) {
          repairs.push({ role: 'assistant', content: outcome.content });
        }
        repairs.push({
          role: 'user',
          content: `That response was rejected by the schema validator:\n\n${lastIssues}\n\nReturn the corrected JSON object only. Do not explain the change.`,
        });
      }
      turn += 1;
    }

    throw new LlmSchemaError(this.id, {
      stage: req.stage,
      issues: lastIssues,
      rawText: lastRaw.slice(0, 4_000),
      attempts: maxTurns,
    });
  }

  // ─── Тіло запиту ───────────────────────────────────────────────────────────

  /**
   * Тіло `chat/completions`. Публічне свідомо: його перевіряють тести
   * (cache_control, session_id, строга схема, effort, max_tokens, приватність).
   */
  buildBody<T>(
    req: CompleteRequest<T>,
    model: string,
    mode: OpenRouterOutputMode = 'json_schema',
    extraMessages: OpenRouterMessage[] = [],
  ): Record<string, unknown> {
    const entry = this.catalogue.lookup(model);
    const plan = this.outputPlan(req);
    const messages = [...this.buildMessages(req, model, mode, plan), ...extraMessages];

    const effort = this.reasoningEffortFor(entry, req.effort);
    const reasoningOn = effort !== null || entry?.reasoningMandatory === true;
    const modelMax = entry?.maxOutputTokens ?? null;
    // Токени роздумів рахуються в max_tokens: без запасу модель «продумає»
    // весь бюджет і поверне порожню відповідь з finish_reason: length.
    const maxTokens = reasoningOn
      ? Math.min(modelMax ?? DEFAULT_REASONING_MAX_TOKENS, Math.max(req.maxOutputTokens * 3, MIN_REASONING_MAX_TOKENS))
      : modelMax !== null
        ? Math.min(req.maxOutputTokens, modelMax)
        : req.maxOutputTokens;

    const provider: Record<string, unknown> = { data_collection: this.opts.dataCollection ?? 'deny' };
    if (mode === 'json_schema') provider.require_parameters = true;

    const body: Record<string, unknown> = {
      model,
      messages,
      stream: true,
      max_tokens: maxTokens,
      response_format:
        mode === 'json_schema'
          ? {
              type: 'json_schema',
              json_schema: { name: plan.name, strict: true, schema: strictifySchema(plan.responseSchema) },
            }
          : { type: 'json_object' },
      provider,
      // Усі батчі одного документа — на той самий апстрім: там уже лежить кеш префікса.
      session_id: sessionIdFor(model, req.system, req.cachedPrefix),
    };
    // temperature не шлемо: на сучасних моделях з роздумами її або видалено, або ігнорують.
    if (effort !== null) body.reasoning = { effort, exclude: true };
    if ((req.documents ?? []).some((doc) => doc.mime === 'application/pdf')) {
      // Лише нативне читання PDF: OCR-движки — це ще одна третя сторона й окрема плата.
      body.plugins = [{ id: 'file-parser', pdf: { engine: 'native' } }];
    }
    return body;
  }

  private buildMessages<T>(
    req: CompleteRequest<T>,
    model: string,
    mode: OpenRouterOutputMode,
    plan: OutputPlan,
  ): OpenRouterMessage[] {
    // Порядок важливий для кешу: стабільне спочатку, breakpoint — на останньому
    // стабільному блоці. OpenRouter переносить block-level cache_control на
    // Anthropic/Gemini і в prompt_cache_breakpoint для GPT-5.6+; решта кешує сама.
    const system: TextPart[] = [
      { type: 'text', text: req.system },
      { type: 'text', text: this.outputInstructions(req, plan, mode) },
    ];
    if (req.cachedPrefix) system.push({ type: 'text', text: req.cachedPrefix });
    const lastSystem = system[system.length - 1];
    if (lastSystem) lastSystem.cache_control = { type: 'ephemeral' };

    const entry = this.catalogue.lookup(model);
    const documents = (req.documents ?? []).map((doc) => this.toDocumentPart(doc, model, entry));
    const lastDocument = documents[documents.length - 1];
    if (lastDocument) lastDocument.cache_control = { type: 'ephemeral' };

    const messages: OpenRouterMessage[] = [{ role: 'system', content: system }];
    req.messages.forEach((message, index) => {
      if (index === 0 && documents.length > 0 && message.role === 'user') {
        messages.push({ role: 'user', content: [...documents, { type: 'text', text: message.content }] });
      } else {
        messages.push({ role: message.role, content: message.content });
      }
    });
    if (documents.length > 0 && req.messages[0]?.role !== 'user') {
      messages.splice(1, 0, { role: 'user', content: documents });
    }
    return messages;
  }

  private toDocumentPart(doc: LlmDocument, model: string, entry: OpenRouterModelEntry | null): TextPart | FilePart {
    if (doc.mime === 'text/plain') {
      const text = Buffer.from(doc.base64, 'base64').toString('utf8');
      const name = doc.name.replace(/"/g, '&quot;');
      return { type: 'text', text: `<document name="${name}">\n${text}\n</document>` };
    }
    // PDF — лише туди, де модель читає файли сама: інакше OpenRouter віддасть
    // документ на OCR третій стороні, а це і гроші, і ще один отримувач даних.
    if (entry && !entry.inputModalities.includes('file')) {
      throw new LlmUnsupportedError(
        this.id,
        `Model "${model}" does not read PDF files natively; send the extracted text instead.`,
      );
    }
    return {
      type: 'file',
      file: { filename: doc.name, file_data: `data:application/pdf;base64,${doc.base64.replace(/\s+/g, '')}` },
    };
  }

  /** Інструкції щодо формату — другий системний блок (стабільний, отже кешується). */
  private outputInstructions<T>(req: CompleteRequest<T>, plan: OutputPlan, mode: OpenRouterOutputMode): string {
    const lines = ['Output format:', 'Reply with a single JSON object and nothing else: no prose, no markdown fence.'];
    if (req.tool) {
      const name = req.tool.name;
      lines.push(
        plan.wrapped
          ? `Tool calling is not available in this conversation. Wherever the instructions say to call \`${name}\`, add one object to the "items" array instead: one object per call, in the order the calls would be made. Each object is the input of \`${name}\`: ${req.tool.description}`
          : `Tool calling is not available in this conversation. Instead of calling \`${name}\`, reply with its input as the JSON object: ${req.tool.description}`,
      );
    }
    if (mode === 'json_object') {
      lines.push('The object must validate against this JSON Schema:', JSON.stringify(plan.responseSchema, null, 2));
      lines.push('Optional properties that do not apply may be omitted or set to null.');
    }
    lines.push(
      'Quotes must be copied character for character from the supplied document. Do not paraphrase, translate, merge fragments or add ellipses: there is no citations API, every quote is verified mechanically against the document afterwards, and a quote that cannot be found verbatim voids the verdict.',
    );
    return lines.join('\n');
  }

  /** Як відповідь лягає на схему запиту; масиви загортаємо в `{ items }` — json_schema вимагає об'єкт. */
  private outputPlan<T>(req: CompleteRequest<T>): OutputPlan {
    if (req.tool) {
      const input = req.tool.inputSchema as JsonSchema;
      if (req.tool.multiCall) {
        const valueSchema: JsonSchema = { type: 'array', items: input };
        return { responseSchema: wrapItems(valueSchema), wrapped: true, valueSchema, name: safeName(`${req.tool.name}_batch`) };
      }
      return { responseSchema: input, wrapped: false, valueSchema: input, name: safeName(req.tool.name) };
    }

    let schema: JsonSchema;
    try {
      schema = z.toJSONSchema(req.schema, { io: 'input' }) as JsonSchema;
    } catch (err) {
      throw new LlmUnsupportedError(this.id, `Cannot express the response schema as JSON Schema: ${(err as Error).message}`);
    }
    const rest: JsonSchema = { ...schema };
    delete rest.$schema;
    const name = safeName(`${req.stage}_response`);
    if (rest.type === 'object') return { responseSchema: rest, wrapped: false, valueSchema: rest, name };
    return { responseSchema: wrapItems(rest), wrapped: true, valueSchema: rest, name };
  }

  private normalizeValue<T>(value: unknown, req: CompleteRequest<T>, plan: OutputPlan): unknown {
    const unwrapped = plan.wrapped ? unwrapItems(value, req.tool?.name) : value;
    return stripOptionalNulls(unwrapped, plan.valueSchema);
  }

  /**
   * Рівень роздумів для моделі. null — параметр `reasoning` не шлемо:
   * effort не задано, або модель роздумів не підтримує.
   * Невідома модель (свій id) — передаємо як є: OpenRouter сам зведе до найближчого.
   */
  private reasoningEffortFor(entry: OpenRouterModelEntry | null, effort: Effort | undefined): string | null {
    if (!effort) return null;
    if (!entry) return effort;
    if (!entry.reasoning) return null;
    return mapOpenRouterEffort(effort, entry.supportedEfforts);
  }

  private costOf(model: string, raw: OpenRouterUsage | null, usage: LlmUsage): number {
    if (raw && typeof raw.cost === 'number' && Number.isFinite(raw.cost)) {
      // BYOK: `cost` — лише комісія OpenRouter, сам виклик оплачено в апстрімі.
      const upstream = raw.is_byok === true ? raw.cost_details?.upstream_inference_cost : null;
      return raw.cost + (typeof upstream === 'number' && Number.isFinite(upstream) ? upstream : 0);
    }
    return estimateCost(model, usage, this.pricingFor(model));
  }

  // ─── Транспорт ─────────────────────────────────────────────────────────────

  /** Один логічний запит із внутрішніми повторами на 408/429/5xx/мережу. */
  private async send(body: Record<string, unknown>, apiKey: string, stage: Stage, signal: AbortSignal): Promise<StreamOutcome> {
    const maxRetries = Math.max(0, this.opts.maxRetries ?? 2);
    for (let attempt = 0; ; attempt += 1) {
      if (signal.aborted) throw abortedError(this.id, stage);
      try {
        return await this.sendOnce(body, apiKey, signal);
      } catch (err) {
        if (signal.aborted) throw abortedError(this.id, stage);
        if (!(err instanceof OpenRouterApiError) || !err.retryable || attempt >= maxRetries) throw err;
        const base = this.opts.retryBaseDelayMs ?? 1_000;
        const delay = Math.min(err.retryAfterMs ?? base * 2 ** attempt, MAX_RETRY_DELAY_MS);
        try {
          await (this.opts.sleep ?? abortableSleep)(delay, signal);
        } catch {
          throw abortedError(this.id, stage);
        }
        if (signal.aborted) throw abortedError(this.id, stage);
      }
    }
  }

  private async sendOnce(body: Record<string, unknown>, apiKey: string, signal: AbortSignal): Promise<StreamOutcome> {
    const doFetch = this.opts.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
    if (!doFetch) throw new OpenRouterApiError({ status: null, message: 'global fetch is unavailable' });
    const url = `${(this.opts.baseUrl ?? OPENROUTER_API_BASE).replace(/\/+$/, '')}/chat/completions`;

    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      throw new OpenRouterApiError({
        status: null,
        message: `Cannot reach ${url}: ${(err as Error)?.message ?? String(err)}`,
        cause: err,
      });
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw errorFromHttp(response.status, text, response.headers);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const outcome = contentType.includes('application/json')
      ? accumulateJson(await response.json().catch(() => null))
      : await readEventStream(response);

    if (outcome.error) throw errorFromBody(outcome.error);
    if (outcome.finishReason === 'error') {
      throw new OpenRouterApiError({ status: 502, message: 'The stream ended with finish_reason "error"' });
    }
    return outcome;
  }

  /** Від конкретного до загального — оркестратор розрізняє ретраїбельні випадки. */
  private toLlmError(err: unknown, stage: Stage, model: string, mode: OpenRouterOutputMode): unknown {
    if (err instanceof LlmError) return err;
    if (!(err instanceof OpenRouterApiError)) {
      return new LlmError('transport', (err as Error)?.message ?? String(err), {
        providerId: this.id,
        stage,
        retryable: true,
        cause: err,
      });
    }

    const status = err.status;
    const message = `OpenRouter ${status ?? 'network error'}: ${err.message}`;
    const base = { providerId: this.id, stage, cause: err };

    if (status === 401) return new LlmError('auth', message, base);
    if (status === 402) {
      // 402 з Retry-After — це «бюджет запитів у польоті», а не порожній рахунок.
      return err.retryAfterMs !== null
        ? new LlmError('rate_limit', message, { ...base, retryable: true })
        : new LlmError('insufficient_credit', `OpenRouter: insufficient credits (402). ${err.message}`, base);
    }
    if (status === 403 || err.errorType === 'refusal' || err.errorType === 'content_policy_violation') {
      if (isModerationBlock(err)) {
        return new LlmRefusalError(this.id, {
          stage,
          category: err.errorType ?? 'moderation',
          explanation: moderationExplanation(err),
        });
      }
      return new LlmError('auth', message, base);
    }
    if (isRoutingConstraint(err)) {
      const constraints = [`data_collection=${this.opts.dataCollection ?? 'deny'}`];
      if (mode === 'json_schema') constraints.push('require_parameters=true');
      return new LlmError(
        'unsupported',
        `OpenRouter has no endpoint for model "${model}" that satisfies the routing constraints (${constraints.join(', ')}). ` +
          'Choose another model, or allow this model in your OpenRouter privacy settings. ' +
          `Upstream message: ${err.message}`,
        base,
      );
    }
    if (status === 404 || (status === 400 && /not a valid model|model .*(not found|does not exist)/i.test(err.message))) {
      return new LlmError('model_not_found', message, base);
    }
    if (status === 429) return new LlmError('rate_limit', message, { ...base, retryable: true });
    if (status === null || status === 408) return new LlmError('transport', message, { ...base, retryable: true });
    if (status >= 500) return new LlmError('api', message, { ...base, retryable: true });
    return new LlmError('api', message, base);
  }
}

// ─── Чисті хелпери (експортовані для тестів) ─────────────────────────────────

const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

/**
 * Рівень, який модель точно прийме: запитаний, якщо є; інакше найближчий
 * НИЖЧИЙ; інакше найнижчий із доступних. `none`/`minimal` — лише коли нічого
 * іншого немає. `supported: null` — каталог не обмежує, передаємо як є.
 */
export function mapOpenRouterEffort(requested: Effort, supported: readonly string[] | null): string | null {
  if (supported === null) return requested;
  const rank = (level: string): number => EFFORT_ORDER.indexOf(level as (typeof EFFORT_ORDER)[number]);
  const known = supported.filter((level) => rank(level) >= 0);
  if (known.includes(requested)) return requested;

  const normal = known.filter((level) => level !== 'none' && level !== 'minimal').sort((a, b) => rank(a) - rank(b));
  if (normal.length > 0) {
    const lower = normal.filter((level) => rank(level) < rank(requested));
    return lower.length > 0 ? (lower[lower.length - 1] as string) : (normal[0] as string);
  }
  if (known.includes('minimal')) return 'minimal';
  return null;
}

/** `prompt_tokens` включає кешовані → наш `input` — лише некешований вхід. */
export function openRouterUsageToLlm(raw: OpenRouterUsage | null | undefined): LlmUsage {
  const n = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  const prompt = n(raw?.prompt_tokens);
  const cachedInput = n(raw?.prompt_tokens_details?.cached_tokens);
  const cacheWrite = n(raw?.prompt_tokens_details?.cache_write_tokens);
  return {
    input: Math.max(0, prompt - cachedInput - cacheWrite),
    cachedInput,
    cacheWrite,
    output: n(raw?.completion_tokens),
  };
}

/** Короткий стабільний ключ «липкої» маршрутизації (≤ 256 символів). */
export function sessionIdFor(model: string, system: string, cachedPrefix: string | undefined): string {
  const hash = createHash('sha256').update(`${model}\n${system}\n${cachedPrefix ?? ''}`, 'utf8').digest('hex');
  return `sa-${hash.slice(0, 32)}`;
}

function wrapItems(valueSchema: JsonSchema): JsonSchema {
  // $defs мусять лишитись у корені, інакше `#/$defs/...` перестануть резолвитись.
  const { $defs, ...inner } = valueSchema;
  const wrapper: JsonSchema = {
    type: 'object',
    properties: { items: inner },
    required: ['items'],
    additionalProperties: false,
  };
  if ($defs !== undefined) wrapper.$defs = $defs;
  return wrapper;
}

/** `{ items: [...] }`, голий масив, `{ "<tool>": [...] }` або єдиний масив в об'єкті. */
function unwrapItems(value: unknown, toolName: string | undefined): unknown {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.items)) return record.items;
    if (toolName && Array.isArray(record[toolName])) return record[toolName];
    const arrays = Object.values(record).filter(Array.isArray);
    if (arrays.length === 1) return arrays[0];
  }
  return value;
}

/** Назва схеми для json_schema: ^[a-zA-Z0-9_-]{1,64}$. */
function safeName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return cleaned.length > 0 ? cleaned : 'response';
}

type Decoded = { ok: true; value: unknown } | { ok: false; error: string };

function decodeJson(text: string): Decoded {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?\s*```\s*$/.exec(text);
  const trimmed = (fenced?.[1] ?? text).trim();
  if (trimmed.length === 0) return { ok: false, error: 'empty response body' };
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch (err) {
    return { ok: false, error: `response is not valid JSON: ${(err as Error).message}` };
  }
}

function abortedError(providerId: string, stage: Stage): LlmError {
  return new LlmError('aborted', 'Request aborted', { providerId, stage });
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// ─── Розбір відповідей ───────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function emptyOutcome(): StreamOutcome {
  return {
    id: null,
    model: null,
    upstreamProvider: null,
    content: '',
    refusal: '',
    finishReason: null,
    nativeFinishReason: null,
    usage: null,
    error: null,
  };
}

/** Один чанк (або повна не-стрімова відповідь) → накопичувач. */
function applyChunk(outcome: StreamOutcome, chunk: unknown): void {
  if (!isRecord(chunk)) return;
  if (typeof chunk.id === 'string') outcome.id = chunk.id;
  if (typeof chunk.model === 'string') outcome.model = chunk.model;
  if (typeof chunk.provider === 'string') outcome.upstreamProvider = chunk.provider;
  if (isRecord(chunk.error)) outcome.error = chunk.error as OpenRouterErrorBody;
  if (isRecord(chunk.usage)) outcome.usage = chunk.usage as OpenRouterUsage;

  const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
  if (!isRecord(choice)) return;
  const delta = isRecord(choice.delta) ? choice.delta : isRecord(choice.message) ? choice.message : null;
  if (delta) {
    if (typeof delta.content === 'string') outcome.content += delta.content;
    if (typeof delta.refusal === 'string') outcome.refusal += delta.refusal;
  }
  if (typeof choice.finish_reason === 'string') outcome.finishReason = choice.finish_reason;
  if (typeof choice.native_finish_reason === 'string') outcome.nativeFinishReason = choice.native_finish_reason;
  if (isRecord(choice.error)) outcome.error = choice.error as OpenRouterErrorBody;
}

function accumulateJson(json: unknown): StreamOutcome {
  const outcome = emptyOutcome();
  applyChunk(outcome, json);
  return outcome;
}

/** SSE-потік → накопичувач. Обрив посеред потоку — ретраїбельна помилка мережі. */
export async function readEventStream(response: Response): Promise<StreamOutcome> {
  const outcome = emptyOutcome();
  const parser = new SseParser();
  const decoder = new TextDecoder();
  let done = false;

  const handle = (payloads: string[]): void => {
    for (const data of payloads) {
      if (done) return;
      if (data.trim() === '[DONE]') {
        done = true;
        return;
      }
      let chunk: unknown;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue; // не-JSON payload — за документацією OpenRouter ігнорується
      }
      applyChunk(outcome, chunk);
    }
  };

  if (!response.body) {
    handle(parser.feed(await response.text()));
    handle(parser.flush());
    return outcome;
  }

  const reader = response.body.getReader();
  try {
    while (!done) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      handle(parser.feed(decoder.decode(value, { stream: true })));
    }
    if (!done) {
      handle(parser.feed(decoder.decode()));
      handle(parser.flush());
    }
  } catch (err) {
    throw new OpenRouterApiError({
      status: null,
      message: `The response stream was interrupted: ${(err as Error)?.message ?? String(err)}`,
      cause: err,
    });
  } finally {
    // Після [DONE] зʼєднання більше не потрібне — звільняємо його одразу.
    if (done) await reader.cancel().catch(() => undefined);
    try {
      reader.releaseLock();
    } catch {
      // замок уже знято — нічого не робимо
    }
  }
  // Потік закрився «чисто», але без [DONE] і без finish_reason — відповідь
  // обірвана посередині. Це збій транспорту (повторюємо), а не кривий JSON.
  if (!done && outcome.finishReason === null && outcome.error === null) {
    throw new OpenRouterApiError({ status: null, message: 'The response stream ended before the model finished' });
  }
  return outcome;
}

function parseRetryAfter(headers: Headers | null | undefined): number | null {
  const value = headers?.get('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

function errorFromHttp(status: number, text: string, headers: Headers): OpenRouterApiError {
  let body: unknown = null;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  const metadata = error && isRecord(error.metadata) ? error.metadata : null;
  const base = (typeof error?.message === 'string' && error.message) || text.slice(0, 500) || `HTTP ${status}`;
  const upstream = upstreamDetail(metadata);
  return new OpenRouterApiError({
    status,
    // Саме цим шляхом приходить «400: Provider returned error» — деталь постачальника обов'язкова.
    message: upstream ? `${base} — ${upstream}` : base,
    errorType: typeof metadata?.error_type === 'string' ? metadata.error_type : null,
    metadata,
    retryAfterMs: parseRetryAfter(headers),
  });
}

function errorFromBody(error: OpenRouterErrorBody): OpenRouterApiError {
  const code = typeof error.code === 'number' ? error.code : Number(error.code);
  const metadata = isRecord(error.metadata) ? error.metadata : null;
  const base = typeof error.message === 'string' && error.message ? error.message : 'Mid-stream error';
  const upstream = upstreamDetail(metadata);
  return new OpenRouterApiError({
    status: Number.isFinite(code) && code > 0 ? code : 502,
    // «Provider returned error» сам по собі нічого не пояснює: справжня причина —
    // у `metadata.raw` від постачальника (Anthropic, Google…). Без неї користувач
    // бачив лише загальну фразу, а ми не могли зрозуміти, що саме не так.
    message: upstream ? `${base} — ${upstream}` : base,
    errorType: typeof metadata?.error_type === 'string' ? metadata.error_type : null,
    metadata,
  });
}

/** «Anthropic: <повідомлення постачальника>» з `metadata.raw`; null — деталей немає. */
export function upstreamDetail(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  const provider = typeof metadata.provider_name === 'string' ? metadata.provider_name : null;
  const raw = metadata.raw;
  let text: string | null = null;
  if (typeof raw === 'string' && raw.trim()) {
    text = raw.trim();
    // Часто це JSON-рядок помилки постачальника — дістаємо з нього саме повідомлення.
    try {
      const parsed: unknown = JSON.parse(text);
      const nested = isRecord(parsed) && isRecord(parsed.error) ? parsed.error.message : isRecord(parsed) ? parsed.message : null;
      if (typeof nested === 'string' && nested.trim()) text = nested.trim();
    } catch {
      /* не JSON — лишаємо як є */
    }
  } else if (isRecord(raw)) {
    const nested = isRecord(raw.error) ? raw.error.message : raw.message;
    text = typeof nested === 'string' ? nested : JSON.stringify(raw);
  }
  if (!text) return provider ? `${provider}` : null;
  const clipped = text.length > 500 ? `${text.slice(0, 500)}…` : text;
  return provider ? `${provider}: ${clipped}` : clipped;
}

/** 408 / 429 / 5xx / мережа; 402 лише з Retry-After. «Немає ендпоінта» не повторюємо. */
function isRetryable(err: OpenRouterApiError): boolean {
  if (isRoutingConstraint(err)) return false;
  const status = err.status;
  if (status === null || status === 408 || status === 429) return true;
  if (status === 402) return err.retryAfterMs !== null;
  return status >= 500;
}

/** Відмова через обмеження маршрутизації: жоден ендпоінт не задовольняє вимоги запиту. */
function isRoutingConstraint(err: OpenRouterApiError): boolean {
  return /no endpoints found|no allowed providers|data policy|routing requirements|meets your routing/i.test(err.message);
}

/**
 * Строгий режим відхилили — привід один раз спробувати json_object.
 *
 * Будь-який 400/422 у строгому режимі, а не лише той, де в тексті є «schema»:
 * OpenRouter загортає відмову постачальника в безлике «Provider returned error»,
 * і за словами відрізнити «не прийняв схему» від іншого неможливо. Повтор без
 * `response_format` безкоштовний (відхилений запит не тарифікується), а якщо
 * причина інша — друга відповідь покаже її вже з деталями постачальника.
 */
function isStructuredOutputRejection(err: OpenRouterApiError): boolean {
  if (err.status !== 400 && err.status !== 404 && err.status !== 422) return false;
  if (/data policy|data_collection/i.test(err.message)) return false;
  // 404 «No endpoints … requested parameters» — ендпоінти відсіяв саме
  // `require_parameters` строгого режиму; json_object його не вимагає.
  if (err.status === 404) {
    return /response_format|json_schema|structured|schema|requested parameters|require_parameters/i.test(err.message);
  }
  if (isRoutingConstraint(err) || isModerationBlock(err)) return false;
  return true;
}

function isModerationBlock(err: OpenRouterApiError): boolean {
  if (err.errorType === 'content_policy_violation' || err.errorType === 'refusal') return true;
  if (err.metadata && (Array.isArray(err.metadata.reasons) || typeof err.metadata.flagged_input === 'string')) return true;
  return /moderation|flagged|guardrail|blocked|content policy|refus/i.test(err.message);
}

function moderationExplanation(err: OpenRouterApiError): string {
  const reasons = Array.isArray(err.metadata?.reasons) ? (err.metadata?.reasons as unknown[]).filter((r) => typeof r === 'string') : [];
  return reasons.length > 0 ? `${err.message} (${reasons.join(', ')})` : err.message;
}
