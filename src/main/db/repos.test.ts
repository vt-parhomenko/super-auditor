import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type Db } from './index';
import { hash, requireId, seed, type SeedResult } from './fixtures';

let s: SeedResult;
let db: Db;

beforeEach(() => {
  s = seed();
  db = s.db;
});

afterEach(() => {
  db.close();
});

describe('blobs', () => {
  it('круговий рейс DTO ↔ рядок', () => {
    const created = db.blobs.insert({
      hash: hash('1'),
      relPath: '11/11/1111.pdf',
      byteSize: 4096,
      mime: 'application/pdf',
      createdAt: '2026-08-30T10:00:00.000Z',
    });
    expect(created.duplicate).toBe(false);
    expect(created.blob).toEqual({
      hash: hash('1'),
      relPath: '11/11/1111.pdf',
      byteSize: 4096,
      mime: 'application/pdf',
      createdAt: '2026-08-30T10:00:00.000Z',
    });
    expect(db.blobs.get(hash('1'))).toEqual(created.blob);
  });

  it('повторна вставка того самого хешу — duplicate, без нового рядка', () => {
    const before = db.blobs.list().length;
    const again = db.blobs.insert({
      hash: s.specBlob,
      relPath: 'інший/шлях.pdf',
      byteSize: 999,
      mime: 'text/plain',
    });
    expect(again.duplicate).toBe(true);
    expect(again.blob.byteSize).toBe(1024); // старі метадані збереглися
    expect(db.blobs.list()).toHaveLength(before);
  });

  it('не дає видалити блоб, на який посилаються', () => {
    expect(() => db.blobs.delete(s.specBlob)).toThrow(/FOREIGN KEY/i);
  });

  it('listOrphans бачить лише непов’язані блоби', () => {
    db.blobs.insert({ hash: hash('9'), relPath: '99/99/x.pdf', byteSize: 1, mime: 'application/pdf' });
    expect(db.blobs.listOrphans().map((b) => b.hash)).toEqual([hash('9')]);
  });
});

describe('extractions', () => {
  it('круговий рейс разом зі сторінками', () => {
    const blobHash = hash('2');
    db.blobs.insert({ hash: blobHash, relPath: '22/22/x.pdf', byteSize: 10, mime: 'application/pdf' });

    const dto = db.extractions.insert({
      blobHash,
      method: 'ocr',
      toolVersion: 'tesseract-5',
      text: 'abcdefghij',
      pageCount: 2,
      quality: 0.42,
      pages: [
        { pageNo: 1, charStart: 0, charEnd: 5 },
        { pageNo: 2, charStart: 5, charEnd: 10 },
      ],
      createdAt: '2026-08-30T11:00:00.000Z',
    });

    expect(dto).toEqual({
      id: dto.id,
      blobHash,
      method: 'ocr',
      toolVersion: 'tesseract-5',
      text: 'abcdefghij',
      pageCount: 2,
      charCount: 10,
      quality: 0.42,
      pages: [
        { pageNo: 1, charStart: 0, charEnd: 5 },
        { pageNo: 2, charStart: 5, charEnd: 10 },
      ],
      createdAt: '2026-08-30T11:00:00.000Z',
    });
    expect(db.extractions.get(dto.id)).toEqual(dto);
  });

  it('getMeta не тягне текст, getText тягне тільки його', () => {
    const meta = db.extractions.getMeta(1);
    expect(meta).not.toBeNull();
    expect(meta && 'text' in meta).toBe(false);
    expect(db.extractions.getText(1)).toContain('Tesco');
  });

  it('UNIQUE (blob_hash, method, tool_version)', () => {
    expect(() =>
      db.extractions.insert({
        blobHash: s.specBlob,
        method: 'pdfjs',
        toolVersion: 'pdfjs-6.3.289',
        text: 'дубль',
      }),
    ).toThrow(/UNIQUE/i);

    const upserted = db.extractions.upsert({
      blobHash: s.specBlob,
      method: 'pdfjs',
      toolVersion: 'pdfjs-6.3.289',
      text: 'дубль',
    });
    expect(upserted.text).toContain('Tesco');
  });

  it('pageAtOffset знаходить сторінку за офсетом', () => {
    const specExtraction = db.extractions.best(s.specBlob);
    expect(specExtraction).not.toBeNull();
    const id = specExtraction?.id ?? 0;
    expect(db.extractions.pageAtOffset(id, 5)).toBe(1);
    expect(db.extractions.pageAtOffset(id, 25)).toBe(2);
    expect(db.extractions.pageAtOffset(id, 500)).toBeNull();
  });

  it('replacePages перезаписує прив’язку цілком', () => {
    const id = db.extractions.best(s.specBlob)?.id ?? 0;
    db.extractions.replacePages(id, [{ pageNo: 1, charStart: 0, charEnd: 40 }]);
    expect(db.extractions.pages(id)).toEqual([{ pageNo: 1, charStart: 0, charEnd: 40 }]);
  });

  it('видалення екстракції каскадно чистить extraction_page', () => {
    const blobHash = hash('3');
    db.blobs.insert({ hash: blobHash, relPath: '33/33/x.pdf', byteSize: 1, mime: 'application/pdf' });
    const dto = db.extractions.insert({
      blobHash,
      method: 'vision',
      toolVersion: 'v1',
      text: 'xy',
      pages: [{ pageNo: 1, charStart: 0, charEnd: 2 }],
    });
    db.extractions.delete(dto.id);
    expect(db.extractions.pages(dto.id)).toEqual([]);
  });
});

