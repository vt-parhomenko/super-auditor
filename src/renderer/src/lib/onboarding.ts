/**
 * «Перший аналіз»: кроки онбордингу і їхній стан, обчислений з реальних даних.
 *
 * Чиста логіка без React, сховищ і каталогів — тестується юніт-тестом. Галочки
 * чек-листа не ставляться вручну: крок «зроблено», лише коли це видно з даних
 * (є ключ, є стандарт, реєстр вичитано…). Вручну можна відмітити тільки
 * необов'язкові кроки — бо «типові моделі мене влаштовують» з даних не видно.
 *
 * Порядок кроків повторює docs/usage.md («Сценарій: перевірити одну інструкцію»),
 * щоб тур і документація не розходились.
 */

import { SITE_PROFILES_ENABLED } from './features';
import type { AuditRunDto, SpecVersionDto, SpecificationDto } from '@shared/domain';
import type { AppSettings, ProviderStatus } from '@shared/ipc';

export const ONBOARDING_STEP_IDS = [
  'language',
  'apiKey',
  'routing',
  'importSpec',
  'cloudAllowed',
  'extractClauses',
  'reviewClauses',
  'siteProfile',
  'importDocument',
  'startRun',
  'readResults',
] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number];

export function isOnboardingStepId(value: unknown): value is OnboardingStepId {
  return typeof value === 'string' && (ONBOARDING_STEP_IDS as readonly string[]).includes(value);
}

/** `setup` — раз на стандарт; `perDocument` — щоразу, коли треба перевірити документ. */
export type OnboardingGroup = 'setup' | 'perDocument';

export interface OnboardingStepDef {
  id: OnboardingStepId;
  optional: boolean;
  group: OnboardingGroup;
  /**
   * Логічні передумови. Без них крок або марний (вичитувати нічого), або його
   * елемента ще немає на екрані (картки стандарту без стандарту). Тур тоді
   * каже «спершу …», а не показує порожнє місце.
   */
  requires: readonly OnboardingStepId[];
  /** Значення атрибута `data-tour`, на яке наводиться тур. */
  anchor: string;
}

const ALL_ONBOARDING_STEPS: readonly OnboardingStepDef[] = [
  { id: 'language', optional: true, group: 'setup', requires: [], anchor: 'settings-language' },
  { id: 'apiKey', optional: false, group: 'setup', requires: [], anchor: 'settings-providers' },
  { id: 'routing', optional: true, group: 'setup', requires: [], anchor: 'settings-routing' },
  { id: 'importSpec', optional: false, group: 'setup', requires: [], anchor: 'specs-import' },
  { id: 'cloudAllowed', optional: false, group: 'setup', requires: ['importSpec'], anchor: 'spec-cloud' },
  {
    id: 'extractClauses',
    optional: false,
    group: 'setup',
    // Кнопка є й без ключа, але без ключа та дозволу хмари етап просто впаде.
    requires: ['importSpec', 'apiKey', 'cloudAllowed'],
    anchor: 'registry-extract',
  },
  { id: 'reviewClauses', optional: false, group: 'setup', requires: ['extractClauses'], anchor: 'registry-review' },
  { id: 'siteProfile', optional: true, group: 'setup', requires: [], anchor: 'sites-new' },
  { id: 'importDocument', optional: false, group: 'perDocument', requires: [], anchor: 'library-import' },
  {
    id: 'startRun',
    optional: false,
    group: 'perDocument',
    requires: ['reviewClauses', 'importDocument'],
    anchor: 'runs-new',
  },
  { id: 'readResults', optional: false, group: 'perDocument', requires: ['startRun'], anchor: 'findings-filters' },
];

/** Кроки, які зараз видно в чеклисті й турі (профілі виробництва приховано — див. lib/features.ts). */
export const ONBOARDING_STEPS: readonly OnboardingStepDef[] = SITE_PROFILES_ENABLED
  ? ALL_ONBOARDING_STEPS
  : ALL_ONBOARDING_STEPS.filter((step) => step.id !== 'siteProfile');

// Визначення — з ПОВНОГО списку: прихований крок лишається відомим (ручні позначки,
// збережені в localStorage, не мають ламати розрахунок).
const STEP_BY_ID = new Map(ALL_ONBOARDING_STEPS.map((step) => [step.id, step]));
const STEP_INDEX = new Map(ONBOARDING_STEPS.map((step, index) => [step.id, index]));

export function stepDef(id: OnboardingStepId): OnboardingStepDef {
  const step = STEP_BY_ID.get(id);
  // Недосяжно: id типізований, а таблиця будується з того самого переліку.
  if (!step) throw new Error(`Невідомий крок онбордингу: ${id}`);
  return step;
}

