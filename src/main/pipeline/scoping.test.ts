import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type Db } from '@main/db';
import { mainMessages } from '@main/i18n';
import type { CompleteRequest, CompleteResult, LlmProvider } from '@main/llm';
import { scopeDocuments } from './scoping';
import { executeRun, planRun } from './runEngine';

const DOC_TEXT = 'Pest Management 0068. Our building is checked monthly for pests by Attack.';
const MODELS = { judge: 'fake-judge', critic: null, promptVersion: 'judge.v1' };

let db: Db;
let specVersionId: number;
let docA: number;
let docB: number;

function provider(
  candidates: Record<number, string[]> | string[],
  opts: { fail?: boolean } = {},
): LlmProvider & { calls: number } {
  const p = {
    id: 'fake',
    label: 'Fake',
    models: ['fake-model'],
    calls: 0,
    caps: {
      contextWindow: 200_000,
      promptCaching: false,
      structuredOutput: 'schema' as const,
      citations: false,
      documentInput: [] as Array<'pdf' | 'text'>,
      maxOutputTokens: 8000,
      cloud: false,
    },
    isConfigured: () => true,
    async complete<T>(req: CompleteRequest<T>): Promise<CompleteResult<T>> {
      p.calls += 1;
      if (opts.fail) throw new Error('профайлер недоступний');

      // Визначаємо документ за назвою будь-де в запиті (промпт може класти її
      // і в кешований префікс, і в user-повідомлення) — так тест не залежить
      // ані від порядку викликів, ані від внутрішньої будови промпта.
      const text = [req.system, req.cachedPrefix, ...req.messages.map((m) => m.content)]
        .filter(Boolean)
        .join('\n');
      const list = Array.isArray(candidates)
        ? candidates
        : (candidates[text.includes('Друга') ? docB : docA] ?? []);

      return {
        data: {
          summary: 'SOP про боротьбу зі шкідниками.',
          docType: 'sop',
          docNumber: '0068',
          versionLabel: '002',
          processes: ['pest control'],
          candidateClauses: list,
        } as T,
        citations: [],
        usage: { input: 500, cachedInput: 0, cacheWrite: 0, output: 100 },
        costUsd: 0.001,
        modelId: 'fake-model',
        providerId: 'fake',
        latencyMs: 1,
        raw: null,
        fromCache: false,
      };
    },
  };
  return p;
}

beforeEach(() => {
  db = createTestDb();
  db.blobs.insert({ hash: 'a'.repeat(64), relPath: 'aa/aa/d.pdf', byteSize: 10, mime: 'application/pdf' });
  db.blobs.insert({ hash: 'b'.repeat(64), relPath: 'bb/bb/s.pdf', byteSize: 10, mime: 'application/pdf' });

  const ex = db.extractions.insert({
    blobHash: 'a'.repeat(64),
    method: 'pdfjs',
    toolVersion: 't',
    text: DOC_TEXT,
    pageCount: 1,
    pages: [{ pageNo: 1, charStart: 0, charEnd: DOC_TEXT.length }],
  });

  const d1 = db.documents.create({ title: 'Pest Management' });
  docA = db.documents.addVersion({ documentId: d1.id, versionLabel: '002', blobHash: 'a'.repeat(64), extractionId: ex.id }).id;
  const d2 = db.documents.create({ title: 'Друга інструкція' });
  docB = db.documents.addVersion({ documentId: d2.id, versionLabel: '001', blobHash: 'a'.repeat(64), extractionId: ex.id }).id;

  const spec = db.specs.create({ name: 'Tesco', code: '20405' });
  specVersionId = db.specs.addVersion({ specificationId: spec.id, versionLabel: '5.0', blobHash: 'b'.repeat(64) }).id;

  db.clauses.createMany(specVersionId, [
    { clauseNo: '1.1', sectionNo: '1', sectionTitle: 'Leadership', topic: 'Policy', requirementText: 'A policy must exist.', obligation: 'must' },
    { clauseNo: '1.2', sectionNo: '1', sectionTitle: 'Leadership', topic: 'Org chart', requirementText: 'An org chart must exist.', obligation: 'must' },
    { clauseNo: '10.1', sectionNo: '10', sectionTitle: 'Pest management', topic: 'Provider', requirementText: 'A competent provider must be used.', obligation: 'must' },
    { clauseNo: '23.1', sectionNo: '23', sectionTitle: 'Transport', topic: 'Vehicles', requirementText: 'Vehicles must be clean.', obligation: 'must' },
  ]);
});

