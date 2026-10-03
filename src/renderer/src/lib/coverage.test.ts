import { describe, expect, it } from 'vitest';

import type { CoverageMatrix } from '@shared/domain';
import { barSegments, documentCoverage, summarizeCell, uncoveredSections } from './coverage';

describe('summarizeCell', () => {
  it('«◐ 9» зі скриншота: 2 часткових серед 9 — це 2 зауваження, а не 9', () => {
    expect(summarizeCell({ partial: 2, not_addressed: 7 })).toEqual({
      state: 'issues',
      tone: 'partial',
      issues: 2,
      review: 0,
      addressed: 2,
      total: 9,
    });
  });

  it('невідповідність фарбує сильніше за часткову', () => {
    expect(summarizeCell({ partial: 3, non_compliant: 1, compliant: 2 }).tone).toBe('nc');
  });

  it('без зауважень, але з «потрібна людина» — на перевірку', () => {
    expect(summarizeCell({ needs_human_review: 1, compliant: 4 }).state).toBe('review');
  });

  it('усе, чого документ стосується, відповідає', () => {
    expect(summarizeCell({ compliant: 3, not_addressed: 4 })).toMatchObject({ state: 'ok', addressed: 3, total: 7 });
  });

  it('лише not_addressed / N/A — документ про секцію не говорить', () => {
    expect(summarizeCell({ not_addressed: 6 })).toMatchObject({ state: 'notCovered', tone: 'none', addressed: 0 });
    expect(summarizeCell({ not_applicable: 2, not_addressed: 1 }).state).toBe('notCovered');
  });

  it('порожня клітинка', () => {
    expect(summarizeCell({}).state).toBe('empty');
    expect(summarizeCell(null).state).toBe('empty');
  });
});

describe('barSegments', () => {
  it('спершу те, що вимагає дій; частки складаються в 100', () => {
    const segments = barSegments({ not_addressed: 6, partial: 2, compliant: 2 });
    expect(segments.map((s) => s.verdict)).toEqual(['partial', 'compliant', 'not_addressed']);
    expect(segments.reduce((acc, s) => acc + s.share, 0)).toBeCloseTo(100);
  });

  it('порожньо — без сегментів', () => {
    expect(barSegments({})).toEqual([]);
  });
});

const matrix: CoverageMatrix = {
  runId: 1,
  sections: [
    { sectionNo: '1', sectionTitle: 'Leadership', clauseCount: 9 },
    { sectionNo: '4', sectionTitle: 'Environment', clauseCount: 6 },
    { sectionNo: '10', sectionTitle: 'Pest management', clauseCount: 7 },
  ],
  documents: [
    { documentVersionId: 11, title: 'Pest Management', versionLabel: '002' },
    { documentVersionId: 12, title: 'Damaged Products', versionLabel: '002' },
  ],
  cells: [
    { sectionNo: '1', documentVersionId: 11, worstVerdict: 'partial', counts: { partial: 2, not_addressed: 7 } as never },
    { sectionNo: '4', documentVersionId: 11, worstVerdict: 'not_addressed', counts: { not_addressed: 6 } as never },
    { sectionNo: '10', documentVersionId: 11, worstVerdict: 'partial', counts: { partial: 1, compliant: 5, not_addressed: 1 } as never },
    { sectionNo: '4', documentVersionId: 12, worstVerdict: 'not_addressed', counts: { not_addressed: 6 } as never },
    { sectionNo: '10', documentVersionId: 12, worstVerdict: 'not_addressed', counts: { not_addressed: 7 } as never },
  ],
};

describe('documentCoverage', () => {
  it('рахує охоплені секції й зауваження по стовпцю', () => {
    expect(documentCoverage(matrix)).toEqual([
      { documentVersionId: 11, coveredSections: 2, totalSections: 3, issues: 3, review: 0 },
      { documentVersionId: 12, coveredSections: 0, totalSections: 3, issues: 0, review: 0 },
    ]);
  });
});

describe('uncoveredSections', () => {
  it('секція, якої не стосується жоден документ', () => {
    expect([...uncoveredSections(matrix)]).toEqual(['4']);
  });
});
