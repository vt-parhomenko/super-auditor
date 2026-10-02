/**
 * Каталог моделей OpenRouter: вбудований знімок + живий `GET /models`.
 *
 * Звідси провайдер бере все, що залежить від моделі: ціни (`pricingFor`),
 * чи є structured outputs, які рівні reasoning effort вона приймає, ліміт
 * виходу. Порядок пошуку: живий каталог → вбудований знімок → «дозвільні»
 * значення за замовчуванням для довільного id, який ввів користувач.
 *
 * Живий каталог зберігається через передані `load`/`save` (у застосунку —
 * `app_setting` під ключем `llm.catalogue.openrouter`) і оновлюється у фоні,
 * коли старший за добу. Фонове оновлення ніколи не блокує виклик моделі,
 * ніколи не кидає і нічого не робить без дозволу на мережу.
 */

import { EFFORTS, type Effort, type IsoDate, type ModelInfo, type ModelTier } from '@shared/domain';
import type { ModelPricing } from '../cost';
import { LlmError } from '../errors';
import type { FetchLike } from './openaiCompatible';
import { OPENROUTER_SNAPSHOT } from './openrouterSnapshot';

export const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';

/** Опис однієї моделі — однаковий для знімка і живого каталогу. */
export interface OpenRouterModelEntry {
  id: string;
  /** Назва як у каталозі: 'Anthropic: Claude Opus 5.5'. */
  name: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  /** USD за 1M токенів; null — невідомо. */
  inputPerMTok: number | null;
  outputPerMTok: number | null;
  cacheReadPerMTok: number | null;
  cacheWritePerMTok: number | null;
  /** Ендпоінти приймають `response_format: json_schema`. */
  structuredOutputs: boolean;
  /** Модель приймає параметр `reasoning`. */
  reasoning: boolean;
  /**
   * `reasoning.supported_efforts` як є, разом із `none`/`minimal`.
   * null — каталог не обмежує рівні (приймається будь-який).
   */
  supportedEfforts: string[] | null;
  /** Роздуми не вимикаються — `effort: none` модель відхилить. */
  reasoningMandatory: boolean;
  inputModalities: string[];
}

/** Що зберігаємо між запусками. */
export interface StoredOpenRouterCatalogue {
  version: 1;
  fetchedAt: IsoDate;
  models: OpenRouterModelEntry[];
}

/** Кураторський список для аудиту — показується першим і позначається рекомендованим. */
export const OPENROUTER_CURATED_IDS: readonly string[] = OPENROUTER_SNAPSHOT.map((entry) => entry.id);

/** Ціновий клас — лише підказка в UI. Решта кураторських — `balanced`. */
const CURATED_TIERS: Readonly<Record<string, ModelTier>> = {
  'anthropic/claude-opus-5.5': 'top',
  'anthropic/claude-fable-5.1': 'top',
  'anthropic/claude-opus-5': 'top',
  'openai/gpt-6.1-sol': 'top',
  'openai/gpt-6-sol': 'top',
  'google/gemini-3.1-pro-preview': 'top',
  'anthropic/claude-haiku-4.5': 'budget',
  'openai/gpt-6-luna': 'budget',
  'openai/gpt-6-luna-pro': 'budget',
  'deepseek/deepseek-v4.1-flash': 'budget',
  'google/gemini-3.8-flash': 'budget',
};

/** Розробник за префіксом id. Каталог пише «SpaceXAI: Grok», але групуємо як xAI. */
const VENDORS: Readonly<Record<string, string>> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  google: 'Google',
  qwen: 'Qwen',
  moonshotai: 'Moonshot AI',
  'z-ai': 'Z.ai',
  'x-ai': 'xAI',
  mistralai: 'Mistral AI',
  'meta-llama': 'Meta',
  cohere: 'Cohere',
  amazon: 'Amazon',
  microsoft: 'Microsoft',
  nvidia: 'NVIDIA',
  minimax: 'MiniMax',
};

/** Суфікси, що змінюють лише маршрутизацію; метадані — від базової моделі. */
const ROUTING_VARIANTS = new Set(['nitro', 'floor', 'exacto', 'online']);

/** Каталог старший за це — оновлюємо у фоні. */
export const CATALOGUE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Після невдалої спроби не смикаємо мережу на кожен виклик. */
const RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30_000;

