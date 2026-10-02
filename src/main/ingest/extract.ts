/**
 * Диспетчер екстракції (Stage 0).
 *
 * Один вхід — `extractText(absPath, mime)` — і один вихід: текст із
 * побудованими офсетами сторінок, готовий лягти в `extraction` +
 * `extraction_page`. Оркестрацію (запис у БД, створення версій документів,
 * `importFiles`) робить шар вище; тут лише детермінована обробка файлу.
 *
 * Порядок дій навмисне жорсткий:
 *   витяг сирих сторінок → нормалізація КОЖНОЇ сторінки → (опційно)
 *   зняття колонтитулів → joinPages → офсети.
 * Будь-яка перестановка ламає `charStart/charEnd` (див. normalize.ts).
 */

import { LocalizedError } from '@main/i18n';
import type { ExtractionMethod, PageRange } from '@shared/domain';
import { extractDocx } from './docx';
import { MIME_DOCX, MIME_PDF, mimeFromExt } from './mime';
import {
  joinPages,
  normalizePageText,
  stripBoilerplate,
  type NormalizeOptions,
  type StripBoilerplateOptions,
} from './normalize';
import { extractPdf, type PdfExtractOptions, type PdfInfo } from './pdf';

export interface ExtractionResult {
  method: ExtractionMethod;
  /** Рушій і версія, напр. `'pdfjs-dist@6.3.289'`. Іде в `extraction.tool_version`. */
  toolVersion: string;
  /** Повний нормалізований текст. Сторінки склеєні через `PAGE_SEPARATOR`. */
  text: string;
  /** Офсети сторінок. Інваріант: `text.slice(charStart, charEnd)` = текст сторінки. */
  pages: PageRange[];
  /** `null` для форматів без сторінок (DOCX). */
  pageCount: number | null;
  charCount: number;
  /** 0..1. Щільність тексту для PDF (див. `pdfQuality`). */
  quality: number | null;
  /** `quality < 0.3` — документ схожий на скан, потрібен OCR. */
  needsOcr: boolean;
  /** Скільки символів прибрало зняття колонтитулів. 0, якщо вимкнено. */
  boilerplateRemoved: number;
  /** Метадані PDF, якщо є. */
  info: PdfInfo | null;
  /** Попередження рушія (mammoth про незрозумілі стилі тощо). */
  warnings: string[];
}

export interface ExtractOptions {
  /** Знімати повторювані колонтитули. Типово true. */
  stripBoilerplate?: boolean;
  boilerplate?: StripBoilerplateOptions;
  normalize?: NormalizeOptions;
  pdf?: PdfExtractOptions;
}

/** Нижче цього значення `quality` документ вважається сканом. */
export const OCR_QUALITY_THRESHOLD = 0.3;

/** Символів на сторінку, нижче яких PDF — майже напевно скан (architecture.md, Stage 0 п. 3). */
const SCAN_CHARS_PER_PAGE = 200;
/** Символів на сторінку, від яких текстовий шар вважаємо повноцінним. */
const DENSE_CHARS_PER_PAGE = 1000;

/**
 * Щільність тексту → 0..1.
 *
 * Кусково-лінійна навмисно: поріг 200 символів/стор. із architecture.md має
 * лягати РІВНО на 0.3, інакше «< 200 → потрібен OCR» і «quality < 0.3 →
 * потрібен OCR» розійшлись би на межі.
 */
