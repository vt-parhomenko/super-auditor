/**
 * Content-addressed сховище оригіналів (розділ 4 architecture.md).
 *
 *   blobs/ab/cd/abcd….pdf     — ім'я = SHA-256 вмісту, шардинг 2+2
 *
 * Модуль НЕ знає про БД. Він повертає дескриптор; рядок у `blob` пише
 * репозиторій. Оригінал ніколи не мутується — тільки копіюється.
 */

import { constants as FS } from 'node:fs';
import { access, copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join, posix } from 'node:path';
import type { BlobDto } from '@shared/domain';
import { blobPath, blobsDir } from '@main/paths';
import { sha256File } from './hash';
import { detectMime, extOf } from './mime';

/** Те, що знає сховище про покладений файл. `createdAt` додасть БД. */
export interface BlobDescriptor extends Omit<BlobDto, 'createdAt'> {
  /** Абсолютний шлях до блоба у сховищі. */
  absPath: string;
  /** Розширення разом із крапкою, `'.pdf'`. Потрібне, щоб зібрати шлях назад. */
  ext: string;
  /** true — блоб із таким хешем уже лежав у сховищі, копіювання не було. */
  duplicate: boolean;
}

/** Тека для часткових записів. Крапка спереду — щоб не плуталась із шардами. */
const TMP_DIR = '.tmp';

/** Відносний шлях блоба всередині `blobs/`, завжди з прямими слешами (він їде в БД). */
export function relPathOf(hash: string, ext: string): string {
  return posix.join(hash.slice(0, 2), hash.slice(2, 4), `${hash}${ext}`);
}

/** Абсолютний шлях блоба. Тонка обгортка над `paths.blobPath`. */
export function resolve(hash: string, ext: string): string {
  return blobPath(hash, ext);
}

export async function exists(hash: string, ext: string): Promise<boolean> {
  try {
    await access(blobPath(hash, ext), FS.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Видаляє блоб. Мовчить, якщо його вже немає. */
export async function remove(hash: string, ext: string): Promise<void> {
  await rm(blobPath(hash, ext), { force: true });
}

/**
 * Кладе файл у сховище.
 *
 * Порядок дій важливий:
 *   1. хеш потоково (файл не тримаємо в пам'яті);
 *   2. якщо блоб уже є — нічого не копіюємо, `duplicate: true` (дедуплікація);
 *   3. інакше копіюємо в `.tmp/<random>` і перейменовуємо на місце.
 *
 * Крок 3 дає атомарність: `rename` у межах одного тому атомарний, тож
 * напівскопійований файл ніколи не з'явиться під іменем свого хешу.
 * Обірваний імпорт залишить сміття тільки в `.tmp/`.
 */
export async function putFile(absPath: string): Promise<BlobDescriptor> {
  const [hash, info, mime] = await Promise.all([
    sha256File(absPath),
    stat(absPath),
    detectMime(absPath),
  ]);
  const ext = extOf(absPath);
  const dest = blobPath(hash, ext);
  const descriptor: BlobDescriptor = {
    hash,
    relPath: relPathOf(hash, ext),
    absPath: dest,
    ext,
    byteSize: info.size,
    mime,
    duplicate: false,
  };

  if (await exists(hash, ext)) {
    descriptor.duplicate = true;
    return descriptor;
  }

  const tmpDir = join(blobsDir(), TMP_DIR);
  await Promise.all([
    mkdir(tmpDir, { recursive: true }),
    mkdir(join(blobsDir(), hash.slice(0, 2), hash.slice(2, 4)), { recursive: true }),
  ]);
  const tmp = join(tmpDir, `${hash}.${randomBytes(6).toString('hex')}.part`);
  try {
    await copyFile(absPath, tmp);
    await rename(tmp, dest);
  } catch (err) {
    await rm(tmp, { force: true });
    // Гонка: паралельний імпорт того самого файлу вже поклав блоб.
    if (await exists(hash, ext)) {
      descriptor.duplicate = true;
      return descriptor;
    }
    throw err;
  }
  return descriptor;
}

/** Прибирає недописані частини після падіння. Викликати на старті застосунку. */
export async function cleanupTemp(): Promise<void> {
  await rm(join(blobsDir(), TMP_DIR), { recursive: true, force: true });
}
