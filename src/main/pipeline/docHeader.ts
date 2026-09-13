import { basename } from 'node:path';

/**
 * Детермінований розбір шапки документа й назви специфікації.
 *
 * Навмисно БЕЗ AI: у документів цього замовника шапка стабільна
 * (`Pest Management 0068 / Versie: 002 / Proceseigenaar: …`), а вигадувати
 * `versionLabel = 'v1'` для документа, який сам про себе каже «Versie: 003»,
 * означало б записати в БД неправду ще на етапі імпорту.
 *
 * Це евристика, не істина: усе, що вона повернула, користувач може виправити
 * в картці документа. Тому кожне поле — `null`, якщо впевненості немає.
 */

export interface DocumentHeader {
  title: string | null;
  docNumber: string | null;
  versionLabel: string | null;
  processOwner: string | null;
  /** Мова, вгадана за характерними словами шапки. */
  lang: string | null;
}

export interface SpecHeader {
  name: string | null;
  code: string | null;
  versionLabel: string | null;
  issuer: string | null;
}

/** Скільки символів від початку тексту вважаємо шапкою. */
const HEADER_WINDOW = 700;

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * Посади, якими закінчується назва ролі власника процесу. Потрібні, бо після
 * шапки одразу йде тіло документа — а воно теж починається з великої літери
 * («…Production Manager This procedure sets out…»), тож самої капіталізації
 * для межі не досить.
 */
const ROLE_NOUN =
  /\b(Manager|Director|Officer|Supervisor|Coordinator|Controller|Lead|Head|Owner|Team|Department)\b/i;

/**
 * Обрізає «хвіст» захопленої ролі: спершу по наступній мітці, далі — по
 * останньому слову-посаді. Якщо посади немає, лишаємо не більше 4 слів.
 */
function trimRole(value: string): string {
  const label = value.search(
    /\b(Versie|Version|Proceseigenaar|Process owner|Datum|Date|Pagina|Page)\b/i,
  );
  let text = (label >= 0 ? value.slice(0, label) : value).trim();

  const role = ROLE_NOUN.exec(text);
  if (role) {
    text = text.slice(0, role.index + role[0].length);
  } else {
    text = text.split(/\s+/).slice(0, 4).join(' ');
  }

  return text.trim().replace(/[.,;:–-]+$/, '');
}

export function parseDocumentHeader(text: string): DocumentHeader {
  const head = collapse(text.slice(0, HEADER_WINDOW));

  // 'Versie: 002' (nl) або 'Version: 2.1' (en)
  const versionMatch = /\b(?:Versie|Version)\s*:?\s*(\d+(?:\.\d+)*)/i.exec(head);
  const versionLabel = versionMatch?.[1] ?? null;

  // Номер документа — 3-5 цифр безпосередньо перед міткою версії.
  // Саме позиція відносно 'Versie' відрізняє його від будь-якого числа в тексті.
  let docNumber: string | null = null;
  const beforeVersion = versionMatch ? head.slice(0, versionMatch.index) : head;
  const numberMatches = [...beforeVersion.matchAll(/\b(\d{3,5})\b/g)];
  const lastNumber = numberMatches.at(-1);
  if (lastNumber?.[1]) docNumber = lastNumber[1];

  // 'Proceseigenaar: Warehouse & Production Manager'
  const ownerMatch = /\b(?:Proceseigenaar|Process\s*owner)\s*:?\s*(.{2,70})/i.exec(head);
  const processOwner = ownerMatch?.[1] ? trimRole(ownerMatch[1]) || null : null;

  // Назва — усе до номера документа (або до мітки версії, якщо номера немає).
  let title: string | null = null;
  const titleEnd = docNumber ? beforeVersion.lastIndexOf(docNumber) : (versionMatch?.index ?? -1);
  if (titleEnd > 0) {
    const candidate = collapse(head.slice(0, titleEnd));
    if (candidate.length >= 3) title = candidate;
  }

  const lang = /\b(Versie|Proceseigenaar)\b/i.test(head) ? 'nl' : null;

  return { title, docNumber, versionLabel, processOwner, lang };
}

/**
 * Специфікація: ім'я файлу структурованіше за текст, тому воно має пріоритет
 * для коду й версії. Приклад: `20405V5.0EN - Tesco Ornamental Plant Standard 2026.pdf`.
 */
export function parseSpecHeader(text: string, filePath?: string): SpecHeader {
  const head = collapse(text.slice(0, HEADER_WINDOW));
  const fileName = filePath ? basename(filePath).replace(/\.[a-z0-9]+$/i, '') : '';

  // '20405V5.0EN' → code 20405, version 5.0
  const fromFile = /\b(\d{4,6})\s*V\s*(\d+(?:\.\d+)*)\s*([A-Z]{2})?\b/i.exec(fileName);

  const code = fromFile?.[1] ?? /\b(\d{4,6})V\d/.exec(head)?.[1] ?? null;

  const versionLabel =
    fromFile?.[2] ?? /\bVersion\s*:?\s*(\d+(?:\.\d+)*)/i.exec(head)?.[1] ?? null;

  // Назву беремо з імені файлу після роздільника ' - ', інакше з тексту.
  // Роздільник саме з пробілами: у 'scan-001' дефіс не відділяє назву.
  let name: string | null = null;
  const afterDash = /\s[-–—]\s+(.+)$/.exec(fileName)?.[1];
  if (afterDash) {
    name = collapse(afterDash)
      .replace(/\b(19|20)\d{2}\b\s*$/, '') // рік у кінці назви файлу
      .trim();
  }
  if (!name || !/[A-Za-z]{3}/.test(name)) {
    const fromText = /\b([A-Z][\w'&.-]*(?:\s+[\w'&.-]+){1,7}\s+Standard)\b/.exec(head)?.[1];
    name = fromText ? collapse(fromText) : null;
  }
  if (name && name.length < 3) name = null;

  return { name, code, versionLabel, issuer: guessIssuer(text, name) };
}

/**
 * Видавець. Спершу — копірайт, але його часто вже немає: `stripBoilerplate`
 * знімає рядок «© Tesco Stores Ltd…», бо той повторюється на всіх 101 сторінці.
 * Тому запасний варіант — перше слово назви стандарту: у роздрібних стандартів
 * назва практично завжди починається з бренду замовника.
 */
function guessIssuer(text: string, name: string | null): string | null {
  const fromCopyright =
    /©\s*([A-Z][\w&.,'-]*(?:\s+[A-Z][\w&.,'-]*){0,4}?)\s*(?:\.|All Rights Reserved)/.exec(
      text.slice(0, 4000),
    )?.[1];
  if (fromCopyright) return fromCopyright.trim();

  const firstWord = name?.split(/\s+/)[0];
  return firstWord && /^[A-Z][\w&'-]{2,}$/.test(firstWord) ? firstWord : null;
}

/**
 * Підбирає вільну мітку версії, якщо запропонована вже зайнята: `002` → `002-2`.
 * Потрібно, коли той самий документ імпортують двічі з різним вмістом.
 */
export function uniqueVersionLabel(preferred: string, taken: readonly string[]): string {
  const used = new Set(taken);
  if (!used.has(preferred)) return preferred;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${preferred}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${preferred}-${Date.now()}`;
}

/** Запасна назва, коли шапку розібрати не вдалось. */
export function titleFromFileName(filePath: string): string {
  return basename(filePath)
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}
