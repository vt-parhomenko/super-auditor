/**
 * Доступ до PDF у renderer.
 *
 * Байти приходять каналом `blob:read`, а не через `file://`: renderer у пісочниці,
 * і послаблювати CSP заради читання файлів не довелось.
 *
 * Воркер підключаємо через `?url` — Vite емітить його окремим файлом поруч зі
 * скриптом сторінки, тобто з того самого origin, що проходить під `script-src 'self'`.
 */

import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import { api } from '@renderer/lib/api';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Кеш за `blobHash`.
 *
 * Тримаємо і байти, і завдання завантаження:
 *  • байти — щоб не тягнути ~1.1 МБ стандарту через IPC на кожен клік;
 *  • завдання — щоб повторне відкриття було миттєвим і щоб було що коректно
 *    знищити (у pdf.js 6 `destroy()` живе на loading task, не на документі).
 *
 * У `getDocument` віддаємо КОПІЮ байтів: pdf.js переносить ArrayBuffer у воркер
 * і відчіплює оригінал, після чого кешований масив став би порожнім.
 */
const byteCache = new Map<string, Promise<Uint8Array>>();
const taskCache = new Map<string, PDFDocumentLoadingTask>();

function readBytes(blobHash: string): Promise<Uint8Array> {
  const cached = byteCache.get(blobHash);
  if (cached) return cached;
  const pending = api['blob:read'](blobHash).then((bytes) => Uint8Array.from(bytes));
  byteCache.set(blobHash, pending);
  // Невдалу спробу не кешуємо: інакше одна помилка IPC отруїла б хеш назавжди.
  pending.catch(() => byteCache.delete(blobHash));
  return pending;
}

export async function loadPdfDocument(blobHash: string): Promise<PDFDocumentProxy> {
  const cached = taskCache.get(blobHash);
  if (cached) return cached.promise;

  const bytes = await readBytes(blobHash);
  const existing = taskCache.get(blobHash);
  if (existing) return existing.promise;

  const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  taskCache.set(blobHash, task);
  task.promise.catch(() => taskCache.delete(blobHash));
  return task.promise;
}

/** Скільки блобів зараз у пам'яті — для діагностики й тестів. */
export function pdfCacheSize(): number {
  return byteCache.size;
}

export function clearPdfCache(): void {
  for (const task of taskCache.values()) void task.destroy();
  taskCache.clear();
  byteCache.clear();
}
