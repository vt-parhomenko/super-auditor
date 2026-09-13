/**
 * Типізований емітер подій main → renderer (`IpcEvents` із контракту).
 *
 * Єдина причина існування: `webContents.send` мовчки кидає, якщо вікно
 * вже знищене, а закривають його рівно посеред довгого прогону.
 * Тому кожна відправка проходить перевірку живості вікна.
 */

import { IPC_EVENT_CHANNELS, type IpcEventChannel, type IpcEvents } from '@shared/ipc';

/** Мінімальна поверхня `WebContents` — щоб у тестах підставити заглушку. */
export interface WebContentsLike {
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
}

/** Мінімальна поверхня `BrowserWindow`. Справжнє вікно їй відповідає структурно. */
export interface WindowLike {
  isDestroyed(): boolean;
  readonly webContents: WebContentsLike;
}

const EVENT_SET = new Set<string>(IPC_EVENT_CHANNELS);

function isAlive(window: WindowLike | null | undefined): window is WindowLike {
  if (!window) return false;
  try {
    if (window.isDestroyed()) return false;
    return !window.webContents.isDestroyed();
  } catch {
    return false;
  }
}

/**
 * Надсилає подію у вікно. `false` — вікна вже немає (це нормальний стан,
 * не помилка: користувач закрив застосунок, а прогін ще дописував прогрес).
 */
export function emit<E extends IpcEventChannel>(
  window: WindowLike | null | undefined,
  event: E,
  payload: IpcEvents[E],
): boolean {
  if (!EVENT_SET.has(event)) throw new Error(`Невідомий канал події: ${event}`);
  if (!isAlive(window)) return false;
  window.webContents.send(event, payload);
  return true;
}

export interface IpcEmitter {
  emit<E extends IpcEventChannel>(event: E, payload: IpcEvents[E]): boolean;
  /** Скорочення для найчастішої події. */
  toast(level: IpcEvents['toast']['level'], message: string): boolean;
}

/**
 * Емітер, прив'язаний до «поточного» вікна через геттер, а не до посилання:
 * вікно на macOS перестворюється по `activate`, і закешоване посилання протухає.
 */
export function createEmitter(getWindow: () => WindowLike | null | undefined): IpcEmitter {
  return {
    emit(event, payload) {
      return emit(getWindow(), event, payload);
    },
    toast(level, message) {
      return emit(getWindow(), 'toast', { level, message });
    },
  };
}

/** Емітер у нікуди — для тестів і для коду, що працює без вікна. */
export const NOOP_EMITTER: IpcEmitter = {
  emit: () => false,
  toast: () => false,
};
