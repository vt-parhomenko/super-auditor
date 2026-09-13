import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type Db } from '@main/db';
import type { CompleteRequest, CompleteResult, LlmProvider, ReportFinding } from '@main/llm';
import type { RunConfig } from '@shared/domain';
import { CRITIC_STAGE, JUDGE_STAGE, executeRun, planRun } from './runEngine';

// ─── Оснастка ────────────────────────────────────────────────────────────────

const DOC_TEXT = [
  'Pest Management 0068',
  'Our building is checked monthly for pests by Attack.',
  'This is a legal requirement according to HACCP.',
  'Damaged glass products are quarantined and recorded.',
].join('\n');

const MODELS = { judge: 'fake-judge', critic: 'fake-critic', promptVersion: 'judge.v1' };

interface Seeded {
  specVersionId: number;
  documentVersionId: number;
  clauseIds: number[];
}

function seed(db: Db): Seeded {
  const blobs = [
    { hash: 'a'.repeat(64), relPath: 'aa/aa/doc.pdf' },
    { hash: 'b'.repeat(64), relPath: 'bb/bb/spec.pdf' },
  ];
  for (const b of blobs) {
    db.blobs.insert({ hash: b.hash, relPath: b.relPath, byteSize: 100, mime: 'application/pdf' });
  }

  const extraction = db.extractions.insert({
    blobHash: blobs[0]!.hash,
    method: 'pdfjs',
    toolVersion: 'test',
    text: DOC_TEXT,
    pageCount: 1,
    pages: [{ pageNo: 1, charStart: 0, charEnd: DOC_TEXT.length }],
  });

  const doc = db.documents.create({ title: 'Pest Management', docNumber: '0068' });
  const docVersion = db.documents.addVersion({
    documentId: doc.id,
    versionLabel: '002',
    blobHash: blobs[0]!.hash,
    extractionId: extraction.id,
  });

  const spec = db.specs.create({ name: 'Tesco Standard', code: '20405' });
  const specVersion = db.specs.addVersion({
    specificationId: spec.id,
    versionLabel: '5.0',
    blobHash: blobs[1]!.hash,
  });

  db.clauses.createMany(specVersion.id, [
    {
      clauseNo: '10.1',
      sectionNo: '10',
      sectionTitle: 'Pest management',
      topic: 'Pest control provider',
      requirementText: 'The site must use a competent pest control provider.',
      obligation: 'must',
    },
    {
      clauseNo: '10.2',
      sectionNo: '10',
      sectionTitle: 'Pest management',
      topic: 'Inspection frequency',
      requirementText: 'Inspections must be carried out at a documented frequency.',
      obligation: 'must',
    },
    {
      clauseNo: '12.1',
      sectionNo: '12',
      sectionTitle: 'Foreign body control',
      topic: 'Glass',
      requirementText: 'Glass breakage must be recorded.',
      obligation: 'must',
    },
  ]);

  return {
    specVersionId: specVersion.id,
    documentVersionId: docVersion.id,
    clauseIds: db.clauses.list(specVersion.id).map((c) => c.id),
  };
}

function finding(overrides: Partial<ReportFinding> = {}): ReportFinding {
  return {
    clause_no: '10.1',
    verdict: 'compliant',
    severity: 'none',
    confidence: 0.9,
    rationale: 'The document names the pest control provider.',
    evidence: [{ quote: 'Our building is checked monthly for pests by Attack.' }],
    ...overrides,
  } as ReportFinding;
}

interface FakeOptions {
  judge?: (clauseNos: string[]) => ReportFinding[];
  critic?: { agree: boolean; reason?: string };
  failFirst?: number;
}

