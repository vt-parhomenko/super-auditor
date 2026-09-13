/**
 * Контракти шару LLM (architecture.md §7).
 *
 * Правила:
 * - жодних імпортів electron / better-sqlite3 — модуль має бути тестованим у vitest;
 * - кеш і ключі API приходять ззовні як інтерфейс/геттер, шар нічого не читає з диска;
 * - кожен виклик приймає AbortSignal — прогін можна скасувати з UI.
 */

import type { ZodType } from 'zod';
import type { EvidenceSource, Stage } from '@shared/domain';

// ─── Можливості провайдера ───────────────────────────────────────────────────

/** Спосіб, яким провайдер уміє гарантувати форму відповіді. */
export type StructuredOutputMode = 'schema' | 'tool' | 'json_mode' | 'none';

export interface ProviderCaps {
  contextWindow: number;
  promptCaching: boolean;
  structuredOutput: StructuredOutputMode;
  citations: boolean;
  documentInput: Array<'pdf' | 'text'>;
  /** Максимум output-токенів на один виклик. */
  maxOutputTokens: number;
  /** Хмарний провайдер підпадає під обмеження cloudAllowed (ADR-8). */
  cloud: boolean;
}

/** Глибина роздумів. Передається в `output_config.effort`, НЕ top-level. */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

// ─── Запит ───────────────────────────────────────────────────────────────────

/**
 * Документ, який іде в запит окремим блоком.
 * Для PDF потрібен base64 БЕЗ переносів рядків (ліміт 32 МБ / 600 сторінок).
 * Для `text/plain` — base64 від UTF-8 тексту; провайдер розкодує сам.
 */
export interface LlmDocument {
  name: string;
  mime: 'application/pdf' | 'text/plain';
  base64: string;
  /** true → просимо Citations API; провайдери без citations це проігнорують. */
  citations: boolean;
  /** Короткий контекст для моделі, напр. 'SOP 0068 v002'. */
  context?: string;
}

/** JSON Schema інструмента. Для `strict: true` обов'язкові обидва поля. */
export interface ToolInputSchema {
  type: 'object';
  additionalProperties: false;
  required: string[];
  properties: Record<string, unknown>;
  /** Решта ключів JSON Schema (`$defs`, `description`, …). */
  [key: string]: unknown;
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  /**
   * true → модель викликає інструмент багато разів за один запит
   * (батч вимог: `report_finding` один раз на вимогу).
   * Тоді `schema` запиту має описувати МАСИВ входів інструмента.
   */
  multiCall?: boolean;
}

/**
 * `structured` — `output_config.format` (zodOutputFormat) + `messages.parse()`.
 * `tool`       — strict tool use; єдиний режим, сумісний з Citations API.
 */
export type OutputMode = 'structured' | 'tool';

export interface CompleteRequest<T> {
  stage: Stage;
  /** Інструкції моделі. Іде першим системним блоком. */
  system: string;
  /**
   * Великий стабільний блок (текст документа / grading rules) — на нього
   * ставиться `cache_control`. Порядок рендерингу: tools → system → messages,
   * тому все стабільне має бути тут, а не в messages.
   */
  cachedPrefix?: string;
  documents?: LlmDocument[];
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Валідація відповіді. Для `multiCall`-інструмента — схема масиву. */
  schema: ZodType<T>;
  /** Потрібен для режиму `tool`. */
  tool?: ToolSpec;
  /** Якщо не задано — `tool` за наявності `tool` + citations, інакше `structured`. */
  outputMode?: OutputMode;
  maxOutputTokens: number;
  effort?: Effort;
  /** Перевизначення моделі; інакше — модель за замовчуванням провайдера. */
  model?: string;
  /** Потрапляє в `prompt_version` БД і в ключ кешу. */
  promptVersion: string;
  /**
   * Канонічний вхід для ключа кешу. Якщо не задано, ключ будується з
   * system + cachedPrefix + messages + імен документів.
   */
  cacheInput?: unknown;
}

// ─── Результат ───────────────────────────────────────────────────────────────

export interface Citation {
  /** `cited_text` з відповіді — гарантовано дослівний фрагмент документа. */
  quote: string;
  documentName: string | null;
  /** Індекс документа в запиті, 0-базований. */
  documentIndex: number | null;
  /** 1-індексовані номери сторінок (`start_page_number` / `end_page_number`). */
  pageFrom: number | null;
  pageTo: number | null;
  /** Для текстових документів — `char_location`. */
  charStart: number | null;
  charEnd: number | null;
  source: EvidenceSource;
}

export interface LlmUsage {
  input: number;
  /** `cache_read_input_tokens` — тарифікується ~10% від вхідного. */
  cachedInput: number;
  /** `cache_creation_input_tokens` — запис у кеш, дорожче за звичайний вхід. */
  cacheWrite: number;
  output: number;
}

export function emptyLlmUsage(): LlmUsage {
  return { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 };
}

export interface CompleteResult<T> {
  data: T;
  citations: Citation[];
  usage: LlmUsage;
  costUsd: number;
  modelId: string;
  providerId: string;
  latencyMs: number;
  /** Сира відповідь провайдера — пишеться в `llm_call.response_json`. */
  raw: unknown;
  fromCache: boolean;
}

// ─── Провайдер ───────────────────────────────────────────────────────────────

export interface LlmProvider {
  readonly id: string;
  readonly label: string;
  readonly caps: ProviderCaps;
  readonly models: readonly string[];
  /** Чи є ключ / доступний ендпоінт. Мережу не чіпає. */
  isConfigured(): boolean;
  complete<T>(req: CompleteRequest<T>, signal: AbortSignal): Promise<CompleteResult<T>>;
}

// ─── Кеш ─────────────────────────────────────────────────────────────────────

/**
 * Запис кешу LLM-виклику. Відповідає таблиці `llm_call` (architecture.md §5),
 * але цей шар про БД нічого не знає — реалізацію підключає інший шар.
 */
export interface LlmCacheEntry {
  stage: Stage;
  provider: string;
  model: string;
  promptVersion: string;
  /** JSON-серіалізований `{ data, citations }`. */
  responseJson: string;
  usage: LlmUsage;
  costUsd: number;
  latencyMs: number;
  createdAt: string;
}

export interface LlmCacheStore {
  get(key: string): Promise<LlmCacheEntry | null> | LlmCacheEntry | null;
  set(key: string, entry: LlmCacheEntry): Promise<void> | void;
}

// ─── Промпти ─────────────────────────────────────────────────────────────────

/**
 * Один етап конвеєра = один файл `prompts/{stage}.{version}.ts`.
 * `version` (напр. 'judge.v1') іде в `prompt_version` і в ключ кешу:
 * зміна промпта = нова версія = інвалідований кеш.
 */
export interface PromptDef<TInput, TOutput> {
  readonly version: string;
  readonly stage: Stage;
  /** Статичні інструкції. Кешується разом із cachedPrefix. */
  readonly system: string;
  readonly schema: ZodType<TOutput>;
  readonly tool?: ToolSpec;
  readonly maxOutputTokens: number;
  readonly effort?: Effort;
  /** Змінна частина запиту. */
  buildUser(input: TInput): string;
  /** Великий стабільний блок (текст документа тощо). */
  buildCachedPrefix?(input: TInput): string | undefined;
  buildDocuments?(input: TInput): LlmDocument[] | undefined;
  /** Канонічний вхід для ключа кешу. Не має містити таймстемпів. */
  cacheInput?(input: TInput): unknown;
}
