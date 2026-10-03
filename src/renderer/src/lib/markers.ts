/**
 * Позначки стандарту біля вимог — що показувати в реєстрі і як їх редагувати.
 *
 * Позначки беруться з самого стандарту (Tesco: P / R / O; GlobalG.A.P.:
 * «Major Must»; BRCGS: «Fundamental») разом із його ж легендою. Правило одне:
 * показуємо лише те, що стандарт справді друкує. Немає позначок — немає ні
 * значків, ні легенди, ні поля в редакторі (а не три сірі «P R O» біля кожної
 * вимоги, як колись).
 *
 * Тут лише чиста логіка без React — щоб її можна було перевірити тестами.
 */

import { markerKey, normalizeMarkers, type MarkerLegendItem } from '@shared/domain';

type WithMarkers = { readonly markers: readonly string[] };

/** Різні позначки списку вимог у порядку першої появи. */
export function usedMarkers(clauses: readonly WithMarkers[]): string[] {
  const out: string[] = [];
  for (const clause of clauses) {
    for (const marker of clause.markers) if (!out.includes(marker)) out.push(marker);
  }
  return out;
}

/** Пункт легенди для коду; null — легенда його не пояснює. */
export function legendItemFor(
  code: string,
  legend: readonly MarkerLegendItem[] | null | undefined,
): MarkerLegendItem | null {
  const key = markerKey(code);
  return legend?.find((item) => markerKey(item.code) === key) ?? null;
}

/** «P — Policy / procedure»; якщо стандарт назви не дав — лише код, без «P — P». */
export function legendItemText(item: MarkerLegendItem): string {
  return item.label && item.label !== item.code ? `${item.code} — ${item.label}` : item.code;
}

/**
 * Підказка значка: назва й пояснення стандарту. Без легенди — сам код:
 * вигадувати значення застосунок не має права.
 */
export function markerTitle(code: string, legend: readonly MarkerLegendItem[] | null | undefined): string {
  const item = legendItemFor(code, legend);
  if (!item) return code;
  const head = legendItemText(item);
  return item.meaning ? `${head}: ${item.meaning}` : head;
}

/**
 * Що показати над списком вимог:
 *  - `legend` — легенда стандарту (рядок «P — Policy / procedure · R — Records…»);
 *    `unexplained` — позначки вимог, яких легенда не знає (додані вручну);
 *  - `unexplained` — позначки є, але легенди немає: коди й приглушена примітка;
 *  - `none` — позначок немає: нічого не показуємо.
 */
export type RegistryMarkerView =
  | { kind: 'legend'; items: MarkerLegendItem[]; unexplained: string[] }
  | { kind: 'unexplained'; codes: string[] }
  | { kind: 'none' };

export function registryMarkerView(
  legend: readonly MarkerLegendItem[] | null | undefined,
  clauses: readonly WithMarkers[],
): RegistryMarkerView {
  const used = usedMarkers(clauses);
  if (legend && legend.length > 0) {
    return {
      kind: 'legend',
      items: [...legend],
      unexplained: used.filter((code) => legendItemFor(code, legend) === null),
    };
  }
  return used.length > 0 ? { kind: 'unexplained', codes: used } : { kind: 'none' };
}

/** Варіант вибору позначки в редакторі. */
export interface MarkerOption {
  code: string;
  label: string;
  meaning: string | null;
}

/**
 * Поле «Позначки стандарту» в редакторі вимоги:
 *  - `checkboxes` — є легенда: прапорці на її коди плюс власні коди вимоги,
 *    яких у легенді немає (інакше їх не можна було б зняти);
 *  - `text` — легенди немає, але версія позначки має: поле вводу через кому;
 *  - `none` — стандарт позначок не має: поля немає.
 */
export type MarkerEditorMode =
  | { kind: 'checkboxes'; options: MarkerOption[] }
  | { kind: 'text' }
  | { kind: 'none' };

export function markerEditorMode(
  legend: readonly MarkerLegendItem[] | null | undefined,
  versionClauses: readonly WithMarkers[],
  clauseMarkers: readonly string[],
): MarkerEditorMode {
  if (legend && legend.length > 0) {
    const options: MarkerOption[] = legend.map((item) => ({
      code: item.code,
      label: item.label,
      meaning: item.meaning,
    }));
    for (const code of clauseMarkers) {
      if (legendItemFor(code, legend) === null) options.push({ code, label: code, meaning: null });
    }
    return { kind: 'checkboxes', options };
  }
  const anyMarkers = clauseMarkers.length > 0 || versionClauses.some((c) => c.markers.length > 0);
  return anyMarkers ? { kind: 'text' } : { kind: 'none' };
}

/**
 * Перемикає позначку. Порядок — як у варіантах вибору (порядок легенди
 * стандарту), а не як клацали: «R P» і «P R» — та сама вимога.
 */
export function toggleMarker(
  current: readonly string[],
  code: string,
  options: readonly MarkerOption[],
): string[] {
  const on = current.includes(code);
  const next = on ? current.filter((c) => c !== code) : [...current, code];
  const order = options.map((o) => o.code);
  const rank = (c: string) => {
    const i = order.indexOf(c);
    return i === -1 ? order.length : i;
  };
  return [...next].sort((a, b) => rank(a) - rank(b));
}

/** Текст поля вводу без легенди: «Major Must, Recommendation». */
export function formatMarkerInput(markers: readonly string[]): string {
  return markers.join(', ');
}

/** Розбір поля вводу: через кому, з тією самою нормалізацією, що й у main. */
export function parseMarkerInput(text: string): string[] {
  return normalizeMarkers(text.split(','));
}

export function sameMarkers(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((code, i) => code === b[i]);
}

/** Пояснення однієї позначки вимоги; `text: null` — стандарт її не пояснює. */
export interface MarkerHint {
  code: string;
  text: string | null;
}

/**
 * Пояснення позначок однієї вимоги — для підказки біля значків на сторінці
 * finding. Позначка без легенди (або з легендою, що повторює сам код) — без
 * тексту: застосунок не має права вигадувати їй значення.
 */
export function markerHints(
  markers: readonly string[],
  legend: readonly MarkerLegendItem[] | null | undefined,
): MarkerHint[] {
  return markers.map((code) => {
    const item = legendItemFor(code, legend);
    const explained = item !== null && (item.meaning !== null || item.label !== item.code);
    return { code, text: explained ? markerTitle(code, legend) : null };
  });
}