function fakeProvider(id: string, options: FakeOptions = {}): LlmProvider & { calls: number } {
  let failures = 0;
  const provider = {
    id,
    label: id,
    models: [`fake-${id}`],
    calls: 0,
    caps: {
      contextWindow: 200_000,
      promptCaching: true,
      structuredOutput: 'tool' as const,
      citations: false,
      documentInput: [] as Array<'pdf' | 'text'>,
      maxOutputTokens: 8000,
      cloud: false,
    },
    isConfigured: () => true,
    async complete<T>(req: CompleteRequest<T>): Promise<CompleteResult<T>> {
      provider.calls += 1;
      if (options.failFirst && failures < options.failFirst) {
        failures += 1;
        throw new Error('тимчасовий збій провайдера');
      }

      const user = req.messages[0]?.content ?? '';
      const clauseNos = [...user.matchAll(/no="(\d+\.\d+)"/g)].map((m) => m[1]!);
      const data = options.critic
        ? options.critic
        : (options.judge?.(clauseNos) ?? clauseNos.map((no) => finding({ clause_no: no })));

      return {
        data: data as T,
        citations: [],
        usage: { input: 1000, cachedInput: 800, cacheWrite: 0, output: 200 },
        costUsd: 0.005,
        modelId: `fake-${id}`,
        providerId: id,
        latencyMs: 1,
        raw: null,
        fromCache: false,
      };
    },
  };
  return provider;
}

let db: Db;
let s: Seeded;

beforeEach(() => {
  db = createTestDb();
  s = seed(db);
});

const config = (overrides: Partial<RunConfig> = {}): RunConfig => ({
  specVersionId: s.specVersionId,
  siteProfileId: null,
  documentVersionIds: [s.documentVersionId],
  ...overrides,
});

// ─── Планування ──────────────────────────────────────────────────────────────

describe('planRun', () => {
  it('матеріалізує план до першого виклику моделі', () => {
    const plan = planRun(db, config(), MODELS);

    // 1 документ × 2 секції (10 і 12)
    expect(plan.tasks).toBe(2);
    expect(plan.clausesApplicable).toBe(3);
    expect(db.runTasks.list(plan.runId, 'pending')).toHaveLength(2);
    expect(db.runs.get(plan.runId)?.status).toBe('queued');
  });

  it('множить завдання на кількість документів', () => {
    const second = db.documents.addVersion({
      documentId: db.documents.list()[0]!.id,
      versionLabel: '003',
      blobHash: 'a'.repeat(64),
      extractionId: 1,
    });

    const plan = planRun(
      db,
      config({ documentVersionIds: [s.documentVersionId, second.id] }),
      MODELS,
    );

    expect(plan.tasks).toBe(4);
  });

  it('виключає незастосовні вимоги', () => {
    const site = db.siteProfiles.save({
      name: 'Site',
      modules: ['P'],
      certifications: [],
      products: [],
      processes: [],
      notes: null,
    });
    db.siteProfiles.setOverride(site.id, s.clauseIds[2]!, false, 'поза scope');

    const plan = planRun(db, config({ siteProfileId: site.id }), MODELS);

    expect(plan.clausesApplicable).toBe(2);
    expect(plan.skippedNotApplicable).toBe(1);
    expect(plan.tasks).toBe(1); // лишилась одна секція
  });

  it('відмовляє на порожньому реєстрі вимог', () => {
    db.clauses.deleteAll(s.specVersionId);
    expect(() => planRun(db, config(), MODELS)).toThrow('Реєстр вимог порожній');
  });

  it('відмовляє, коли не вибрано документів', () => {
    expect(() => planRun(db, config({ documentVersionIds: [] }), MODELS)).toThrow('жодного документа');
  });
});

// ─── Виконання ───────────────────────────────────────────────────────────────

