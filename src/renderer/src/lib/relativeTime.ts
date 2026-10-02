/**
 * Вибір одиниці для «5 хвилин тому». Саме форматування робить
 * `Intl.RelativeTimeFormat` (див. `formatRelative` у format.ts) — тут лише
 * арифметика, щоб її можна було перевірити без локалі.
 */

export interface RelativeParts {
  value: number;
  unit: Intl.RelativeTimeFormatUnit;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** `diffSeconds` < 0 — у минулому. Округлення до найближчого цілого в обраній одиниці. */
export function relativeParts(diffSeconds: number): RelativeParts {
  const abs = Math.abs(diffSeconds);
  // `|| 0` прибирає -0: інакше Intl пише «0 секунд тому» замість «зараз».
  const round = (unit: number) => Math.round(diffSeconds / unit) || 0;
  if (abs < MINUTE) return { value: round(1), unit: 'second' };
  if (abs < HOUR) return { value: round(MINUTE), unit: 'minute' };
  if (abs < DAY) return { value: round(HOUR), unit: 'hour' };
  if (abs < MONTH) return { value: round(DAY), unit: 'day' };
  if (abs < YEAR) return { value: round(MONTH), unit: 'month' };
  return { value: round(YEAR), unit: 'year' };
}