// ─── Розбір відповіді `GET /models` ──────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Ціни в API — рядки USD за токен; у нас — USD за 1M. Від'ємні (-1 у роутерів) → null. */
function perMTok(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Number((n * 1_000_000).toPrecision(12));
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * Чи годиться модель для аудиту. Відкидаємо:
 *  - `~vendor/...-latest` — рухомі псевдоніми: ключ кешу і журнал витрат
 *    посилались би на модель, що завтра стане іншою (ввести вручну — можна);
 *  - каталожні варіанти `:free` / `:batch` / `:thinking` / `:extended`:
 *    free має свої ліміти й політики даних, batch — лише для асинхронного
 *    Batch API, решта застаріли;
 *  - динамічні роутери з ціною -1 (`openrouter/auto` тощо) — той самий рухомий вибір;
 *  - моделі без текстового виходу.
 */
function isAuditCandidate(raw: Record<string, unknown>, id: string): boolean {
  if (id.startsWith('~') || id.includes(':')) return false;
  const pricing = isRecord(raw.pricing) ? raw.pricing : {};
  const prompt = Number(pricing.prompt);
  if (Number.isFinite(prompt) && prompt < 0) return false;
  const architecture = isRecord(raw.architecture) ? raw.architecture : null;
  if (architecture && Array.isArray(architecture.output_modalities)) {
    if (!stringList(architecture.output_modalities).includes('text')) return false;
  }
  return true;
}

/** `GET /models` → наші записи. Невалідні елементи мовчки пропускаються. */
export function parseOpenRouterModels(json: unknown): OpenRouterModelEntry[] {
  const data = isRecord(json) && Array.isArray(json.data) ? json.data : [];
  const entries: OpenRouterModelEntry[] = [];
  const seen = new Set<string>();

  for (const raw of data) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id.length === 0) continue;
    const id = raw.id;
    if (seen.has(id) || !isAuditCandidate(raw, id)) continue;
    seen.add(id);

    const pricing = isRecord(raw.pricing) ? raw.pricing : {};
    const topProvider = isRecord(raw.top_provider) ? raw.top_provider : {};
    const params = stringList(raw.supported_parameters);
    const reasoningInfo = isRecord(raw.reasoning) ? raw.reasoning : null;
    const architecture = isRecord(raw.architecture) ? raw.architecture : {};
    const reasoning = params.includes('reasoning');

    entries.push({
      id,
      name: typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : id,
      contextWindow: numberOrNull(raw.context_length) ?? numberOrNull(topProvider.context_length),
      maxOutputTokens: numberOrNull(topProvider.max_completion_tokens),
      inputPerMTok: perMTok(pricing.prompt),
      outputPerMTok: perMTok(pricing.completion),
      cacheReadPerMTok: perMTok(pricing.input_cache_read),
      cacheWritePerMTok: perMTok(pricing.input_cache_write),
      structuredOutputs: params.includes('structured_outputs'),
      reasoning,
      // Документація: null — приймаються всі рівні; поле відсутнє — модель
      // не виставляє вибір рівня (OpenRouter сам переводить effort у бюджет).
      supportedEfforts:
        reasoning && reasoningInfo && Array.isArray(reasoningInfo.supported_efforts)
          ? stringList(reasoningInfo.supported_efforts)
          : null,
      reasoningMandatory: reasoningInfo?.mandatory === true,
      inputModalities: stringList(architecture.input_modalities),
    });
  }
  return entries;
}

// ─── Подання для UI ──────────────────────────────────────────────────────────

export function openRouterVendorOf(id: string, name?: string): string | null {
  const prefix = id.replace(/^~/, '').split('/')[0] ?? '';
  const known = VENDORS[prefix];
  if (known) return known;
  const fromName = name && name.includes(': ') ? name.slice(0, name.indexOf(': ')).trim() : '';
  if (fromName) return fromName;
  return prefix.length > 0 ? prefix : null;
}

/** 'Anthropic: Claude Opus 5.5' → 'Claude Opus 5.5'. */
function labelOf(entry: OpenRouterModelEntry): string {
  const colon = entry.name.indexOf(': ');
  return colon > 0 ? entry.name.slice(colon + 2) : entry.name;
}

