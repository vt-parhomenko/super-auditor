/**
 * Дрібні хелпери рендерингу промптів.
 *
 * Промпти англійською (документи і стандарти англомовні), коментарі українською.
 * Жодних `Date.now()` і випадкових значень: усе, що рендериться, входить у
 * кешований префікс і в ключ кешу (architecture.md §9).
 */

/** Екранування значення атрибута XML-подібного тега. */
export function attr(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `<tag a="1" b="2">` з пропуском порожніх атрибутів. */
export function openTag(name: string, attrs: Record<string, string | number | null | undefined>): string {
  const rendered = Object.entries(attrs)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => ` ${key}="${attr(value)}"`)
    .join('');
  return `<${name}${rendered}>`;
}

export function tag(
  name: string,
  attrs: Record<string, string | number | null | undefined>,
  body: string,
): string {
  return `${openTag(name, attrs)}\n${body}\n</${name}>`;
}

/** Склеює секції промпта, викидаючи порожні. */
export function joinBlocks(...blocks: Array<string | null | undefined>): string {
  return blocks
    .filter((block): block is string => typeof block === 'string' && block.trim().length > 0)
    .join('\n\n');
}

/** Обрізає довгий текст із явною позначкою — щоб модель знала, що це не кінець. */
export function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[... truncated, ${text.length - maxChars} characters omitted ...]`;
}


/**
 * Інструкція про мову висновків.
 *
 * Критично: ЦИТАТИ лишаються мовою оригіналу. Якщо модель перекладе їх разом
 * із висновками, механічна перевірка (`verifyQuote`) перестане знаходити їх у
 * тексті документа — і кожен вердикт `compliant` буде понижено до
 * `needs_human_review`. Тобто переклад цитат тихо зруйнував би весь аудит.
 */
export function languageInstruction(language: string | undefined | null): string | null {
  const code = (language ?? '').trim();
  if (code === '') return null;

  const name = LANGUAGE_NAMES[code.toLowerCase()] ?? code;
  return (
    `Write \`rationale\`, \`gap\` and \`recommendation\` in ${name}. ` +
    'Keep every `quote` EXACTLY as it appears in the source document — never translate, ' +
    'paraphrase or re-punctuate a quote. Keep clause numbers, verdict and severity values ' +
    'unchanged as the schema defines them.'
  );
}

const LANGUAGE_NAMES: Record<string, string> = {
  uk: 'Ukrainian',
  en: 'English',
  nl: 'Dutch',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  pl: 'Polish',
  it: 'Italian',
};
