/**
 * Насіння для тестів шару БД. Не використовується в продакшн-коді.
 *
 * Дані наближені до реального набору з `architecture.md`:
 * Tesco v5.0 із секціями 3 / 10 / 14 і двома SOP нідерландського пакувальника.
 */

import type { MarkerLegendItem } from '@shared/domain';
import { createTestDb, type Db } from './index';

/** Легенда позначок Tesco — слова стандарту зі стор. 10 («Clause Layout»). */
export const TESCO_MARKER_LEGEND: readonly MarkerLegendItem[] = [
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

export interface SeedResult {
  db: Db;
  specBlob: string;
  specificationId: number;
  specVersionId: number;
  /** clauseNo → clause.id */
  clauseIds: Record<string, number>;
  siteProfileId: number;
  /** Pest Management 0068 v002 */
  pestDocId: number;
  pestVersionId: number;
  /** Damaged Products 0072 v002 */
  damagedDocId: number;
  damagedVersionId: number;
  runId: number;
}

export function hash(seed: string): string {
  return seed.repeat(64).slice(0, 64);
}

export interface SeedOptions {
  db?: Db;
  /** Не створювати прогін (для тестів, де прогін будується вручну). */
  withRun?: boolean;
}

export function seed(options: SeedOptions = {}): SeedResult {
  const db = options.db ?? createTestDb();
  const withRun = options.withRun ?? true;

  const specBlob = hash('a');
  const pestBlob = hash('b');
  const damagedBlob = hash('c');

  for (const [h, mime] of [
    [specBlob, 'application/pdf'],
    [pestBlob, 'application/pdf'],
    [damagedBlob, 'application/pdf'],
  ] as const) {
    db.blobs.insert({
      hash: h,
      relPath: `${h.slice(0, 2)}/${h.slice(2, 4)}/${h}.pdf`,
      byteSize: 1024,
      mime,
    });
  }

  const specExtraction = db.extractions.insert({
    blobHash: specBlob,
    method: 'pdfjs',
    toolVersion: 'pdfjs-6.3.289',
    text: 'Tesco Ornamental Plant Standard 2026 …',
    pageCount: 101,
    quality: 0.92,
    pages: [
      { pageNo: 1, charStart: 0, charEnd: 20 },
      { pageNo: 2, charStart: 20, charEnd: 40 },
    ],
  });

  const pestExtraction = db.extractions.insert({
    blobHash: pestBlob,
    method: 'pdfjs',
    toolVersion: 'pdfjs-6.3.289',
    text: 'Pest management programme is documented and reviewed annually.',
    pageCount: 3,
    quality: 0.88,
    pages: [{ pageNo: 1, charStart: 0, charEnd: 62 }],
  });

  const damagedExtraction = db.extractions.insert({
    blobHash: damagedBlob,
    method: 'mammoth',
    toolVersion: 'mammoth-1.12.2',
    text: 'Damaged products are segregated and recorded.',
    pageCount: null,
    quality: 0.7,
  });

  const specification = db.specs.create({
    name: 'Tesco Ornamental Plant Standard',
    issuer: 'Tesco Stores Ltd.',
    code: '20405',
    cloudAllowed: false,
  });

  const specVersion = db.specs.addVersion({
    specificationId: specification.id,
    versionLabel: '5.0',
    blobHash: specBlob,
    extractionId: specExtraction.id,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    clausesStatus: 'reviewed',
  });

  const clauseDefs = [
    {
      clauseNo: '3.1',
      sectionNo: '3',
      sectionTitle: 'Responsible sourcing',
      topic: 'Ethical audit',
      requirementText: 'The site must hold a valid third-party ethical audit.',
      modules: ['R'] as const,
      obligation: 'must' as const,
      pageFrom: 28,
      pageTo: 28,
    },
    {
      clauseNo: '10.1',
      sectionNo: '10',
      sectionTitle: 'Pest management',
      topic: 'Pest management programme',
      requirementText: 'A documented pest management programme must be in place.',
      modules: ['P'] as const,
      obligation: 'must' as const,
      pageFrom: 41,
      pageTo: 41,
    },
    {
      clauseNo: '10.2',
      sectionNo: '10',
      sectionTitle: 'Pest management',
      topic: 'Pest control contractor',
      requirementText: 'Pest control must be carried out by a competent contractor.',
      modules: ['P'] as const,
      obligation: 'must' as const,
      pageFrom: 41,
      pageTo: 41,
    },
    {
      clauseNo: '10.3',
      sectionNo: '10',
      sectionTitle: 'Pest management',
      topic: 'Pest management programme specification',
      requirementText: 'The programme must specify the minimum elements listed below.',
      modules: ['P', 'R'] as const,
      obligation: 'must' as const,
      pageFrom: 41,
      pageTo: 41,
    },
    {
      clauseNo: '14.1',
      sectionNo: '14',
      sectionTitle: 'Environment',
      topic: 'Water and waste',
      requirementText: 'The site should minimise water use and manage waste responsibly.',
      modules: ['O'] as const,
      obligation: 'should' as const,
      pageFrom: 62,
      pageTo: 62,
    },
  ];

  db.specs.setMarkerLegend(specVersion.id, TESCO_MARKER_LEGEND);

  const clauseIds: Record<string, number> = {};
  for (const def of clauseDefs) {
    const clause = db.clauses.create(specVersion.id, {
      clauseNo: def.clauseNo,
      sectionNo: def.sectionNo,
      sectionTitle: def.sectionTitle,
      topic: def.topic,
      requirementText: def.requirementText,
      modules: [...def.modules],
      // Позначки Tesco — ті самі P/R/O, тепер як надруковані коди стандарту.
      markers: [...def.modules],
      obligation: def.obligation,
      pageFrom: def.pageFrom,
      pageTo: def.pageTo,
      reviewStatus: 'confirmed',
    });
    clauseIds[def.clauseNo] = clause.id;
  }

  const site = db.siteProfiles.save({
    name: 'Flowerbulbs BV',
    modules: ['P', 'R', 'O'],
    certifications: ['ISO14001'],
    products: ['flower bulbs'],
    processes: ['receiving', 'packing'],
    notes: null,
  });

  // Секція 14 покрита ISO 14001 → детермінований N/A (ADR-4, Stage 3).
  db.siteProfiles.recompute(site.id, [
    { clauseId: requireId(clauseIds, '3.1'), applicable: true, reason: 'in scope' },
    { clauseId: requireId(clauseIds, '10.1'), applicable: true, reason: 'in scope' },
    { clauseId: requireId(clauseIds, '10.2'), applicable: true, reason: 'in scope' },
    { clauseId: requireId(clauseIds, '10.3'), applicable: true, reason: 'in scope' },
    {
      clauseId: requireId(clauseIds, '14.1'),
      applicable: false,
      reason: 'ISO 14001 покриває Environment/water/waste',
    },
  ]);

  const pestDoc = db.documents.create({
    title: 'Pest Management',
    docNumber: '0068',
    processOwner: 'Warehouse & Production Manager',
    kind: 'sop',
  });
  const pestVersion = db.documents.addVersion({
    documentId: pestDoc.id,
    versionLabel: '002',
    blobHash: pestBlob,
    extractionId: pestExtraction.id,
    lang: 'en',
  });

  const damagedDoc = db.documents.create({
    title: 'Damaged Products',
    docNumber: '0072',
    processOwner: 'Quality Manager',
    kind: 'sop',
  });
  const damagedVersion = db.documents.addVersion({
    documentId: damagedDoc.id,
    versionLabel: '002',
    blobHash: damagedBlob,
    extractionId: damagedExtraction.id,
    lang: 'nl',
  });

  let runId = 0;
  if (withRun) {
    const run = db.runs.create({
      label: 'M3 повний прогін',
      specVersionId: specVersion.id,
      siteProfileId: site.id,
      documentVersionIds: [pestVersion.id, damagedVersion.id],
      modelJudge: 'claude-opus-5',
      modelCritic: 'claude-opus-5',
      promptVersion: 'judge.v1',
    });
    runId = run.id;
  }

  return {
    db,
    specBlob,
    specificationId: specification.id,
    specVersionId: specVersion.id,
    clauseIds,
    siteProfileId: site.id,
    pestDocId: pestDoc.id,
    pestVersionId: pestVersion.id,
    damagedDocId: damagedDoc.id,
    damagedVersionId: damagedVersion.id,
    runId,
  };
}

/** `noUncheckedIndexedAccess` робить `Record<string, number>[k]` можливо-undefined. */
export function requireId(map: Record<string, number>, key: string): number {
  const value = map[key];
  if (value === undefined) throw new Error(`Немає вимоги ${key} у фікстурі`);
  return value;
}
