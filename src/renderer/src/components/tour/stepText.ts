import type { Messages } from '@renderer/i18n';
import type { OnboardingStepId } from '@renderer/lib/onboarding';

export interface StepText {
  title: string;
  why: string;
  action: string;
  /**
   * Підпис елемента, який шукати на екрані, — дослівно з каталогу самого екрана.
   * Беремо його звідти, а не дублюємо в тексті туру: перейменують кнопку —
   * тур не почне посилатись на неіснуючу.
   */
  lookFor: string;
}

/** «+ Імпортувати стандарт» → «Імпортувати стандарт», «Реєстр вимог →» → «Реєстр вимог». */
function bare(label: string): string {
  return label.replace(/^\+\s*/, '').replace(/\s*[→›]$/, '').trim();
}

function lookFor(t: Messages, id: OnboardingStepId): string {
  switch (id) {
    case 'language':
      return t.settings.languageTitle;
    case 'apiKey':
      return `${t.settings.providersTitle} → ${t.settings.saveKey}`;
    case 'routing':
      return t.settings.routingTitle;
    case 'importSpec':
      return bare(t.specs.import);
    case 'cloudAllowed':
      return t.specs.cloudAllowed;
    case 'extractClauses':
      return t.clauseRegistry.extractBtn;
    case 'reviewClauses':
      return t.clauseRegistry.markReviewed;
    case 'siteProfile':
      return bare(t.sites.newProfile);
    case 'importDocument':
      return bare(t.library.import);
    case 'startRun':
      return `${bare(t.runs.newRun)} → ${t.runs.estimate} → ${t.runs.start}`;
    case 'readResults':
      return `${t.runDetail.tabFindings} → ${t.labels.verdictShort.non_compliant} · ${t.labels.verdictShort.partial}`;
  }
}

export function stepText(t: Messages, id: OnboardingStepId): StepText {
  const step = t.tour.steps[id];
  return { title: step.title, why: step.why, action: step.action, lookFor: lookFor(t, id) };
}
