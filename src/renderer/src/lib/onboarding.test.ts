import { describe, expect, it } from 'vitest';

import type { SpecVersionDto, SpecificationDto } from '@shared/domain';
import {
  ONBOARDING_STEPS,
  ONBOARDING_STEP_IDS,
  computeOnboarding,
  firstUnmetPrerequisite,
  isOnboardingStepId,
  isStepDone,
  pickExtractVersion,
  pickResultRun,
  pickReviewVersion,
  shouldOfferTour,
  tourTarget,
  type OnboardingSnapshot,
  type OnboardingStepId,
} from './onboarding';

type Spec = Pick<SpecificationDto, 'cloudAllowed' | 'versions'>;

function version(id: number, patch: Partial<SpecVersionDto> = {}): SpecVersionDto {
  return {
    id,
    specificationId: 1,
    versionLabel: '5.0',
    blobHash: 'hash',
    extractionId: null,
    effectiveFrom: null,
    clausesStatus: 'pending',
    clauseCount: 0,
    reviewedClauseCount: 0,
    markerLegend: null,
    ...patch,
  };
}

/** Чиста інсталяція: усі запити відповіли, але нічого немає. */
function fresh(patch: Partial<OnboardingSnapshot> = {}): OnboardingSnapshot {
  return {
    providers: [
      { cloud: true, configured: false },
      { cloud: false, configured: false },
    ],
    settings: { routing: {}, resultsLanguage: '' },
    localeChosen: false,
    specs: [],
    documentCount: 0,
    siteCount: 0,
    runs: [],
    acknowledged: [],
    ...patch,
  };
}

/** Усе зроблено — як у mock-режимі. */
function complete(): OnboardingSnapshot {
  const spec: Spec = {
    cloudAllowed: true,
    versions: [version(7, { clausesStatus: 'reviewed', clauseCount: 183, reviewedClauseCount: 183 })],
  };
  return fresh({
    providers: [{ cloud: true, configured: true }],
    specs: [spec],
    documentCount: 3,
    siteCount: 1,
    runs: [
      { id: 1, status: 'done' },
      { id: 2, status: 'paused' },
    ],
  });
}