export function stepIndex(id: OnboardingStepId): number {
  return STEP_INDEX.get(id) ?? 0;
}

// ─── Знімок даних ────────────────────────────────────────────────────────────

/**
 * Те, з чого рахується стан. `undefined` — запит ще не відповів або впав:
 * тоді крок не «зроблено», але й автоматичну пропозицію туру не показуємо
 * (див. `shouldOfferTour`) — інакше вона блимала б на кожному старті.
 */
export interface OnboardingSnapshot {
  providers: readonly Pick<ProviderStatus, 'cloud' | 'configured'>[] | undefined;
  settings: Pick<AppSettings, 'routing' | 'resultsLanguage'> | undefined;
  /** Мову інтерфейсу обрано явно, а не «як у системі». */
  localeChosen: boolean;
  specs: readonly Pick<SpecificationDto, 'cloudAllowed' | 'versions'>[] | undefined;
  documentCount: number | undefined;
  siteCount: number | undefined;
  runs: readonly Pick<AuditRunDto, 'id' | 'status'>[] | undefined;
  /** Необов'язкові кроки, які людина відмітила сама («мене влаштовують типові»). */
  acknowledged: readonly OnboardingStepId[];
}

type VersionLike = Pick<SpecVersionDto, 'id' | 'clauseCount' | 'clausesStatus'>;

function allVersions(snapshot: OnboardingSnapshot): Array<{ version: VersionLike; cloudAllowed: boolean }> {
  return (snapshot.specs ?? []).flatMap((spec) =>
    spec.versions.map((version) => ({ version, cloudAllowed: spec.cloudAllowed })),
  );
}

/** Чи виконано крок — лише з даних (і ручної позначки для необов'язкових). */
export function isStepDone(id: OnboardingStepId, snapshot: OnboardingSnapshot): boolean {
  const acknowledged = stepDef(id).optional && snapshot.acknowledged.includes(id);
  switch (id) {
    case 'language':
      return acknowledged || snapshot.localeChosen || (snapshot.settings?.resultsLanguage ?? '') !== '';
    case 'apiKey':
      // Локальний провайдер не рахуємо: ADR-8 і весь сценарій нижче — про хмарні.
      return (snapshot.providers ?? []).some((p) => p.cloud && p.configured);
    case 'routing':
      return acknowledged || Object.keys(snapshot.settings?.routing ?? {}).length > 0;
    case 'importSpec':
      return (snapshot.specs ?? []).length > 0;
    case 'cloudAllowed':
      return (snapshot.specs ?? []).some((s) => s.cloudAllowed);
    case 'extractClauses':
      return allVersions(snapshot).some(({ version }) => version.clauseCount > 0);
    case 'reviewClauses':
      return allVersions(snapshot).some(({ version }) => version.clausesStatus === 'reviewed');
    case 'siteProfile':
      return acknowledged || (snapshot.siteCount ?? 0) > 0;
    case 'importDocument':
      return (snapshot.documentCount ?? 0) > 0;
    case 'startRun':
      return (snapshot.runs ?? []).length > 0;
    case 'readResults':
      return (snapshot.runs ?? []).some((r) => r.status === 'done');
  }
}

// ─── Стан чек-листа ──────────────────────────────────────────────────────────

/** `current` — перший незроблений ОБОВ'ЯЗКОВИЙ крок; необов'язкові його не займають. */
export type StepState = 'done' | 'current' | 'pending';

export interface OnboardingStepStatus {
  id: OnboardingStepId;
  optional: boolean;
  group: OnboardingGroup;
  state: StepState;
  /** Найраніший незроблений крок серед передумов (транзитивно); null — нічого не заважає. */
  blockedBy: OnboardingStepId | null;
}

export interface OnboardingProgress {
  steps: OnboardingStepStatus[];
  requiredDone: number;
  requiredTotal: number;
  complete: boolean;
  currentId: OnboardingStepId | null;
}

/**
 * Найраніша (за порядком кроків) незроблена передумова, з урахуванням ланцюжка:
 * для «вичитати реєстр» без ключа відповідь — «ключ», а не «витягти вимоги».
 */
export function firstUnmetPrerequisite(
  id: OnboardingStepId,
  done: (id: OnboardingStepId) => boolean,
): OnboardingStepId | null {
  const seen = new Set<OnboardingStepId>();
  const stack = [...stepDef(id).requires];
  let best: OnboardingStepId | null = null;
  while (stack.length > 0) {
    const next = stack.pop() as OnboardingStepId;
    if (seen.has(next)) continue;
    seen.add(next);
    if (!done(next) && (best == null || stepIndex(next) < stepIndex(best))) best = next;
    stack.push(...stepDef(next).requires);
  }
  return best;
}