describe('scopeDocuments', () => {
  it('звужує перевірку до секцій, названих профілем документа', async () => {
    const scope = await scopeDocuments(db, provider(['10.1']), specVersionId, [docA]);

    expect(scope.get(docA)?.sections).toEqual(new Set(['10']));
    expect(scope.get(docA)?.source).toBe('profile');
  });

  it('кілька вимог з різних секцій дають кілька секцій', async () => {
    const scope = await scopeDocuments(db, provider(['1.1', '10.1']), specVersionId, [docA]);
    expect(scope.get(docA)?.sections).toEqual(new Set(['1', '10']));
  });

  it('порожній профіль НЕ означає «не перевіряти нічого»', async () => {
    const scope = await scopeDocuments(db, provider([]), specVersionId, [docA]);

    expect(scope.get(docA)?.source).toBe('fallback');
    expect(scope.get(docA)?.sections).toEqual(new Set(['1', '10', '23']));
  });

  it('невідомі номери вимог ігноруються, але не обнуляють scope', async () => {
    const scope = await scopeDocuments(db, provider(['99.9', '10.1']), specVersionId, [docA]);
    expect(scope.get(docA)?.sections).toEqual(new Set(['10']));
  });

  it("режим 'all' не звертається до моделі взагалі", async () => {
    const p = provider(['10.1']);
    const scope = await scopeDocuments(db, p, specVersionId, [docA], { mode: 'all' });

    expect(p.calls).toBe(0);
    expect(scope.get(docA)?.source).toBe('all');
    expect(scope.get(docA)?.sections.size).toBe(3);
  });

  it('профіль кешується — повторний виклик не платить удруге', async () => {
    const p = provider(['10.1']);
    await scopeDocuments(db, p, specVersionId, [docA]);
    await scopeDocuments(db, p, specVersionId, [docA]);

    expect(p.calls).toBe(1);
    expect(db.docProfiles.getLatest(docA)?.candidateClauses).toEqual(['10.1']);
  });

  it('кожен документ отримує власний scope', async () => {
    const scope = await scopeDocuments(
      db,
      provider({ [docA]: ['10.1'], [docB]: ['23.1'] }),
      specVersionId,
      [docA, docB],
    );

    expect(scope.get(docA)?.sections).toEqual(new Set(['10']));
    expect(scope.get(docB)?.sections).toEqual(new Set(['23']));
  });

  it('падіння профайлера не ковтається мовчки', async () => {
    await expect(
      scopeDocuments(db, provider([], { fail: true }), specVersionId, [docA]),
    ).rejects.toThrow('профайлер недоступний');
  });
});

