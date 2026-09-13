import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE, isLocale, isLocalePreference, resolveLocale } from './locale';

describe('resolveLocale', () => {
  it('бере системну локаль, якщо вона підтримувана', () => {
    expect(resolveLocale('system', 'uk')).toBe('uk');
    expect(resolveLocale('system', 'uk-UA')).toBe('uk');
    expect(resolveLocale('system', 'UK-ua')).toBe('uk');
    expect(resolveLocale('system', 'en-GB')).toBe('en');
  });

  it('падає на англійську для непідтримуваної або відсутньої системної локалі', () => {
    expect(resolveLocale('system', 'nl-NL')).toBe('en');
    expect(resolveLocale('system', 'ru')).toBe('en');
    expect(resolveLocale('system', '')).toBe('en');
    expect(resolveLocale('system', null)).toBe('en');
    expect(resolveLocale('system', undefined)).toBe(DEFAULT_LOCALE);
  });

  it('явний вибір перекриває систему', () => {
    expect(resolveLocale('en', 'uk-UA')).toBe('en');
    expect(resolveLocale('uk', 'en-US')).toBe('uk');
    expect(resolveLocale('uk', undefined)).toBe('uk');
  });
});

describe('guards', () => {
  it('розрізняють локаль і преференцію', () => {
    expect(isLocale('uk')).toBe(true);
    expect(isLocale('system')).toBe(false);
    expect(isLocale('de')).toBe(false);
    expect(isLocalePreference('system')).toBe(true);
    expect(isLocalePreference('en')).toBe(true);
    expect(isLocalePreference('de')).toBe(false);
  });
});
