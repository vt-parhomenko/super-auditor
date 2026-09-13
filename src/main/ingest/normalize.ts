/**
 * Нормалізація тексту й побудова офсетів сторінок.
 *
 * ГОЛОВНЕ ПРАВИЛО МОДУЛЯ: нормалізація змінює довжину тексту, отже ламає
 * будь-які раніше пораховані офсети. Тому API посторінкове:
 *
 *     pages.map(normalizePageText)  →  joinPages(...)  →  { text, ranges }
 *
 * Спочатку нормалізуємо КОЖНУ сторінку окремо, і лише потім склеюємо,
 * рахуючи `charStart/charEnd` по вже нормалізованих довжинах. Нормалізувати
 * склеєний текст не можна — прив'язки цитат до сторінок стануть брехнею
 * (розділ 6, Stage 0, п. 4 architecture.md).
 */

import type { PageRange } from '@shared/domain';

/** Роздільник сторінок у склеєному тексті. НЕ входить у жоден `PageRange`. */
export const PAGE_SEPARATOR = '\n\n';

export interface NormalizeOptions {
  /** Прибирати типові колонтитули («Page 3 of 100», голий номер сторінки). За замовчуванням true. */
  stripRunningHeaders?: boolean;
  /** Максимум порожніх рядків підряд. За замовчуванням 1 (тобто `\n\n`). */
  maxBlankLines?: number;
}

/**
 * Заміна артефактів екстракції.
 *
 * U+FFFD — головний біль: у частині PDF буліт `•` виходить саме так
 * (architecture.md прямо на це вказує). У поточній збірці pdfjs 6.3 на наших
 * файлах буліт витягується правильно, але заміна лишається — вона рятує
 * файли з нестандартними шрифтами й нічого не псує (U+FFFD не буває
 * легітимним символом у документі).
 *
 * Решта — типографіка, яка тільки з'їдає токени й заважає пошуку цитат.
 */
const ARTIFACTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\uFFFD/g, '\u2022'], // replacement character -> буліт (артефакт зі Stage 0)
  [/[\u25CF\u25AA\u25E6\u2023\uF0B7\uF0A7\uF0D8\uF076]/g, '\u2022'], // варіанти булітів, у т.ч. Symbol/Wingdings із PUA
  [/\u00AD/g, ''], // soft hyphen
  [/[\u200B-\u200D\u2060\uFEFF]/g, ''], // zero-width + BOM
  [/[\u00A0\u202F\u2007]/g, ' '], // нерозривні пробіли
  [/[\u2000-\u200A\u205F\u3000]/g, ' '], // типографські пробіли
  [/[\u2010\u2011]/g, '-'], // hyphen / non-breaking hyphen
  [/[\u2018\u2019\u201B\u2032]/g, "'"], // одинарні лапки
  [/[\u201C\u201D\u201F\u2033]/g, '"'], // подвійні лапки
  [/\u2026/g, '...'], // ellipsis
  [/\uFB00/g, 'ff'],
  [/\uFB01/g, 'fi'],
  [/\uFB02/g, 'fl'],
  [/\uFB03/g, 'ffi'],
  [/\uFB04/g, 'ffl'],
];

/**
 * Рядки-колонтитули, які нічого не додають до змісту, зате повторюються
 * на кожній сторінці. Прибираються тільки якщо становлять ВЕСЬ рядок.
 */
const RUNNING_HEADER_PATTERNS: readonly RegExp[] = [
  /^\d{1,3}$/, // голий номер сторінки (4 цифри — це вже радше рік на обкладинці)
  /^-\s*\d{1,4}\s*-$/, // - 12 -
  /^page\s+\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i, // Page 12 of 100
  /^\d{1,4}\s*(of|\/)\s*\d{1,4}$/i, // 12 of 100
  /^(стор\.?|сторінка|стр\.?)\s*\d{1,4}.*$/i,
];

/**
 * Нормалізує текст ОДНІЄЇ сторінки.
 *
 * Ідемпотентна: `f(f(x)) === f(x)`. На цьому тримаються тести офсетів —
 * нормалізований текст сторінки можна порівнювати з нарізкою склеєного.
 */
export function normalizePageText(raw: string, options: NormalizeOptions = {}): string {
  const { stripRunningHeaders = true, maxBlankLines = 1 } = options;
  if (raw.length === 0) return '';

  let text = raw;
  for (const [pattern, replacement] of ARTIFACTS) {
    text = text.replace(pattern, replacement);
  }

  // Кінці рядків → LF.
  text = text.replace(/\r\n?/g, '\n');

  // Порядкова обробка: схлопування пробілів, обрізання країв, колонтитули.
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    const squashed = line.replace(/[ \t\f\v]+/g, ' ').trim();
    if (stripRunningHeaders && squashed !== '' && isRunningHeader(squashed)) continue;
    lines.push(squashed);
  }
  text = lines.join('\n');

  // Обмеження порожніх рядків: maxBlankLines=1 → максимум '\n\n'.
  const maxNewlines = Math.max(1, maxBlankLines + 1);
  text = text.replace(new RegExp(`\\n{${maxNewlines + 1},}`, 'g'), '\n'.repeat(maxNewlines));

  return text.trim().normalize('NFC');
}

