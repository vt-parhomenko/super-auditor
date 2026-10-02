/**
 * Локалізація повідомлень main-процесу.
 *
 * Мов дві, і вони незалежні:
 *  - мова ІНТЕРФЕЙСУ (`settings.uiLanguage`) — тости, помилки IPC, тексти
 *    `audit_run.error`. Джерело правди — renderer: він синхронізує сюди
 *    розв'язану мову, тож main говорить тією ж мовою, що й вікно;
 *  - мова РЕЗУЛЬТАТІВ (`settings.resultsLanguage`) — службові позначки, що
 *    зберігаються у findings, і експорт. `''` означає «мовою стандарту», а
 *    стандарти англомовні — тож позначки тоді англійською.
 *
 * Модуль свідомо без runtime-залежностей від решти main (лише `@shared` і
 * типи): його імпортують і шари без доступу до БД (secrets, ingest), і preload.
 *
 *   events.toast('warn', uiMessages(db).run.scopeFallback(n)); // БД під рукою — одразу
 *   throw validation((m) => m.runs.noDocuments);              // IPC: мову обере межа
 */

import { isLanguage, type Language, type ResultsLanguage } from '@shared/domain';
import type { AppSettings } from '@shared/ipc';
import type { LlmErrorKind } from '@main/llm/errors';
import { en, type MainMessages } from './en';
import { nl } from './nl';
import { uk } from './uk';

export type { MainMessages } from './en';

export const MAIN_CATALOGS: Readonly<Record<Language, MainMessages>> = Object.freeze({ en, nl, uk });

/** Мова за замовчуванням — нею ж падаємо для всього невідомого. */
export const DEFAULT_LANGUAGE: Language = 'en';

/** Каталог мови. Невідоме значення (стара база, кривий IPC) → англійський. */
export function mainMessages(language: Language | null | undefined): MainMessages {
  return MAIN_CATALOGS[isLanguage(language) ? language : DEFAULT_LANGUAGE];
}

// ─── Звідки брати мову ──────────────────────────────────────────────────────

/**
 * Мінімальна поверхня БД. Структурний тип замість `Db` — щоб модуль не тягнув
 * шар БД і щоб у тестах можна було підставити будь-що.
 */
export interface SettingsSource {
  readonly settings: { get(): Pick<AppSettings, 'uiLanguage' | 'resultsLanguage'> };
}

/**
 * Мова інтерфейсу. Ніколи не кидає: її питають і тоді, коли щось уже зламалось
 * (тост про внутрішню помилку на виході, коли база закрита), — і саме тоді
 * повідомлення найпотрібніше.
 */
