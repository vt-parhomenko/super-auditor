import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { mainMessages } from '../main/i18n';
import { isLanguage, type Language } from '../shared/domain';
import { IPC_CHANNELS, IPC_EVENT_CHANNELS } from '../shared/ipc';
import type { IpcChannel, IpcEventChannel, IpcEvents, RendererApi } from '../shared/ipc';

/**
 * Міст між renderer і main. Renderer не має доступу до node/electron —
 * тільки до цього об'єкта, побудованого зі списку каналів у контракті.
 *
 * Свідомо не експонуємо жодного generic-invoke: renderer не може викликати
 * канал, якого немає в IPC_CHANNELS.
 */

const invokers = Object.fromEntries(
  IPC_CHANNELS.map((channel: IpcChannel) => [
    channel,
    (...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  ]),
);

const eventSet = new Set<string>(IPC_EVENT_CHANNELS);

/**
 * Мова інтерфейсу для помилок самого мосту. Preload живе в тому ж документі,
 * що й renderer, а той тримає `<html lang>` синхронним із розв'язаною мовою.
 */
function uiLanguage(): Language | undefined {
  const lang = (globalThis as { document?: { documentElement?: { lang?: string } } }).document
    ?.documentElement?.lang;
  return isLanguage(lang) ? lang : undefined;
}

const api = {
  ...invokers,
  on<E extends IpcEventChannel>(event: E, listener: (payload: IpcEvents[E]) => void): () => void {
    if (!eventSet.has(event)) {
      throw new Error(mainMessages(uiLanguage()).preload.unknownEvent(event));
    }
    const wrapped = (_e: Electron.IpcRendererEvent, payload: IpcEvents[E]) => listener(payload);
    ipcRenderer.on(event, wrapped);
    return () => {
      ipcRenderer.off(event, wrapped);
    };
  },
} as unknown as RendererApi;

contextBridge.exposeInMainWorld('api', api);

/**
 * Окремий міст для роботи з перетягнутими файлами.
 *
 * Свідомо не входить у `RendererApi`: це не IPC-канал, а синхронний виклик
 * Electron, і приймає він об'єкт `File`, який через IPC не серіалізується.
 * Тримати його в контракті каналів означало б тягнути DOM-типи в `@shared`,
 * який має лишатись ізоморфним.
 *
 * `File.path` в Electron прибрано — це єдиний спосіб дістати шлях із drop.
 */
contextBridge.exposeInMainWorld('files', {
  getPathForFile(file: File): string | null {
    try {
      return webUtils.getPathForFile(file) || null;
    } catch {
      return null;
    }
  },
});

export interface FilesBridge {
  getPathForFile(file: File): string | null;
}

declare global {
  interface Window {
    api: RendererApi;
    files: FilesBridge;
  }
}
