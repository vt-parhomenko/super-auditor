import { app } from 'electron';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

/**
 * Розкладка сховища (розділ 4 architecture.md):
 *
 *   <userData>/
 *   ├── auditor.db
 *   ├── blobs/ab/cd/abcd….pdf     content-addressed, шардинг 2+2
 *   ├── extracted/ab/cd/abcd….json
 *   └── exports/
 *
 * У режимі розробки використовуємо окрему теку, щоб не змішувати
 * тестові дані з робочими.
 */

let rootOverride: string | null = null;

/** Для тестів: підмінити корінь сховища на тимчасову теку. */
export function setStorageRoot(path: string | null): void {
  rootOverride = path;
}

export function storageRoot(): string {
  if (rootOverride) return rootOverride;
  const base = app.getPath('userData');
  return app.isPackaged ? base : join(base, 'dev');
}

export const dbPath = (): string => join(storageRoot(), 'auditor.db');
export const blobsDir = (): string => join(storageRoot(), 'blobs');
export const extractedDir = (): string => join(storageRoot(), 'extracted');
export const exportsDir = (): string => join(storageRoot(), 'exports');

/** Шлях до блоба за хешем: 'abcd1234…' → '<blobs>/ab/cd/abcd1234….pdf'. */
export function blobPath(hash: string, ext: string): string {
  return join(blobsDir(), hash.slice(0, 2), hash.slice(2, 4), `${hash}${ext}`);
}

export function ensureStorageDirs(): void {
  for (const dir of [storageRoot(), blobsDir(), extractedDir(), exportsDir()]) {
    mkdirSync(dir, { recursive: true });
  }
}
