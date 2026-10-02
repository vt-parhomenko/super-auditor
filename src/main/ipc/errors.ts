/**
 * Серіалізація помилок main → renderer.
 *
 * Проблема: Electron не переносить довільні поля помилки через `invoke` —
 * renderer отримує `new Error("Error invoking remote method 'ch': Error: текст")`.
 * Тому код помилки кодуємо в САМЕ повідомлення сталим префіксом `[CODE] …`,
 * який переживає обгортку Electron і чиститься `cleanMessage` у renderer.
 *
 *   throw notFound('document', 42);
 *   // renderer (мова інтерфейсу uk) бачить: "[NOT_FOUND] Документ 42 не знайдено"
 *   // parseIpcErrorMessage(msg) → { code: 'NOT_FOUND', message: 'Документ 42 не знайдено' }
 *
 * Мова. Текст помилки — мовою інтерфейсу, але хендлер її не знає й знати не
 * мусить: повідомлення задається функцією від каталогу (`(m) => m.runs.noDocuments`),
 * а рендерить його межа IPC (`serializeIpcError`) мовою з налаштувань. Так само
 * помилки глибших шарів (LLM, SQLite, secrets) отримують людський текст у
 * `toIpcError`. `Error.message` — англійською, для логів і стеків.
 *
 * Стек НІКОЛИ не їде в renderer: повний стек логується в main, назовні
 * віддається свіжий `Error` із порожнім стеком.
 */

import {
  DEFAULT_LANGUAGE,
  LocalizedError,
  describeLlmError,
  providerName,
  type MainMessages,
} from '@main/i18n';
import { isLlmError } from '@main/llm';
import type { Language } from '@shared/domain';

export const IPC_ERROR_CODES = [
  /** Сутності з таким id немає. */
  'NOT_FOUND',
  /** Вхід не пройшов перевірку або дія заборонена станом даних. */
  'VALIDATION',
  /** ADR-8: специфікацію не можна відправляти в хмару (або ввімкнено localOnly). */
  'CLOUD_BLOCKED',
  /** Немає ключа API / ендпоінта для провайдера. */
  'PROVIDER_NOT_CONFIGURED',
  /** Ресурс зайнятий: прогін уже йде, ліміт запитів провайдера тощо. */
  'BUSY',
  /** Усе інше — баг або зовнішній збій. */
  'INTERNAL',
] as const;

export type IpcErrorCode = (typeof IPC_ERROR_CODES)[number];

export interface IpcErrorShape {
  code: IpcErrorCode;
  message: string;
  details?: unknown;
}

/** Роздільник структурованих деталей у серіалізованому повідомленні. */
const DETAILS_MARKER = ' | details=';
const CODE_RE = /^\[([A-Z_]+)\]\s?/;

const CODE_SET = new Set<string>(IPC_ERROR_CODES);

export function isIpcErrorCode(value: unknown): value is IpcErrorCode {
  return typeof value === 'string' && CODE_SET.has(value);
}

/**
 * Текст помилки: готовий рядок (уже потрібною мовою або сирий текст ззовні)
 * чи функція від каталогу — тоді мову обирає межа IPC.
 */
export type IpcMessage = string | ((messages: MainMessages) => string);

/** Помилка з кодом, який renderer може розрізнити. */
export class IpcError extends LocalizedError {
  readonly code: IpcErrorCode;
  readonly details: unknown;

  constructor(code: IpcErrorCode, message: IpcMessage, details?: unknown) {
    super(typeof message === 'function' ? message : () => message);
    this.name = 'IpcError';
    this.code = code;
    this.details = details;
  }

  /** Форма для транспорту. Без мови — англійською (`message`). */
  get shape(): IpcErrorShape {
    return this.shapeIn(DEFAULT_LANGUAGE);
  }

  shapeIn(language: Language): IpcErrorShape {
    const message = this.localize(language);
    return this.details === undefined
      ? { code: this.code, message }
      : { code: this.code, message, details: this.details };
  }
}

export function isIpcError(err: unknown): err is IpcError {
  return err instanceof IpcError;
}

// ─── Конструктори ────────────────────────────────────────────────────────────

/** Сутності, про які можна сказати «не знайдено». */
export type NotFoundEntity = keyof MainMessages['ipc']['entities'];

/**
 * Сутність за ключем, а не готовою назвою: порядок слів і відмінок різні в
 * кожній мові («Специфікацію 42 не знайдено»), тож фразу складає каталог.
 */
export function notFound(entity: NotFoundEntity, id?: unknown, details?: unknown): IpcError {
  return new IpcError(
    'NOT_FOUND',
    (m) => {
      const name = m.ipc.entities[entity];
      return m.ipc.notFound(id === undefined || id === null ? name : `${name} ${String(id)}`);
    },
    details,
  );
}

