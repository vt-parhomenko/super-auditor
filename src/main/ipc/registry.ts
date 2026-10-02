/**
 * Реєстрація IPC-хендлерів.
 *
 * Типобезпека тут одностороння і навмисна: об'єкт хендлерів має відповідати
 * типу `IpcHandlers` із контракту, тож TypeScript ловить і зайвий канал,
 * і відсутній, і розбіжність у сигнатурі. Рантайм додає другий пояс —
 * `assertContractShape` не дасть зареєструвати нічого поза `IPC_CHANNELS`.
 */

import { ipcMain } from 'electron';
import { DEFAULT_LANGUAGE } from '@main/i18n';
import { isLanguage, type Language } from '@shared/domain';
import { IPC_CHANNELS, type IpcChannel, type IpcHandlers } from '@shared/ipc';
import { serializeIpcError, type ErrorLogger } from './errors';

/** Мінімальна поверхня `ipcMain` — щоб тести не піднімали Electron. */
export interface IpcMainLike {
  handle(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown,
  ): void;
  removeHandler(channel: string): void;
}

export interface RegisterOptions {
  ipc?: IpcMainLike;
  logger?: ErrorLogger;
}

type AnyHandler = (...args: unknown[]) => unknown;

/**
 * Перевіряє, що набір хендлерів — це рівно контракт: ані каналу більше,
 * ані менше. TypeScript це вже гарантує на типах, але хендлери можуть
 * зібратися динамічно (spread груп), і тоді помилка спливе тільки тут.
 */
export function assertContractShape(handlers: IpcHandlers): void {
  const expected = new Set<string>(IPC_CHANNELS);
  const missing: string[] = [];
  for (const channel of IPC_CHANNELS) {
    if (typeof handlers[channel] !== 'function') missing.push(channel);
  }
  const extra = Object.keys(handlers).filter((key) => !expected.has(key));

  if (missing.length > 0 || extra.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`не реалізовані: ${missing.join(', ')}`);
    if (extra.length > 0) parts.push(`поза контрактом: ${extra.join(', ')}`);
    throw new Error(`Набір IPC-хендлерів не відповідає контракту — ${parts.join('; ')}`);
  }
}

/**
 * Реєструє всі канали контракту. Повертає функцію зняття реєстрації
 * (потрібна в тестах і при гарячому перезавантаженні в dev).
 */
export function registerIpcHandlers(
  handlers: IpcHandlers,
  options: RegisterOptions = {},
): () => void {
  const ipc = options.ipc ?? (ipcMain as unknown as IpcMainLike);
  const logger = options.logger ?? console;

  assertContractShape(handlers);

  for (const channel of IPC_CHANNELS) {
    const handler = handlers[channel] as AnyHandler;
    ipc.handle(channel, async (_event: unknown, ...args: unknown[]) => {
      try {
        return await handler(...args);
      } catch (err) {
        throw serializeIpcError(err, channel, logger, await uiLanguage(handlers));
      }
    });
  }

  return () => {
    for (const channel of IPC_CHANNELS) ipc.removeHandler(channel);
  };
}

/**
 * Мова інтерфейсу для тексту помилки. Береться з того самого `settings:get`,
 * що бачить renderer: окремого джерела, яке могло б розійтися з ним, немає.
 * Питаємо лише на шляху помилки, тож зайвого читання БД на кожен виклик теж немає.
 */
async function uiLanguage(handlers: IpcHandlers): Promise<Language> {
  try {
    const settings = await handlers['settings:get']();
    return isLanguage(settings?.uiLanguage) ? settings.uiLanguage : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

/** Список каналів контракту — зручно для тестів і діагностики. */
export function contractChannels(): IpcChannel[] {
  return [...IPC_CHANNELS];
}
