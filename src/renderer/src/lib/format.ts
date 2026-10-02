/** Форматери для щільної таблиці: короткі, з нерозривними пробілами й tabular-nums. */

import type { IsoDate } from '@shared/domain';
import { getLocale, getMessages, type Locale } from '@renderer/i18n';
import { relativeParts } from '@renderer/lib/relativeTime';

interface Formatters {
  locale: Locale;
  dateTime: Intl.DateTimeFormat;
  date: Intl.DateTimeFormat;
  number: Intl.NumberFormat;
  relative: Intl.RelativeTimeFormat;
}

let cached: Formatters | null = null;

/**
 * Intl-обʼєкти дорогі — перебудовуємо лише коли справді змінилась локаль.
 * Регіональний тег береться з каталогу (`nl-NL`, `uk-UA`, `en-GB`): саме він
 * дає правильні роздільники й порядок дати — `02-10-2026` для нідерландської.
 */
function intl(): Formatters {
  const locale = getLocale();
  if (cached && cached.locale === locale) return cached;
  const tag = getMessages().format.intlLocale;
  cached = {
    locale,
    dateTime: new Intl.DateTimeFormat(tag, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }),
    date: new Intl.DateTimeFormat(tag, { year: 'numeric', month: '2-digit', day: '2-digit' }),
    number: new Intl.NumberFormat(tag),
    relative: new Intl.RelativeTimeFormat(tag, { numeric: 'auto', style: 'long' }),
  };
  return cached;
}

export function formatDateTime(iso: IsoDate | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : intl().dateTime.format(d);
}

export function formatDate(iso: IsoDate | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : intl().date.format(d);
}

/**
 * «5 хвилин тому» / «5 minuten geleden». Для подій, де важливіша свіжість, ніж
 * точний час (оновлення каталогу, баланс); точний час — у `title` через `formatDateTime`.
 */
export function formatRelative(iso: IsoDate | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—';
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '—';
  const { value, unit } = relativeParts((time - now) / 1000);
  return intl().relative.format(value, unit);
}

/** Тривалість між двома мітками у вигляді «12 хв 03 с». */
export function formatDuration(from: IsoDate | null, to: IsoDate | null): string {
  if (!from) return '—';
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '—';
  const total = Math.round((end - start) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const units = getMessages().format;
  if (h > 0) return `${h} ${units.hours} ${String(m).padStart(2, '0')} ${units.minutes}`;
  if (m > 0) return `${m} ${units.minutes} ${String(s).padStart(2, '0')} ${units.seconds}`;
  return `${s} ${units.seconds}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  const unit = getMessages().format;
  if (bytes < 1024) return `${bytes} ${unit.bytes}`;
  const units = [unit.kilobytes, unit.megabytes, unit.gigabytes];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i] ?? unit.gigabytes}`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return intl().number.format(value);
}

/** Токени: 1 234 567 → «1.23M». Довгі числа ламають щільну сітку. */
export function formatTokens(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}

/** Вартість завжди в USD і завжди видима — це не косметика, а бюджет. */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null || Number.isNaN(usd)) return '—';
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(usd < 100 ? 2 : 0)}`;
}

export function formatPercent(value: number, total: number): string {
  if (total <= 0) return '—';
  return `${Math.round((value / total) * 100)}%`;
}

export function formatConfidence(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${Math.round(value * 100)}%`;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Базове ім'я файлу з абсолютного шляху (Windows або POSIX). */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}
