import { describe, expect, it } from 'vitest';

import { LANGUAGES } from '@shared/domain';
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_NAMES,
  isLocale,
  isLocalePreference,
  needsUiLanguageSync,
  resolveLocale,
} from './locale';

describe('resolveLocale', () => {
  it('бере системну локаль, якщо вона підтримувана', () => {
    expect(resolveLocale('system', 'uk')).toBe('uk');
    expect(resolveLocale('system', 'uk-UA')).toBe('uk');
    expect(resolveLocale('system', 'UK-ua')).toBe('uk');
    expect(resolveLocale('system', 'en-GB')).toBe('en');
    expect(resolveLocale('system', 'nl-NL')).toBe('nl');
    expect(resolveLocale('system', 'nl-BE')).toBe('nl');
    expect(resolveLocale('system', 'nl_NL')).toBe('nl');
  });

  it('падає на англійську для непідтримуваної або відсутньої системної локалі', () => {
    expect(resolveLocale('system', 'de-DE')).toBe('en');
    expect(resolveLocale('system', 'ru')).toBe('en');
    expect(resolveLocale('system', '')).toBe('en');
    expect(resolveLocale('system', null)).toBe('en');
    expect(resolveLocale('system', undefined)).toBe(DEFAULT_LOCALE);
  });

  it('явний вибір перекриває систему', () => {
    expect(resolveLocale('en', 'uk-UA')).toBe('en');
    expect(resolveLocale('uk', 'en-US')).toBe('uk');
    expect(resolveLocale('uk', undefined)).toBe('uk');
    expect(resolveLocale('nl', 'uk-UA')).toBe('nl');
  });
});

describe('guards', () => {
  it('розрізняють локаль і преференцію', () => {
    expect(isLocale('uk')).toBe(true);
    expect(isLocale('nl')).toBe(true);
    expect(isLocale('system')).toBe(false);
    expect(isLocale('de')).toBe(false);
    expect(isLocalePreference('system')).toBe(true);
    expect(isLocalePreference('en')).toBe(true);
    expect(isLocalePreference('nl')).toBe(true);
    expect(isLocalePreference('de')).toBe(false);
  });
});

describe('LOCALES', () => {
  it('збігаються з мовами застосунку з shared — один список на UI і висновки', () => {
    expect(LOCALES).toEqual(LANGUAGES);
  });

  it('кожна мова має самоназву', () => {
    for (const locale of LOCALES) expect(LOCALE_NAMES[locale]).toBeTruthy();
    expect(LOCALE_NAMES.nl).toBe('Nederlands');
  });
});

describe('needsUiLanguageSync', () => {
  it('пише, коли збережена мова розходиться з фактичною', () => {
    expect(needsUiLanguageSync('en', 'nl', null)).toBe(true);
    // Старий бекенд без поля uiLanguage.
    expect(needsUiLanguageSync(undefined, 'uk', null)).toBe(true);
  });

  it('не пише, коли мова вже збережена', () => {
    expect(needsUiLanguageSync('nl', 'nl', null)).toBe(false);
  });

  it('не повторює запис тієї самої мови, якщо main її не зберіг', () => {
    expect(needsUiLanguageSync('en', 'nl', 'nl')).toBe(false);
    // …але нова мова — новий запис.
    expect(needsUiLanguageSync('en', 'uk', 'nl')).toBe(true);
  });
});
