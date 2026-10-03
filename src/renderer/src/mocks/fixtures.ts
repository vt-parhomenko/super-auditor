/**
 * Детерміновані фікстури для розробки UI без бекенда.
 * Масштаб узятий із додатка architecture.md: Tesco v5.0 — 183 вимоги, 24 секції,
 * 3 документи-SOP нідерландського пакувальника.
 *
 * Генератор псевдовипадковий, але з фіксованим сідом — між перезавантаженнями
 * дані однакові, інакше неможливо порівняти два скріншоти екрана.
 */

import {
  clauseSortKey,
  emptyVerdictCounts,
  worstVerdict,
  type AuditRunDto,
  type ClauseDto,
  type CoverageCell,
  type CoverageMatrix,
  type DocProfileDto,
  type DocumentDto,
  type DocumentRunStats,
  type Effort,
  type EvidenceDto,
  type ExtractionDto,
  type FindingDto,
  type GapItem,
  type MarkerLegendItem,
  type ModelInfo,
  type Module,
  type Obligation,
  type RunSummary,
  type Severity,
  type SiteProfileDto,
  type SpecSummaryDto,
  type SpecificationDto,
  type SpendByStage,
  type SpendEntry,
  type SpendSummary,
  type Verdict,
} from '@shared/domain';
import type { AppSettings, ProviderBalance, ProviderStatus } from '@shared/ipc';

// ─── PRNG ────────────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(20405);
const pick = <T>(list: readonly T[], r: number): T => {
  const item = list[Math.floor(r * list.length) % list.length];
  // list завжди непорожній у фікстурах; fallback лише щоб задовольнити noUncheckedIndexedAccess
  return item ?? (list[0] as T);
};

// ─── Секції ──────────────────────────────────────────────────────────────────

interface SectionSeed {
  no: string;
  title: string;
  count: number;
  topics: string[];
}

const SECTIONS: SectionSeed[] = [
  { no: '1', title: 'Management commitment', count: 6, topics: ['Policy statement', 'Management review', 'Objectives', 'Resource provision', 'Organisational chart', 'Senior responsibility'] },
  { no: '2', title: 'Quality management system', count: 11, topics: ['Documented procedures', 'Document control', 'Record retention', 'Specification control', 'Change control', 'Version approval', 'Master document list', 'Obsolete documents', 'Electronic records', 'Signature authority', 'Annual review'] },
  { no: '3', title: 'Responsible sourcing', count: 7, topics: ['Ethical trade policy', 'Labour providers', 'Worker voice', 'Working hours', 'Wages', 'SMETA audit', 'Grievance mechanism'] },
  { no: '4', title: 'Site and building standards', count: 8, topics: ['Site security', 'Building fabric', 'Lighting', 'Drainage', 'Glass and brittle plastic', 'Ventilation', 'External areas', 'Floor condition'] },
  { no: '5', title: 'Supplier approval', count: 8, topics: ['Approved supplier list', 'Risk assessment', 'Supplier audits', 'Certification check', 'Performance monitoring', 'Sub-contracting', 'Raw material spec', 'De-listing'] },
  { no: '6', title: 'Traceability', count: 7, topics: ['One-up one-down', 'Batch coding', 'Mass balance test', 'Traceability exercise', 'Records retention', 'Mixed batches', 'Labelling integrity'] },
  { no: '7', title: 'Product specification and labelling', count: 11, topics: ['Specification sign-off', 'Label artwork', 'Barcode verification', 'Country of origin', 'Care instructions', 'Species naming', 'Claims substantiation', 'Print approval', 'Label reconciliation', 'Legal compliance', 'Language requirements'] },
  { no: '8', title: 'Goods receiving and storage', count: 8, topics: ['Incoming inspection', 'Vehicle checks', 'Temperature control', 'Segregation', 'Stock rotation', 'Damaged intake', 'Rejection procedure', 'Storage conditions'] },
  { no: '9', title: 'Water management', count: 6, topics: ['Water source risk', 'Water testing', 'Irrigation water', 'Recycled water', 'Test frequency', 'Corrective action'] },
  { no: '10', title: 'Pest management', count: 9, topics: ['Pest control contract', 'Bait station map', 'Inspection frequency', 'Trend analysis', 'Contractor competence', 'Action reports', 'Proofing', 'Non-toxic monitoring', 'Pesticide storage'] },
  { no: '11', title: 'Cleaning and hygiene', count: 8, topics: ['Cleaning schedule', 'Cleaning validation', 'Chemical approval', 'Personal hygiene', 'Hand washing', 'Protective clothing', 'Visitor rules', 'Equipment cleaning'] },
  { no: '12', title: 'Non-conforming and damaged product', count: 7, topics: ['Identification', 'Quarantine area', 'Disposition decision', 'Rework rules', 'Disposal records', 'Root cause', 'Customer notification'] },
  { no: '13', title: 'Plant protection products', count: 9, topics: ['Approved list', 'Application records', 'Operator training', 'MRL compliance', 'Harvest interval', 'Storage security', 'Spray equipment', 'Residue testing', 'Disposal of containers'] },
  { no: '14', title: 'Environment, waste and energy', count: 8, topics: ['Environmental policy', 'Waste segregation', 'Waste contractor', 'Energy monitoring', 'Peat reduction', 'Packaging recyclability', 'Emissions', 'Legal register'] },
  { no: '15', title: 'Growing media and substrate', count: 7, topics: ['Substrate specification', 'Peat content', 'Supplier declaration', 'Contamination risk', 'Batch records', 'Storage of media', 'Reuse rules'] },
  { no: '16', title: 'Propagation and young plants', count: 6, topics: ['Propagation records', 'Variety identity', 'Plant passport', 'Health inspection', 'Rootstock records', 'Nursery hygiene'] },
  { no: '17', title: 'Dispatch and transport', count: 8, topics: ['Loading checks', 'Vehicle hygiene', 'Temperature during transit', 'Load security', 'Dispatch documentation', 'Trolley condition', 'Delivery windows', 'Transport contractor approval'] },
  { no: '18', title: 'Customer complaints', count: 6, topics: ['Complaint log', 'Response time', 'Trend analysis', 'Corrective action', 'Escalation', 'Annual review'] },
  { no: '19', title: 'Incident and crisis management', count: 7, topics: ['Crisis team', 'Contact list', 'Withdrawal procedure', 'Recall test', 'Tesco notification', 'Mock recall records', 'Post-incident review'] },
  { no: '20', title: 'Training and competence', count: 8, topics: ['Training matrix', 'Induction', 'Refresher training', 'Competence assessment', 'Agency staff', 'Language barriers', 'Training records', 'Trainer qualification'] },
  { no: '21', title: 'Equipment and maintenance', count: 7, topics: ['Maintenance schedule', 'Calibration', 'Breakdown procedure', 'Temporary repairs', 'Spare parts hygiene', 'Equipment approval', 'Maintenance records'] },
  { no: '22', title: 'Internal audit', count: 6, topics: ['Audit schedule', 'Auditor independence', 'Audit scope', 'Non-conformance closure', 'Audit records', 'Management reporting'] },
  { no: '23', title: 'Product testing and inspection', count: 8, topics: ['Inspection plan', 'Sampling frequency', 'Quality attributes', 'Laboratory accreditation', 'Test records', 'Out-of-spec handling', 'Shelf-life trials', 'Vase-life testing'] },
  { no: '24', title: 'Continuous improvement', count: 7, topics: ['Improvement plan', 'KPI review', 'Root cause methodology', 'Preventive action', 'Benchmarking', 'Action tracking', 'Effectiveness check'] },
];