export function validation(message: IpcMessage, details?: unknown): IpcError {
  return new IpcError('VALIDATION', message, details);
}

export function cloudBlocked(message: IpcMessage, details?: unknown): IpcError {
  return new IpcError('CLOUD_BLOCKED', message, details);
}

export function providerNotConfigured(providerId: string, message?: IpcMessage): IpcError {
  return new IpcError(
    'PROVIDER_NOT_CONFIGURED',
    message ?? ((m) => m.llm.notConfigured(providerName(providerId))),
    { providerId },
  );
}

export function busy(message: IpcMessage, details?: unknown): IpcError {
  return new IpcError('BUSY', message, details);
}

export function internal(message: IpcMessage, details?: unknown): IpcError {
  return new IpcError('INTERNAL', message, details);
}

// ─── Мапінг чужих помилок ────────────────────────────────────────────────────

/**
 * Будь-що → `IpcError`. Помилки шару LLM розкладаються по кодах, решта — INTERNAL.
 *
 * `language` — мова інтерфейсу: помилки LLM (сирий текст провайдера) і помилки
 * шарів без доступу до мови (`LocalizedError`) отримують тут людський текст.
 * `IpcError` повертається як є — свій текст він відрендерить сам.
 */
export function toIpcError(err: unknown, language: Language = DEFAULT_LANGUAGE): IpcError {
  if (isIpcError(err)) return err;

  if (isLlmError(err)) {
    const message = describeLlmError(language, err);
    switch (err.kind) {
      case 'cloud_blocked':
        return cloudBlocked(message, { providerId: err.providerId, stage: err.stage });
      case 'not_configured':
      case 'auth':
      case 'model_not_found':
        return new IpcError('PROVIDER_NOT_CONFIGURED', message, {
          providerId: err.providerId,
          kind: err.kind,
        });
      case 'rate_limit':
        return busy(message, { providerId: err.providerId });
      default:
        return new IpcError('INTERNAL', message, {
          providerId: err.providerId,
          kind: err.kind,
        });
    }
  }

  if (err instanceof LocalizedError) return internal(err.localize(language));

  // better-sqlite3 кидає SqliteError з кодом на кшталт SQLITE_CONSTRAINT_FOREIGNKEY.
  // Для користувача це не «внутрішня помилка», а заборонена дія.
  const sqliteCode = sqliteErrorCode(err);
  if (sqliteCode) {
    return validation((m) => m.ipc.integrity(sqliteCode), { sqlite: sqliteCode });
  }

  if (err instanceof Error) return internal(err.message);
  return internal(String(err));
}

function sqliteErrorCode(err: unknown): string | null {
  if (!(err instanceof Error)) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT') ? code : null;
}

// ─── Транспорт ───────────────────────────────────────────────────────────────

export function formatIpcErrorMessage(shape: IpcErrorShape): string {
  const head = `[${shape.code}] ${shape.message}`;
  if (shape.details === undefined) return head;
  try {
    return `${head}${DETAILS_MARKER}${JSON.stringify(shape.details)}`;
  } catch {
    return head;
  }
}

/** Зворотний розбір. `null` — повідомлення не від цього шару. */
export function parseIpcErrorMessage(raw: string): IpcErrorShape | null {
  const cleaned = raw
    .replace(/^Error invoking remote method '[^']*':\s*/i, '')
    .replace(/^(?:Ipc)?Error:\s*/i, '')
    .trim();

  const match = CODE_RE.exec(cleaned);
  const code = match?.[1];
  if (!match || !isIpcErrorCode(code)) return null;

  const rest = cleaned.slice(match[0].length);
  const at = rest.indexOf(DETAILS_MARKER);
  if (at < 0) return { code, message: rest };

  const message = rest.slice(0, at);
  try {
    return { code, message, details: JSON.parse(rest.slice(at + DETAILS_MARKER.length)) as unknown };
  } catch {
    return { code, message };
  }
}

export interface ErrorLogger {
  error(...args: unknown[]): void;
}

/**
 * Готує помилку до перетину межі IPC: повний стек — у лог main,
 * у renderer — тільки код + повідомлення (+ details), без жодного кадру стека.
 */
export function serializeIpcError(
  err: unknown,
  channel: string,
  logger: ErrorLogger = console,
  language: Language = DEFAULT_LANGUAGE,
): Error {
  const ipcError = toIpcError(err, language);
  const shape = ipcError.shapeIn(language);
  const original = err instanceof Error ? (err.stack ?? err.message) : String(err);
  logger.error(`[ipc] ${channel} → ${ipcError.code}: ${shape.message}\n${original}`);

  const outbound = new Error(formatIpcErrorMessage(shape));
  // Ім'я лишаємо 'Error', щоб renderer зчистив префікс своїм `cleanMessage`.
  outbound.name = 'Error';
  outbound.stack = `Error: ${outbound.message}`;
  return outbound;
}