describe('documents', () => {
  it('круговий рейс документа з версіями', () => {
    const doc = db.documents.get(s.pestDocId);
    expect(doc).toMatchObject({
      id: s.pestDocId,
      title: 'Pest Management',
      docNumber: '0068',
      processOwner: 'Warehouse & Production Manager',
      kind: 'sop',
    });
    expect(doc?.versions).toHaveLength(1);
    expect(doc?.versions[0]).toMatchObject({
      versionLabel: '002',
      lang: 'en',
      byteSize: 1024,
      pageCount: 3,
    });
  });

  it('list із фільтрами search і kind', () => {
    expect(db.documents.list().map((d) => d.docNumber)).toEqual(['0068', '0072']);
    expect(db.documents.list({ search: 'Damaged' }).map((d) => d.id)).toEqual([s.damagedDocId]);
    expect(db.documents.list({ search: '0068' }).map((d) => d.id)).toEqual([s.pestDocId]);
    expect(db.documents.list({ kind: 'policy' })).toEqual([]);
    // Спецсимволи LIKE трактуються буквально.
    expect(db.documents.list({ search: '%' })).toEqual([]);
  });

  it('list не робить N+1: версії приходять до кожного документа', () => {
    const all = db.documents.list();
    expect(all.every((d) => d.versions.length === 1)).toBe(true);
  });

  it('update патчить лише передані поля', () => {
    const updated = db.documents.update(s.pestDocId, { title: 'Pest Management (EN)' });
    expect(updated?.title).toBe('Pest Management (EN)');
    expect(updated?.docNumber).toBe('0068');

    const nulled = db.documents.update(s.pestDocId, { processOwner: null });
    expect(nulled?.processOwner).toBeNull();
  });

  it('UNIQUE (document_id, version_label)', () => {
    expect(() =>
      db.documents.addVersion({
        documentId: s.pestDocId,
        versionLabel: '002',
        blobHash: s.specBlob,
      }),
    ).toThrow(/UNIQUE/i);
  });

  it('видалення документа каскадно чистить версії й профілі', () => {
    const doc = db.documents.create({ title: 'Тимчасовий' });
    const version = db.documents.addVersion({
      documentId: doc.id,
      versionLabel: '001',
      blobHash: s.specBlob,
    });
    db.docProfiles.upsert({
      documentVersionId: version.id,
      summary: 'коротко',
      model: 'claude-haiku-4-5',
      promptVersion: 'doc_profile.v1',
    });

    expect(db.documents.delete(doc.id)).toBe(true);
    expect(db.documents.getVersion(version.id)).toBeNull();
    expect(db.docProfiles.getLatest(version.id)).toBeNull();
  });

  it('findVersionByBlob знаходить версію за хешем', () => {
    const version = db.documents.findVersionByBlob(hash('b'));
    expect(version?.id).toBe(s.pestVersionId);
  });
});

