/**
 * Витяг тексту з PDF через `pdfjs-dist`.
 *
 * У Node-процесі беремо legacy-збірку: `pdfjs-dist/legacy/build/pdf.mjs`.
 * Основна збірка розрахована на сучасний браузер і тягне DOM-API, яких у
 * main-процесі Electron під час фонової обробки може не бути.
 *
 * Найважливіше тут — РЕКОНСТРУКЦІЯ РОЗКЛАДКИ. `textContent.items` — це не
 * текст, а послідовність позиційованих шматочків. Стандарт Tesco — таблиця
 * `P R O | Clause number | Topic | Requirements`, і наївне склеювання
 * `items.map(i => i.str).join('')` перемішує колонки так, що Stage 1
 * (реєстр вимог) стає неможливим.
 */

import { readFile } from 'node:fs/promises';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface PdfInfo {
  title: string | null;
  author: string | null;
  producer: string | null;
  creator: string | null;
  /** Сира дата з метаданих PDF (`D:20260101…`), як є. */
  creationDate: string | null;
  encrypted: boolean;
}

export interface PdfExtraction {
  /** Сирий (ще НЕ нормалізований) текст кожної сторінки. Індекс 0 = сторінка 1. */
  pages: string[];
  pageCount: number;
  info: PdfInfo;
  /** Версія pdfjs, з якою зроблено витяг. Іде в `extraction.tool_version`. */
  toolVersion: string;
}

export interface PdfExtractOptions {
  /**
   * `'stream'` (типово) — порядок блоків такий, як у контент-стрімі PDF.
   * На таблицях Tesco це єдиний порядок, що дає правильне читання
   * (номер вимоги → топік → вимога), бо клітинки в стрімі йдуть по рядках
   * таблиці, тоді як геометрично номер вимоги відцентрований по вертикалі
   * й «провалюється» нижче першого рядка вимоги.
   *
   * `'geometric'` — блоки перевпорядковуються за Y-смугами, всередині смуги
   * за X. Запасний варіант для PDF, де стрім перемішаний.
   */
  readingOrder?: 'stream' | 'geometric';
  /**
   * Склеювати м'які переноси всередині блоку (типово true).
   * Рядок, що дотягується до правого краю блоку, вважається перенесеним і
   * зшивається з наступним пробілом. Саме це перетворює клітинку
   * `«Management» / «review»` на `«Management review»`, а тритисячний
   * колонтитул із двох рядків — на один (що потім ловить `stripBoilerplate`).
   */
  unwrapLines?: boolean;
  /** Викликається після кожної сторінки — для прогрес-бару імпорту. */
  onPage?: (pageNo: number, pageCount: number) => void;
}

/** Допуск по Y, у межах якого елементи вважаються одним рядком, у частках висоти шрифту. */
const LINE_Y_TOLERANCE = 0.4;
/** Горизонтальний розрив (у частках висоти шрифту), після якого вставляємо пробіл. */
const SPACE_GAP = 0.12;
/** Вертикальний розрив (у міжрядкових інтервалах), після якого блок вважається новим. */
const BLOCK_LINE_GAP = 1.9;
/** Наскільки (у висотах шрифту) правий край рядка може не дотягнути до краю блоку і все ще вважатись перенесеним. */
const WRAP_SLACK = 2.6;
/** Блок, вужчий за таку частку сторінки, вважається вузькою клітинкою таблиці. */
const NARROW_BLOCK = 0.15;

interface Piece {
  x: number;
  y: number;
  width: number;
  height: number;
  str: string;
  eol: boolean;
}

interface Line {
  y: number;
  left: number;
  right: number;
  text: string;
}

interface Block {
  top: number;
  bottom: number;
  left: number;
  right: number;
  lines: Line[];
}

/** Мінімальний зріз того, що нам треба від `TextItem`, щоб не тягнути типи pdfjs. */
interface RawItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

export async function extractPdf(
  absPath: string,
  options: PdfExtractOptions = {},
): Promise<PdfExtraction> {
  const data = new Uint8Array(await readFile(absPath));
  const task = pdfjs.getDocument({
    data,
    // Ані системні шрифти, ані @font-face у Node не потрібні: рендеру немає,
    // потрібні лише мапи гліфів → Unicode, які pdfjs бере з самого файлу.
    useSystemFonts: false,
    disableFontFace: true,
    // Тільки помилки: інакше кожен нестандартний шрифт друкує «TT: undefined function».
    verbosity: 0,
  });

  const doc = await task.promise;
  try {
    const pageCount = doc.numPages;
    const pages: string[] = new Array<string>(pageCount);
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      try {
        const content = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1 });
        pages[i - 1] = renderPage(content.items as RawItem[], viewport.height, options);
      } finally {
        page.cleanup();
      }
      options.onPage?.(i, pageCount);
    }
    const info = await readInfo(doc);
    return { pages, pageCount, info, toolVersion: `pdfjs-dist@${pdfjs.version}` };
  } finally {
    await task.destroy();
  }
}

