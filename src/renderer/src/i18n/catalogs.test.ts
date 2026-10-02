import { describe, expect, it } from 'vitest';

import { CATALOGS } from './catalogs';
import { LOCALES } from './locale';

/** Шляхи всіх листків каталогу: 'settings.modelsCount', 'labels.verdict.compliant'… */
function leafPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

function leaves(value: unknown, prefix = ''): Array<[string, unknown]> {
  if (value === null || typeof value !== 'object') return [[prefix, value]];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leaves(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('каталоги', () => {
  it('є для кожної мови застосунку', () => {
    for (const locale of LOCALES) expect(CATALOGS[locale]).toBeDefined();
  });

  it('мають однакову форму й однакові типи значень', () => {
    // Тип `Messages` це вже гарантує під час компіляції; тест ловить `as`-обхід і ручні правки.
    const reference = leaves(CATALOGS.en);
    for (const locale of LOCALES) {
      const catalog = leaves(CATALOGS[locale]);
      expect(catalog.map(([path]) => path).sort()).toEqual(reference.map(([path]) => path).sort());
      const types = new Map(catalog.map(([path, v]) => [path, typeof v]));
      for (const [path, v] of reference) expect([locale, path, types.get(path)]).toEqual([locale, path, typeof v]);
      // TypeScript пропускає функцію з МЕНШОЮ кількістю параметрів — тоді переклад
      // мовчки губить, напр., кількість у множині. Арність має збігатися.
      const arity = new Map(catalog.map(([path, v]) => [path, typeof v === 'function' ? v.length : null]));
      for (const [path, v] of reference) {
        if (typeof v === 'function') expect([locale, path, arity.get(path)]).toEqual([locale, path, v.length]);
      }
    }
  });

  it('не мають порожніх рядків', () => {
    for (const locale of LOCALES) {
      for (const [path, v] of leaves(CATALOGS[locale])) {
        if (typeof v === 'string') expect([locale, path, v.trim().length > 0]).toEqual([locale, path, true]);
      }
    }
  });

  it('кількість листків розумна — каталог не обрізаний', () => {
    expect(leafPaths(CATALOGS.nl).length).toBeGreaterThan(400);
  });
});

describe('множина', () => {
  it('нідерландська: one / other', () => {
    const { nl } = CATALOGS;
    expect(nl.settings.modelsCount(1)).toBe('1 model');
    expect(nl.settings.modelsCount(19)).toBe('19 modellen');
    expect(nl.sites.clausesCount(1)).toBe('1 eis');
    expect(nl.sites.clausesCount(0)).toBe('0 eisen');
  });

  it('українська: one / few / many', () => {
    const { uk } = CATALOGS;
    expect(uk.settings.modelsCount(1)).toBe('1 модель');
    expect(uk.settings.modelsCount(3)).toBe('3 моделі');
    expect(uk.settings.modelsCount(5)).toBe('5 моделей');
    expect(uk.settings.modelsCount(21)).toBe('21 модель');
  });
});

describe('узгодженість посилань між текстами', () => {
  it('підказка про хмару цитує назву перемикача специфікації дослівно', () => {
    for (const locale of LOCALES) {
      const t = CATALOGS[locale];
      expect(t.settings.cloudHintOpenRouter).toContain(t.specs.cloudAllowed);
      expect(t.settings.cloudHintDirect('Anthropic')).toContain(t.specs.cloudAllowed);
    }
  });

  it('нідерландське попередження про цитати називає вердикти так, як їх показує UI', () => {
    const { nl } = CATALOGS;
    expect(nl.settings.resultsLanguageQuotes).toContain(nl.labels.verdict.compliant);
    expect(nl.settings.resultsLanguageQuotes).toContain(nl.labels.verdict.needs_human_review);
  });

  it('регіональний тег Intl дає нідерландські роздільники', () => {
    const tag = CATALOGS.nl.format.intlLocale;
    expect(new Intl.NumberFormat(tag).format(1234.5)).toBe('1.234,5');
    expect(new Intl.DateTimeFormat(tag, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date('2026-10-02T00:00:00Z'))).toBe('02-10-2026');
  });
});
