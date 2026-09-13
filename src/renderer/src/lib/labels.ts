/** Гліфи для доменних перелічень і доступ до їхніх локалізованих підписів. */

import type { Verdict } from '@shared/domain';
import { useT, type Messages } from '@renderer/i18n';

/**
 * Гліф поруч із кольором — головний засіб проти дальтонізму:
 * вердикт читається навіть у сірому друці. Від мови не залежить.
 */
export const VERDICT_GLYPH: Record<Verdict, string> = {
  compliant: '✔',
  partial: '◐',
  non_compliant: '✕',
  not_applicable: '—',
  not_addressed: '○',
  needs_human_review: '?',
};

export type Labels = Messages['labels'];

/** Підписи перелічень у компонентах: `const labels = useLabels()` → `labels.verdict[v]`. */
export function useLabels(): Labels {
  return useT().labels;
}

/** CSS-суфікс класу для вердикту (використовується у бейджах, тепловій карті, дереві). */
export function verdictClass(verdict: Verdict): string {
  return `v-${verdict}`;
}