/** Рівні для UI: [] — effort не керує моделлю; null — приймається будь-який. */
function effortsForUi(entry: OpenRouterModelEntry): Effort[] | null {
  if (!entry.reasoning) return [];
  if (entry.supportedEfforts === null) return null;
  const supported = new Set(entry.supportedEfforts);
  return EFFORTS.filter((effort) => supported.has(effort));
}

export function openRouterModelInfo(entry: OpenRouterModelEntry, recommended: boolean): ModelInfo {
  return {
    id: entry.id,
    label: labelOf(entry),
    vendor: openRouterVendorOf(entry.id, entry.name),
    contextWindow: entry.contextWindow,
    maxOutputTokens: entry.maxOutputTokens,
    inputPerMTok: entry.inputPerMTok,
    outputPerMTok: entry.outputPerMTok,
    cacheReadPerMTok: entry.cacheReadPerMTok,
    efforts: effortsForUi(entry),
    recommended,
    tier: recommended ? (CURATED_TIERS[entry.id] ?? 'balanced') : null,
  };
}

/**
 * Ціни для обліку. Без цін входу/виходу — null (не вигадуємо).
 * Невідома ціна кешу рахується як звичайний вхід: краще трохи переоцінити.
 */
export function pricingOfEntry(entry: OpenRouterModelEntry): ModelPricing | null {
  if (entry.inputPerMTok === null || entry.outputPerMTok === null) return null;
  return {
    inputPerMTok: entry.inputPerMTok,
    outputPerMTok: entry.outputPerMTok,
    cacheReadPerMTok: entry.cacheReadPerMTok ?? entry.inputPerMTok,
    cacheWritePerMTok: entry.cacheWritePerMTok ?? entry.inputPerMTok,
    contextWindow: entry.contextWindow ?? 128_000,
  };
}

/**
 * Id запису каталогу для запитаного id: маршрутні суфікси (`:nitro`, `:floor`,
 * `:exacto`, `:online`) відкидаються, каталожні (`:free` тощо) лишаються.
 */
export function openRouterCatalogueId(model: string): string {
  const [base, ...suffixes] = model.split(':');
  const kept = suffixes.filter((suffix) => !ROUTING_VARIANTS.has(suffix));
  return [base ?? model, ...kept].join(':');
}

// ─── Каталог ─────────────────────────────────────────────────────────────────

export interface OpenRouterCatalogueOptions {
  fetchImpl?: FetchLike;
  baseUrl?: string;
  /** false → каталог ніколи не ходить у мережу сам (тести, офлайн-режим). */
  allowNetwork?: boolean;
  load?: () => unknown;
  save?: (value: StoredOpenRouterCatalogue) => void;
  now?: () => number;
  maxAgeMs?: number;
}

const SNAPSHOT_BY_ID = new Map(OPENROUTER_SNAPSHOT.map((entry) => [entry.id, entry]));

export class OpenRouterCatalogue {
  private stored: StoredOpenRouterCatalogue | null;
  private byId = new Map<string, OpenRouterModelEntry>();
  private infos: ModelInfo[] | null = null;
  private inFlight: Promise<void> | null = null;
  private lastFailureAt: number | null = null;

  constructor(private readonly opts: OpenRouterCatalogueOptions = {}) {
    this.stored = loadStored(opts.load);
    this.index();
  }

  updatedAt(): IsoDate | null {
    return this.stored?.fetchedAt ?? null;
  }

  isStale(): boolean {
    if (!this.stored) return true;
    const fetchedAt = Date.parse(this.stored.fetchedAt);
    if (!Number.isFinite(fetchedAt)) return true;
    return this.now() - fetchedAt > (this.opts.maxAgeMs ?? CATALOGUE_MAX_AGE_MS);
  }

  /** Запис моделі: живий каталог → знімок → null (довільний id користувача). */
  lookup(model: string): OpenRouterModelEntry | null {
    const id = openRouterCatalogueId(model);
    return this.byId.get(id) ?? SNAPSHOT_BY_ID.get(id) ?? null;
  }