describe('planRun зі scope', () => {
  it('створює завдання лише для релевантних секцій', () => {
    const plan = planRun(
      db,
      { specVersionId, siteProfileId: null, documentVersionIds: [docA] },
      MODELS,
      { scope: new Map([[docA, new Set(['10'])]]) },
    );

    expect(plan.tasks).toBe(1); // лише секція 10
    expect(plan.skippedOutOfScope).toBe(3); // 1.1, 1.2, 23.1
  });

  it('вимоги поза scope одразу отримують not_addressed із поясненням', () => {
    const plan = planRun(
      db,
      { specVersionId, siteProfileId: null, documentVersionIds: [docA] },
      MODELS,
      { scope: new Map([[docA, new Set(['10'])]]) },
    );

    const findings = db.findings.listByRun(plan.runId);
    expect(findings).toHaveLength(3);

    for (const f of findings) {
      expect(f.verdict).toBe('not_addressed');
      // severity лишається порожньою — інакше оцінка за шкалою стандарту зламається
      expect(f.severity).toBeNull();
      // Мова результатів не задана (мовою стандарту) → позначка англійською.
      expect(f.rationale).toBe(mainMessages('en').results.outOfScope);
      expect(f.evidence).toEqual([]);
    }
  });

  it('документ без запису у scope перевіряється повністю', () => {
    const plan = planRun(
      db,
      { specVersionId, siteProfileId: null, documentVersionIds: [docA, docB] },
      MODELS,
      { scope: new Map([[docA, new Set(['10'])]]) },
    );

    // docA: 1 завдання; docB: усі 3 секції
    expect(plan.tasks).toBe(4);
    expect(plan.skippedOutOfScope).toBe(3);
  });

  it('без scope поведінка не змінюється', () => {
    const plan = planRun(
      db,
      { specVersionId, siteProfileId: null, documentVersionIds: [docA] },
      MODELS,
    );

    expect(plan.tasks).toBe(3);
    expect(plan.skippedOutOfScope).toBe(0);
    expect(db.findings.listByRun(plan.runId)).toEqual([]);
  });
});

describe('severity не рахується для not_addressed', () => {
  it('оцінка не псується вимогами, яких документ не стосується', async () => {
    const plan = planRun(
      db,
      { specVersionId, siteProfileId: null, documentVersionIds: [docA] },
      MODELS,
      { scope: new Map([[docA, new Set(['10'])]]) },
    );

    // Додаємо одну справжню невідповідність.
    db.findings.upsert({
      runId: plan.runId,
      clauseId: db.clauses.getByNo(specVersionId, '10.1')!.id,
      documentVersionId: docA,
      verdict: 'partial',
      severity: 'major',
      rationale: 'частково',
      evidence: [],
    });

    // І одну not_addressed із severity — як робить модель.
    db.findings.upsert({
      runId: plan.runId,
      clauseId: db.clauses.getByNo(specVersionId, '23.1')!.id,
      documentVersionId: docA,
      verdict: 'not_addressed',
      severity: 'critical',
      rationale: 'не про це',
      evidence: [],
    });

    const summary = db.runs.summary(plan.runId);

    expect(summary.severityCounts.major).toBe(1);
    // Критична severity на not_addressed не потрапляє в оцінку.
    expect(summary.severityCounts.critical).toBe(0);
    expect(summary.counts.not_addressed).toBe(3);
  });
});

describe('сторінки доказів', () => {
  it('номер сторінки виводиться з офсету цитати', async () => {
    const plan = planRun(
      db,
      { specVersionId, siteProfileId: null, documentVersionIds: [docA] },
      MODELS,
      { scope: new Map([[docA, new Set(['10'])]]) },
    );

    const judge: LlmProvider = {
      ...provider([]),
      async complete<T>(): Promise<CompleteResult<T>> {
        return {
          data: [
            {
              clause_no: '10.1',
              verdict: 'partial',
              confidence: 0.8,
              rationale: 'ok',
              // Модель НЕ повертає page — саме цей випадок і був у реальному прогоні.
              evidence: [{ quote: 'checked monthly for pests by Attack' }],
            },
          ] as T,
          citations: [],
          usage: { input: 10, cachedInput: 0, cacheWrite: 0, output: 10 },
          costUsd: 0,
          modelId: 'fake-model',
          providerId: 'fake',
          latencyMs: 1,
          raw: null,
          fromCache: false,
        };
      },
    };

    await executeRun({ db, judge }, plan.runId, { concurrency: 1 });

    const finding = db.findings
      .listByRun(plan.runId)
      .find((f) => f.clause.clauseNo === '10.1');

    expect(finding?.evidence[0]?.verified).toBe(true);
    expect(finding?.evidence[0]?.charStart).toBeGreaterThan(0);
    expect(finding?.evidence[0]?.pageNo).toBe(1);
  });
});