describe('executeRun', () => {
  it('зберігає findings з доказами і рахує вартість', async () => {
    const { runId } = planRun(db, config(), MODELS);
    const judge = fakeProvider('judge');

    const report = await executeRun({ db, judge }, runId, { concurrency: 1 });

    expect(report.status).toBe('done');
    expect(report.findings).toBe(3);
    expect(report.usage.costUsd).toBeCloseTo(0.01);
    expect(db.runs.get(runId)?.status).toBe('done');

    const findings = db.findings.listByRun(runId);
    expect(findings).toHaveLength(3);
    expect(findings[0]?.evidence[0]?.verified).toBe(true);
  });

  it('понижує compliant без підтвердженої цитати до needs_human_review', async () => {
    const { runId } = planRun(db, config(), MODELS);
    const judge = fakeProvider('judge', {
      judge: (nos) =>
        nos.map((no) =>
          finding({
            clause_no: no,
            verdict: 'compliant',
            evidence: [{ quote: 'Цієї фрази в документі немає взагалі.' }],
          }),
        ),
    });

    const report = await executeRun({ db, judge }, runId, { concurrency: 1 });

    expect(report.downgraded).toBe(3);
    const findings = db.findings.listByRun(runId);
    expect(findings.every((f) => f.verdict === 'needs_human_review')).toBe(true);
    expect(findings[0]?.rationale).toContain('доказ не підтверджено');
    expect(findings[0]?.evidence[0]?.verified).toBe(false);
  });

  it('не понижує вердикти, крім compliant — там доказ не обов’язковий', async () => {
    const { runId } = planRun(db, config(), MODELS);
    const judge = fakeProvider('judge', {
      judge: (nos) =>
        nos.map((no) => finding({ clause_no: no, verdict: 'not_addressed', evidence: [] })),
    });

    const report = await executeRun({ db, judge }, runId, { concurrency: 1 });

    expect(report.downgraded).toBe(0);
    expect(db.findings.listByRun(runId).every((f) => f.verdict === 'not_addressed')).toBe(true);
  });

  it('вимога, яку модель проігнорувала, стає needs_human_review, а не «відповідає»', async () => {
    const { runId } = planRun(db, config(), MODELS);
    // Модель відповідає лише про першу вимогу кожної секції.
    const judge = fakeProvider('judge', {
      judge: (nos) => (nos[0] ? [finding({ clause_no: nos[0], verdict: 'not_addressed', evidence: [] })] : []),
    });

    await executeRun({ db, judge }, runId, { concurrency: 1 });

    const findings = db.findings.listByRun(runId);
    expect(findings).toHaveLength(3);

    const ignored = findings.filter((f) => f.rationale.includes('не повернула висновок'));
    expect(ignored).toHaveLength(1);
    expect(ignored[0]?.verdict).toBe('needs_human_review');
  });

  it('ігнорує вигаданий номер вимоги', async () => {
    const { runId } = planRun(db, config(), MODELS);
    const judge = fakeProvider('judge', {
      judge: () => [finding({ clause_no: '99.9', verdict: 'compliant' })],
    });

    await executeRun({ db, judge }, runId, { concurrency: 1 });

    const findings = db.findings.listByRun(runId);
    // Жодного finding із вигаданої вимоги; усі три реальні позначені як без висновку.
    expect(findings).toHaveLength(3);
    expect(findings.every((f) => f.verdict === 'needs_human_review')).toBe(true);
  });

  it('падіння частини завдань не зриває прогін, але фіксується в статусі', async () => {
    const { runId } = planRun(db, config(), MODELS);
    const judge = fakeProvider('judge', { failFirst: 1 });

    const report = await executeRun({ db, judge }, runId, { concurrency: 1 });

    expect(report.failedTasks).toHaveLength(1);
    expect(report.status).toBe('done');
    expect(db.runTasks.list(runId, 'failed')).toHaveLength(1);
    expect(db.runTasks.list(runId, 'done')).toHaveLength(1);
    // Часткова невдача не має виглядати як бездоганний прогін.
    expect(db.runs.get(runId)?.error).toContain('Частково');
  });

  it('прогін, у якому впало ВСЕ, є failed — а не «Завершено» без зауважень', async () => {
    const { runId } = planRun(db, config(), MODELS);
    const judge = fakeProvider('judge', { failFirst: 99 });

    const report = await executeRun({ db, judge }, runId, { concurrency: 1 });

    expect(report.status).toBe('failed');
    expect(report.findings).toBe(0);

    const run = db.runs.get(runId);
    expect(run?.status).toBe('failed');
    // Справжня причина має дійти до екрана, а не лишитись у run_task.last_error.
    expect(run?.error).toContain('тимчасовий збій провайдера');
  });

  it('прогін відновлюється після обриву й не переробляє готове', async () => {
    const { runId } = planRun(db, config(), MODELS);

    // Перший захід: обриваємо після першого завдання.
    const controller = new AbortController();
    const first = fakeProvider('judge');
    const originalComplete = first.complete.bind(first);
    first.complete = async (req, signal) => {
      const result = await originalComplete(req, signal);
      controller.abort();
      return result;
    };

    await executeRun({ db, judge: first }, runId, { concurrency: 1, signal: controller.signal });
    expect(db.runs.get(runId)?.status).toBe('cancelled');
    const doneAfterFirst = db.runTasks.list(runId, 'done').length;
    expect(doneAfterFirst).toBe(1);

    // Другий захід: доробляє решту.
    const second = fakeProvider('judge');
    db.runTasks.requeueFailed(runId);
    const report = await executeRun({ db, judge: second }, runId, { concurrency: 1 });

    expect(report.status).toBe('done');
    expect(second.calls).toBe(1); // тільки завдання, що лишилось
    expect(db.runTasks.list(runId, 'done')).toHaveLength(2);
  });

  it('повідомляє прогрес і кожен finding окремо', async () => {
    const { runId } = planRun(db, config(), MODELS);
    const judge = fakeProvider('judge');
    const progress: number[] = [];
    const streamed: number[] = [];

    await executeRun({ db, judge }, runId, {
      concurrency: 1,
      onProgress: (p) => progress.push(p.tasksDone),
      onFinding: (f) => streamed.push(f.id),
    });

    expect(progress.length).toBeGreaterThan(0);
    expect(streamed).toHaveLength(3);
  });
});