  /** Кураторські першими (рекомендовані), далі решта за розробником і назвою. */
  listModelInfo(): ModelInfo[] {
    // Копія: хтось зовні може відсортувати масив на місці й зіпсувати кеш.
    if (this.infos) return [...this.infos];
    const curated = OPENROUTER_CURATED_IDS.map((id) =>
      openRouterModelInfo(this.byId.get(id) ?? (SNAPSHOT_BY_ID.get(id) as OpenRouterModelEntry), true),
    );
    const curatedIds = new Set(OPENROUTER_CURATED_IDS);
    const rest = [...this.byId.values()]
      .filter((entry) => !curatedIds.has(entry.id))
      .map((entry) => openRouterModelInfo(entry, false))
      .sort(
        (a, b) =>
          (a.vendor ?? '').localeCompare(b.vendor ?? '') ||
          a.label.localeCompare(b.label) ||
          a.id.localeCompare(b.id),
      );
    this.infos = [...curated, ...rest];
    return [...this.infos];
  }

  /** Явне оновлення (кнопка в Налаштуваннях). Кидає `LlmError` при збої. */
  refresh(signal?: AbortSignal): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const run = this.fetchAndStore(signal).finally(() => {
      this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  /**
   * Фонове оновлення застарілого каталогу. Не чекає, не кидає, без дозволу
   * на мережу нічого не робить; після збою — пауза, щоб не смикати мережу
   * на кожен виклик моделі.
   */
  refreshInBackground(): void {
    if (this.opts.allowNetwork !== true || this.inFlight || !this.isStale()) return;
    if (this.lastFailureAt !== null && this.now() - this.lastFailureAt < RETRY_AFTER_FAILURE_MS) return;
    this.refresh().catch((err: unknown) => {
      console.warn('[llm] каталог OpenRouter не оновлено:', err instanceof Error ? err.message : err);
    });
  }

  /** Поточне оновлення — для тестів і для тих, хто хоче дочекатись. */
  pending(): Promise<void> | null {
    return this.inFlight;
  }

  private async fetchAndStore(signal?: AbortSignal): Promise<void> {
    const doFetch = this.opts.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
    if (!doFetch) {
      throw new LlmError('transport', 'global fetch is unavailable', { providerId: 'openrouter' });
    }
    const url = `${(this.opts.baseUrl ?? OPENROUTER_API_BASE).replace(/\/+$/, '')}/models`;
    const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let models: OpenRouterModelEntry[];
    try {
      const response = await doFetch(url, { method: 'GET', headers: { accept: 'application/json' }, signal: combined });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new LlmError('api', `OpenRouter /models returned ${response.status}: ${text.slice(0, 300)}`, {
          providerId: 'openrouter',
          retryable: response.status >= 500 || response.status === 429,
        });
      }
      models = parseOpenRouterModels(await response.json());
    } catch (err) {
      this.lastFailureAt = this.now();
      if (err instanceof LlmError) throw err;
      if (signal?.aborted) throw new LlmError('aborted', 'Request aborted', { providerId: 'openrouter' });
      throw new LlmError('transport', `Cannot load the OpenRouter model catalogue: ${(err as Error)?.message ?? String(err)}`, {
        providerId: 'openrouter',
        retryable: true,
        cause: err,
      });
    }

    // Порожня відповідь — не привід стерти робочий каталог.
    if (models.length === 0) {
      this.lastFailureAt = this.now();
      throw new LlmError('api', 'OpenRouter /models returned no usable models', { providerId: 'openrouter' });
    }

    this.lastFailureAt = null;
    this.stored = { version: 1, fetchedAt: new Date(this.now()).toISOString(), models };
    this.index();
    try {
      this.opts.save?.(this.stored);
    } catch (err) {
      // Не збереглось — каталог однаково живе в памʼяті до перезапуску.
      console.error('[llm] не вдалося зберегти каталог OpenRouter:', err);
    }
  }

  private index(): void {
    this.byId = new Map((this.stored?.models ?? []).map((entry) => [entry.id, entry]));
    this.infos = null;
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }
}

/** Зіпсований або застарілий формат — ігноруємо: є вбудований знімок. */
function loadStored(load: (() => unknown) | undefined): StoredOpenRouterCatalogue | null {
  let raw: unknown;
  try {
    raw = load?.();
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.version !== 1 || typeof raw.fetchedAt !== 'string' || !Array.isArray(raw.models)) {
    return null;
  }
  const models = raw.models.filter(
    (entry): entry is OpenRouterModelEntry =>
      isRecord(entry) &&
      typeof entry.id === 'string' &&
      typeof entry.name === 'string' &&
      typeof entry.reasoning === 'boolean' &&
      typeof entry.structuredOutputs === 'boolean',
  );
  return { version: 1, fetchedAt: raw.fetchedAt, models };
}
