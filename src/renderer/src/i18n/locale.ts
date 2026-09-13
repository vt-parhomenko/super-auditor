/**
 * Розв'язання локалі. Модуль навмисно без залежностей від React, DOM і стора —
 * щоб логіку можна було перевірити юніт-тестом і викликати будь-звідки.
 */

export const LOCALES = ['en', 'uk'] as const;

export type Locale = (typeof LOCALES)[number];

/** `system` — брати мову ОС; решта — явний вибір користувача. */
export type LocalePreference = 'system' | Locale;

/** Англійська — мова за замовчуванням: нею падаємо для всього непідтримуваного. */
export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === 'system' || isLocale(value);
}

/**
 * Порівнюємо лише базовий субтег ('uk-UA' → 'uk'): регіон на вибір мови не впливає.
 */
export function resolveLocale(preference: LocalePreference, systemLocale?: string | null): Locale {
  if (preference !== 'system') return preference;
  const base = (systemLocale ?? '').toLowerCase().split('-')[0] ?? '';
  return isLocale(base) ? base : DEFAULT_LOCALE;
}

/** `navigator.language` віддає локаль ОС і в Electron, і в браузері під mock-режимом. */
export function systemLocale(): string {
  if (typeof navigator === 'undefined') return '';
  return navigator.language ?? '';
}
