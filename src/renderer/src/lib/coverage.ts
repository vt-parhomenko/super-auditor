/**
 * Як читати клітинку матриці покриття — чиста логіка без React і каталогів.
 *
 * Раніше клітинка показувала гліф найгіршого вердикту і ЗАГАЛЬНУ кількість
 * findings: «◐ 9» читалось як «9 часткових», хоча там могло бути 2 зауваження і
 * 7 «не стосується». Тепер клітинка відповідає на питання аудитора словами:
 * скільки зауважень, чи все гаразд, чи документ про цю секцію взагалі не говорить.
 */

import type { CoverageCell, CoverageMatrix, Verdict } from '@shared/domain';

/**
 * Стан клітинки, від найважливішого:
 *  - `issues`     — є зауваження (частково або не відповідає);
 *  - `review`     — зауважень немає, але щось чекає на людину;
 *  - `ok`         — усе, чого документ стосується, відповідає;
 *  - `notCovered` — документ про цю секцію не говорить (лише not_addressed / N/A);
 *  - `empty`      — findings немає зовсім.
 */
export type CellState = 'issues' | 'review' | 'ok' | 'notCovered' | 'empty';

export interface CellSummary {
  state: CellState;
  /** Тон фону: `nc` — є невідповідність, `partial` — лише часткові. */
  tone: 'nc' | 'partial' | 'review' | 'ok' | 'none';
  /** partial + non_compliant. */
  issues: number;
  review: number;
  /** Вимоги, яких документ справді стосується: усе, крім not_addressed і N/A. */
  addressed: number;
  total: number;
}

const sum = (counts: Partial<Record<Verdict, number>>, verdicts: readonly Verdict[]): number =>
  verdicts.reduce((acc, v) => acc + (counts[v] ?? 0), 0);

export function summarizeCell(counts: Partial<Record<Verdict, number>> | null | undefined): CellSummary {
  const c = counts ?? {};
  const nonCompliant = c.non_compliant ?? 0;
  const issues = nonCompliant + (c.partial ?? 0);
  const review = c.needs_human_review ?? 0;
  const addressed = issues + review + (c.compliant ?? 0);
  const total = addressed + sum(c, ['not_addressed', 'not_applicable']);

  if (total === 0) return { state: 'empty', tone: 'none', issues, review, addressed, total };
  if (issues > 0) {
    return { state: 'issues', tone: nonCompliant > 0 ? 'nc' : 'partial', issues, review, addressed, total };
  }
  if (review > 0) return { state: 'review', tone: 'review', issues, review, addressed, total };
  if (addressed > 0) return { state: 'ok', tone: 'ok', issues, review, addressed, total };
  return { state: 'notCovered', tone: 'none', issues, review, addressed, total };
}

/**
 * Порядок сегментів смужки: спершу те, що вимагає дій, наприкінці — те, що
 * документа не стосується. Так око одразу бачить червоне/жовте зліва.
 */
export const BAR_ORDER: readonly Verdict[] = [
  'non_compliant',
  'partial',
  'needs_human_review',
  'compliant',
  'not_addressed',
  'not_applicable',
];

export interface BarSegment {
  verdict: Verdict;
  count: number;
  /** Частка у відсотках, 0..100. */
  share: number;
}

export function barSegments(counts: Partial<Record<Verdict, number>> | null | undefined): BarSegment[] {
  const c = counts ?? {};
  const total = sum(c, BAR_ORDER);
  if (total === 0) return [];
  return BAR_ORDER.filter((v) => (c[v] ?? 0) > 0).map((verdict) => ({
    verdict,
    count: c[verdict] ?? 0,
    share: ((c[verdict] ?? 0) / total) * 100,
  }));
}

export interface DocumentCoverage {
  documentVersionId: number;
  /** Секції, яких документ стосується хоча б однією вимогою. */
  coveredSections: number;
  totalSections: number;
  issues: number;
  review: number;
}

/** Підсумок стовпця: скільки секцій документ охоплює і скільки в ньому зауважень. */
export function documentCoverage(matrix: CoverageMatrix): DocumentCoverage[] {
  return matrix.documents.map((doc) => {
    const cells = matrix.cells.filter((cell) => cell.documentVersionId === doc.documentVersionId);
    const summaries = cells.map((cell) => summarizeCell(cell.counts));
    return {
      documentVersionId: doc.documentVersionId,
      coveredSections: summaries.filter((s) => s.addressed > 0).length,
      totalSections: matrix.sections.length,
      issues: summaries.reduce((acc, s) => acc + s.issues, 0),
      review: summaries.reduce((acc, s) => acc + s.review, 0),
    };
  });
}

/** Секції, яких не стосується ЖОДЕН документ прогону, — кандидати сховати. */
export function uncoveredSections(matrix: CoverageMatrix): Set<string> {
  const covered = new Set(
    matrix.cells
      .filter((cell: CoverageCell) => summarizeCell(cell.counts).addressed > 0)
      .map((cell) => cell.sectionNo),
  );
  return new Set(matrix.sections.map((s) => s.sectionNo).filter((no) => !covered.has(no)));
}
