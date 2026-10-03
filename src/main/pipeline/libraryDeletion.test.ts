import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlobDto } from '@shared/domain';
import type { LibraryDeleteImpact, LibraryDeleteTarget } from '@shared/ipc';
import type { Db } from '@main/db';
import { hash, seed, type SeedResult } from '@main/db/fixtures';
import { blobPath, extractedDir, setStorageRoot } from '@main/paths';
import { deleteFromLibrary, libraryDeleteImpact, type LibraryDeletionDeps } from './libraryDeletion';

/**
 * Видалення специфікацій і документів на справжній тестовій БД.
 *
 * Головні властивості, на яких легко помилитися:
 *  • у схемі немає каскаду від версій до результатів перевірок — без плану
 *    транзакція впала б на FK посередині;
 *  • перевірка неподільна: видалення одного документа забирає й перевірку,
 *    що охоплювала інші документи, — і вікно підтвердження мусить це сказати;
 *  • файли content-addressed: спільний файл лишається, поки ним користується
 *    хоч одна версія;
 *  • журнал витрат не чіпається ніколи;
 *  • показана ціна — це рівно те, що потім видалено.
 */

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'sa-library-deletion-'));
  setStorageRoot(root);
});

afterAll(() => {
  setStorageRoot(null);
  rmSync(root, { recursive: true, force: true });
});

let s: SeedResult;
let db: Db;
let cancelled: number[];
let warnings: unknown[][];

function deps(overrides: Partial<LibraryDeletionDeps> = {}): LibraryDeletionDeps {
  return {
    db,
    cancelRun: async (runId) => {
      cancelled.push(runId);
      db.runs.setStatus(runId, 'cancelled');
    },
    logger: { warn: (...args: unknown[]) => warnings.push(args) },
    ...overrides,
  };
}