const OBLIGATIONS_POOL: Obligation[] = ['must', 'must', 'must', 'should', 'should', 'may'];
/** Прапорці P / R / O біля вимог Tesco: і позначки стандарту, і (застаріле) `modules`. */
const MODULE_POOL: Module[][] = [['P'], ['O'], ['R'], ['P', 'O'], ['P', 'R', 'O'], ['R', 'O'], ['P', 'R']];

/** Легенда позначок Tesco — слова стандарту зі стор. 10 («Clause Layout»). */
export const TESCO_MARKER_LEGEND: MarkerLegendItem[] = [
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

const REQ_TEMPLATES = [
  (t: string) =>
    `The site must have a documented procedure covering ${t.toLowerCase()}. The procedure shall define:\n• the person responsible and their deputy;\n• the frequency at which the activity is carried out;\n• the records generated and where they are retained;\n• the action taken when the requirement is not met.`,
  (t: string) =>
    `Site management must ensure that ${t.toLowerCase()} is reviewed at least annually and whenever a significant change occurs. Records of the review, including attendees and actions agreed, must be retained for a minimum of two years and be available to Tesco on request.`,
  (t: string) =>
    `Records demonstrating ${t.toLowerCase()} must be completed at the time of the activity, be legible, dated and signed by a competent person. Retrospective completion of records is not acceptable.`,
  (t: string) =>
    `A risk assessment covering ${t.toLowerCase()} must be documented, approved by site management and reviewed at a defined frequency. Where risk is identified as significant, controls must be verified for effectiveness.`,
  (t: string) =>
    `The supplier should be able to demonstrate that ${t.toLowerCase()} is monitored against defined limits. Where limits are exceeded, corrective action must be recorded together with a root cause analysis and a check of effectiveness.`,
];

/**
 * Сторінка, з якої починається кожна секція в оригіналі стандарту (12…98).
 * Розподіл нерівномірний — так само, як у справжньому PDF, де ранні секції
 * розбавлені текстом, а пізні йдуть щільною таблицею.
 */
const SECTION_START_PAGE: Record<string, number> = {
  '1': 12, '2': 14, '3': 18, '4': 21, '5': 24, '6': 28,
  '7': 31, '8': 36, '9': 40, '10': 41, '11': 45, '12': 49,
  '13': 52, '14': 57, '15': 61, '16': 64, '17': 70, '18': 74,
  '19': 77, '20': 80, '21': 84, '22': 87, '23': 90, '24': 94,
};
const LAST_PAGE = 98;

/** Сторінка вимоги: рівномірно всередині діапазону своєї секції. */
function clausePages(sectionNo: string, index: number, count: number, spansTwo: boolean) {
  const start = SECTION_START_PAGE[sectionNo] ?? 12;
  const nextSection = String(Number(sectionNo) + 1);
  const end = SECTION_START_PAGE[nextSection] ?? LAST_PAGE + 1;
  const span = Math.max(1, end - start);
  const pageFrom = start + Math.min(span - 1, Math.floor((index * span) / Math.max(1, count)));
  return { pageFrom, pageTo: spansTwo ? Math.min(LAST_PAGE, pageFrom + 1) : pageFrom };
}

export const CLAUSES: ClauseDto[] = (() => {
  const out: ClauseDto[] = [];
  let id = 1000;
  for (const section of SECTIONS) {
    for (let i = 0; i < section.count; i += 1) {
      const clauseNo = `${section.no}.${i + 1}`;
      const topic = section.topics[i] ?? `${section.title} ${i + 1}`;
      const template = pick(REQ_TEMPLATES, rnd());
      const r = rnd();
      // Частина вимог перетікає на наступну сторінку — щоб UI показував і діапазон.
      const pages = clausePages(section.no, i, section.count, rnd() < 0.15);
      // Порядок викликів rnd() той самий, що й до появи позначок: дані між версіями мока не зсуваються.
      const flags = pick(MODULE_POOL, rnd());
      out.push({
        id: (id += 1),
        specVersionId: 1,
        clauseNo,
        sortKey: clauseSortKey(clauseNo),
        sectionNo: section.no,
        sectionTitle: section.title,
        topic,
        requirementText: template(topic),
        modules: flags,
        markers: [...flags],
        obligation: pick(OBLIGATIONS_POOL, rnd()),
        pageFrom: pages.pageFrom,
        pageTo: pages.pageTo,
        textHash: `sha256:${(id * 7919).toString(16).padStart(12, '0')}`,
        reviewStatus: r < 0.52 ? 'confirmed' : r < 0.6 ? 'edited' : r < 0.65 ? 'flagged' : 'auto',
      });
    }
  }
  return out;
})();

export const REVIEWED_CLAUSE_COUNT = CLAUSES.filter(
  (c) => c.reviewStatus === 'confirmed' || c.reviewStatus === 'edited',
).length;

/**
 * Демо-стандарт без позначок: вимоги нумерованою прозою, як у ISO чи нормах
 * пожежної безпеки. Реєстр такого стандарту не показує жодних значків і
 * легенди — на ньому це й видно. Тексти вигадані.
 */
export const PROSE_SPEC_VERSION_ID = 4;

export const PROSE_CLAUSES: ClauseDto[] = (
  [
    ['4.1', '4', 'Organisation', 'Responsibilities', 'The site shall appoint a person responsible for fire safety and a deputy.'],
    ['4.2', '4', 'Organisation', 'Risk assessment', 'A fire risk assessment shall be documented and reviewed at least annually.'],
    ['4.2.1', '4', 'Organisation', null, 'The risk assessment shall cover storage of flammable packaging materials.'],
    ['5.1', '5', 'Escape routes', 'Marking', 'Escape routes shall be marked and kept free of obstructions at all times.'],
    ['5.2', '5', 'Escape routes', 'Emergency lighting', 'Emergency lighting should be tested monthly and the result recorded.'],
    ['6.1', '6', 'Equipment', 'Extinguishers', 'Fire extinguishers shall be inspected by a competent person every year.'],
  ] as const
).map(([clauseNo, sectionNo, sectionTitle, topic, requirementText], i): ClauseDto => ({
  id: 5001 + i,
  specVersionId: PROSE_SPEC_VERSION_ID,
  clauseNo,
  sortKey: clauseSortKey(clauseNo),
  sectionNo,
  sectionTitle,
  topic,
  requirementText,
  modules: [],
  markers: [],
  obligation: /\bshould\b/.test(requirementText) ? 'should' : 'must',
  pageFrom: 3 + i,
  pageTo: 3 + i,
  textHash: `sha256:${(5001 + i).toString(16).padStart(12, '0')}`,
  reviewStatus: i < 2 ? 'confirmed' : 'auto',
}));

// ─── Специфікації ────────────────────────────────────────────────────────────

export const SPECIFICATIONS: SpecificationDto[] = [
  {
    id: 1,
    name: 'Tesco Ornamental Plant Standard 2026',
    issuer: 'Tesco Stores Ltd',
    code: '20405',
    cloudAllowed: true,
    versions: [
      {
        id: 1,
        specificationId: 1,
        versionLabel: '5.0',
        blobHash: 'a1c9f0d4e8b7256390fd41ac77b3e5219a0d4c6b8e2f7139aa4c0d5e6f701122',
        extractionId: 1,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        clausesStatus: 'extracted',
        clauseCount: CLAUSES.length,
        reviewedClauseCount: REVIEWED_CLAUSE_COUNT,
        markerLegend: TESCO_MARKER_LEGEND,
      },
      {
        id: 2,
        specificationId: 1,
        versionLabel: '4.2',
        blobHash: 'b7712dd0aa39ce4415f0c2e8b96d7a3315ce9012ff45ab7788cd0011ee223344',
        extractionId: 2,
        effectiveFrom: '2024-03-01T00:00:00.000Z',
        clausesStatus: 'reviewed',
        clauseCount: 176,
        reviewedClauseCount: 176,
        markerLegend: TESCO_MARKER_LEGEND,
      },
    ],
  },
  {
    id: 2,
    name: 'GLOBALG.A.P. Chain of Custody',
    issuer: 'FoodPLUS GmbH',
    code: 'CoC v6',
    cloudAllowed: false,
    versions: [
      {
        id: 3,
        specificationId: 2,
        versionLabel: '6.0',
        blobHash: 'cc019a3b7742ff10ee0d5b6c8899aa11bb22cc33dd44ee55ff6600112233445',
        extractionId: null,
        effectiveFrom: '2025-06-01T00:00:00.000Z',
        clausesStatus: 'pending',
        clauseCount: 0,
        reviewedClauseCount: 0,
        markerLegend: null,
      },
    ],
  },
  {
    id: 3,
    name: 'Fire Safety Code (demo)',
    issuer: 'Demo',
    code: 'FSC',
    cloudAllowed: true,
    versions: [
      {
        id: PROSE_SPEC_VERSION_ID,
        specificationId: 3,
        versionLabel: '2024',
        blobHash: 'dd4410ee5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7',
        extractionId: 4,
        effectiveFrom: '2024-01-01T00:00:00.000Z',
        clausesStatus: 'extracted',
        clauseCount: PROSE_CLAUSES.length,
        reviewedClauseCount: 2,
        // Стандарт позначок не має — і легенди теж.
        markerLegend: null,
      },
    ],
  },
];

export const SPEC_SUMMARY: SpecSummaryDto = {
  specVersionId: 1,
  summary:
    'Стандарт охоплює вирощування, пакування й постачання декоративних рослин і цибулин для Tesco. 24 секції; позначки біля вимог показують, чим доводиться відповідність: P — політика/процедура, R — записи, O — огляд майданчика.',
  scope:
    'Усі майданчики, що постачають Tesco декоративні рослини, зрізані квіти та цибулини, включно з субпідрядниками пакування.',
  gradingRules:
    'Critical — невиконання вимоги, що створює безпосередній ризик для споживача або репутації Tesco.\nMajor — системний збій контролю.\nMinor — одиничне відхилення без системного впливу.\n\n0 Critical + 0 Major → 5 Excellent\n0 Critical + 1–3 Major → 3 Improvement needed\n≥4 Major або 1 Critical → 1 Unsatisfactory',
  sectionSummaries: Object.fromEntries(
    SECTIONS.map((s) => [s.no, `${s.title}: ${s.count} вимог, ключове — документована процедура та записи виконання.`]),
  ),
  model: 'claude-opus-5',
  promptVersion: 'spec_summary.v1',
  createdAt: '2026-08-12T09:14:22.000Z',
};

// ─── Документи ───────────────────────────────────────────────────────────────

export const DOCUMENTS: DocumentDto[] = [
  {
    id: 1,
    title: 'Receiving (BIO, Global G.A.P. CoC) Flowerbulbs',
    docNumber: '0045',
    processOwner: 'M. van Dijk',
    kind: 'sop',
    // Заповнюється в `documents:list` / `documents:get` — так само, як у main.
    lastRun: null,
    createdAt: '2026-07-02T08:00:00.000Z',
    versions: [
      {
        id: 11,
        documentId: 1,
        versionLabel: '003',
        blobHash: '0e443916aa1177cc22dd33ee44ff5566778899aabbccddeeff0011223344556',
        extractionId: 11,
        lang: 'nl',
        effectiveFrom: '2026-05-14T00:00:00.000Z',
        importedAt: '2026-07-02T08:00:00.000Z',
        byteSize: 214_336,
        pageCount: 4,
      },
      {
        id: 12,
        documentId: 1,
        versionLabel: '002',
        blobHash: '77aa1122bb3344cc5566dd7788ee99ff00112233445566778899aabbccddeef',
        extractionId: 12,
        lang: 'nl',
        effectiveFrom: '2024-11-03T00:00:00.000Z',
        importedAt: '2026-07-02T08:00:00.000Z',
        byteSize: 208_112,
        pageCount: 4,
      },
    ],
  },
  {
    id: 2,
    title: 'Pest Management',
    docNumber: '0068',
    processOwner: 'J. Bakker',
    kind: 'sop',
    // Заповнюється в `documents:list` / `documents:get` — так само, як у main.
    lastRun: null,
    createdAt: '2026-07-02T08:04:00.000Z',
    versions: [
      {
        id: 21,
        documentId: 2,
        versionLabel: '002',
        blobHash: '11c22d29ee33ff4455667788990011223344556677889900aabbccddeeff112',
        extractionId: 21,
        lang: 'en',
        effectiveFrom: '2026-02-01T00:00:00.000Z',
        importedAt: '2026-07-02T08:04:00.000Z',
        byteSize: 156_004,
        pageCount: 3,
      },
    ],
  },
  {
    id: 3,
    title: 'Damaged Products',
    docNumber: '0072',
    processOwner: 'S. de Vries',
    kind: 'sop',
    // Заповнюється в `documents:list` / `documents:get` — так само, як у main.
    lastRun: null,
    createdAt: '2026-07-02T08:07:00.000Z',
    versions: [
      {
        id: 31,
        documentId: 3,
        versionLabel: '002',
        blobHash: 'f5e7e0c4bb9988776655443322110099aabbccddeeff00112233445566778899',
        extractionId: 31,
        lang: 'en',
        effectiveFrom: '2025-09-20T00:00:00.000Z',
        importedAt: '2026-07-02T08:07:00.000Z',
        byteSize: 132_760,
        pageCount: 2,
      },
    ],
  },
];

export const DOC_VERSION_INDEX = new Map(
  DOCUMENTS.flatMap((d) => d.versions.map((v) => [v.id, { doc: d, version: v }] as const)),
);

export const RUN_DOC_VERSION_IDS = [11, 21, 31];

export const DOC_PROFILES: DocProfileDto[] = [
  {
    id: 1,
    documentVersionId: 11,
    summary:
      'Процедура приймання цибулин квітів із контролем сертифікатів BIO та GLOBALG.A.P. CoC, перевіркою транспорту й реєстрацією партій.',
    docType: 'sop',
    processes: ['Приймання', 'Контроль сертифікатів', 'Реєстрація партій'],
    candidateClauses: ['8.1', '8.2', '8.5', '15.3', '17.1', '6.1'],
    model: 'claude-haiku-4-5',
    promptVersion: 'doc_profile.v1',
    createdAt: '2026-08-20T10:02:11.000Z',
  },
  {
    id: 2,
    documentVersionId: 21,
    summary: 'SOP управління шкідниками: договір із підрядником, карта принад, частота інспекцій, звіти про дії.',
    docType: 'sop',
    processes: ['Моніторинг шкідників', 'Робота з підрядником'],
    candidateClauses: ['10.1', '10.2', '10.3', '10.4', '10.6'],
    model: 'claude-haiku-4-5',
    promptVersion: 'doc_profile.v1',
    createdAt: '2026-08-20T10:03:40.000Z',
  },
  {
    id: 3,
    documentVersionId: 31,
    summary: 'Поводження з пошкодженою продукцією: ідентифікація, карантин, рішення про долю партії, записи утилізації.',
    docType: 'sop',
    processes: ['Карантин', 'Утилізація', 'Кореневий аналіз'],
    candidateClauses: ['12.1', '12.2', '12.4', '18.4'],
    model: 'claude-haiku-4-5',
    promptVersion: 'doc_profile.v1',
    createdAt: '2026-08-20T10:04:55.000Z',
  },
];

// ─── Профілі виробництва ───────────────────────────────────────────────────────────

export const SITE_PROFILES: SiteProfileDto[] = [
  {
    id: 1,
    name: 'Lisse — пакування цибулин',
    modules: ['P', 'O'],
    certifications: ['ISO14001', 'SMETA', 'GLOBALG.A.P. CoC'],
    products: ['Цибулини тюльпанів', 'Цибулини нарцисів', 'Горщикові рослини'],
    processes: ['Приймання', 'Сортування', 'Пакування', 'Відвантаження'],
    notes: 'Вирощування не виконується — тільки пакування закупленої продукції.',
  },
  {
    id: 2,
    name: 'Noordwijk — вирощування',
    modules: ['P', 'R', 'O'],
    certifications: ['GLOBALG.A.P.'],
    products: ['Зрізані квіти'],
    processes: ['Вирощування', 'Зрізання', 'Пакування'],
    notes: null,
  },
];

// ─── Прогони ─────────────────────────────────────────────────────────────────

export const RUNS: AuditRunDto[] = [
  {
    id: 3,
    label: 'Tesco v5.0 × 3 SOP (повний)',
    specVersionId: 1,
    siteProfileId: 1,
    status: 'done',
    modelJudge: 'claude-opus-5',
    modelCritic: 'claude-sonnet-5',
    // Findings цього прогону мають «перевірити поза документом» — це вже judge.v2.
    promptVersion: 'judge.v2',
    startedAt: '2026-08-28T12:04:00.000Z',
    finishedAt: '2026-08-28T12:41:37.000Z',
    usage: { inputTokens: 1_842_100, cachedTokens: 1_301_400, outputTokens: 188_640, costUsd: 6.42 },
    error: null,
    documentVersionIds: RUN_DOC_VERSION_IDS,
  },
  {
    id: 2,
    label: 'Пробна перевірка — секція 10',
    specVersionId: 1,
    siteProfileId: 1,
    status: 'paused',
    modelJudge: 'claude-opus-5',
    modelCritic: null,
    promptVersion: 'judge.v1',
    startedAt: '2026-08-27T09:12:00.000Z',
    finishedAt: null,
    usage: { inputTokens: 214_800, cachedTokens: 120_500, outputTokens: 22_100, costUsd: 0.81 },
    error: null,
    documentVersionIds: [21],
  },
  {
    id: 1,
    label: null,
    specVersionId: 2,
    siteProfileId: null,
    status: 'failed',
    modelJudge: 'claude-sonnet-5',
    modelCritic: null,
    promptVersion: 'judge.v1',
    startedAt: '2026-08-21T16:30:00.000Z',
    finishedAt: '2026-08-21T16:33:12.000Z',
    usage: { inputTokens: 48_200, cachedTokens: 0, outputTokens: 3100, costUsd: 0.14 },
    error: 'rate_limit: 429 від провайдера anthropic після 3 спроб',
    documentVersionIds: [11, 31],
  },
];

// ─── Findings ────────────────────────────────────────────────────────────────

/** Які секції реально покриті кожним документом — решта дасть not_addressed. */
const DOC_SECTIONS: Record<number, string[]> = {
  11: ['6', '8', '15', '17'],
  21: ['10', '11', '13'],
  31: ['12', '18', '22'],
};

const RATIONALES: Record<Verdict, string[]> = {
  compliant: [
    'Документ містить пряму відповідь на вимогу: визначено відповідального, частоту та форму запису. Цитата підтверджує всі три елементи.',
    'Процедура покриває вимогу повністю, включно з дією при невиконанні. Критик не знайшов розбіжностей.',
  ],
  partial: [
    'Процедура описує саму дію, але не визначає частоту її виконання та не називає відповідального. Вимога виконана частково.',
    'Записи згадані, проте немає вимоги підписувати їх компетентною особою і немає строку зберігання.',
  ],
  non_compliant: [
    'Документ прямо допускає ретроспективне заповнення записів, що суперечить вимозі стандарту.',
    'Задана частота (раз на рік) нижча за мінімум стандарту. Це системне відхилення, не одиничне.',
  ],
  not_addressed: [
    'У наборі документів немає жодної згадки про цю вимогу. Доказів не знайдено.',
  ],
  needs_human_review: [
    'Судження і критик розійшлись: судження дало compliant, критик вказав на відсутність перевірки ефективності. Потрібне рішення людини.',
    'Жодна цитата не пройшла механічну верифікацію — довіри до доказів немає.',
  ],
  not_applicable: [
    'Секцію покрито сторонньою сертифікацією згідно з профілем виробництва.',
  ],
};

const QUOTES = [
  'The responsible person for this procedure is the Quality Manager, with the Site Manager acting as deputy in their absence.',
  'Inspections are carried out every four weeks by the approved contractor and the report is filed in the quality folder.',
  'All records must be completed at the time of the activity and signed by the operator performing it.',
  'Where a deviation is found, the Quality Manager is informed within 24 hours and a corrective action form is raised.',
  'Records are retained for a minimum of two years and are available for inspection on request.',
  'Damaged product is moved to the designated quarantine area and labelled with a red hold card.',
  'The bait station map is displayed in the technical office and updated whenever a station is moved.',
  'Incoming pallets are checked against the delivery note for certification status before they are accepted.',
];

function severityFor(verdict: Verdict, r: number): Severity | null {
  if (verdict === 'compliant' || verdict === 'not_applicable') return null;
  if (verdict === 'non_compliant') return r < 0.18 ? 'critical' : r < 0.66 ? 'major' : 'minor';
  if (verdict === 'partial') return r < 0.4 ? 'major' : r < 0.85 ? 'minor' : 'recommendation';
  if (verdict === 'not_addressed') return r < 0.25 ? 'major' : 'minor';
  return r < 0.5 ? 'major' : 'minor';
}

/** Вимога, яку легенда Tesco доводить записами (R) чи оглядом майданчика (O). */
function provenOutsideDocument(clause: ClauseDto): boolean {
  return clause.markers.includes('R') || clause.markers.includes('O');
}

/**
 * «Перевірити поза документом» — так, як його пише judge.v2: лише для вимог із
 * позначками R / O і не для «не розглянуто». Без rnd(): решта мока не зсувається.
 */
function mockOutsideEvidence(clause: ClauseDto, verdict: Verdict): string | null {
  if (verdict === 'not_addressed' || verdict === 'not_applicable') return null;
  const topic = clause.topic ?? clause.clauseNo;
  const parts: string[] = [];
  if (clause.markers.includes('R')) {
    parts.push(`Записи: переглянути заповнені журнали «${topic}» за останні 12 місяців — дати, підписи, вжиті дії.`);
  }
  if (clause.markers.includes('O')) {
    parts.push(`Огляд: на місці переконатися, що «${topic}» виконується так, як описано в процедурі.`);
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

export const FINDINGS: FindingDto[] = (() => {
  const out: FindingDto[] = [];
  let findingId = 5000;
  let evidenceId = 9000;

  for (const clause of CLAUSES) {
    const section = clause.sectionNo ?? '';
    // Стадія 3: секція 14 покрита ISO14001, секція 3 — SMETA (профіль виробництва 1)
    if (section === '14' || section === '3') continue;

    let anyCovered = false;
    for (const dvId of RUN_DOC_VERSION_IDS) {
      const covered = (DOC_SECTIONS[dvId] ?? []).includes(section);
      if (!covered) continue;
      anyCovered = true;

      const r = rnd();
      const verdict: Verdict =
        r < 0.44 ? 'compliant' : r < 0.68 ? 'partial' : r < 0.8 ? 'non_compliant' : r < 0.9 ? 'needs_human_review' : 'not_addressed';
      const severity = severityFor(verdict, rnd());
      const evidenceCount = verdict === 'not_addressed' ? 0 : 1 + Math.floor(rnd() * 2);
      const evidence: EvidenceDto[] = [];
      for (let i = 0; i < evidenceCount; i += 1) {
        const vr = rnd();
        evidence.push({
          id: (evidenceId += 1),
          findingId: findingId + 1,
          documentVersionId: dvId,
          quote: pick(QUOTES, rnd()),
          pageNo: 1 + Math.floor(rnd() * 3),
          charStart: Math.floor(rnd() * 4000),
          charEnd: Math.floor(rnd() * 4000) + 200,
          source: vr < 0.75 ? 'citations_api' : 'model_quote',
          verified: verdict === 'needs_human_review' ? vr > 0.7 : vr < 0.88,
        });
      }

      const reviewR = rnd();
      out.push({
        id: (findingId += 1),
        runId: 3,
        clauseId: clause.id,
        documentVersionId: dvId,
        verdict,
        severity,
        confidence: Math.round((0.55 + rnd() * 0.44) * 100) / 100,
        rationale: pick(RATIONALES[verdict], rnd()),
        gap:
          verdict === 'compliant'
            ? null
            : provenOutsideDocument(clause)
              ? // Записи й огляд документ не замінить (judge.v2) — прогалина лише в процедурі.
                `У процедурі не визначено частоту й відповідального для «${clause.topic ?? clause.clauseNo}».`
              : `Не показано, як саме виробництво виконує «${clause.topic ?? clause.clauseNo}» — бракує запису, що підтверджує виконання.`,
        recommendation:
          verdict === 'compliant'
            ? null
            : 'Додати до процедури пункт із частотою, відповідальним і формою запису; додати приклад заповненого запису як доказ.',
        outsideEvidence: mockOutsideEvidence(clause, verdict),
        createdAt: '2026-08-28T12:20:00.000Z',
        evidence,
        review:
          reviewR < 0.22
            ? {
                findingId,
                humanVerdict: reviewR < 0.12 ? verdict : 'partial',
                humanSeverity: severity,
                note: reviewR < 0.06 ? 'Погоджено з аудитором на місці.' : null,
                reviewedAt: '2026-08-29T08:15:00.000Z',
              }
            : null,
        clause: {
          clauseNo: clause.clauseNo,
          sectionNo: clause.sectionNo,
          sectionTitle: clause.sectionTitle,
          topic: clause.topic,
          obligation: clause.obligation,
          pageFrom: clause.pageFrom,
          pageTo: clause.pageTo,
        },
      });
    }

    if (!anyCovered) {
      // Зведений finding по всьому набору (document_version_id IS NULL)
      out.push({
        id: (findingId += 1),
        runId: 3,
        clauseId: clause.id,
        documentVersionId: null,
        verdict: 'not_addressed',
        severity: severityFor('not_addressed', rnd()),
        confidence: null,
        rationale: RATIONALES.not_addressed[0] ?? '',
        gap: `Жоден із трьох документів не описує «${clause.topic ?? clause.clauseNo}».`,
        recommendation: 'Створити або доповнити SOP, який покриває цю вимогу, і додати його до набору аудиту.',
        outsideEvidence: null,
        createdAt: '2026-08-28T12:33:00.000Z',
        evidence: [],
        review: null,
        clause: {
          clauseNo: clause.clauseNo,
          sectionNo: clause.sectionNo,
          sectionTitle: clause.sectionTitle,
          topic: clause.topic,
          obligation: clause.obligation,
          pageFrom: clause.pageFrom,
          pageTo: clause.pageTo,
        },
      });
    }
  }
  return out;
})();

// ─── Агрегація ───────────────────────────────────────────────────────────────

export function buildCoverage(runId: number): CoverageMatrix {
  const findings = FINDINGS.filter((f) => f.runId === runId);
  const sections = SECTIONS.map((s) => ({
    sectionNo: s.no,
    sectionTitle: s.title,
    clauseCount: s.count,
  }));
  const documents = RUN_DOC_VERSION_IDS.map((id) => {
    const entry = DOC_VERSION_INDEX.get(id);
    return {
      documentVersionId: id,
      title: entry?.doc.title ?? `Документ ${id}`,
      versionLabel: entry?.version.versionLabel ?? '—',
    };
  });

  const buckets = new Map<string, Verdict[]>();
  for (const f of findings) {
    if (f.documentVersionId == null) continue;
    const key = `${f.clause.sectionNo ?? ''}::${f.documentVersionId}`;
    const list = buckets.get(key);
    if (list) list.push(f.verdict);
    else buckets.set(key, [f.verdict]);
  }

  const cells: CoverageCell[] = [];
  for (const [key, verdicts] of buckets) {
    const [sectionNo, dv] = key.split('::');
    const counts = emptyVerdictCounts();
    for (const v of verdicts) counts[v] += 1;
    cells.push({
      sectionNo: sectionNo ?? '',
      documentVersionId: Number(dv),
      worstVerdict: worstVerdict(verdicts),
      counts,
    });
  }
  return { runId, sections, documents, cells };
}

export function buildGaps(runId: number): GapItem[] {
  const byClause = new Map<number, FindingDto[]>();
  for (const f of FINDINGS) {
    if (f.runId !== runId) continue;
    const list = byClause.get(f.clauseId);
    if (list) list.push(f);
    else byClause.set(f.clauseId, [f]);
  }
  const gaps: GapItem[] = [];
  for (const clause of CLAUSES) {
    const list = byClause.get(clause.id);
    if (!list || list.length === 0) continue;
    const hasEvidence = list.some((f) => f.evidence.length > 0);
    if (hasEvidence) continue;
    gaps.push({
      clauseId: clause.id,
      clauseNo: clause.clauseNo,
      sectionNo: clause.sectionNo,
      sectionTitle: clause.sectionTitle,
      topic: clause.topic,
      obligation: clause.obligation,
      requirementText: clause.requirementText,
      severityIfMissing: list[0]?.severity ?? 'minor',
      pageFrom: clause.pageFrom,
      pageTo: clause.pageTo,
    });
  }
  return gaps;
}

export function buildSummary(runId: number): RunSummary {
  const findings = FINDINGS.filter((f) => f.runId === runId);
  const counts = emptyVerdictCounts();
  const severityCounts: Record<Severity, number> = { critical: 0, major: 0, minor: 0, recommendation: 0 };
  const assessed = new Set<number>();
  for (const f of findings) {
    counts[f.verdict] += 1;
    if (f.severity) severityCounts[f.severity] += 1;
    assessed.add(f.clauseId);
  }
  const applicable = CLAUSES.filter((c) => c.sectionNo !== '14' && c.sectionNo !== '3').length;
  const run = RUNS.find((r) => r.id === runId);
  const grade =
    severityCounts.critical > 0 || severityCounts.major >= 4
      ? { value: 1, label: 'Unsatisfactory' }
      : severityCounts.major > 0
        ? { value: 3, label: 'Improvement needed' }
        : { value: 5, label: 'Excellent' };
  return {
    runId,
    clausesApplicable: applicable,
    clausesAssessed: assessed.size,
    counts,
    severityCounts,
    gaps: buildGaps(runId).length,
    grade,
    usage: run?.usage ?? { inputTokens: 0, cachedTokens: 0, outputTokens: 0, costUsd: 0 },
  };
}

/** Скільки вимог застосовні для профілю виробництва — та сама логіка, що у Stage 3. */
export function applicableCount(siteProfileId: number): { applicable: number; notApplicable: number } {
  const site = SITE_PROFILES.find((s) => s.id === siteProfileId);
  if (!site) return { applicable: CLAUSES.length, notApplicable: 0 };
  let applicable = 0;
  for (const clause of CLAUSES) {
    const moduleOk = clause.modules.length === 0 || clause.modules.some((m) => site.modules.includes(m));
    const isoSkip = clause.sectionNo === '14' && site.certifications.includes('ISO14001');
    const ethicalSkip =
      clause.sectionNo === '3' && site.certifications.some((c) => c === 'SMETA' || c === 'SIZA');
    if (moduleOk && !isoSkip && !ethicalSkip) applicable += 1;
  }
  return { applicable, notApplicable: CLAUSES.length - applicable };
}

// ─── Екстракції ──────────────────────────────────────────────────────────────

export function buildExtraction(extractionId: number): ExtractionDto {
  const text = QUOTES.join('\n\n');
  return {
    id: extractionId,
    blobHash: `mock-${extractionId}`,
    method: 'pdfjs',
    toolVersion: 'pdfjs-dist@6.3.289',
    text,
    pageCount: 3,
    charCount: text.length,
    quality: 0.86,
    pages: [
      { pageNo: 1, charStart: 0, charEnd: Math.floor(text.length / 3) },
      { pageNo: 2, charStart: Math.floor(text.length / 3), charEnd: Math.floor((2 * text.length) / 3) },
      { pageNo: 3, charStart: Math.floor((2 * text.length) / 3), charEnd: text.length },
    ],
    createdAt: '2026-07-02T08:00:05.000Z',
  };
}


// ─── Прогони в розрізі документа ─────────────────────────────────────────────

/**
 * Метрики прогону для ОДНОГО документа. Рахуємо з тих самих FINDINGS, що
 * живлять решту екранів, — інакше картка документа й вкладка findings
 * показували б різні числа на тих самих даних.
 */
function statsFor(runId: number, documentVersionId: number): DocumentRunStats | null {
  const items = FINDINGS.filter(
    (f) => f.runId === runId && f.documentVersionId === documentVersionId,
  );
  if (items.length === 0) return null;

  const run = RUNS.find((r) => r.id === runId);
  const entry = DOC_VERSION_INDEX.get(documentVersionId);
  const spec = SPECIFICATIONS.find((sp) => sp.versions.some((v) => v.id === run?.specVersionId));
  const specVersion = spec?.versions.find((v) => v.id === run?.specVersionId);

  const counts = emptyVerdictCounts();
  const severityCounts: Record<Severity, number> = {
    critical: 0,
    major: 0,
    minor: 0,
    recommendation: 0,
  };
  let reviewed = 0;
  for (const f of items) {
    counts[f.verdict] += 1;
    // Severity рахуємо лише за справжніми невідповідностями — інакше
    // «minor» від not_addressed роздував би картку неіснуючими проблемами.
    if ((f.verdict === 'partial' || f.verdict === 'non_compliant') && f.severity) {
      severityCounts[f.severity] += 1;
    }
    if (f.review) reviewed += 1;
  }

  return {
    runId,
    label: run?.label ?? null,
    status: run?.status ?? 'done',
    startedAt: run?.startedAt ?? null,
    finishedAt: run?.finishedAt ?? null,
    specName: spec?.name ?? 'Невідомий стандарт',
    specVersionLabel: specVersion?.versionLabel ?? '—',
    documentVersionId,
    documentVersionLabel: entry?.version.versionLabel ?? '—',
    counts,
    severityCounts,
    assessed: items.length,
    relevant: items.filter((f) => f.verdict !== 'not_addressed').length,
    reviewed,
  };
}

/** Усі прогони, що торкались документа, від найновішого. */
export function buildDocumentRuns(documentId: number): DocumentRunStats[] {
  const doc = DOCUMENTS.find((d) => d.id === documentId);
  if (!doc) return [];
  const out: DocumentRunStats[] = [];
  for (const run of RUNS) {
    for (const version of doc.versions) {
      const stats = statsFor(run.id, version.id);
      if (stats) out.push(stats);
    }
  }
  return out.sort((a, b) => b.runId - a.runId);
}

// ─── Журнал витрат ───────────────────────────────────────────────────────────

const SPEND_ROWS: Array<[string, string, number, number, number, number, number]> = [
  // етап, модель, викликів, cost, input, cached, output
  ['clause_extract', 'claude-opus-5', 101, 3.82, 412_000, 0, 96_400],
  ['spec_summary', 'claude-sonnet-5', 3, 0.21, 48_200, 12_000, 6100],
  ['doc_profile', 'claude-haiku-4-5', 6, 0.04, 31_400, 8200, 2900],
  ['judge', 'claude-opus-5', 72, 6.42, 1_842_100, 1_301_400, 188_640],
  ['critic', 'claude-sonnet-5', 24, 0.88, 214_800, 120_500, 22_100],
  // Через OpenRouter: id із префіксом розробника.
  ['critic', 'openai/gpt-6-luna', 18, 0.04, 162_300, 98_400, 15_800],
];

export const SPEND_BY_STAGE: SpendByStage[] = SPEND_ROWS.map(
  ([stage, model, calls, costUsd, inputTokens, cachedTokens, outputTokens]) => ({
    stage,
    model,
    calls,
    costUsd,
    inputTokens,
    cachedTokens,
    outputTokens,
  }),
);

export function buildSpendSummary(): SpendSummary {
  const total = Math.round(SPEND_BY_STAGE.reduce((a, r) => a + r.costUsd, 0) * 100) / 100;
  return {
    today: Math.round(total * 0.18 * 100) / 100,
    month: Math.round(total * 0.74 * 100) / 100,
    total,
    byStage: SPEND_BY_STAGE,
  };
}

export function buildRecentSpend(limit = 50): SpendEntry[] {
  const out: SpendEntry[] = [];
  const base = Date.parse('2026-09-13T19:30:00.000Z');
  for (let i = 0; i < Math.min(limit, 40); i += 1) {
    const row = SPEND_ROWS[i % SPEND_ROWS.length];
    if (!row) continue;
    const [stage, model] = row;
    const fromCache = i % 7 === 3;
    out.push({
      id: 9000 + i,
      stage,
      provider: model.includes('/') ? 'openrouter' : 'anthropic',
      model,
      promptVersion: `${stage}.v1`,
      inputTokens: fromCache ? 0 : 18_400 + i * 120,
      cachedTokens: fromCache ? 0 : 12_800 + i * 60,
      outputTokens: fromCache ? 0 : 1600 + i * 20,
      costUsd: fromCache ? 0 : Math.round((0.04 + (i % 5) * 0.013) * 10000) / 10000,
      latencyMs: fromCache ? 2 : 1800 + i * 45,
      runId: 3,
      specVersionId: 1,
      fromCache,
      createdAt: new Date(base - i * 47_000).toISOString(),
    });
  }
  return out;
}

// ─── Налаштування й провайдери ───────────────────────────────────────────────

export const SETTINGS: AppSettings = {
  // Решта етапів — на вбудованій маршрутизації (OpenRouter), один перевизначений —
  // щоб на екрані було видно і позначку «типово», і власний вибір.
  routing: {
    critic: { provider: 'openrouter', model: 'openai/gpt-6-luna', effort: 'medium' },
  },
  concurrency: 4,
  localOnly: false,
  theme: 'system',
  resultsLanguage: 'uk',
  uiLanguage: 'en',
};

const ALL_EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Скорочення для опису моделі у фікстурах: решта полів — розумні значення за замовчуванням. */
function mi(
  id: string,
  label: string,
  vendor: string | null,
  price: [input: number | null, output: number | null, cacheRead?: number | null],
  extra: Partial<ModelInfo> = {},
): ModelInfo {
  return {
    id,
    label,
    vendor,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    inputPerMTok: price[0],
    outputPerMTok: price[1],
    cacheReadPerMTok: price[2] ?? null,
    efforts: null,
    recommended: false,
    tier: null,
    ...extra,
  };
}

const ANTHROPIC_MODELS: ModelInfo[] = [
  mi('claude-opus-5-5', 'Claude Opus 5.5', 'Anthropic', [4, 20, 0.2], { efforts: ALL_EFFORTS, recommended: true, tier: 'top' }),
  mi('claude-fable-5-1', 'Claude Fable 5.1', 'Anthropic', [10, 50, 0.25], { efforts: ALL_EFFORTS, recommended: true, tier: 'top' }),
  mi('claude-opus-5', 'Claude Opus 5', 'Anthropic', [5, 25, 0.5], { efforts: ALL_EFFORTS, recommended: true, tier: 'top' }),
  mi('claude-sonnet-5', 'Claude Sonnet 5', 'Anthropic', [2, 10, 0.2], {
    efforts: ['low', 'medium', 'high', 'max'],
    recommended: true,
    tier: 'balanced',
  }),
  mi('claude-haiku-4-5', 'Claude Haiku 4.5', 'Anthropic', [1, 5, 0.1], {
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    efforts: [],
    recommended: true,
    tier: 'budget',
  }),
];

/** Куровані моделі OpenRouter — у тому порядку, в якому їх показує main. */
const OPENROUTER_CURATED: ModelInfo[] = [
  mi('anthropic/claude-opus-5.5', 'Claude Opus 5.5', 'Anthropic', [4, 20, 0.2], { efforts: ALL_EFFORTS, tier: 'top' }),
  mi('anthropic/claude-sonnet-5.5', 'Claude Sonnet 5.5', 'Anthropic', [2, 10, 0.2], { efforts: ALL_EFFORTS, tier: 'balanced' }),
  mi('anthropic/claude-fable-5.1', 'Claude Fable 5.1', 'Anthropic', [10, 50, 0.25], { efforts: ALL_EFFORTS, tier: 'top' }),
  mi('anthropic/claude-opus-5', 'Claude Opus 5', 'Anthropic', [5, 25, 0.5], { efforts: ALL_EFFORTS, tier: 'top' }),
  mi('anthropic/claude-sonnet-5', 'Claude Sonnet 5', 'Anthropic', [2, 10, 0.2], {
    efforts: ['low', 'medium', 'high', 'max'],
    tier: 'balanced',
  }),
  mi('anthropic/claude-haiku-4.5', 'Claude Haiku 4.5', 'Anthropic', [1, 5, 0.1], {
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    efforts: [],
    tier: 'budget',
  }),
  mi('openai/gpt-6-luna', 'GPT-6 Luna', 'OpenAI', [0.1, 0.5, 0.01], { efforts: ['low', 'medium', 'high'], tier: 'budget' }),
  mi('openai/gpt-6-luna-pro', 'GPT-6 Luna Pro', 'OpenAI', [0.1, 0.5], { efforts: ['low', 'medium', 'high', 'xhigh'], tier: 'budget' }),
  mi('openai/gpt-6-sol', 'GPT-6 Sol', 'OpenAI', [2, 10, 0.2], { efforts: ['low', 'medium', 'high', 'xhigh'], tier: 'balanced' }),
  mi('openai/gpt-6.1-sol', 'GPT-6.1 Sol', 'OpenAI', [2, 10, 0.1], { efforts: ['low', 'medium', 'high', 'xhigh'], tier: 'balanced' }),
  mi('deepseek/deepseek-v4-pro', 'DeepSeek V4 Pro', 'DeepSeek', [0.209, 0.418, 0.017], { tier: 'budget' }),
  mi('deepseek/deepseek-v4-pro-0813', 'DeepSeek V4 Pro 0813', 'DeepSeek', [0.66, 1.98], { tier: 'budget' }),
  mi('deepseek/deepseek-v4.1-flash', 'DeepSeek V4.1 Flash', 'DeepSeek', [0.02, 0.6], { efforts: [], tier: 'budget' }),
  mi('google/gemini-3.1-pro-preview', 'Gemini 3.1 Pro Preview', 'Google', [2, 12, 0.2], { efforts: ['low', 'high'], tier: 'balanced' }),
  mi('google/gemini-3.8-flash', 'Gemini 3.8 Flash', 'Google', [0.75, 3.75], { efforts: ['low', 'medium', 'high'], tier: 'budget' }),
  mi('qwen/qwen3.8-max-0902', 'Qwen3.8 Max', 'Qwen', [2, 6], { tier: 'balanced' }),
  mi('moonshotai/kimi-k3', 'Kimi K3', 'Moonshot AI', [2.7, 13.5], { efforts: [], tier: 'balanced' }),
  mi('z-ai/glm-5.3', 'GLM 5.3', 'Z.ai', [1.4, 4.4], { tier: 'balanced' }),
  mi('x-ai/grok-4.7', 'Grok 4.7', 'xAI', [2, 6], { contextWindow: 500_000, efforts: ['low', 'high'], tier: 'balanced' }),
].map((m) => ({ ...m, recommended: true }));

/**
 * «Решта каталогу» — у справжньому OpenRouter їх сотні. Тут кілька десятків, щоб
 * було видно лічильник «+N», автодоповнення в «Іншій моделі…» і моделі без ціни.
 */
const OPENROUTER_REST: ModelInfo[] = [
  mi('anthropic/claude-3.7-sonnet', 'Claude 3.7 Sonnet', 'Anthropic', [3, 15, 0.3], { contextWindow: 200_000 }),
  mi('openai/gpt-6-luna-mini', 'GPT-6 Luna Mini', 'OpenAI', [0.04, 0.2]),
  mi('google/gemma-4-27b-it', 'Gemma 4 27B', 'Google', [0.08, 0.3], { contextWindow: 131_072 }),
  mi('deepseek/deepseek-v4-lite', 'DeepSeek V4 Lite', 'DeepSeek', [0.05, 0.2]),
  mi('qwen/qwen3.8-coder', 'Qwen3.8 Coder', 'Qwen', [0.4, 1.6]),
  mi('qwen/qwen3.8-flash', 'Qwen3.8 Flash', 'Qwen', [0.05, 0.4]),
  mi('x-ai/grok-4.7-mini', 'Grok 4.7 Mini', 'xAI', [0.3, 0.5], { contextWindow: 500_000 }),
  mi('meta-llama/llama-4-maverick', 'Llama 4 Maverick', 'Meta', [0.15, 0.6], { contextWindow: 1_048_576 }),
  mi('meta-llama/llama-4-scout', 'Llama 4 Scout', 'Meta', [0.08, 0.3], { contextWindow: 1_048_576 }),
  mi('mistralai/mistral-large-2512', 'Mistral Large 2512', 'Mistral AI', [2, 6], { contextWindow: 131_072 }),
  mi('mistralai/mistral-medium-3.2', 'Mistral Medium 3.2', 'Mistral AI', [0.4, 2], { contextWindow: 131_072 }),
  mi('cohere/command-a', 'Command A', 'Cohere', [2.5, 10], { contextWindow: 256_000 }),
  mi('amazon/nova-2-pro', 'Nova 2 Pro', 'Amazon', [1.25, 10], { contextWindow: 300_000 }),
  mi('amazon/nova-2-lite', 'Nova 2 Lite', 'Amazon', [0.3, 2.5], { contextWindow: 300_000 }),
  mi('microsoft/phi-5', 'Phi-5', 'Microsoft', [0.1, 0.4], { contextWindow: 131_072 }),
  mi('nvidia/nemotron-ultra-2', 'Nemotron Ultra 2', 'NVIDIA', [0.6, 1.8], { contextWindow: 131_072 }),
  mi('perplexity/sonar-pro-2', 'Sonar Pro 2', 'Perplexity', [3, 15], { contextWindow: 200_000 }),
  mi('nousresearch/hermes-5-405b', 'Hermes 5 405B', 'Nous Research', [null, null], { contextWindow: 131_072 }),
  mi('openrouter/auto', 'Auto Router', 'OpenRouter', [null, null], { contextWindow: 2_000_000 }),
];

const OPENROUTER_MODELS = [...OPENROUTER_CURATED, ...OPENROUTER_REST];

const LOCAL_MODELS: ModelInfo[] = [
  mi('qwen3-32b-instruct', 'qwen3-32b-instruct', null, [null, null], { contextWindow: 32_768, maxOutputTokens: null }),
  mi('llama-4-scout', 'llama-4-scout', null, [null, null], { contextWindow: 131_072, maxOutputTokens: null }),
];

export const PROVIDERS: ProviderStatus[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    configured: true,
    cloud: true,
    models: ANTHROPIC_MODELS.map((m) => m.id),
    modelInfo: ANTHROPIC_MODELS,
    allowCustomModel: false,
    catalogueUpdatedAt: null,
    supportsBalance: false,
    error: null,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    configured: true,
    cloud: true,
    models: OPENROUTER_MODELS.map((m) => m.id),
    modelInfo: OPENROUTER_MODELS,
    allowCustomModel: true,
    catalogueUpdatedAt: '2026-10-02T07:40:00.000Z',
    supportsBalance: true,
    managementKeyConfigured: true,
    error: null,
  },
  {
    id: 'local',
    label: 'Local (OpenAI-compatible)',
    configured: true,
    cloud: false,
    models: LOCAL_MODELS.map((m) => m.id),
    modelInfo: LOCAL_MODELS,
    // Як у main: локальний сервер приймає будь-яку модель, яку в нього завантажено.
    allowCustomModel: true,
    catalogueUpdatedAt: null,
    error: 'Сервер на 127.0.0.1:1234 не відповідає',
  },
];

/**
 * Баланс OpenRouter. Без management-ключа рахунок недоступний — лишаються лише
 * витрати ключа, як і в справжньому API (`/key` vs `/credits`).
 */
export function buildOpenRouterBalance(
  managementKey: 'none' | 'valid' | 'rejected',
): ProviderBalance {
  const account =
    managementKey === 'valid'
      ? {
          accountRemainingUsd: 74.5,
          accountTotalCreditsUsd: 100,
          accountTotalUsageUsd: 25.5,
          accountUnavailableReason: null,
        }
      : {
          accountRemainingUsd: null,
          accountTotalCreditsUsd: null,
          accountTotalUsageUsd: null,
          accountUnavailableReason:
            managementKey === 'rejected' ? ('management_key_rejected' as const) : ('management_key_required' as const),
        };
  return {
    providerId: 'openrouter',
    ...account,
    keyLimitUsd: null,
    keyLimitRemainingUsd: null,
    keyLimitReset: null,
    keyUsageUsd: 25.5,
    keyUsageDailyUsd: 1.18,
    keyUsageWeeklyUsd: 6.84,
    keyUsageMonthlyUsd: 25.5,
    isFreeTier: false,
    fetchedAt: new Date().toISOString(),
  };
}

export const SECTION_SEEDS = SECTIONS;