export function uiLanguageOf(source: SettingsSource): Language {
  try {
    const value = source.settings.get().uiLanguage;
    return isLanguage(value) ? value : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

/** Мова результатів: `''` — мовою стандарту. */
export function resultsLanguageOf(source: SettingsSource): ResultsLanguage {
  try {
    const value = source.settings.get().resultsLanguage;
    return isLanguage(value) ? value : '';
  } catch {
    return '';
  }
}

/**
 * Мова службових позначок у результатах. `''` (мовою стандарту) → англійська:
 * стандарти англомовні, а позначка посеред англійського висновку іншою мовою
 * читалась би як збій.
 */
export function markerLanguage(results: ResultsLanguage | null | undefined): Language {
  return isLanguage(results) ? results : DEFAULT_LANGUAGE;
}

/** Повідомлення застосунку мовою інтерфейсу. */
export function uiMessages(source: SettingsSource): MainMessages {
  return mainMessages(uiLanguageOf(source));
}

/** Тексти, що пишуться в результати, — мовою результатів. */
export function resultsMessages(results: ResultsLanguage | null | undefined): MainMessages {
  return mainMessages(markerLanguage(results));
}

// ─── Помилки без доступу до мови ────────────────────────────────────────────

/**
 * Помилка шару, який не знає мови інтерфейсу (secrets, ingest): він знає, ЩО
 * сталося, а текст для людини будується на межі (IPC, імпорт) потрібною мовою.
 * `message` — англійською, для логів і стеків.
 */
export class LocalizedError extends Error {
  private readonly render: (messages: MainMessages) => string;

  constructor(render: (messages: MainMessages) => string) {
    super(render(en));
    this.name = 'LocalizedError';
    this.render = render;
  }

  localize(language: Language): string {
    return this.render(mainMessages(language));
  }
}

// ─── Помилки моделей і провайдерів ──────────────────────────────────────────

/** Людські назви провайдерів. Невідомий id показується як є. */
const PROVIDER_NAMES: Readonly<Record<string, string>> = {
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
  'openai-compatible': 'OpenAI-compatible',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
};

export function providerName(providerId: string): string {
  return PROVIDER_NAMES[providerId.trim().toLowerCase()] ?? providerId;
}

/**
 * Де поповнити рахунок — лише там, де адреса стабільна й точно відома.
 * Для решти пояснення називає самого провайдера.
 */
const TOP_UP_URLS: Readonly<Record<string, string>> = {
  openrouter: 'openrouter.ai/settings/credits',
};

/** Структурна форма `LlmError` — без runtime-імпорту шару LLM. */
export interface LlmErrorLike {
  readonly kind: string;
  readonly providerId: string;
  readonly message: string;
}

/** Повний перелік через `Record` — новий kind у шарі LLM не пройде typecheck непоміченим. */
const LLM_ERROR_KINDS: Readonly<Record<LlmErrorKind, true>> = {
  not_configured: true,
  refusal: true,
  schema: true,
  rate_limit: true,
  transport: true,
  model_not_found: true,
  auth: true,
  insufficient_credit: true,
  aborted: true,
  cloud_blocked: true,
  unsupported: true,
  api: true,
};

export function isLlmErrorLike(err: unknown): err is LlmErrorLike {
  if (!(err instanceof Error)) return false;
  const { kind, providerId } = err as Error & Partial<LlmErrorLike>;
  return typeof kind === 'string' && Object.hasOwn(LLM_ERROR_KINDS, kind) && typeof providerId === 'string';
}

/**
 * OpenRouter: жоден ендпоінт моделі не проходить вимоги маршрутизації
 * (`data_collection: 'deny'`, `require_parameters` для structured output).
 * Шар LLM віддає це як `unsupported` із поясненням про routing constraints.
 */
function isNoRoutedEndpoint(err: LlmErrorLike): boolean {
  return err.kind === 'unsupported' && /routing constraints|no endpoints? found|data policy/i.test(err.message);
}

/** Що відомо про обставини: уточнює, ЧОМУ хмару заблоковано. */
export interface LlmErrorContext {
  localOnly?: boolean;
  cloudAllowed?: boolean;
}

/**
 * Людиночитне пояснення помилки моделі: що сталося і що робити далі.
 * Провайдер-нейтральне — назва провайдера береться з `providerId`.
 * Сирий текст провайдера лишається в дужках: без нього не продіагностувати.
 */
export function describeLlmError(
  language: Language,
  err: LlmErrorLike,
  context: LlmErrorContext = {},
): string {
  const m = mainMessages(language).llm;
  const provider = providerName(err.providerId);

  switch (err.kind as LlmErrorKind) {
    case 'insufficient_credit':
      return m.insufficientCredit(provider, TOP_UP_URLS[err.providerId] ?? null, err.message);
    case 'auth':
      return m.auth(provider, err.message);
    case 'not_configured':
      return m.notConfigured(provider);
    case 'cloud_blocked':
      if (context.localOnly) return m.cloudBlockedLocalOnly(provider);
      if (context.cloudAllowed === false) return m.cloudBlockedSpec(provider);
      return m.cloudBlocked(provider);
    case 'rate_limit':
      return m.rateLimit(provider);
    case 'transport':
      return m.transport(provider, err.message);
    case 'model_not_found':
      return m.modelNotFound(provider, err.message);
    case 'refusal':
      return m.refusal;
    case 'schema':
      return m.schema(err.message);
    case 'aborted':
      return m.aborted;
    case 'unsupported':
      return isNoRoutedEndpoint(err)
        ? m.noRoutedEndpoint(provider, err.message)
        : m.unsupported(provider, err.message);
    default:
      return err.message;
  }
}

/** Текст будь-якої помилки для людини: відомі — локалізовано, решта — як є. */
export function errorText(language: Language, err: unknown): string {
  if (err instanceof LocalizedError) return err.localize(language);
  if (isLlmErrorLike(err)) return describeLlmError(language, err);
  if (err instanceof Error) return err.message;
  return String(err);
}
