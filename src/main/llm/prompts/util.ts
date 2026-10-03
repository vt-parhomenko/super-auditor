/**
 * Дрібні хелпери рендерингу промптів.
 *
 * Промпти англійською (документи і стандарти англомовні), коментарі українською.
 * Жодних `Date.now()` і випадкових значень: усе, що рендериться, входить у
 * кешований префікс і в ключ кешу (architecture.md §9).
 */

import { isLanguage, type Language, type MarkerLegendItem } from '@shared/domain';

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

// ─── Позначки стандарту ──────────────────────────────────────────────────────

/**
 * Атрибут `markers="P, R"` для тега вимоги. Позначок немає — `undefined`, і
 * `openTag` атрибут просто пропускає: промпт стандарту без позначок не має
 * ні порожнього `markers=""`, ні згадки про них.
 */
export function markersAttr(markers: readonly string[] | null | undefined): string | undefined {
  return markers && markers.length > 0 ? markers.join(', ') : undefined;
}

/**
 * Блок `<marker_legend>` — пояснення позначок словами самого стандарту.
 * Порожня легенда — `null` (блоку немає взагалі). Позначка без пояснення
 * лишається в блоці з явним «не пояснено»: модель має знати, що значення
 * невідоме, а не вгадувати його з коду.
 */
export function markerLegendBlock(legend: readonly MarkerLegendItem[] | null | undefined): string | null {
  if (!legend || legend.length === 0) return null;
  const items = legend.map((item) =>
    tag(
      'marker',
      // Назва, що дублює код («P» — «P»), нічого не додає.
      { code: item.code, label: item.label && item.label !== item.code ? item.label : undefined },
      item.meaning ?? '(The standard does not explain this marker.)',
    ),
  );
  return tag('marker_legend', { count: legend.length }, items.join('\n'));
}

/** Канонічна легенда для `cacheInput`: зміна будь-якого слова легенди — інший ключ. */
export function markerLegendKey(
  legend: readonly MarkerLegendItem[] | null | undefined,
): Array<{ code: string; label: string; meaning: string | null }> | null {
  if (!legend || legend.length === 0) return null;
  return legend.map((item) => ({ code: item.code, label: item.label, meaning: item.meaning }));
}

/** Обрізає довгий текст із явною позначкою — щоб модель знала, що це не кінець. */
export function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[... truncated, ${text.length - maxChars} characters omitted ...]`;
}

/** Назви мов так, як їх найкраще розуміє модель. Лише мови застосунку. */
const LANGUAGE_NAMES: Readonly<Record<Language, string>> = {
  en: 'English',
  nl: 'Dutch',
  uk: 'Ukrainian',
};

export interface LanguageInstructionOptions {
  /** Поля відповіді, які модель пише мовою результатів. */
  fields?: readonly string[];
  /** Що лишається як є, крім цитат (про цитати сказано завжди). */
  keep?: string;
}

/** Поля й правило для судження (Stage 4) — типовий випадок. */
const JUDGE_FIELDS = ['rationale', 'gap', 'recommendation'] as const;
const JUDGE_KEEP = 'Keep clause numbers, verdict and severity values unchanged as the schema defines them.';

/**
 * Інструкція про мову висновків. `null` — мовою стандарту, без інструкції:
 * тоді промпт байт-у-байт той самий, що й до появи вибору мови, і старий кеш
 * лишається дійсним.
 *
 * Приймаються лише мови застосунку (`LANGUAGES`); будь-що інше — так само
 * «мовою стандарту», а не сирий рядок у промпті.
 *
 * Критично: ЦИТАТИ лишаються мовою оригіналу. Якщо модель перекладе їх разом
 * із висновками, механічна перевірка (`verifyQuote`) перестане знаходити їх у
 * тексті документа — і кожен вердикт `compliant` буде понижено до
 * `needs_human_review`. Тобто переклад цитат тихо зруйнував би весь аудит.
 */
export function languageInstruction(
  language: string | undefined | null,
  options: LanguageInstructionOptions = {},
): string | null {
  const code = (language ?? '').trim();
  if (!isLanguage(code)) return null;

  const fields = options.fields ?? JUDGE_FIELDS;
  const keep = options.keep ?? JUDGE_KEEP;
  return (
    `Write ${listFields(fields)} in ${LANGUAGE_NAMES[code]}. ` +
    'Keep every `quote` EXACTLY as it appears in the source document — never translate, ' +
    `paraphrase or re-punctuate a quote. ${keep}`
  );
}

/** `a`, `b` and `c` — так само, як промпт називав поля до параметризації. */
function listFields(fields: readonly string[]): string {
  const quoted = fields.map((field) => `\`${field}\``);
  if (quoted.length <= 1) return quoted.join('');
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

/**
 * Мова для `cacheInput`. Порожня (мовою стандарту) не додає ключа взагалі —
 * тоді вхід кешу байт-у-байт той самий, що до появи вибору мови.
 */
export function languageKey(language: string | undefined | null): { language?: string } {
  const code = (language ?? '').trim();
  return isLanguage(code) ? { language: code } : {};
}
