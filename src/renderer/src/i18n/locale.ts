/**
 * Розв'язання локалі. Модуль навмисно без залежностей від React, DOM і стора —
 * щоб логіку можна було перевірити юніт-тестом і викликати будь-звідки.
 */

import { LANGUAGES, isLanguage, type Language } from '@shared/domain';

/**
 * Мови інтерфейсу — той самий список, що й мови висновків у main. Один джерельний
 * перелік: додати мову в UI й забути про неї в main (або навпаки) неможливо.
 */
export const LOCALES = LANGUAGES;

export type Locale = Language;

/** `system` — брати мову ОС; решта — явний вибір користувача. */
export type LocalePreference = 'system' | Locale;

/** Англійська — мова за замовчуванням: нею падаємо для всього непідтримуваного. */
export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Самоназви мов. Свідомо НЕ в каталогах: «Nederlands» має читатись як
 * «Nederlands» і з українського інтерфейсу — інакше людина, що не читає
 * поточну мову, не знайде свою.
 */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  nl: 'Nederlands',
  uk: 'Українська',
};

export function isLocale(value: unknown): value is Locale {
  return isLanguage(value);
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === 'system' || isLocale(value);
}

/**
 * Порівнюємо лише базовий субтег ('uk-UA' → 'uk', 'nl-BE' → 'nl'): регіон на вибір
 * мови не впливає.
 */
export function resolveLocale(preference: LocalePreference, systemLocale?: string | null): Locale {
  if (preference !== 'system') return preference;
  const base = (systemLocale ?? '').toLowerCase().split(/[-_]/)[0] ?? '';
  return isLocale(base) ? base : DEFAULT_LOCALE;
}

/** `navigator.language` віддає локаль ОС і в Electron, і в браузері під mock-режимом. */
export function systemLocale(): string {
  if (typeof navigator === 'undefined') return '';
  return navigator.language ?? '';
}

/**
 * Чи треба повідомити main про мову інтерфейсу.
 *
 * Пишемо лише коли збережене значення розходиться з фактичним. `lastSent` —
 * мова, яку вже пробували записати в цій сесії: якщо main її не зберіг (старий
 * бекенд, помилка), повторювати запис на кожен рендер марно й шумно.
 */
export function needsUiLanguageSync(
  stored: unknown,
  resolved: Locale,
  lastSent: Locale | null,
): boolean {
  return stored !== resolved && lastSent !== resolved;
}