describe('specs', () => {
  it('круговий рейс специфікації з версіями й лічильниками вимог', () => {
    const spec = db.specs.get(s.specificationId);
    expect(spec).toMatchObject({
      name: 'Tesco Ornamental Plant Standard',
      issuer: 'Tesco Stores Ltd.',
      code: '20405',
      cloudAllowed: false,
    });
    expect(spec?.versions[0]).toMatchObject({
      versionLabel: '5.0',
      clausesStatus: 'reviewed',
      clauseCount: 5,
      reviewedClauseCount: 5,
    });
  });

  it('cloudAllowed зберігається як boolean (ADR-8)', () => {
    db.specs.setCloudAllowed(s.specificationId, true);
    expect(db.specs.get(s.specificationId)?.cloudAllowed).toBe(true);
    db.specs.setCloudAllowed(s.specificationId, false);
    expect(db.specs.get(s.specificationId)?.cloudAllowed).toBe(false);
  });

  it('UNIQUE (specification_id, version_label)', () => {
    expect(() =>
      db.specs.addVersion({
        specificationId: s.specificationId,
        versionLabel: '5.0',
        blobHash: s.specBlob,
      }),
    ).toThrow(/UNIQUE/i);
  });

  it('spec_summary: круговий рейс із JSON-полем sectionSummaries', () => {
    const summary = db.specs.upsertSummary({
      specVersionId: s.specVersionId,
      summary: 'Стандарт для декоративних рослин.',
      scope: 'Ornamental plants',
      gradingRules: '0 Critical + 1 Major → 3 Improvement needed',
      sectionSummaries: { '10': 'Pest management', '3': 'Responsible sourcing' },
      model: 'claude-sonnet-5',
      promptVersion: 'spec_summary.v1',
      createdAt: '2026-08-30T12:00:00.000Z',
    });

    expect(summary).toEqual({
      specVersionId: s.specVersionId,
      summary: 'Стандарт для декоративних рослин.',
      scope: 'Ornamental plants',
      gradingRules: '0 Critical + 1 Major → 3 Improvement needed',
      sectionSummaries: { '10': 'Pest management', '3': 'Responsible sourcing' },
      model: 'claude-sonnet-5',
      promptVersion: 'spec_summary.v1',
      createdAt: '2026-08-30T12:00:00.000Z',
    });

    expect(db.specs.getSummary(s.specVersionId)).toEqual(summary);
    expect(db.specs.gradingRules(s.specVersionId)).toContain('Improvement needed');

    // upsert перезаписує, а не дублює
    db.specs.upsertSummary({ specVersionId: s.specVersionId, summary: 'нове' });
    expect(db.specs.getSummary(s.specVersionId)?.summary).toBe('нове');
    expect(db.specs.getSummary(s.specVersionId)?.sectionSummaries).toEqual({});
  });

  it('isReviewed відображає clauses_status', () => {
    expect(db.specs.isReviewed(s.specVersionId)).toBe(true);
    db.specs.setClausesStatus(s.specVersionId, 'extracted');
    expect(db.specs.isReviewed(s.specVersionId)).toBe(false);
  });

  it('видалення версії спеки каскадно чистить вимоги й summary', () => {
    db.specs.upsertSummary({ specVersionId: s.specVersionId, summary: 'x' });
    db.runs.delete(s.runId); // finding → clause FK без каскаду, тому спершу прогін
    db.specs.deleteVersion(s.specVersionId);
    expect(db.clauses.list(s.specVersionId)).toEqual([]);
    expect(db.specs.getSummary(s.specVersionId)).toBeNull();
  });
});

