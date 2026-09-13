/// <reference types="vite/client" />

import type { RendererApi } from '@shared/ipc';

/**
 * Другий міст із preload, окремий від `window.api`.
 *
 * Свідомо описаний тут локально, а не імпортований із `src/preload/index.ts`:
 * той модуль тягне за собою `electron`, якого у web-проекті немає. Структура
 * мінімальна, тож дублювання дешевше за залежність.
 * Джерело правди — `FilesBridge` у preload; сигнатури мають збігатись.
 */
interface FilesBridge {
  /** Абсолютний шлях до файлу з drag&drop. `null`, якщо Electron його не дав. */
  getPathForFile(file: File): string | null;
}

declare global {
  interface Window {
    /** Міст IPC. У браузері без Electron (і в mock-режимі) може бути undefined. */
    api?: RendererApi;
    /** Міст доступу до шляхів файлів. Відсутній поза Electron. */
    files?: FilesBridge;
  }

  interface ImportMetaEnv {
    /** '1' → підмінити IPC фікстурами (див. src/renderer/src/mocks). */
    readonly VITE_MOCK?: string;
  }
}

export {};
