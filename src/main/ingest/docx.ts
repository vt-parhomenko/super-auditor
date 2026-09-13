/**
 * Витяг тексту з DOCX: `mammoth` → HTML → простий Markdown.
 *
 * Чому не `mammoth.extractRawText`: він втрачає структуру. Заголовки, списки
 * й таблиці — це саме те, за що чіпляється Stage 2 (профіль документа) і
 * Stage 4 (судження): «розділ 4.2 SOP описує…» без заголовків не працює.
 *
 * Сторінок у DOCX немає — розбиття на сторінки робить друкарка Word, а не
 * файл. Тому віддаємо ОДНУ «сторінку»: прив'язка цитат буде тільки за
 * офсетами (розділ 6, Stage 0, п. 5 architecture.md).
 */

import { createRequire } from 'node:module';
import mammoth from 'mammoth';

export interface DocxExtraction {
  /** Завжди рівно один елемент — увесь документ як одна «сторінка». */
  pages: string[];
  /** Попередження mammoth (незрозумілі стилі, втрачені зображення тощо). */
  messages: string[];
  toolVersion: string;
}

/** Стилі Word → Markdown. Без цього нумеровані заголовки Heading 1..6 стають абзацами. */
const STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => h2:fresh",
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='Heading 4'] => h4:fresh",
  "p[style-name='Heading 5'] => h5:fresh",
  "p[style-name='Heading 6'] => h6:fresh",
];

export async function extractDocx(absPath: string): Promise<DocxExtraction> {
  const result = await mammoth.convertToHtml(
    { path: absPath },
    {
      styleMap: STYLE_MAP,
      // Зображення не конвертуємо: base64 роздув би текст на порядок.
      ignoreEmptyParagraphs: true,
    },
  );
  return {
    pages: [htmlToMarkdown(result.value)],
    messages: result.messages.map((m) => `${m.type}: ${m.message}`),
    toolVersion: `mammoth@${mammothVersion()}`,
  };
}

let cachedVersion: string | null = null;

function mammothVersion(): string {
  if (cachedVersion) return cachedVersion;
  cachedVersion = 'unknown';
  try {
    // Пакет не експортує свою версію; читаємо package.json без нових залежностей.
    const req = createRequire(`${process.cwd()}/package.json`);
    const pkg = req('mammoth/package.json') as { version?: string };
    if (typeof pkg.version === 'string') cachedVersion = pkg.version;
  } catch {
    /* лишається 'unknown' — не привід валити імпорт */
  }
  return cachedVersion;
}

// ─── HTML → Markdown ─────────────────────────────────────────────────────────

/** Значущі теги. Усе інше просто розгортається у свій вміст. */
type Token =
  | { kind: 'text'; value: string }
  | { kind: 'open'; tag: string }
  | { kind: 'close'; tag: string };

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

function decodeEntities(html: string): string {
  return html.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return HTML_ENTITIES[body.toLowerCase()] ?? match;
  });
}

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    if (match.index > last) {
      tokens.push({ kind: 'text', value: decodeEntities(html.slice(last, match.index)) });
    }
    const tag = (match[1] ?? '').toLowerCase();
    const selfClosing = match[2] === '/';
    if (match[0].startsWith('</')) tokens.push({ kind: 'close', tag });
    else {
      tokens.push({ kind: 'open', tag });
      if (selfClosing || tag === 'br' || tag === 'img' || tag === 'hr') {
        tokens.push({ kind: 'close', tag });
      }
    }
    last = re.lastIndex;
  }
  if (last < html.length) tokens.push({ kind: 'text', value: decodeEntities(html.slice(last)) });
  return tokens;
}

/**
 * Перетворює HTML від mammoth на Markdown.
 *
 * Свідомо простий потоковий конвертер: mammoth віддає рівно той підмножинний
 * HTML, який сам і генерує (p, h1–h6, ul/ol/li, table/tr/td/th, strong, em,
 * a, br), тож повноцінний парсер тут був би зайвою вагою.
 */
export function htmlToMarkdown(html: string): string {
  const tokens = tokenize(html);
  const out: string[] = [];
  /** Стек типів списків для вкладеності: 'ul' | 'ol'. */
  const listStack: Array<{ tag: string; index: number }> = [];
  let buffer = '';
  let heading = 0;
  let inCell = false;
  let row: string[] = [];
  let tableRows: string[][] = [];

  const flushBlock = (prefix = ''): void => {
    const text = buffer.replace(/[ \t]+/g, ' ').trim();
    buffer = '';
    if (text === '') return;
    out.push(prefix + text);
  };

  const flushTable = (): void => {
    if (tableRows.length === 0) return;
    const width = tableRows.reduce((m, r) => Math.max(m, r.length), 0);
    const pad = (r: string[]): string =>
      `| ${Array.from({ length: width }, (_, i) => (r[i] ?? '').trim() || ' ').join(' | ')} |`;
    const [first, ...rest] = tableRows;
    if (first) {
      out.push(pad(first));
      out.push(`|${' --- |'.repeat(width)}`);
      for (const r of rest) out.push(pad(r));
    }
    tableRows = [];
  };

  for (const token of tokens) {
    if (token.kind === 'text') {
      buffer += token.value;
      continue;
    }
    const { tag } = token;

    if (token.kind === 'open') {
      switch (tag) {
        case 'p':
          flushBlock();
          break;
        case 'h1':
        case 'h2':
        case 'h3':
        case 'h4':
        case 'h5':
        case 'h6':
          flushBlock();
          heading = Number(tag.slice(1));
          break;
        case 'ul':
        case 'ol':
          flushBlock();
          listStack.push({ tag, index: 0 });
          break;
        case 'li':
          flushBlock();
          break;
        case 'table':
          flushBlock();
          tableRows = [];
          break;
        case 'tr':
          row = [];
          break;
        case 'th':
        case 'td':
          inCell = true;
          buffer = '';
          break;
        case 'strong':
        case 'b':
          buffer += '**';
          break;
        case 'em':
        case 'i':
          buffer += '*';
          break;
        case 'br':
          buffer += inCell ? ' ' : '\n';
          break;
        default:
          break;
      }
      continue;
    }

    switch (tag) {
      case 'p':
        flushBlock();
        break;
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        flushBlock(`${'#'.repeat(heading || Number(tag.slice(1)))} `);
        heading = 0;
        break;
      case 'li': {
        const frame = listStack[listStack.length - 1];
        const indent = '  '.repeat(Math.max(0, listStack.length - 1));
        if (frame && frame.tag === 'ol') {
          frame.index += 1;
          flushBlock(`${indent}${frame.index}. `);
        } else {
          flushBlock(`${indent}- `);
        }
        break;
      }
      case 'ul':
      case 'ol':
        flushBlock();
        listStack.pop();
        break;
      case 'th':
      case 'td':
        row.push(buffer.replace(/\s+/g, ' ').trim());
        buffer = '';
        inCell = false;
        break;
      case 'tr':
        if (row.length > 0) tableRows.push(row);
        row = [];
        break;
      case 'strong':
      case 'b':
        buffer += '**';
        break;
      case 'em':
      case 'i':
        buffer += '*';
        break;
      case 'table':
        flushTable();
        break;
      default:
        break;
    }
  }
  flushBlock();
  flushTable();

  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}
