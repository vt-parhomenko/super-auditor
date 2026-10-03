import { describe, expect, it } from 'vitest';

import { CATALOGS } from '../../i18n/catalogs';
import { LOCALES } from '../../i18n/locale';
import { ONBOARDING_STEP_IDS } from '../../lib/onboarding';
import { stepText } from './stepText';

describe('тексти туру', () => {
  it('кожен крок має назву, пояснення «навіщо» і дію в кожній мові', () => {
    for (const locale of LOCALES) {
      for (const id of ONBOARDING_STEP_IDS) {
        const text = stepText(CATALOGS[locale], id);
        for (const [field, value] of Object.entries(text)) {
          expect([locale, id, field, value.trim().length > 0]).toEqual([locale, id, field, true]);
        }
      }
    }
  });

  it('«шукайте» — живий підпис екрана, без «+ » і стрілки в кінці', () => {
    for (const locale of LOCALES) {
      for (const id of ONBOARDING_STEP_IDS) {
        const { lookFor } = stepText(CATALOGS[locale], id);
        expect([locale, id, lookFor.startsWith('+')]).toEqual([locale, id, false]);
        expect([locale, id, lookFor.endsWith('→')]).toEqual([locale, id, false]);
      }
    }
  });

  it('крок про хмару називає перемикач так, як на картці стандарту', () => {
    for (const locale of LOCALES) {
      const t = CATALOGS[locale];
      expect(stepText(t, 'cloudAllowed').lookFor).toBe(t.specs.cloudAllowed);
    }
  });

  it('крок про результати цитує вердикти дослівно, як їх показує UI', () => {
    for (const locale of LOCALES) {
      const t = CATALOGS[locale];
      const step = t.tour.steps.readResults;
      expect([locale, step.why.includes(t.labels.verdict.not_addressed)]).toEqual([locale, true]);
      expect([locale, step.action.includes(t.labels.verdict.non_compliant)]).toEqual([locale, true]);
      expect([locale, step.action.includes(t.labels.verdict.partial)]).toEqual([locale, true]);
    }
  });

  it('лічильник прогресу узгоджує множину', () => {
    expect(CATALOGS.en.tour.progress(1, 8)).toBe('1 of 8 required steps done');
    expect(CATALOGS.uk.tour.progress(4, 8)).toBe('Виконано 4 з 8 обов’язкових кроків');
    expect(CATALOGS.uk.tour.progress(1, 21)).toBe('Виконано 1 з 21 обов’язкового кроку');
    expect(CATALOGS.nl.tour.progress(8, 8)).toBe('8 van 8 verplichte stappen gedaan');
  });
});