export function pdfQuality(charCount: number, pageCount: number): number {
  if (pageCount <= 0) return 0;
  const perPage = charCount / pageCount;
  if (perPage <= 0) return 0;
  if (perPage < SCAN_CHARS_PER_PAGE) {
    return round3((perPage / SCAN_CHARS_PER_PAGE) * OCR_QUALITY_THRESHOLD);
  }
  if (perPage >= DENSE_CHARS_PER_PAGE) return 1;
  const span = (perPage - SCAN_CHARS_PER_PAGE) / (DENSE_CHARS_PER_PAGE - SCAN_CHARS_PER_PAGE);
  return round3(OCR_QUALITY_THRESHOLD + span * (1 - OCR_QUALITY_THRESHOLD));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Чи вміє модуль читати такий тип. Для фільтра діалогу вибору файлів. */
export function isSupportedMime(mime: string): boolean {
  return mime === MIME_PDF || mime === MIME_DOCX;
}

/**
 * Stage 0 читає лише PDF (pdfjs) і DOCX (mammoth). Текст для людини будує межа
 * імпорту мовою інтерфейсу — сам модуль мови не знає.
 */
export class UnsupportedFormatError extends LocalizedError {
  constructor(readonly mime: string) {
    super((m) => m.importing.unsupportedFormat(mime));
    this.name = 'UnsupportedFormatError';
  }
}

/**
 * Витягує текст із файлу.
 *
 * @param absPath абсолютний шлях (зазвичай — блоб зі сховища)
 * @param mime    визначений MIME; якщо не задано — вгадуємо за розширенням
 */
export async function extractText(
  absPath: string,
  mime?: string,
  options: ExtractOptions = {},
): Promise<ExtractionResult> {
  const type = mime ?? mimeFromExt(absPath);
  if (type === MIME_PDF) return extractFromPdf(absPath, options);
  if (type === MIME_DOCX) return extractFromDocx(absPath, options);
  throw new UnsupportedFormatError(type);
}

async function extractFromPdf(
  absPath: string,
  options: ExtractOptions,
): Promise<ExtractionResult> {
  const raw = await extractPdf(absPath, options.pdf ?? {});

  // 1. Нормалізуємо кожну сторінку окремо — офсетів ще немає, ламати нічого.
  const normalized = raw.pages.map((page) => normalizePageText(page, options.normalize));
  const beforeStrip = totalLength(normalized);

  // 2. Знімаємо колонтитули (теж посторінково).
  const useStrip = options.stripBoilerplate !== false;
  const cleaned = useStrip ? stripBoilerplate(normalized, options.boilerplate) : normalized;
  const boilerplateRemoved = useStrip ? beforeStrip - totalLength(cleaned) : 0;

  // 3. І тільки тепер склеюємо — офсети рахуються по фінальних довжинах.
  const { text, ranges } = joinPages(cleaned);
  const charCount = text.length;
  const quality = pdfQuality(totalLength(cleaned), raw.pageCount);

  return {
    method: 'pdfjs' satisfies ExtractionMethod,
    toolVersion: raw.toolVersion,
    text,
    pages: ranges,
    pageCount: raw.pageCount,
    charCount,
    quality,
    needsOcr: quality < OCR_QUALITY_THRESHOLD,
    boilerplateRemoved,
    info: raw.info,
    warnings: [],
  };
}

async function extractFromDocx(
  absPath: string,
  options: ExtractOptions,
): Promise<ExtractionResult> {
  const raw = await extractDocx(absPath);
  // DOCX уже структурований — колонтитули mammoth не віддає, знімати нічого.
  const normalized = raw.pages.map((page) =>
    normalizePageText(page, { stripRunningHeaders: false, ...options.normalize }),
  );
  const { text, ranges } = joinPages(normalized);

  return {
    method: 'mammoth' satisfies ExtractionMethod,
    toolVersion: raw.toolVersion,
    text,
    pages: ranges,
    // Сторінок у DOCX немає — саме тому поле nullable у ExtractionDto.
    pageCount: null,
    charCount: text.length,
    quality: text.length > 0 ? 1 : 0,
    needsOcr: text.length === 0,
    boilerplateRemoved: 0,
    info: null,
    warnings: raw.messages,
  };
}

function totalLength(pages: readonly string[]): number {
  let sum = 0;
  for (const page of pages) sum += page.length;
  return sum;
}
