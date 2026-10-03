/**
 * Дані-заглушки для тестів промптів і провайдерів.
 * Побудовані за реальним матеріалом проєкту: Tesco Ornamental Plant Standard
 * v5.0 і SOP `Pest Management 0068 v002` (architecture.md, додаток).
 */

import type { ClauseExtractInput } from '../prompts/clauseExtract.v1';
import type { MarkerLegendItem } from '@shared/domain';
import type { CriticInput } from '../prompts/critic.v1';
import type { CriticV2Input } from '../prompts/critic.v2';
import type { DocProfileInput } from '../prompts/docProfile.v1';
import type { JudgeInput } from '../prompts/judge.v1';
import type { JudgeV2Input } from '../prompts/judge.v2';
import type { MarkerLegendInput } from '../prompts/markerLegend.v1';
import type { SpecSummaryInput } from '../prompts/specSummary.v1';

export const GRADING_RULES = [
  'Critical: a failure that affects product safety, legality or brand integrity.',
  'Major: a mandatory requirement is not implemented.',
  'Minor: a mandatory requirement is implemented but incomplete.',
  'Recommendation: an improvement opportunity with no non-conformance.',
  '',
  'Rating table:',
  '5 Excellent — 0 Critical, 0 Major, 0 Minor',
  '3 Improvement needed — 0 Critical and 1 Major non-conformance',
  '1 Unsatisfactory — 4 or more Major non-conformances',
].join('\n');

export const DOC_TEXT = [
  'Pest Management',
  'Documentnummer: 0068   Versie: 002   Proceseigenaar: Warehouse & Production Manager',
  '',
  '1. Purpose',
  'This procedure describes how pest activity is monitored and controlled on site.',
  '',
  '2. Contractor',
  'The site has a contract with a licensed pest control contractor.',
  'The contractor visits the site at least every four weeks.',
  '',
  '3. Monitoring',
  'Monitoring devices are numbered and shown on a site map.',
  'Results of each inspection are recorded in the pest control logbook.',
].join('\n');

export const SPEC_TEXT = [
  'Tesco Ornamental Plant Standard 2026',
  'Auditing of Standard',
  GRADING_RULES,
].join('\n\n');

export const clauseExtractInput: ClauseExtractInput = {
  specName: 'Tesco Ornamental Plant Standard',
  specVersion: '5.0',
  pageNo: 34,
  prevTail: '...the site must retain records for a minimum of 12 months.',
  pageText: [
    'P R  10.3  Pest management programme specification',
    'The site must have a documented pest management programme which includes as a minimum:',
    '- the scope of the programme',
    '- a site map showing the location of all monitoring devices',
    '- the frequency of inspections',
    'P    10.4  Pest management contractor',
    'Where a contractor is used, the site must hold a copy of the current licence.',
  ].join('\n'),
  nextHead: 'and the qualifications of the technicians attending site.',
};

/**
 * Сторінка стандарту без таблиці: вимоги нумерованою прозою, номери додатка
 * з літерою. Саме такі сторінки v1 радив пропускати («no clause table»).
 */
export const clauseExtractProseInput: ClauseExtractInput = {
  specName: 'ISO/IEC 27001',
  specVersion: '2022',
  pageNo: 14,
  pageText: [
    'A.5 Organizational controls',
    'A.5.1 Policies for information security',
    'Information security policy and topic-specific policies shall be defined, approved by management,',
    'published, communicated to and acknowledged by relevant personnel and relevant interested parties.',
    'A.5.2 Information security roles and responsibilities',
    'Information security roles and responsibilities shall be defined and allocated according to the',
    'organization needs.',
  ].join('\n'),
  nextHead: 'A.5.3 Segregation of duties',
};

export const markerLegendInput: MarkerLegendInput = {
  specName: 'Tesco Ornamental Plant Standard',
  specVersion: '5.0',
  codes: ['P', 'R', 'O'],
  introText: [
    '--- page 10 ---',
    'Clause Layout',
    'P — Policy / procedure: the site must have a documented policy/procedure that has been fully implemented.',
    'R — Records: the site must have comprehensive accurately completed records to demonstrate compliance.',
    'O — Observation: compliance to the clause will be verified through observation of the site.',
  ].join('\n'),
  pageFrom: 1,
  pageTo: 11,
};

