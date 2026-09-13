/**
 * Серіалізація помилок main → renderer.
 *
 * Проблема: Electron не переносить довільні поля помилки через `invoke` —
 * renderer отримує `new Error("Error invoking remote method 'ch': Error: текст")`.
 * Тому код помилки кодуємо в САМЕ повідомлення сталим префіксом `[CODE] …`,
 * який переживає обгортку Electron і чиститься `cleanMessage` у renderer.
 *
 *   throw notFound('Документ', 42);
 *   // renderer бачить: "[NOT_FOUND] Документ 42 не знайдено"
 *   // parseIpcErrorMessage(msg) → { code: 'NOT_FOUND', message: 'Документ 42 не знайдено' }
 *
 * Стек НІКОЛИ не їде в renderer: повний стек логується в main, назовні
 * віддається свіжий `Error` із порожнім стеком.
 */

import { isLlmError } from '@main/llm';

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

/** Помилка з кодом, який renderer може розрізнити. */
export class IpcError extends Error {
  readonly code: IpcErrorCode;
  readonly details: unknown;

  constructor(code: IpcErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'IpcError';
    this.code = code;
    this.details = details;
  }

  get shape(): IpcErrorShape {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}

export function isIpcError(err: unknown): err is IpcError {
  return err instanceof IpcError;
}

// ─── Конструктори ────────────────────────────────────────────────────────────

export function notFound(entity: string, id?: unknown, details?: unknown): IpcError {
  const what = id === undefined || id === null ? entity : `${entity} ${String(id)}`;
  return new IpcError('NOT_FOUND', `${what} не знайдено`, details);
}

export function validation(message: string, details?: unknown): IpcError {
  return new IpcError('VALIDATION', message, details);
}

export function cloudBlocked(message: string, details?: unknown): IpcError {
  return new IpcError('CLOUD_BLOCKED', message, details);
}

export function providerNotConfigured(providerId: string, message?: string): IpcError {
  return new IpcError(
    'PROVIDER_NOT_CONFIGURED',
    message ?? `Провайдер «${providerId}» не налаштовано: немає ключа API або ендпоінта`,
    { providerId },
  );
}

export function busy(message: string, details?: unknown): IpcError {
  return new IpcError('BUSY', message, details);
}

export function internal(message: string, details?: unknown): IpcError {
  return new IpcError('INTERNAL', message, details);
}

// ─── Мапінг чужих помилок ────────────────────────────────────────────────────

/** Будь-що → `IpcError`. Помилки шару LLM розкладаються по кодах, решта — INTERNAL. */
export function toIpcError(err: unknown): IpcError {
  if (isIpcError(err)) return err;

  if (isLlmError(err)) {
    switch (err.kind) {
      case 'cloud_blocked':
        return cloudBlocked(err.message, { providerId: err.providerId, stage: err.stage });
      case 'not_configured':
      case 'auth':
      case 'model_not_found':
        return new IpcError('PROVIDER_NOT_CONFIGURED', err.message, {
          providerId: err.providerId,
          kind: err.kind,
        });
      case 'rate_limit':
        return busy(err.message, { providerId: err.providerId });
      default:
        return new IpcError('INTERNAL', err.message, {
          providerId: err.providerId,
          kind: err.kind,
        });
    }
  }

  // better-sqlite3 кидає SqliteError з кодом на кшталт SQLITE_CONSTRAINT_FOREIGNKEY.
  // Для користувача це не «внутрішня помилка», а заборонена дія.
  const sqliteCode = sqliteErrorCode(err);
  if (sqliteCode) {
    return validation(
      `Дія суперечить цілісності даних (${sqliteCode}) — можливо, запис уже використано в іншому місці`,
      { sqlite: sqliteCode },
    );
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
): Error {
  const ipcError = toIpcError(err);
  const original = err instanceof Error ? (err.stack ?? err.message) : String(err);
  logger.error(`[ipc] ${channel} → ${ipcError.code}: ${ipcError.message}\n${original}`);

  const outbound = new Error(formatIpcErrorMessage(ipcError.shape));
  // Ім'я лишаємо 'Error', щоб renderer зчистив префікс своїм `cleanMessage`.
  outbound.name = 'Error';
  outbound.stack = `Error: ${outbound.message}`;
  return outbound;
}