describe('кроки', () => {
  it('порядок і склад узгоджені з переліком id', () => {
    // Порядок той самий, що в переліку id; прихований профіль виробництва — пропущено.
    expect(ONBOARDING_STEPS.map((s) => s.id)).toEqual(ONBOARDING_STEP_IDS.filter((id) => id !== 'siteProfile'));
  });

  it('якорі унікальні — інакше тур підсвітив би чужий елемент', () => {
    const anchors = ONBOARDING_STEPS.map((s) => s.anchor);
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  it('передумови стоять раніше за крок — інакше «спершу …» вело б уперед', () => {
    const order = new Map(ONBOARDING_STEPS.map((s, i) => [s.id, i]));
    for (const step of ONBOARDING_STEPS) {
      for (const req of step.requires) expect([step.id, req, (order.get(req) ?? 99) < (order.get(step.id) ?? -1)]).toEqual([step.id, req, true]);
    }
  });

  it('необов’язкові — мова й моделі; профіль виробництва поки прихований (lib/features.ts)', () => {
    expect(ONBOARDING_STEPS.filter((s) => s.optional).map((s) => s.id)).toEqual(['language', 'routing']);
    expect(ONBOARDING_STEPS.some((s) => s.id === 'siteProfile')).toBe(false);
  });

  it('isOnboardingStepId відсіює сміття з localStorage', () => {
    expect(isOnboardingStepId('apiKey')).toBe(true);
    expect(isOnboardingStepId('nope')).toBe(false);
    expect(isOnboardingStepId(3)).toBe(false);
  });
});

describe('isStepDone', () => {
  it('на чистій інсталяції не зроблено нічого', () => {
    for (const id of ONBOARDING_STEP_IDS) expect([id, isStepDone(id, fresh())]).toEqual([id, false]);
  });

  it('ключ рахується лише для хмарного провайдера', () => {
    expect(isStepDone('apiKey', fresh({ providers: [{ cloud: false, configured: true }] }))).toBe(false);
    expect(isStepDone('apiKey', fresh({ providers: [{ cloud: true, configured: true }] }))).toBe(true);
  });

  it('хмару дозволено хоча б на одному стандарті', () => {
    const specs: Spec[] = [
      { cloudAllowed: false, versions: [] },
      { cloudAllowed: true, versions: [] },
    ];
    expect(isStepDone('importSpec', fresh({ specs }))).toBe(true);
    expect(isStepDone('cloudAllowed', fresh({ specs }))).toBe(true);
    expect(isStepDone('cloudAllowed', fresh({ specs: [{ cloudAllowed: false, versions: [] }] }))).toBe(false);
  });

  it('вимоги витягнуто й вичитано — по версіях', () => {
    const extracted: Spec = { cloudAllowed: true, versions: [version(1, { clauseCount: 183, clausesStatus: 'extracted' })] };
    expect(isStepDone('extractClauses', fresh({ specs: [extracted] }))).toBe(true);
    expect(isStepDone('reviewClauses', fresh({ specs: [extracted] }))).toBe(false);
    const reviewed: Spec = { cloudAllowed: true, versions: [version(2, { clauseCount: 183, clausesStatus: 'reviewed' })] };
    expect(isStepDone('reviewClauses', fresh({ specs: [extracted, reviewed] }))).toBe(true);
  });

  it('результати прочитано, лише коли є завершений прогін', () => {
    expect(isStepDone('startRun', fresh({ runs: [{ id: 1, status: 'running' }] }))).toBe(true);
    expect(isStepDone('readResults', fresh({ runs: [{ id: 1, status: 'running' }] }))).toBe(false);
    expect(isStepDone('readResults', fresh({ runs: [{ id: 1, status: 'done' }] }))).toBe(true);
  });

  it('мова — явний вибір інтерфейсу чи мови результатів', () => {
    expect(isStepDone('language', fresh({ localeChosen: true }))).toBe(true);
    expect(isStepDone('language', fresh({ settings: { routing: {}, resultsLanguage: 'uk' } }))).toBe(true);
  });

  it('маршрутизація — будь-яке перевизначення', () => {
    const settings = { routing: { judge: { provider: 'openrouter', model: 'openai/gpt-6-luna' } }, resultsLanguage: '' as const };
    expect(isStepDone('routing', fresh({ settings }))).toBe(true);
  });

  it('ручна позначка діє лише на необов’язкові кроки', () => {
    const acknowledged: OnboardingStepId[] = ['routing', 'siteProfile', 'language', 'apiKey', 'importSpec'];
    const snap = fresh({ acknowledged });
    expect(isStepDone('routing', snap)).toBe(true);
    expect(isStepDone('siteProfile', snap)).toBe(true);
    expect(isStepDone('language', snap)).toBe(true);
    // Обов'язкові «відмітити» не можна: чек-лист відстежує реальність.
    expect(isStepDone('apiKey', snap)).toBe(false);
    expect(isStepDone('importSpec', snap)).toBe(false);
  });

  it('незавантажені дані — не зроблено, а не падіння', () => {
    const snap = fresh({ providers: undefined, settings: undefined, specs: undefined, documentCount: undefined, siteCount: undefined, runs: undefined });
    for (const id of ONBOARDING_STEP_IDS) expect(isStepDone(id, snap)).toBe(false);
  });
});

describe('computeOnboarding', () => {
  it('чиста інсталяція: 0 з 8, поточний — ключ (мова необов’язкова)', () => {
    const progress = computeOnboarding(fresh());
    expect(progress.requiredTotal).toBe(8);
    expect(progress.requiredDone).toBe(0);
    expect(progress.complete).toBe(false);
    expect(progress.currentId).toBe('apiKey');
    const states = Object.fromEntries(progress.steps.map((s) => [s.id, s.state]));
    expect(states.language).toBe('pending');
    expect(states.apiKey).toBe('current');
    expect(states.importSpec).toBe('pending');
  });

  it('усе зроблено: 8 з 8, поточного немає', () => {
    const progress = computeOnboarding(complete());
    expect(progress.requiredDone).toBe(8);
    expect(progress.complete).toBe(true);
    expect(progress.currentId).toBeNull();
    for (const step of progress.steps.filter((s) => !s.optional)) expect([step.id, step.state]).toEqual([step.id, 'done']);
  });

  it('поточний крок рухається з даними', () => {
    const progress = computeOnboarding(
      fresh({ providers: [{ cloud: true, configured: true }], specs: [{ cloudAllowed: false, versions: [version(1)] }] }),
    );
    expect(progress.requiredDone).toBe(2);
    expect(progress.currentId).toBe('cloudAllowed');
  });

  it('blockedBy називає найранішу незроблену передумову ланцюжка', () => {
    const progress = computeOnboarding(fresh());
    const blocked = Object.fromEntries(progress.steps.map((s) => [s.id, s.blockedBy]));
    expect(blocked.reviewClauses).toBe('apiKey');
    expect(blocked.cloudAllowed).toBe('importSpec');
    expect(blocked.readResults).toBe('apiKey');
    expect(blocked.importDocument).toBeNull();
    expect(blocked.apiKey).toBeNull();
  });

  it('зроблений крок нічим не заблокований, навіть якщо передумову потім скасовано', () => {
    // Ключ видалили після прогону — прогін від цього не зник.
    const snap = { ...complete(), providers: [{ cloud: true, configured: false }] };
    const step = computeOnboarding(snap).steps.find((s) => s.id === 'startRun');
    expect(step?.state).toBe('done');
    expect(step?.blockedBy).toBeNull();
  });
});

describe('firstUnmetPrerequisite', () => {
  it('без передумов — null', () => {
    expect(firstUnmetPrerequisite('apiKey', () => false)).toBeNull();
  });

  it('усе зроблено — null', () => {
    expect(firstUnmetPrerequisite('readResults', () => true)).toBeNull();
  });

  it('транзитивно: лишився лише документ', () => {
    expect(firstUnmetPrerequisite('readResults', (id) => id !== 'importDocument' && id !== 'startRun')).toBe('importDocument');
  });
});

describe('tourTarget', () => {
  it('налаштування й списки — фіксовані маршрути', () => {
    expect(tourTarget('apiKey', fresh())).toEqual({ path: '/settings', anchor: 'settings-providers' });
    expect(tourTarget('importSpec', fresh())).toEqual({ path: '/specs', anchor: 'specs-import' });
    expect(tourTarget('siteProfile', fresh())).toEqual({ path: '/sites', anchor: 'sites-new' });
    expect(tourTarget('importDocument', fresh())).toEqual({ path: '/library', anchor: 'library-import' });
    expect(tourTarget('startRun', fresh())).toEqual({ path: '/runs', anchor: 'runs-new' });
  });

  it('без стандарту реєстр веде на список стандартів (там тур скаже «спершу імпорт»)', () => {
    expect(tourTarget('extractClauses', fresh()).path).toBe('/specs');
    expect(tourTarget('reviewClauses', fresh()).path).toBe('/specs');
  });

  it('без прогону результати ведуть на список прогонів', () => {
    expect(tourTarget('readResults', fresh())).toEqual({ path: '/runs', anchor: 'findings-filters' });
  });

  it('з даними — на конкретну версію й прогін', () => {
    expect(tourTarget('reviewClauses', complete()).path).toBe('/specs/7/clauses');
    expect(tourTarget('readResults', complete()).path).toBe('/runs/1/findings');
  });
});

describe('вибір версії й прогону', () => {
  const specs: Spec[] = [
    { cloudAllowed: false, versions: [version(1), version(2, { clauseCount: 10, clausesStatus: 'reviewed' })] },
    { cloudAllowed: true, versions: [version(3), version(4, { clauseCount: 20, clausesStatus: 'extracted' })] },
  ];

  it('витягувати — спершу невитягнуту версію стандарту з дозволеною хмарою', () => {
    expect(pickExtractVersion(fresh({ specs }))).toBe(3);
  });

  it('витягувати — невитягнута будь-яка, далі будь-яка', () => {
    expect(pickExtractVersion(fresh({ specs: [{ cloudAllowed: false, versions: [version(5, { clauseCount: 3 }), version(6)] }] }))).toBe(6);
    expect(pickExtractVersion(fresh({ specs: [{ cloudAllowed: false, versions: [version(5, { clauseCount: 3 })] }] }))).toBe(5);
    expect(pickExtractVersion(fresh())).toBeNull();
  });

  it('вичитувати — витягнуту, але не вичитану', () => {
    expect(pickReviewVersion(fresh({ specs }))).toBe(4);
    expect(pickReviewVersion(fresh({ specs: [specs[0] as Spec] }))).toBe(2);
    expect(pickReviewVersion(fresh({ specs: [{ cloudAllowed: true, versions: [version(9)] }] }))).toBe(9);
  });

  it('прогін — найсвіжіший завершений, інакше найсвіжіший', () => {
    expect(pickResultRun(fresh({ runs: [{ id: 3, status: 'done' }, { id: 8, status: 'done' }, { id: 9, status: 'failed' }] }))).toBe(8);
    expect(pickResultRun(fresh({ runs: [{ id: 3, status: 'failed' }, { id: 5, status: 'running' }] }))).toBe(5);
    expect(pickResultRun(fresh())).toBeNull();
  });
});

describe('shouldOfferTour', () => {
  const idle = { dismissed: false, busy: false };

  it('пропонує на чистій інсталяції', () => {
    expect(shouldOfferTour(fresh(), idle)).toBe(true);
  });

  it('не пропонує, поки дані не завантажились', () => {
    expect(shouldOfferTour(fresh({ providers: undefined }), idle)).toBe(false);
    expect(shouldOfferTour(fresh({ specs: undefined }), idle)).toBe(false);
  });

  it('не пропонує, якщо вже є ключ АБО стандарт', () => {
    expect(shouldOfferTour(fresh({ providers: [{ cloud: true, configured: true }] }), idle)).toBe(false);
    expect(shouldOfferTour(fresh({ specs: [{ cloudAllowed: false, versions: [] }] }), idle)).toBe(false);
  });

  it('не пропонує після відмови і поки відкрито тур чи чек-лист', () => {
    expect(shouldOfferTour(fresh(), { dismissed: true, busy: false })).toBe(false);
    expect(shouldOfferTour(fresh(), { dismissed: false, busy: true })).toBe(false);
  });
});