function count(table: string): number {
  return (db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

/** Знімок кількості рядків — щоб звірити показану ціну з фактично видаленим. */
function snapshot() {
  return {
    runs: count('audit_run'),
    findings: count('finding'),
    reviews: count('finding_review'),
    evidence: count('finding_evidence'),
    tasks: count('run_task'),
    clauses: count('clause'),
    applicability: count('clause_applicability'),
    specVersions: count('spec_version'),
    specifications: count('specification'),
    documentVersions: count('document_version'),
    documents: count('document'),
    profiles: count('doc_profile'),
    blobs: count('blob'),
    extractions: count('extraction'),
    spend: count('llm_spend'),
  };
}

function fkViolations(): unknown[] {
  return db.raw.pragma('foreign_key_check') as unknown[];
}

/** Файл блоба на диску — як після справжнього імпорту. */
function writeBlobFile(blob: BlobDto | null): string {
  if (!blob) throw new Error('блоба немає');
  const path = blobPath(blob.hash, '.pdf');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `%PDF ${blob.hash}`);
  return path;
}

/** Результати перевірки: findings по обох документах, доказ, людське рев'ю, черга, витрати. */
function populateRun(runId: number) {
  const pest = db.findings.upsert({
    runId,
    clauseId: s.clauseIds['10.1']!,
    documentVersionId: s.pestVersionId,
    verdict: 'partial',
    severity: 'major',
    rationale: 'частково',
    evidence: [{ documentVersionId: s.pestVersionId, quote: 'Pest management', verified: true, source: 'model_quote' }],
  });
  db.findings.upsert({
    runId,
    clauseId: s.clauseIds['10.2']!,
    documentVersionId: s.damagedVersionId,
    verdict: 'not_addressed',
    rationale: 'не розглянуто',
  });
  db.findings.upsert({
    runId,
    clauseId: s.clauseIds['3.1']!,
    documentVersionId: null,
    verdict: 'non_compliant',
    severity: 'critical',
    rationale: 'зведений',
  });
  db.findings.saveReview(pest.id, { humanVerdict: 'compliant', humanSeverity: null, note: 'перевірив очима' });
  db.runTasks.enqueue(runId, { stage: 'judge', payload: {} });
  db.spend.record({
    stage: 'judge',
    provider: 'anthropic',
    model: 'claude-opus-5',
    costUsd: 1.25,
    runId,
    specVersionId: s.specVersionId,
  });
}

beforeEach(() => {
  s = seed();
  db = s.db;
  cancelled = [];
  warnings = [];
  // Типовий стан: перевірку давно завершено. Живі — окремими тестами.
  db.runs.setStatus(s.runId, 'done');
  populateRun(s.runId);
  db.specs.upsertSummary({ specVersionId: s.specVersionId, summary: 'Tesco', gradingRules: 'rules' });
  db.docProfiles.upsert({
    documentVersionId: s.pestVersionId,
    summary: 'SOP',
    model: 'claude-haiku-4-5',
    promptVersion: 'doc_profile.v1',
  });
});

describe('схема без плану не дала б видалити', () => {
  it('FK справді ввімкнені: версію, за якою є перевірка, напряму не видалити', () => {
    expect(() => db.specs.deleteVersion(s.specVersionId)).toThrow(/FOREIGN KEY/);
    expect(() => db.documents.deleteVersion(s.pestVersionId)).toThrow(/FOREIGN KEY/);
  });

  it('усі зовнішні ключі схеми відомі видаленню', () => {
    // Якщо цей тест упав — міграція додала FK. Перевірте, що `LibraryDeletionRepo`
    // прибирає рядки, які на нього посилаються, ДО видалення батька (або що FK
    // з ON DELETE CASCADE), і лише тоді оновіть список.
    const tables = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    const fks = tables.flatMap(({ name }) =>
      (
        db.raw.prepare(`PRAGMA foreign_key_list(${name})`).all() as Array<{
          table: string;
          from: string;
          on_delete: string;
        }>
      ).map((fk) => `${name}.${fk.from} → ${fk.table} ${fk.on_delete}`),
    );
    expect(fks.sort()).toEqual(
      [
        'audit_run.site_profile_id → site_profile NO ACTION',
        'audit_run.spec_version_id → spec_version NO ACTION',
        'audit_run_document.document_version_id → document_version NO ACTION',
        'audit_run_document.run_id → audit_run CASCADE',
        'clause.spec_version_id → spec_version CASCADE',
        'clause_applicability.clause_id → clause CASCADE',
        'clause_applicability.site_profile_id → site_profile CASCADE',
        'doc_profile.document_version_id → document_version CASCADE',
        'document_version.blob_hash → blob NO ACTION',
        'document_version.document_id → document CASCADE',
        'document_version.extraction_id → extraction NO ACTION',
        'extraction.blob_hash → blob NO ACTION',
        'extraction_page.extraction_id → extraction CASCADE',
        'finding.clause_id → clause NO ACTION',
        'finding.document_version_id → document_version NO ACTION',
        'finding.run_id → audit_run CASCADE',
        'finding_evidence.document_version_id → document_version NO ACTION',
        'finding_evidence.finding_id → finding CASCADE',
        'finding_review.finding_id → finding CASCADE',
        'run_task.run_id → audit_run CASCADE',
        'spec_summary.spec_version_id → spec_version CASCADE',
        'spec_version.blob_hash → blob NO ACTION',
        'spec_version.extraction_id → extraction NO ACTION',
        'spec_version.specification_id → specification CASCADE',
      ].sort(),
    );
  });
});

describe('ціна видалення', () => {
  it('нічого не змінює', () => {
    const before = snapshot();
    libraryDeleteImpact(db, { kind: 'specification', id: s.specificationId });
    libraryDeleteImpact(db, { kind: 'document', id: s.pestDocId });
    expect(snapshot()).toEqual(before);
  });

  it('null для неіснуючої цілі', () => {
    for (const kind of ['specification', 'specVersion', 'document', 'documentVersion'] as const) {
      expect(libraryDeleteImpact(db, { kind, id: 9999 })).toBeNull();
    }
  });

  it('версія специфікації: вимоги, перевірки, findings, рев’ю, файли', () => {
    const impact = libraryDeleteImpact(db, { kind: 'specVersion', id: s.specVersionId });
    expect(impact).toEqual<LibraryDeleteImpact>({
      target: { kind: 'specVersion', id: s.specVersionId },
      title: 'Tesco Ornamental Plant Standard v5.0',
      parentId: s.specificationId,
      deletesParent: true,
      versionIds: [s.specVersionId],
      versions: 1,
      clauses: 5,
      documentProfiles: 0,
      runs: [{ id: s.runId, label: 'M3 повний прогін', status: 'done', documentCount: 2, otherDocuments: 2 }],
      findings: 3,
      reviewedFindings: 1,
      filesToRemove: 1,
      bytesToFree: 1024,
      sharedFilesKept: 0,
    });
  });

  it('версія документа: назва з номером, перевірка з іншими документами', () => {
    const impact = libraryDeleteImpact(db, { kind: 'documentVersion', id: s.pestVersionId });
    expect(impact?.title).toBe('0068 Pest Management v002');
    expect(impact?.deletesParent).toBe(true);
    expect(impact?.documentProfiles).toBe(1);
    expect(impact?.clauses).toBe(0);
    expect(impact?.runs).toEqual([
      { id: s.runId, label: 'M3 повний прогін', status: 'done', documentCount: 2, otherDocuments: 1 },
    ]);
  });
});

describe('видалення версії специфікації', () => {
  it('остання версія забирає специфікацію, перевірки й файл; документи лишаються', async () => {
    const specBlob = db.blobs.get(s.specBlob);
    const specFile = writeBlobFile(specBlob);
    const pestFile = writeBlobFile(db.blobs.get(hash('b')));
    const shown = libraryDeleteImpact(db, { kind: 'specVersion', id: s.specVersionId });
    const before = snapshot();

    const done = await deleteFromLibrary(deps(), { kind: 'specVersion', id: s.specVersionId });

    const after = snapshot();
    expect(done).toEqual(shown);
    expect(db.specs.get(s.specificationId)).toBeNull();
    expect(db.specs.getVersion(s.specVersionId)).toBeNull();
    expect(db.runs.get(s.runId)).toBeNull();
    // Каскадом пішли вимоги з їх застосовністю, зведення, findings із доказами й рев'ю, черга.
    expect(after.clauses).toBe(0);
    expect(after.applicability).toBe(0);
    expect(db.specs.getSummary(s.specVersionId)).toBeNull();
    expect(after.findings + after.evidence + after.reviews + after.tasks).toBe(0);
    // Документи не зачеплено.
    expect(after.documents).toBe(before.documents);
    expect(after.documentVersions).toBe(before.documentVersions);
    expect(after.profiles).toBe(before.profiles);
    // Файл стандарту — сирота: рядок, екстракція й файл на диску зникли.
    expect(db.blobs.exists(s.specBlob)).toBe(false);
    expect(after.extractions).toBe(before.extractions - 1);
    expect(existsSync(specFile)).toBe(false);
    expect(existsSync(pestFile)).toBe(true);
    // Журнал витрат — факт, а не властивість перевірки.
    expect(after.spend).toBe(before.spend);
    expect(db.spend.summary().total).toBeCloseTo(1.25);
    expect(fkViolations()).toEqual([]);
  });

  it('не остання версія — специфікація лишається з рештою версій', async () => {
    db.blobs.insert({ hash: hash('d'), relPath: `dd/dd/${hash('d')}.pdf`, byteSize: 2048, mime: 'application/pdf' });
    const v6 = db.specs.addVersion({ specificationId: s.specificationId, versionLabel: '6.0', blobHash: hash('d') });

    const impact = libraryDeleteImpact(db, { kind: 'specVersion', id: s.specVersionId });
    expect(impact?.deletesParent).toBe(false);

    await deleteFromLibrary(deps(), { kind: 'specVersion', id: s.specVersionId });

    expect(db.specs.get(s.specificationId)?.versions.map((v) => v.id)).toEqual([v6.id]);
    expect(fkViolations()).toEqual([]);
  });

  it('файл, спільний із документом, лишається', async () => {
    // Той самий PDF імпортовано і як стандарт, і як документ.
    const doc = db.documents.create({ title: 'Копія стандарту', kind: 'other' });
    db.documents.addVersion({ documentId: doc.id, versionLabel: '1', blobHash: s.specBlob });
    const specFile = writeBlobFile(db.blobs.get(s.specBlob));

    const impact = await deleteFromLibrary(deps(), { kind: 'specVersion', id: s.specVersionId });

    expect(impact?.filesToRemove).toBe(0);
    expect(impact?.bytesToFree).toBe(0);
    expect(impact?.sharedFilesKept).toBe(1);
    expect(db.blobs.exists(s.specBlob)).toBe(true);
    expect(db.extractions.best(s.specBlob)).not.toBeNull();
    expect(existsSync(specFile)).toBe(true);
    expect(fkViolations()).toEqual([]);
  });
});

describe('видалення цілої специфікації', () => {
  it('усі версії й перевірки за кожною з них', async () => {
    db.blobs.insert({ hash: hash('d'), relPath: `dd/dd/${hash('d')}.pdf`, byteSize: 2048, mime: 'application/pdf' });
    const v6 = db.specs.addVersion({
      specificationId: s.specificationId,
      versionLabel: '6.0',
      blobHash: hash('d'),
      clausesStatus: 'reviewed',
    });
    db.clauses.create(v6.id, { clauseNo: '1.1', requirementText: 'Нова вимога', reviewStatus: 'confirmed' });
    const run6 = db.runs.create({
      specVersionId: v6.id,
      siteProfileId: null,
      documentVersionIds: [s.damagedVersionId],
      modelJudge: 'claude-opus-5',
      promptVersion: 'judge.v2',
      status: 'done',
    });

    const target: LibraryDeleteTarget = { kind: 'specification', id: s.specificationId };
    const shown = libraryDeleteImpact(db, target)!;
    expect(shown.title).toBe('Tesco Ornamental Plant Standard');
    expect(shown.versions).toBe(2);
    expect(shown.clauses).toBe(6);
    expect(shown.runs.map((r) => r.id).sort()).toEqual([s.runId, run6.id].sort());
    expect(shown.filesToRemove).toBe(2);
    expect(shown.bytesToFree).toBe(1024 + 2048);

    const before = snapshot();
    const done = await deleteFromLibrary(deps(), target);
    const after = snapshot();

    expect(done).toEqual(shown);
    expect(before.specifications - after.specifications).toBe(1);
    expect(before.specVersions - after.specVersions).toBe(shown.versions);
    expect(before.clauses - after.clauses).toBe(shown.clauses);
    expect(before.runs - after.runs).toBe(shown.runs.length);
    expect(before.findings - after.findings).toBe(shown.findings);
    expect(before.reviews - after.reviews).toBe(shown.reviewedFindings);
    expect(before.blobs - after.blobs).toBe(shown.filesToRemove);
    expect(after.spend).toBe(before.spend);
    expect(fkViolations()).toEqual([]);
  });

  it('специфікація без версій теж видаляється', async () => {
    const empty = db.specs.create({ name: 'Порожній стандарт' });
    const impact = await deleteFromLibrary(deps(), { kind: 'specification', id: empty.id });
    expect(impact).toMatchObject({ versions: 0, runs: [], deletesParent: true, filesToRemove: 0 });
    expect(db.specs.get(empty.id)).toBeNull();
  });
});

describe('видалення документа', () => {
  it('версія документа забирає перевірку з іншими документами повністю й каже про це', async () => {
    const shown = libraryDeleteImpact(db, { kind: 'documentVersion', id: s.pestVersionId })!;
    expect(shown.runs[0]?.otherDocuments).toBe(1);
    const before = snapshot();

    const done = await deleteFromLibrary(deps(), { kind: 'documentVersion', id: s.pestVersionId });

    const after = snapshot();
    expect(done).toEqual(shown);
    // Остання версія → документ теж зник.
    expect(db.documents.get(s.pestDocId)).toBeNull();
    // Перевірка неподільна: findings по «Damaged Products» зникли разом із нею.
    expect(db.runs.get(s.runId)).toBeNull();
    expect(after.findings).toBe(0);
    // Сам інший документ і стандарт лишились.
    expect(db.documents.get(s.damagedDocId)?.versions).toHaveLength(1);
    expect(db.specs.getVersion(s.specVersionId)?.clauseCount).toBe(5);
    expect(before.profiles - after.profiles).toBe(shown.documentProfiles);
    expect(before.blobs - after.blobs).toBe(1);
    expect(after.spend).toBe(before.spend);
    expect(fkViolations()).toEqual([]);
  });

  it('одна з кількох версій — документ лишається', async () => {
    db.blobs.insert({ hash: hash('e'), relPath: `ee/ee/${hash('e')}.pdf`, byteSize: 512, mime: 'application/pdf' });
    const v3 = db.documents.addVersion({ documentId: s.pestDocId, versionLabel: '003', blobHash: hash('e') });

    const impact = await deleteFromLibrary(deps(), { kind: 'documentVersion', id: v3.id });

    expect(impact).toMatchObject({ deletesParent: false, runs: [], findings: 0, filesToRemove: 1, bytesToFree: 512 });
    expect(db.documents.get(s.pestDocId)?.versions.map((v) => v.id)).toEqual([s.pestVersionId]);
    expect(db.runs.get(s.runId)).not.toBeNull();
    expect(fkViolations()).toEqual([]);
  });

  it('цілий документ; файл, спільний з іншим документом, лишається на диску', async () => {
    // Той самий файл «Pest Management» імпортовано ще як окремий документ.
    const twin = db.documents.create({ title: 'Pest Management (копія)', docNumber: '0068-A', kind: 'sop' });
    db.documents.addVersion({ documentId: twin.id, versionLabel: '001', blobHash: hash('b') });
    const pestFile = writeBlobFile(db.blobs.get(hash('b')));

    const impact = await deleteFromLibrary(deps(), { kind: 'document', id: twin.id });

    expect(impact).toMatchObject({
      title: '0068-A Pest Management (копія)',
      deletesParent: true,
      versions: 1,
      runs: [],
      filesToRemove: 0,
      sharedFilesKept: 1,
    });
    expect(db.documents.get(twin.id)).toBeNull();
    expect(db.blobs.exists(hash('b'))).toBe(true);
    expect(existsSync(pestFile)).toBe(true);
    expect(db.runs.get(s.runId)).not.toBeNull();
    expect(fkViolations()).toEqual([]);
  });

  it('прибирає й кеш екстракції на диску, якщо він є', async () => {
    const pest = db.blobs.get(hash('b'))!;
    const blobFile = writeBlobFile(pest);
    const cached = join(extractedDir(), pest.hash.slice(0, 2), pest.hash.slice(2, 4), `${pest.hash}.json`);
    mkdirSync(dirname(cached), { recursive: true });
    writeFileSync(cached, '{}');

    await deleteFromLibrary(deps(), { kind: 'document', id: s.pestDocId });

    expect(existsSync(blobFile)).toBe(false);
    expect(existsSync(cached)).toBe(false);
  });
});

describe('живі перевірки', () => {
  it('спершу зупиняються, потім видаляються', async () => {
    db.runs.setStatus(s.runId, 'running');
    const order: string[] = [];
    const impact = await deleteFromLibrary(
      deps({
        cancelRun: async (runId) => {
          order.push(`cancel ${runId}`);
          // Під час зупинки рядок ще мусить існувати.
          expect(db.runs.get(runId)).not.toBeNull();
          db.runs.setStatus(runId, 'cancelled');
        },
      }),
      { kind: 'document', id: s.pestDocId },
    );
    expect(order).toEqual([`cancel ${s.runId}`]);
    expect(impact?.runs.map((r) => r.id)).toEqual([s.runId]);
    expect(db.runs.get(s.runId)).toBeNull();
  });

  it('завершені й призупинені перевірки не зупиняються', async () => {
    db.runs.setStatus(s.runId, 'paused');
    await deleteFromLibrary(deps(), { kind: 'specVersion', id: s.specVersionId });
    expect(cancelled).toEqual([]);
  });

  it('помилка зупинки нічого не видаляє', async () => {
    db.runs.setStatus(s.runId, 'running');
    const before = snapshot();
    await expect(
      deleteFromLibrary(
        deps({
          cancelRun: async () => {
            throw new Error('оркестратор недоступний');
          },
        }),
        { kind: 'specVersion', id: s.specVersionId },
      ),
    ).rejects.toThrow('оркестратор недоступний');
    expect(snapshot()).toEqual(before);
  });

  it('перевірка, що стартувала під час видалення, теж видаляється й зупиняється', async () => {
    db.runs.setStatus(s.runId, 'running');
    let late = 0;
    const impact = await deleteFromLibrary(
      deps({
        cancelRun: async (runId) => {
          cancelled.push(runId);
          db.runs.setStatus(runId, 'cancelled');
          // Поки зупиняли першу, хтось запустив ще одну за тією ж версією.
          if (late === 0) {
            late = db.runs.create({
              specVersionId: s.specVersionId,
              siteProfileId: null,
              documentVersionIds: [s.damagedVersionId],
              modelJudge: 'claude-opus-5',
              promptVersion: 'judge.v2',
              status: 'running',
            }).id;
          }
        },
      }),
      { kind: 'specVersion', id: s.specVersionId },
    );
    expect(impact?.runs.map((r) => r.id).sort()).toEqual([s.runId, late].sort());
    expect(cancelled).toEqual([s.runId, late]);
    expect(db.runs.get(late)).toBeNull();
    expect(fkViolations()).toEqual([]);
  });
});

describe('стійкість', () => {
  it('findings і докази, що посилаються на ціль поза зв’язком перевірки, не валять транзакцію', async () => {
    // Перевірка за іншою версією стандарту, без «Pest Management» серед документів,
    // але з finding на клаузулу v5.0 і доказом із версії «Pest Management».
    // Таких даних конвеєр не пише, але FK їх дозволяє — і видалення має витримати.
    db.blobs.insert({ hash: hash('d'), relPath: `dd/dd/${hash('d')}.pdf`, byteSize: 2048, mime: 'application/pdf' });
    const v6 = db.specs.addVersion({ specificationId: s.specificationId, versionLabel: '6.0', blobHash: hash('d') });
    const odd = db.runs.create({
      specVersionId: v6.id,
      siteProfileId: null,
      documentVersionIds: [s.damagedVersionId],
      modelJudge: 'claude-opus-5',
      promptVersion: 'judge.v2',
      status: 'done',
    });
    db.findings.upsert({
      runId: odd.id,
      clauseId: s.clauseIds['14.1']!,
      documentVersionId: s.damagedVersionId,
      verdict: 'compliant',
      rationale: 'ok',
      evidence: [{ documentVersionId: s.pestVersionId, quote: 'q', source: 'model_quote' }],
    });

    const bySpec = libraryDeleteImpact(db, { kind: 'specVersion', id: s.specVersionId })!;
    expect(bySpec.runs.map((r) => r.id)).toContain(odd.id);
    const byDoc = libraryDeleteImpact(db, { kind: 'document', id: s.pestDocId })!;
    expect(byDoc.runs.map((r) => r.id)).toContain(odd.id);

    await deleteFromLibrary(deps(), { kind: 'document', id: s.pestDocId });
    expect(db.runs.get(odd.id)).toBeNull();
    expect(fkViolations()).toEqual([]);
  });

  it('файл, який не вдалося стерти, не валить видалення — лише пише в лог', async () => {
    const removeBlobFile = vi.fn(async () => {
      throw new Error('EBUSY: файл відкрито в іншій програмі');
    });
    const impact = await deleteFromLibrary(deps({ removeBlobFile }), { kind: 'specVersion', id: s.specVersionId });

    expect(removeBlobFile).toHaveBeenCalledTimes(1);
    expect(impact?.filesToRemove).toBe(1);
    expect(db.specs.get(s.specificationId)).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]?.[0])).toContain(`${s.specBlob}.pdf`);
  });

  it('файл не стирається, якщо той самий блоб устигли імпортувати знову', async () => {
    const removeBlobFile = vi.fn(async (blob: BlobDto) => {
      void blob;
    });
    const custom = deps({
      removeBlobFile,
      cancelRun: async () => {},
    });
    // Імітуємо повторний імпорт одразу після коміту: перехоплюємо execute.
    const execute = db.libraryDeletion.execute.bind(db.libraryDeletion);
    vi.spyOn(db.libraryDeletion, 'execute').mockImplementation((target) => {
      const plan = execute(target);
      db.blobs.insert({ hash: s.specBlob, relPath: `aa/aa/${s.specBlob}.pdf`, byteSize: 1024, mime: 'application/pdf' });
      return plan;
    });

    await deleteFromLibrary(custom, { kind: 'specVersion', id: s.specVersionId });
    expect(removeBlobFile).not.toHaveBeenCalled();
  });

  it('повторне видалення вже видаленого — null, без змін', async () => {
    await deleteFromLibrary(deps(), { kind: 'document', id: s.pestDocId });
    const before = snapshot();
    expect(await deleteFromLibrary(deps(), { kind: 'document', id: s.pestDocId })).toBeNull();
    expect(snapshot()).toEqual(before);
  });
});