async function readInfo(doc: { getMetadata: () => Promise<{ info: unknown }> }): Promise<PdfInfo> {
  const empty: PdfInfo = {
    title: null,
    author: null,
    producer: null,
    creator: null,
    creationDate: null,
    encrypted: false,
  };
  try {
    const meta = await doc.getMetadata();
    const raw = (meta.info ?? {}) as Record<string, unknown>;
    const str = (key: string): string | null => {
      const value = raw[key];
      return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
    };
    return {
      title: str('Title'),
      author: str('Author'),
      producer: str('Producer'),
      creator: str('Creator'),
      creationDate: str('CreationDate'),
      encrypted: raw['IsEncrypted'] === true,
    };
  } catch {
    return empty;
  }
}

/** Збирає текст однієї сторінки з позиційованих шматочків. */
function renderPage(items: RawItem[], pageHeight: number, options: PdfExtractOptions): string {
  const { readingOrder = 'stream', unwrapLines = true } = options;

  const pieces: Piece[] = [];
  const breaks: number[] = []; // індекси в `pieces`, перед якими примусово новий блок

  for (const item of items) {
    const transform = item.transform;
    if (typeof item.str !== 'string' || !transform || transform.length < 6) continue;
    const x = transform[4] ?? 0;
    const y = transform[5] ?? 0;
    const width = item.width ?? 0;
    const height = item.height ?? 0;

    // Порожній шматок нульової ширини з hasEOL — маркер початку текстового
    // блоку (клітинки, абзацу) у більшості генераторів PDF. Найнадійніший
    // сигнал межі, який pdfjs віддає безкоштовно.
    if (item.str === '' && width === 0) {
      if (item.hasEOL) breaks.push(pieces.length);
      continue;
    }
    pieces.push({ x, y, width, height, str: item.str, eol: item.hasEOL === true });
  }
  if (pieces.length === 0) return '';

  const fontSize = medianHeight(pieces);
  const blocks = buildBlocks(pieces, new Set(breaks), fontSize);
  const ordered =
    readingOrder === 'geometric'
      ? sortGeometrically(blocks, fontSize)
      : hoistLeadingFooter(blocks, pageHeight);

  const pageWidth = maxRight(blocks);
  const out: string[] = [];
  for (const block of ordered) {
    out.push(
      unwrapLines
        ? unwrapBlock(block, fontSize, pageWidth)
        : block.lines.map((l) => l.text).join('\n'),
    );
  }
  return out.join('\n');
}

function medianHeight(pieces: readonly Piece[]): number {
  const heights = pieces.map((p) => p.height).filter((h) => h > 0);
  if (heights.length === 0) return 10;
  heights.sort((a, b) => a - b);
  return heights[heights.length >> 1] ?? 10;
}

/**
 * Ріже потік шматочків на блоки (клітинка таблиці / абзац).
 *
 * Шматочки в межах блоку йдуть у стрімі підряд, тож блок обривається, коли:
 *   • прийшов маркер `''` + hasEOL;
 *   • Y пішов ВГОРУ (у PDF Y росте вгору) — почалась нова колонка/клітинка;
 *   • Y упав більше ніж на `BLOCK_LINE_GAP` міжрядкових інтервалів;
 *   • новий рядок починається лівіше за лівий край блоку.
 */
function buildBlocks(pieces: readonly Piece[], breaks: ReadonlySet<number>, fontSize: number): Block[] {
  const yTol = fontSize * LINE_Y_TOLERANCE;
  const blocks: Block[] = [];
  let block: Block | null = null;
  let line: Line | null = null;
  let lineHeight = fontSize * 1.2;

  const closeBlock = (): void => {
    if (block && line) block.lines.push(line);
    if (block && block.lines.length > 0) blocks.push(block);
    block = null;
    line = null;
  };

  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    if (!piece) continue;

    if (breaks.has(i)) closeBlock();

    if (block && line) {
      const sameLine = Math.abs(piece.y - line.y) <= yTol;
      if (sameLine) {
        appendToLine(line, piece, fontSize);
        block.left = Math.min(block.left, line.left);
        block.right = Math.max(block.right, line.right);
        continue;
      }
      const drop = line.y - piece.y;
      const newBlock =
        drop < -yTol || // поїхали вгору
        drop > lineHeight * BLOCK_LINE_GAP || // завеликий вертикальний розрив
        piece.x < block.left - fontSize; // новий рядок починається лівіше блоку
      if (newBlock) {
        closeBlock();
      } else {
        lineHeight = drop > 0 ? drop : lineHeight;
        block.lines.push(line);
        block.left = Math.min(block.left, piece.x);
        block.right = Math.max(block.right, piece.x + piece.width);
        block.bottom = Math.min(block.bottom, piece.y);
        line = newLine(piece);
        continue;
      }
    }

    block ??= {
      top: piece.y,
      bottom: piece.y,
      left: piece.x,
      right: piece.x + piece.width,
      lines: [],
    };
    line = newLine(piece);
  }
  closeBlock();
  return blocks;
}

