/**
 * Визначення MIME-типу за розширенням і сигнатурою (magic bytes).
 *
 * Розширенню не довіряємо самі по собі: користувач цілком може перейменувати
 * .docx у .pdf. Сигнатура має пріоритет, розширення — уточнює (zip-контейнер
 * сам по собі не розрізняє docx / xlsx / pptx).
 */

import { open } from 'node:fs/promises';
import { extname } from 'node:path';

export const MIME_PDF = 'application/pdf';
export const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const MIME_DOC = 'application/msword';
export const MIME_TXT = 'text/plain';
export const MIME_MD = 'text/markdown';
export const MIME_RTF = 'application/rtf';
export const MIME_HTML = 'text/html';
export const MIME_BIN = 'application/octet-stream';

const BY_EXT: Readonly<Record<string, string>> = {
  '.pdf': MIME_PDF,
  '.docx': MIME_DOCX,
  '.doc': MIME_DOC,
  '.txt': MIME_TXT,
  '.md': MIME_MD,
  '.markdown': MIME_MD,
  '.rtf': MIME_RTF,
  '.htm': MIME_HTML,
  '.html': MIME_HTML,
};

/** Скільки байтів голови файлу читаємо для сигнатури. */
const SNIFF_BYTES = 16;

/** MIME за розширенням шляху. `application/octet-stream`, якщо невідоме. */
export function mimeFromExt(path: string): string {
  return BY_EXT[extname(path).toLowerCase()] ?? MIME_BIN;
}

/** Розширення у нижньому регістрі, разом із крапкою: `'.pdf'`. Порожній рядок, якщо немає. */
export function extOf(path: string): string {
  return extname(path).toLowerCase();
}

/**
 * MIME за перших кількох байтах. `null`, якщо сигнатура не впізнана.
 * @param head перші байти файлу (достатньо 8)
 * @param ext  розширення — потрібне, щоб розрізнити типи всередині zip-контейнера
 */
export function mimeFromSignature(head: Uint8Array, ext: string): string | null {
  // '%PDF-'
  if (
    head[0] === 0x25 &&
    head[1] === 0x50 &&
    head[2] === 0x44 &&
    head[3] === 0x46 &&
    head[4] === 0x2d
  ) {
    return MIME_PDF;
  }
  // 'PK\x03\x04' — zip-контейнер. OOXML (docx) — це zip.
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    return ext === '.docx' ? MIME_DOCX : (BY_EXT[ext] ?? MIME_BIN);
  }
  // '\xD0\xCF\x11\xE0' — OLE2 (старий .doc)
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
    return MIME_DOC;
  }
  // '{\rtf'
  if (head[0] === 0x7b && head[1] === 0x5c && head[2] === 0x72 && head[3] === 0x74) {
    return MIME_RTF;
  }
  return null;
}

/** Читає голову файлу і повертає MIME: сигнатура → розширення → octet-stream. */
export async function detectMime(absPath: string): Promise<string> {
  const ext = extOf(absPath);
  const head = new Uint8Array(SNIFF_BYTES);
  const fh = await open(absPath, 'r');
  try {
    await fh.read(head, 0, SNIFF_BYTES, 0);
  } finally {
    await fh.close();
  }
  return mimeFromSignature(head, ext) ?? mimeFromExt(absPath);
}