// ─── Критик ──────────────────────────────────────────────────────────────────

describe('прохід критика', () => {
  it('перевіряє лише compliant', async () => {
    const { runId } = planRun(db, config(), MODELS);
    const judge = fakeProvider('judge', {
      judge: (nos) =>
        nos.map((no, i) =>
          finding({
            clause_no: no,
            verdict: i === 0 ? 'compliant' : 'not_addressed',
            evidence: i === 0 ? [{ quote: 'Our building is checked monthly for pests by Attack.' }] : [],
          }),
        ),
    });
    const critic = fakeProvider('critic', { critic: { agree: true } });

    const report = await executeRun({ db, judge, critic }, runId, { concurrency: 1 });

    // Дві секції → дві compliant-вимоги на перевірку.
    expect(report.criticTasks).toBe(2);
    expect(db.runTasks.list(runId, 'done').filter((t) => t.stage === CRITIC_STAGE)).toHaveLength(2);
  });

  it('незгода критика понижує вердикт і зберігає докази', async () => {
    const { runId } = planRun(db, config(), MODELS);
    const judge = fakeProvider('judge');
    const critic = fakeProvider('critic', {
      critic: { agree: false, reason: 'Доказ описує намір, а не виконання.' },
    });

    const report = await executeRun({ db, judge, critic }, runId, { concurrency: 1 });

    expect(report.downgraded).toBeGreaterThan(0);
    const findings = db.findings.listByRun(runId);
    expect(findings.every((f) => f.verdict === 'needs_human_review')).toBe(true);
    expect(findings[0]?.rationale).toContain('критик не погодився');
    expect(findings[0]?.evidence.length).toBeGreaterThan(0);
  });

  it('без критика етап пропускається', async () => {
    const { runId } = planRun(db, config(), MODELS);
    const judge = fakeProvider('judge');

    const report = await executeRun({ db, judge }, runId, { concurrency: 1 });

    expect(report.criticTasks).toBe(0);
    expect(db.runTasks.list(runId).filter((t) => t.stage === CRITIC_STAGE)).toHaveLength(0);
    expect(db.findings.listByRun(runId).every((f) => f.verdict === 'compliant')).toBe(true);
  });
});

describe('етапи завдань', () => {
  it('усі заплановані завдання належать етапу judge', () => {
    const { runId } = planRun(db, config(), MODELS);
    expect(db.runTasks.list(runId).every((t) => t.stage === JUDGE_STAGE)).toBe(true);
  });
});