function isRunningHeader(line: string): boolean {
  if (line.length > 64) return false;
  return RUNNING_HEADER_PATTERNS.some((re) => re.test(line));
}

/**
 * Склеює ВЖЕ НОРМАЛІЗОВАНІ сторінки й будує офсети.
 *
 * Інваріант, на якому тримаються клікабельні цитати:
 *
 *     text.slice(ranges[i].charStart, ranges[i].charEnd) === pages[i]
 *
 * Роздільник між сторінками лежить ПОЗА діапазонами, тож порожня сторінка
 * дає коректний вироджений діапазон `charStart === charEnd`.
 */
export function joinPages(pages: readonly string[]): { text: string; ranges: PageRange[] } {
  const ranges: PageRange[] = [];
  const chunks: string[] = [];
  let cursor = 0;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i] ?? '';
    if (i > 0) {
      chunks.push(PAGE_SEPARATOR);
      cursor += PAGE_SEPARATOR.length;
    }
    chunks.push(page);
    ranges.push({ pageNo: i + 1, charStart: cursor, charEnd: cursor + page.length });
    cursor += page.length;
  }

  return { text: chunks.join(''), ranges };
}

/** Знаходить номер сторінки за офсетом у склеєному тексті. Для клікабельних цитат. */
export function pageOfOffset(ranges: readonly PageRange[], offset: number): number | null {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = ranges[mid];
    if (!r) break;
    if (offset < r.charStart) hi = mid - 1;
    else if (offset >= r.charEnd) lo = mid + 1;
    else return r.pageNo;
  }
  return null;
}

export interface StripBoilerplateOptions {
  /** Частка сторінок, на якій рядок має зустрітись, щоб вважатись колонтитулом. 0..1. */
  minPageFraction?: number;
  /** Мінімальна довжина рядка-кандидата. Коротке («•», «4») не чіпаємо. */
  minLineLength?: number;
  /** Не працювати на документах, коротших за стільки сторінок — статистики немає. */
  minPages?: number;
  /**
   * До скількох символів обрізати ключ порівняння.
   *
   * Колонтитул на першій сторінці спеки Tesco каже «available on myLibrary»,
   * а на решті 100 — «available on the myLibrary». Порівняння цілих рядків
   * вважало б їх різними, і на титулці колонтитул би вижив. Порівняння за
   * префіксом склеює такі варіанти, а от два різні тексти вимог, однакові в
   * перших 48 символах ще й на 60% сторінок, — річ неможлива.
   */
  keyPrefixLength?: number;
}

/**
 * Прибирає рядки, що повторюються на ≥ `minPageFraction` сторінок.
 *
 * У 101-сторінковій спеці Tesco це три рядки на кожній сторінці
 * («The controlled version … myLibrary (Inspectorio) …», «© Tesco Stores Ltd. …»,
 * шапка таблиці «P R O Clause number Topic Requirements») — приблизно чверть
 * усього тексту, яка не несе жодної вимоги, зате їде у кожен промпт.
 *
 * Порівняння йде за КЛЮЧЕМ: регістр згорнуто, цифри замасковано (`#`),
 * інакше «Page 12 of 100» і «Page 13 of 100» вважались би різними рядками.
 * Вхід і вихід — масиви посторінкового тексту; офсети будує вже `joinPages`.
 */
export function stripBoilerplate(
  pages: readonly string[],
  options: StripBoilerplateOptions = {},
): string[] {
  const {
    minPageFraction = 0.6,
    minLineLength = 8,
    minPages = 4,
    keyPrefixLength = 48,
  } = options;
  if (pages.length < minPages) return pages.slice();

  const keyOf = (line: string): string => boilerplateKey(line, keyPrefixLength);

  const pagesWithLine = new Map<string, number>();
  for (const page of pages) {
    const seen = new Set<string>();
    for (const line of page.split('\n')) {
      const key = keyOf(line);
      if (key.length < minLineLength) continue;
      seen.add(key);
    }
    for (const key of seen) pagesWithLine.set(key, (pagesWithLine.get(key) ?? 0) + 1);
  }

  const threshold = Math.max(2, Math.ceil(pages.length * minPageFraction));
  const drop = new Set<string>();
  for (const [key, count] of pagesWithLine) {
    if (count >= threshold) drop.add(key);
  }
  if (drop.size === 0) return pages.slice();

  return pages.map((page) => {
    const kept = page.split('\n').filter((line) => !drop.has(keyOf(line)));
    return kept
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  });
}

/** Ключ порівняння рядків-колонтитулів: без регістру, без конкретних цифр, за префіксом. */
function boilerplateKey(line: string, prefixLength: number): string {
  const normalized = line.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\d+/g, '#');
  return normalized.length > prefixLength ? normalized.slice(0, prefixLength) : normalized;
}
