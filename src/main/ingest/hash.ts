/**
 * SHA-256 файлів і рядків.
 *
 * Хеш файлу рахуємо ПОТОКОВО: спека Tesco — 1.1 МБ, але користувач може
 * закинути 200-мегабайтний скан, і читати його цілком у пам'ять не можна.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

/** Розмір чанку читання. 256 КБ — компроміс між кількістю syscall і пам'яттю. */
const CHUNK_SIZE = 256 * 1024;

/**
 * SHA-256 вмісту файлу, hex у нижньому регістрі.
 * Файл ніколи не тримається в пам'яті цілком.
 */
export async function sha256File(absPath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(absPath, { highWaterMark: CHUNK_SIZE });
  await pipeline(stream, hash);
  return hash.digest('hex');
}

/** SHA-256 рядка (UTF-8), hex у нижньому регістрі. Для textHash вимог тощо. */
export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** SHA-256 буфера, hex у нижньому регістрі. */
export function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