describe('clauses', () => {
  it('круговий рейс із модулями-JSON і похідними полями', () => {
    const clause = db.clauses.get(requireId(s.clauseIds, '10.3'));
    expect(clause).toMatchObject({
      clauseNo: '10.3',
      sortKey: '010.003',
      sectionNo: '10',
      modules: ['P', 'R'],
      obligation: 'must',
      reviewStatus: 'confirmed',
    });
    expect(clause?.textHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('сортування за sortKey, а не лексикографічне', () => {
    expect(db.clauses.list(s.specVersionId).map((c) => c.clauseNo)).toEqual([
      '3.1',
      '10.1',
      '10.2',
      '10.3',
      '14.1',
    ]);
  });

  it('patch перераховує sortKey і textHash', () => {
    const id = requireId(s.clauseIds, '10.1');
    const before = db.clauses.get(id);

    const renumbered = db.clauses.patch(id, { clauseNo: '2.5' });
    expect(renumbered?.sortKey).toBe('002.005');
    expect(renumbered?.textHash).toBe(before?.textHash);

    const retexted = db.clauses.patch(id, { requirementText: 'Інша вимога.', reviewStatus: 'edited' });
    expect(retexted?.textHash).not.toBe(before?.textHash);
    expect(retexted?.reviewStatus).toBe('edited');
  });

  it('textHash не змінюється від пробілів і переносів', () => {
    const a = db.clauses.create(s.specVersionId, {
      clauseNo: '99.1',
      requirementText: 'A documented   programme\nmust exist.',
    });
    const b = db.clauses.create(s.specVersionId, {
      clauseNo: '99.2',
      requirementText: ' A documented programme must exist. ',
    });
    expect(a.textHash).toBe(b.textHash);
  });

  it('UNIQUE (spec_version_id, clause_no)', () => {
    expect(() =>
      db.clauses.create(s.specVersionId, { clauseNo: '10.1', requirementText: 'дубль' }),
    ).toThrow(/UNIQUE/i);
  });

  it('reviewCounts і sections', () => {
    expect(db.clauses.reviewCounts(s.specVersionId)).toEqual({
      auto: 0,
      confirmed: 5,
      edited: 0,
      flagged: 0,
    });
    expect(db.clauses.sections(s.specVersionId)).toEqual([
      { sectionNo: '3', sectionTitle: 'Responsible sourcing', clauseCount: 1 },
      { sectionNo: '10', sectionTitle: 'Pest management', clauseCount: 3 },
      { sectionNo: '14', sectionTitle: 'Environment', clauseCount: 1 },
    ]);
  });

  it('createMany вставляє пакетом', () => {
    const version = db.specs.addVersion({
      specificationId: s.specificationId,
      versionLabel: '4.0',
      blobHash: s.specBlob,
    });
    const count = db.clauses.createMany(version.id, [
      { clauseNo: '1.1', requirementText: 'Один' },
      { clauseNo: '1.2', requirementText: 'Два' },
    ]);
    expect(count).toBe(2);
    expect(db.clauses.count(version.id)).toBe(2);
  });

  it('видалення вимоги каскадно чистить clause_applicability', () => {
    const id = requireId(s.clauseIds, '14.1');
    expect(db.siteProfiles.getApplicability(s.siteProfileId, id)).not.toBeNull();
    db.clauses.delete(id);
    expect(db.siteProfiles.getApplicability(s.siteProfileId, id)).toBeNull();
  });
});

describe('siteProfiles', () => {
  it('круговий рейс із JSON-масивами', () => {
    const profile = db.siteProfiles.get(s.siteProfileId);
    expect(profile).toEqual({
      id: s.siteProfileId,
      name: 'Flowerbulbs BV',
      modules: ['P', 'R', 'O'],
      certifications: ['ISO14001'],
      products: ['flower bulbs'],
      processes: ['receiving', 'packing'],
      notes: null,
    });
  });

  it('save з id оновлює, без id — створює', () => {
    const created = db.siteProfiles.save({
      name: 'Друге виробництво',
      modules: ['P'],
      certifications: [],
      products: [],
      processes: [],
      notes: 'нотатка',
    });
    expect(created.id).not.toBe(s.siteProfileId);

    const updated = db.siteProfiles.save({ ...created, name: 'Перейменований' });
    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe('Перейменований');
    expect(db.siteProfiles.list()).toHaveLength(2);
  });

  it('applicable/overriddenByUser конвертуються в boolean', () => {
    const na = db.siteProfiles.getApplicability(s.siteProfileId, requireId(s.clauseIds, '14.1'));
    expect(na).toEqual({
      siteProfileId: s.siteProfileId,
      clauseId: requireId(s.clauseIds, '14.1'),
      applicable: false,
      reason: 'ISO 14001 покриває Environment/water/waste',
      overriddenByUser: false,
    });
  });

  it('перерахунок НЕ затирає ручне перевизначення користувача', () => {
    const clauseId = requireId(s.clauseIds, '14.1');
    db.siteProfiles.setOverride(s.siteProfileId, clauseId, true, 'аудитор наполіг');

    db.siteProfiles.recompute(s.siteProfileId, [
      { clauseId, applicable: false, reason: 'ISO 14001' },
    ]);

    const after = db.siteProfiles.getApplicability(s.siteProfileId, clauseId);
    expect(after?.applicable).toBe(true);
    expect(after?.overriddenByUser).toBe(true);
    expect(after?.reason).toBe('аудитор наполіг');

    db.siteProfiles.clearOverride(s.siteProfileId, clauseId);
    db.siteProfiles.recompute(s.siteProfileId, [
      { clauseId, applicable: false, reason: 'ISO 14001' },
    ]);
    expect(db.siteProfiles.getApplicability(s.siteProfileId, clauseId)?.applicable).toBe(false);
  });

  it('applicableClauseIds ріже незастосовні, а без профілю віддає всі', () => {
    const withProfile = db.siteProfiles.applicableClauseIds(s.specVersionId, s.siteProfileId);
    expect(withProfile).toHaveLength(4);
    expect(withProfile).not.toContain(requireId(s.clauseIds, '14.1'));

    expect(db.siteProfiles.applicableClauseIds(s.specVersionId, null)).toHaveLength(5);
    expect(db.siteProfiles.countApplicable(s.specVersionId, s.siteProfileId)).toBe(4);
  });

  it('recompute повертає лічильники', () => {
    const profile = db.siteProfiles.save({
      name: 'Чистий',
      modules: ['P'],
      certifications: [],
      products: [],
      processes: [],
      notes: null,
    });
    const counts = db.siteProfiles.recompute(profile.id, [
      { clauseId: requireId(s.clauseIds, '10.1'), applicable: true, reason: 'in scope' },
      { clauseId: requireId(s.clauseIds, '3.1'), applicable: false, reason: 'SMETA' },
    ]);
    expect(counts).toEqual({ applicable: 1, notApplicable: 1 });
  });

  it('видалення профілю каскадно чистить applicability', () => {
    const profile = db.siteProfiles.save({
      name: 'На видалення',
      modules: ['P'],
      certifications: [],
      products: [],
      processes: [],
      notes: null,
    });
    db.siteProfiles.recompute(profile.id, [
      { clauseId: requireId(s.clauseIds, '10.1'), applicable: true, reason: 'in scope' },
    ]);
    expect(db.siteProfiles.listApplicability(profile.id)).toHaveLength(1);

    db.siteProfiles.delete(profile.id);
    expect(db.siteProfiles.listApplicability(profile.id)).toEqual([]);
  });

  it('профіль, на який посилається прогін, не видаляється мовчки', () => {
    // audit_run.site_profile_id — FK без ON DELETE (схема з architecture.md §5).
    expect(() => db.siteProfiles.delete(s.siteProfileId)).toThrow(/FOREIGN KEY/i);
    db.runs.delete(s.runId);
    expect(db.siteProfiles.delete(s.siteProfileId)).toBe(true);
  });
});

describe('docProfiles', () => {
  it('круговий рейс із JSON-полями', () => {
    const profile = db.docProfiles.upsert({
      documentVersionId: s.pestVersionId,
      summary: 'SOP щодо контролю шкідників.',
      docType: 'sop',
      processes: ['pest control'],
      candidateClauses: ['10.1', '10.3'],
      model: 'claude-haiku-4-5',
      promptVersion: 'doc_profile.v1',
      createdAt: '2026-08-30T13:00:00.000Z',
    });

    expect(profile).toEqual({
      id: profile.id,
      documentVersionId: s.pestVersionId,
      summary: 'SOP щодо контролю шкідників.',
      docType: 'sop',
      processes: ['pest control'],
      candidateClauses: ['10.1', '10.3'],
      model: 'claude-haiku-4-5',
      promptVersion: 'doc_profile.v1',
      createdAt: '2026-08-30T13:00:00.000Z',
    });
    expect(db.docProfiles.getLatest(s.pestVersionId)).toEqual(profile);
  });

  it('upsert ідемпотентний за (версія, модель, промпт)', () => {
    const first = db.docProfiles.upsert({
      documentVersionId: s.pestVersionId,
      summary: 'перший',
      model: 'm',
      promptVersion: 'v1',
    });
    const second = db.docProfiles.upsert({
      documentVersionId: s.pestVersionId,
      summary: 'другий',
      model: 'm',
      promptVersion: 'v1',
    });
    expect(second.id).toBe(first.id);
    expect(second.summary).toBe('другий');
    expect(db.docProfiles.listFor(s.pestVersionId)).toHaveLength(1);
  });

  it('різні промпти співіснують', () => {
    db.docProfiles.upsert({ documentVersionId: s.pestVersionId, summary: 'a', model: 'm', promptVersion: 'v1' });
    db.docProfiles.upsert({ documentVersionId: s.pestVersionId, summary: 'b', model: 'm', promptVersion: 'v2' });
    expect(db.docProfiles.listFor(s.pestVersionId)).toHaveLength(2);
  });

  it('latestFor віддає найсвіжіший на кожну версію одним запитом', () => {
    db.docProfiles.upsert({
      documentVersionId: s.pestVersionId,
      summary: 'старий',
      model: 'm',
      promptVersion: 'v1',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    db.docProfiles.upsert({
      documentVersionId: s.pestVersionId,
      summary: 'новий',
      model: 'm',
      promptVersion: 'v2',
      createdAt: '2026-06-01T00:00:00.000Z',
    });
    db.docProfiles.upsert({
      documentVersionId: s.damagedVersionId,
      summary: 'інший документ',
      model: 'm',
      promptVersion: 'v1',
    });

    const map = db.docProfiles.latestFor([s.pestVersionId, s.damagedVersionId]);
    expect(map.get(s.pestVersionId)?.summary).toBe('новий');
    expect(map.get(s.damagedVersionId)?.summary).toBe('інший документ');
  });
});

describe('llmCache', () => {
  it('круговий рейс із розпакуванням response', () => {
    const dto = db.llmCache.put({
      cacheKey: 'k1',
      stage: 'judge',
      provider: 'anthropic',
      model: 'claude-opus-5',
      promptVersion: 'judge.v1',
      response: { findings: [{ clauseNo: '10.1', verdict: 'compliant' }] },
      inputTokens: 42_000,
      cachedTokens: 40_000,
      outputTokens: 900,
      costUsd: 0.031,
      latencyMs: 4200,
      createdAt: '2026-08-30T14:00:00.000Z',
    });

    expect(dto).toEqual({
      cacheKey: 'k1',
      stage: 'judge',
      provider: 'anthropic',
      model: 'claude-opus-5',
      promptVersion: 'judge.v1',
      response: { findings: [{ clauseNo: '10.1', verdict: 'compliant' }] },
      inputTokens: 42_000,
      cachedTokens: 40_000,
      outputTokens: 900,
      costUsd: 0.031,
      latencyMs: 4200,
      createdAt: '2026-08-30T14:00:00.000Z',
    });
    expect(db.llmCache.get('k1')).toEqual(dto);
    expect(db.llmCache.has('k1')).toBe(true);
    expect(db.llmCache.has('нема')).toBe(false);
  });

  it('put за тим самим ключем перезаписує', () => {
    db.llmCache.put({ cacheKey: 'k', stage: 'judge', provider: 'p', model: 'm', promptVersion: 'v', response: 1 });
    db.llmCache.put({ cacheKey: 'k', stage: 'judge', provider: 'p', model: 'm', promptVersion: 'v', response: 2 });
    expect(db.llmCache.get('k')?.response).toBe(2);
    expect(db.llmCache.totals().calls).toBe(1);
  });

  it('агрегати вартості по етапах', () => {
    db.llmCache.put({ cacheKey: 'a', stage: 'judge', provider: 'p', model: 'm', promptVersion: 'v', response: null, inputTokens: 10, outputTokens: 1, costUsd: 0.5 });
    db.llmCache.put({ cacheKey: 'b', stage: 'judge', provider: 'p', model: 'm', promptVersion: 'v', response: null, inputTokens: 20, outputTokens: 2, costUsd: 1.5 });
    db.llmCache.put({ cacheKey: 'c', stage: 'critic', provider: 'p', model: 'm', promptVersion: 'v', response: null, inputTokens: 5, costUsd: 0.1 });

    expect(db.llmCache.totalsForStage('judge')).toEqual({
      calls: 2,
      inputTokens: 30,
      cachedTokens: 0,
      outputTokens: 3,
      costUsd: 2,
    });
    expect(db.llmCache.totals().calls).toBe(3);
    expect(db.llmCache.deleteByPromptVersion('judge', 'v')).toBe(2);
    expect(db.llmCache.totals().calls).toBe(1);
  });
});

describe('settings', () => {
  it('дефолти, якщо нічого не збережено', () => {
    const clean = createTestDb();
    expect(clean.settings.get()).toEqual({
      routing: {},
      concurrency: 3,
      localOnly: false,
      theme: 'system',
      // Порожньо = висновки мовою стандарту.
      resultsLanguage: '',
    });
    clean.close();
  });

  it('частковий патч не затирає інші поля', () => {
    db.settings.set({ concurrency: 8, theme: 'dark' });
    db.settings.set({ localOnly: true });

    expect(db.settings.get()).toEqual({
      routing: {},
      concurrency: 8,
      localOnly: true,
      theme: 'dark',
      resultsLanguage: '',
    });
  });

  it('routing зберігається як структура, а не рядок', () => {
    db.settings.set({
      routing: { judge: { provider: 'anthropic', model: 'claude-opus-5', effort: 'high' } },
    });
    expect(db.settings.get().routing).toEqual({
      judge: { provider: 'anthropic', model: 'claude-opus-5', effort: 'high' },
    });
  });

  it('concurrency обмежується розумним діапазоном', () => {
    expect(db.settings.set({ concurrency: 0 }).concurrency).toBe(1);
    expect(db.settings.set({ concurrency: 999 }).concurrency).toBe(16);
  });

  it('битий JSON у сховищі не валить читання', () => {
    db.raw.prepare("INSERT INTO app_setting (key, value) VALUES ('theme', 'не json')").run();
    expect(db.settings.get().theme).toBe('system');
  });

  it('довільні ключі', () => {
    db.settings.setRaw('lastRunId', 42);
    expect(db.settings.getRaw<number>('lastRunId')).toBe(42);
    expect(db.settings.deleteRaw('lastRunId')).toBe(true);
    expect(db.settings.getRaw('lastRunId')).toBeUndefined();
  });
});

describe('runs — базовий круговий рейс', () => {
  it('прогін із набором документів', () => {
    const run = db.runs.get(s.runId);
    expect(run).toMatchObject({
      label: 'M3 повний прогін',
      specVersionId: s.specVersionId,
      siteProfileId: s.siteProfileId,
      status: 'queued',
      modelJudge: 'claude-opus-5',
      modelCritic: 'claude-opus-5',
      promptVersion: 'judge.v1',
      error: null,
    });
    expect(run?.documentVersionIds).toEqual([s.pestVersionId, s.damagedVersionId].sort((a, b) => a - b));
    expect(run?.usage).toEqual({ inputTokens: 0, cachedTokens: 0, outputTokens: 0, costUsd: 0 });
  });

  it('статуси й таймстемпи', () => {
    db.runs.markStarted(s.runId, '2026-08-30T15:00:00.000Z');
    expect(db.runs.get(s.runId)?.status).toBe('running');
    expect(db.runs.get(s.runId)?.startedAt).toBe('2026-08-30T15:00:00.000Z');

    // повторний старт не перезаписує startedAt (resume після паузи)
    db.runs.markStarted(s.runId, '2026-08-30T16:00:00.000Z');
    expect(db.runs.get(s.runId)?.startedAt).toBe('2026-08-30T15:00:00.000Z');

    db.runs.markFinished(s.runId, 'failed', 'обірвалось', '2026-08-30T17:00:00.000Z');
    const run = db.runs.get(s.runId);
    expect(run).toMatchObject({
      status: 'failed',
      finishedAt: '2026-08-30T17:00:00.000Z',
      error: 'обірвалось',
    });
  });

  it('addUsage накопичує вартість', () => {
    db.runs.addUsage(s.runId, { inputTokens: 1000, cachedTokens: 900, outputTokens: 100, costUsd: 0.01 });
    db.runs.addUsage(s.runId, { inputTokens: 500, costUsd: 0.005 });
    expect(db.runs.usage(s.runId)).toEqual({
      inputTokens: 1500,
      cachedTokens: 900,
      outputTokens: 100,
      costUsd: 0.015,
    });
  });

  it('list повертає прогони з наборами документів', () => {
    const runs = db.runs.list();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.documentVersionIds).toHaveLength(2);
  });

  it('видалення прогону каскадно чистить документи, завдання й findings', () => {
    db.runTasks.enqueue(s.runId, { stage: 'judge', payload: { clauseIds: [1] } });
    db.findings.upsert({
      runId: s.runId,
      clauseId: requireId(s.clauseIds, '10.1'),
      documentVersionId: s.pestVersionId,
      verdict: 'compliant',
      rationale: 'ок',
      evidence: [{ documentVersionId: s.pestVersionId, quote: 'q', source: 'citations_api', verified: true }],
    });

    expect(db.runs.delete(s.runId)).toBe(true);
    expect(db.runs.documentVersionIds(s.runId)).toEqual([]);
    expect(db.runTasks.list(s.runId)).toEqual([]);
    expect(db.findings.listByRun(s.runId)).toEqual([]);
    expect(
      db.raw.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM finding_evidence').get()?.n,
    ).toBe(0);
  });
});