function newLine(piece: Piece): Line {
  return {
    y: piece.y,
    left: piece.x,
    right: piece.x + piece.width,
    text: piece.str,
  };
}

/** Дописує шматок у рядок, вставляючи пробіл, якщо між ними є горизонтальний розрив. */
function appendToLine(line: Line, piece: Piece, fontSize: number): void {
  const gap = piece.x - line.right;
  const needsSpace =
    gap > fontSize * SPACE_GAP && !/\s$/.test(line.text) && !/^\s/.test(piece.str);
  line.text += (needsSpace ? ' ' : '') + piece.str;
  line.right = Math.max(line.right, piece.x + piece.width);
  line.left = Math.min(line.left, piece.x);
}

/**
 * Зшиває м'які переноси всередині блоку.
 *
 * Критерій — геометричний, не пунктуаційний: рядок, правий край якого
 * дотягується до правого краю блоку, обірвався через ширину колонки, а не
 * через кінець думки. Це працює і на клітинці `Management / review`
 * (обидва рядки — вся ширина вузької колонки), і на шапці документа
 * `Versie: 002` / `Proceseigenaar: …`, де короткий рядок НЕ зшивається.
 */
function unwrapBlock(block: Block, fontSize: number, pageWidth: number): string {
  const lines = block.lines;
  if (lines.length <= 1) return lines[0]?.text ?? '';

  // Вузька колонка (Topic у таблиці Tesco) — це підпис, розкиданий по рядках
  // тільки через ширину клітинки. Склеюємо цілком: «Key / performance /
  // indicators» → «Key performance indicators».
  if (
    pageWidth > 0 &&
    block.right - block.left < pageWidth * NARROW_BLOCK &&
    !lines.some((l) => /^[•\-–—*]\s/.test(l.text))
  ) {
    return lines.map((l) => l.text).join(' ');
  }

  const blockRight = lines.reduce((m, l) => Math.max(m, l.right), 0);
  const slack = fontSize * WRAP_SLACK;
  const out: string[] = [];
  let current = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    current = current === '' ? line.text : `${current} ${line.text}`;
    const next = lines[i + 1];
    const wrapped =
      next !== undefined &&
      line.right >= blockRight - slack &&
      !/^[•\-–—*]\s/.test(next.text) && // наступний — новий пункт списку
      !/[.:;!?]$/.test(line.text.trimEnd()); // рядок явно завершений
    if (!wrapped) {
      out.push(current);
      current = '';
    }
  }
  if (current !== '') out.push(current);
  return out.join('\n');
}

/**
 * Колонтитул часто йде першим у контент-стрімі. Якщо перші блоки сидять у
 * нижній частині сторінки, а основний текст — вище, переносимо їх у кінець.
 * Мінімальне втручання: порядок решти блоків не змінюється.
 */
function hoistLeadingFooter(blocks: Block[], pageHeight: number): Block[] {
  if (blocks.length < 3 || pageHeight <= 0) return blocks;
  const footerZone = pageHeight * 0.2;
  let cut = 0;
  while (cut < blocks.length && (blocks[cut]?.top ?? 0) < footerZone) cut++;
  if (cut === 0 || cut === blocks.length) return blocks;
  const maxTop = blocks.reduce((m, b) => Math.max(m, b.top), 0);
  if (maxTop < pageHeight * 0.5) return blocks;
  return [...blocks.slice(cut), ...blocks.slice(0, cut)];
}

/** Найправіша точка сторінки — оцінка ширини текстової області. */
function maxRight(blocks: readonly Block[]): number {
  return blocks.reduce((m, b) => Math.max(m, b.right), 0);
}

/** Запасний порядок: Y-смуги згори вниз, усередині смуги — зліва направо. */
function sortGeometrically(blocks: Block[], fontSize: number): Block[] {
  const sorted = [...blocks].sort((a, b) => b.top - a.top || a.left - b.left);
  const bandTol = fontSize * 1.2;
  const out: Block[] = [];
  let band: Block[] = [];
  let bandTop = Number.POSITIVE_INFINITY;

  const flush = (): void => {
    band.sort((a, b) => a.left - b.left);
    out.push(...band);
    band = [];
  };

  for (const block of sorted) {
    if (block.top < bandTop - bandTol) {
      flush();
      bandTop = block.top;
    }
    band.push(block);
  }
  flush();
  return out;
}