export function computeOnboarding(snapshot: OnboardingSnapshot): OnboardingProgress {
  const doneMap = new Map(ONBOARDING_STEP_IDS.map((id) => [id, isStepDone(id, snapshot)]));
  const done = (id: OnboardingStepId) => doneMap.get(id) === true;
  const currentId = ONBOARDING_STEPS.find((s) => !s.optional && !done(s.id))?.id ?? null;

  const steps = ONBOARDING_STEPS.map(
    (step): OnboardingStepStatus => ({
      id: step.id,
      optional: step.optional,
      group: step.group,
      state: done(step.id) ? 'done' : step.id === currentId ? 'current' : 'pending',
      blockedBy: done(step.id) ? null : firstUnmetPrerequisite(step.id, done),
    }),
  );

  const required = ONBOARDING_STEPS.filter((s) => !s.optional);
  const requiredDone = required.filter((s) => done(s.id)).length;
  return {
    steps,
    requiredDone,
    requiredTotal: required.length,
    complete: requiredDone === required.length,
    currentId,
  };
}

// ─── Куди веде тур ───────────────────────────────────────────────────────────

export interface TourTarget {
  /** Маршрут хеш-роутера, напр. `/specs/12/clauses`. */
  path: string;
  /** Значення `data-tour` елемента, який підсвічуємо. */
  anchor: string;
}

/**
 * Версія для кроку «витягти вимоги»: спершу та, яку справді ще треба витягати,
 * причому зі стандарту, де хмару вже дозволено (інакше етап однаково впаде).
 */
export function pickExtractVersion(snapshot: OnboardingSnapshot): number | null {
  const versions = allVersions(snapshot);
  const pick =
    versions.find((v) => v.cloudAllowed && v.version.clauseCount === 0) ??
    versions.find((v) => v.version.clauseCount === 0) ??
    versions[0];
  return pick?.version.id ?? null;
}

/** Версія для вичитки: витягнута, але не вичитана; далі — будь-яка з вимогами. */
export function pickReviewVersion(snapshot: OnboardingSnapshot): number | null {
  const versions = allVersions(snapshot).map((v) => v.version);
  const pick =
    versions.find((v) => v.clauseCount > 0 && v.clausesStatus !== 'reviewed') ??
    versions.find((v) => v.clauseCount > 0) ??
    versions[0];
  return pick?.id ?? null;
}

/** Найсвіжіший завершений прогін: незавершений ще не має що читати. */
export function pickResultRun(snapshot: OnboardingSnapshot): number | null {
  const runs = [...(snapshot.runs ?? [])].sort((a, b) => b.id - a.id);
  return (runs.find((r) => r.status === 'done') ?? runs[0])?.id ?? null;
}

/**
 * Маршрут і якір кроку. Якщо потрібного об'єкта ще немає (стандарту, прогону),
 * ведемо на сторінку списку: якоря там не буде, і тур покаже картку «спершу …».
 */
export function tourTarget(id: OnboardingStepId, snapshot: OnboardingSnapshot): TourTarget {
  const anchor = stepDef(id).anchor;
  switch (id) {
    case 'language':
    case 'apiKey':
    case 'routing':
      return { path: '/settings', anchor };
    case 'importSpec':
    case 'cloudAllowed':
      return { path: '/specs', anchor };
    case 'extractClauses': {
      const versionId = pickExtractVersion(snapshot);
      return { path: versionId == null ? '/specs' : `/specs/${versionId}/clauses`, anchor };
    }
    case 'reviewClauses': {
      const versionId = pickReviewVersion(snapshot);
      return { path: versionId == null ? '/specs' : `/specs/${versionId}/clauses`, anchor };
    }
    case 'siteProfile':
      return { path: '/sites', anchor };
    case 'importDocument':
      return { path: '/library', anchor };
    case 'startRun':
      return { path: '/runs', anchor };
    case 'readResults': {
      const runId = pickResultRun(snapshot);
      return { path: runId == null ? '/runs' : `/runs/${runId}/findings`, anchor };
    }
  }
}

// ─── Автоматична пропозиція туру ─────────────────────────────────────────────

/**
 * Пропонуємо тур лише справді новій людині: дані вже завантажені, жодного
 * хмарного ключа І жодного стандарту. Досвідченому користувачу, який, скажімо,
 * видалив усі стандарти, картка «Уперше тут?» лише заважала б.
 */
export function shouldOfferTour(
  snapshot: OnboardingSnapshot,
  ui: { dismissed: boolean; busy: boolean },
): boolean {
  if (ui.dismissed || ui.busy) return false;
  if (snapshot.providers === undefined || snapshot.specs === undefined) return false;
  return !isStepDone('apiKey', snapshot) && snapshot.specs.length === 0;
}
