/** Валідація zod-схем на прикладах коректної й некоректної відповіді моделі. */

import { describe, expect, it } from 'vitest';
import {
  clauseExtractSchema,
  criticSchema,
  docProfileSchema,
  judgeSchema,
  reportFindingSchema,
  specSummarySchema,
} from './prompts';

describe('clauseExtractSchema', () => {
  const valid = {
    clauses: [
      {
        clauseNo: '10.3',
        sectionNo: '10',
        sectionTitle: 'Pest management',
        topic: 'Pest management programme specification',
        requirementText: 'The site must have a documented pest management programme.',
        modules: ['P', 'R'],
        obligation: 'must',
        truncated: false,
      },
    ],
  };

  it('приймає коректну відповідь', () => {
    expect(clauseExtractSchema.safeParse(valid).success).toBe(true);
  });

  it('приймає порожній масив — сторінка без таблиці вимог', () => {
    expect(clauseExtractSchema.safeParse({ clauses: [] }).success).toBe(true);
  });

  it('відхиляє модуль поза {P,R,O}', () => {
    const bad = { clauses: [{ ...valid.clauses[0], modules: ['P', 'X'] }] };
    const result = clauseExtractSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('modules');
  });

  it('відхиляє порожній requirementText і невідомий obligation', () => {
    expect(
      clauseExtractSchema.safeParse({ clauses: [{ ...valid.clauses[0], requirementText: '' }] }).success,
    ).toBe(false);
    expect(
      clauseExtractSchema.safeParse({ clauses: [{ ...valid.clauses[0], obligation: 'shall' }] }).success,
    ).toBe(false);
  });

  it('відхиляє відсутнє поле truncated', () => {
    const { truncated: _drop, ...rest } = valid.clauses[0]!;
    expect(clauseExtractSchema.safeParse({ clauses: [rest] }).success).toBe(false);
  });
});

describe('reportFindingSchema / judgeSchema', () => {
  const finding = {
    clause_no: '10.3',
    verdict: 'partial',
    severity: 'minor',
    confidence: 0.8,
    rationale: 'The programme is documented but the inspection frequency is not stated.',
    evidence: [{ quote: 'Monitoring devices are numbered and shown on a site map.', page: 1 }],
    gap: 'Inspection frequency is missing.',
    recommendation: 'State the inspection frequency in section 3.',
  };

  it('приймає повний finding', () => {
    expect(reportFindingSchema.safeParse(finding).success).toBe(true);
  });

  it('приймає мінімальний finding — необов\'язкові поля відсутні', () => {
    const minimal = {
      clause_no: '10.4',
      verdict: 'not_addressed',
      confidence: 0.95,
      rationale: 'The document does not mention contractor licences.',
      evidence: [],
    };
    expect(reportFindingSchema.safeParse(minimal).success).toBe(true);
  });

  it('відхиляє not_applicable — N/A вирішує детермінований фільтр, не модель', () => {
    expect(reportFindingSchema.safeParse({ ...finding, verdict: 'not_applicable' }).success).toBe(false);
  });

  // Раніше тут було «відхиляє confidence поза 0..1». Поведінку змінено свідомо:
  // схема інструмента більше не може нести minimum/maximum (Anthropic дає 400),
  // тож модель інколи поверне 1.4. Відхиляти через це весь батч вимог — зайва
  // суворість: confidence лише допоміжне поле, а вердикт і докази цілком придатні.
  it('зрізає confidence поза 0..1, а не відкидає весь батч', () => {
    const high = reportFindingSchema.safeParse({ ...finding, confidence: 1.4 });
    const low = reportFindingSchema.safeParse({ ...finding, confidence: -0.1 });

    expect(high.success).toBe(true);
    expect(low.success).toBe(true);
    expect(high.data?.confidence).toBe(1);
    expect(low.data?.confidence).toBe(0);
  });

  it('відхиляє доказ без quote і нецілу сторінку', () => {
    expect(reportFindingSchema.safeParse({ ...finding, evidence: [{ page: 1 }] }).success).toBe(false);
    expect(
      reportFindingSchema.safeParse({ ...finding, evidence: [{ quote: 'x', page: 1.5 }] }).success,
    ).toBe(false);
  });

  it('judgeSchema — масив findings по одному на вимогу батчу', () => {
    const parsed = judgeSchema.safeParse([finding, { ...finding, clause_no: '10.4' }]);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toHaveLength(2);
    expect(judgeSchema.safeParse(finding).success).toBe(false);
  });
});

describe('criticSchema', () => {
  const valid = {
    agree: false,
    reason: 'The evidence shows a site map but never states an inspection frequency.',
    missingElements: ['frequency of inspections'],
    suggestedVerdict: 'partial',
    confidence: 0.7,
  };

  it('приймає коректну відповідь', () => {
    expect(criticSchema.safeParse(valid).success).toBe(true);
  });

  it('відхиляє suggestedVerdict поза MODEL_VERDICTS', () => {
    expect(criticSchema.safeParse({ ...valid, suggestedVerdict: 'not_applicable' }).success).toBe(false);
  });

  it('відхиляє agree не-булевим', () => {
    expect(criticSchema.safeParse({ ...valid, agree: 'no' }).success).toBe(false);
  });
});

describe('docProfileSchema', () => {
  const valid = {
    summary: 'Describes pest monitoring and contractor management.',
    docType: 'sop',
    docNumber: '0068',
    versionLabel: '002',
    processOwner: 'Warehouse & Production Manager',
    lang: 'en',
    processes: ['pest monitoring'],
    candidateClauses: ['10.1', '10.3'],
  };

  it('приймає коректну відповідь і null у необов\'язкових полях', () => {
    expect(docProfileSchema.safeParse(valid).success).toBe(true);
    expect(
      docProfileSchema.safeParse({ ...valid, docType: null, docNumber: null, lang: null }).success,
    ).toBe(true);
  });

  it('відхиляє невідомий docType і рядок замість масиву', () => {
    expect(docProfileSchema.safeParse({ ...valid, docType: 'instruction' }).success).toBe(false);
    expect(docProfileSchema.safeParse({ ...valid, candidateClauses: '10.1' }).success).toBe(false);
  });
});

describe('specSummarySchema', () => {
  const valid = {
    summary: 'Standard for ornamental plant suppliers.',
    scope: 'Applies to all growers supplying Tesco.',
    gradingRules: {
      rawText: 'Auditing of Standard ...',
      definitions: [{ level: 'major', definition: 'A mandatory requirement is not implemented.' }],
      ratings: [{ grade: '3', label: 'Improvement needed', criteria: '0 Critical and 1 Major' }],
    },
    sectionSummaries: [{ sectionNo: '10', sectionTitle: 'Pest management', summary: 'Requires a programme.' }],
  };

  it('приймає коректну відповідь', () => {
    expect(specSummarySchema.safeParse(valid).success).toBe(true);
  });

  it('приймає gradingRules: null', () => {
    expect(specSummarySchema.safeParse({ ...valid, gradingRules: null }).success).toBe(true);
  });

  it('відхиляє рівень severity поза переліком', () => {
    const bad = {
      ...valid,
      gradingRules: { ...valid.gradingRules, definitions: [{ level: 'blocker', definition: 'x' }] },
    };
    expect(specSummarySchema.safeParse(bad).success).toBe(false);
  });
});