export const specSummaryInput: SpecSummaryInput = {
  specName: 'Tesco Ornamental Plant Standard',
  specVersion: '5.0',
  issuer: 'Tesco Stores Ltd.',
  specText: SPEC_TEXT,
  sections: [
    { sectionNo: '10', sectionTitle: 'Pest management' },
    { sectionNo: '14', sectionTitle: 'Environment, water and waste' },
  ],
};

export const docProfileInput: DocProfileInput = {
  title: 'Pest Management',
  versionLabel: '002',
  docText: DOC_TEXT,
  clauseIndex: [
    { clauseNo: '10.1', topic: 'Pest management responsibility' },
    { clauseNo: '10.3', topic: 'Pest management programme specification' },
    { clauseNo: '12.2', topic: 'Damaged product segregation' },
  ],
};

export const judgeInput: JudgeInput = {
  spec: { name: 'Tesco Ornamental Plant Standard', version: '5.0', gradingRules: GRADING_RULES },
  doc: { title: 'Pest Management', versionLabel: '002', text: DOC_TEXT },
  section: { sectionNo: '10', sectionTitle: 'Pest management' },
  clauses: [
    {
      clauseNo: '10.3',
      topic: 'Pest management programme specification',
      obligation: 'must',
      requirementText: [
        'The site must have a documented pest management programme which includes as a minimum:',
        '- the scope of the programme',
        '- a site map showing the location of all monitoring devices',
        '- the frequency of inspections',
      ].join('\n'),
    },
    {
      clauseNo: '10.4',
      topic: 'Pest management contractor',
      obligation: 'must',
      requirementText: 'Where a contractor is used, the site must hold a copy of the current licence.',
    },
  ],
};

export const criticInput: CriticInput = {
  spec: { name: 'Tesco Ornamental Plant Standard', version: '5.0' },
  clause: {
    clauseNo: '10.3',
    topic: 'Pest management programme specification',
    obligation: 'must',
    requirementText: judgeInput.clauses[0]?.requirementText ?? '',
  },
  evidence: [
    { quote: 'Monitoring devices are numbered and shown on a site map.', page: 1, verified: true },
    { quote: 'The contractor visits the site at least every four weeks.', page: 1, verified: true },
  ],
  claimedRationale:
    'The document defines the scope, shows devices on a site map and states the inspection frequency.',
};

// ─── Позначки стандарту (judge.v2 / critic.v2) ───────────────────────────────

/** Легенда Tesco — словами стандарту, як її записала міграція 4. */
export const TESCO_LEGEND: MarkerLegendItem[] = [
  {
    code: 'P',
    label: 'Policy / procedure',
    meaning: 'The site must have a documented policy/procedure that has been fully implemented',
  },
  {
    code: 'R',
    label: 'Records',
    meaning: 'The site must have comprehensive accurately completed records to demonstrate compliance',
  },
  {
    code: 'O',
    label: 'Observation',
    meaning: 'Compliance to the clause will be verified through observation of the site',
  },
];

/** Той самий батч секції 10, але з позначками Tesco і легендою. */
export const judgeV2Input: JudgeV2Input = {
  ...judgeInput,
  markerLegend: TESCO_LEGEND,
  clauses: [
    { ...judgeInput.clauses[0]!, markers: ['P', 'R'] },
    { ...judgeInput.clauses[1]!, markers: ['P', 'R', 'O'] },
  ],
};

/** Стандарт без позначок (ISO-подібний): ні легенди, ні `markers` у вимог. */
export const judgeV2PlainInput: JudgeV2Input = {
  ...judgeInput,
  markerLegend: null,
  clauses: judgeInput.clauses.map((clause) => ({ ...clause, markers: [] })),
};

export const criticV2Input: CriticV2Input = {
  ...criticInput,
  clause: { ...criticInput.clause, markers: ['P', 'R'] },
  // Лише пункти для позначок цієї вимоги — O критику не показуємо.
  markerLegend: TESCO_LEGEND.slice(0, 2),
  claimedOutsideEvidence: 'Inspect the contractor visit reports and the trend analysis for the last 12 months.',
};

export const criticV2PlainInput: CriticV2Input = {
  ...criticInput,
  clause: { ...criticInput.clause, markers: [] },
  markerLegend: [],
  claimedOutsideEvidence: null,
};
