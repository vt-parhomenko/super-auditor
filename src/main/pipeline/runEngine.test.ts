import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type Db } from '@main/db';
import { mainMessages } from '@main/i18n';
import { LlmError } from '@main/llm';
import type { CompleteRequest, CompleteResult, LlmProvider, ReportFindingV2 as ReportFinding } from '@main/llm';
import type { ResultsLanguage, RunConfig } from '@shared/domain';
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
  /** Чим падати в `failFirst`-викликах; за замовчуванням — звичайний Error. */
  failWith?: () => unknown;
  /** Кожен запит, що дійшов до провайдера. */
  requests?: Array<CompleteRequest<unknown>>;
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
      options.requests?.push(req as CompleteRequest<unknown>);
      if (options.failFirst && failures < options.failFirst) {
        failures += 1;
        throw options.failWith?.() ?? new Error('тимчасовий збій провайдера');
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
    expect(() => planRun(db, config(), MODELS)).toThrow('The clause registry is empty');
  });

  it('відмовляє, коли не вибрано документів', () => {
    expect(() => planRun(db, config({ documentVersionIds: [] }), MODELS)).toThrow('No documents selected');
  });

  it('пояснює відмову мовою інтерфейсу', () => {
    db.settings.set({ uiLanguage: 'uk' });
    expect(() => planRun(db, config({ documentVersionIds: [] }), MODELS)).toThrow(
      'Не вибрано жодного документа',
    );
  });

  it('фіксує в прогоні маршрутизацію і мову висновків', () => {
    db.settings.set({ resultsLanguage: 'nl' });
    const routing = {
      judge: { provider: 'openrouter', model: 'openai/gpt-6-luna', effort: 'high' as const },
      critic: null,
    };

    const { runId } = planRun(db, config(), MODELS, { routing });

    expect(db.runs.launchSettings(runId)).toEqual({ routing, resultsLanguage: 'nl' });
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
    expect(findings[0]?.rationale).toContain('[evidence not confirmed in the document text]');
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

    const ignored = findings.filter((f) => f.rationale.includes('returned no conclusion'));
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
    expect(db.runs.get(runId)?.error).toContain('Partially completed');
  });

  it('текст помилки прогону — мовою інтерфейсу, помилки моделі пояснено', async () => {
    db.settings.set({ uiLanguage: 'uk' });
    const { runId } = planRun(db, config(), MODELS);
    const judge = fakeProvider('judge', {
      failFirst: 99,
      failWith: () => new LlmError('transport', 'ECONNRESET', { providerId: 'openrouter' }),
    });

    await executeRun({ db, judge }, runId, { concurrency: 1 });

    const error = db.runs.get(runId)?.error ?? '';
    expect(error).toContain('Жодне з 2 завдань не виконалось');
    expect(error).toContain("Немає з'єднання з OpenRouter");
    expect(error).toContain('ECONNRESET');
    // У черзі лишається сирий текст — для діагностики.
    expect(db.runTasks.list(runId, 'failed')[0]?.lastError).toBe('ECONNRESET');
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

describe('пауза', () => {
  it('пауза посеред судження лишає прогін на паузі, а не «done», і критика не запускає', async () => {
    const { runId } = planRun(db, config(), MODELS);
    const judge = fakeProvider('judge');
    const inner = judge.complete.bind(judge);
    // Користувач тисне «Пауза», поки перший виклик моделі ще в дорозі.
    judge.complete = async (req, signal) => {
      db.runs.setStatus(runId, 'paused');
      return inner(req, signal);
    };
    const critic = fakeProvider('critic', { critic: { agree: true } });

    const report = await executeRun({ db, judge, critic }, runId, { concurrency: 1 });

    expect(report.status).toBe('paused');
    expect(db.runs.get(runId)?.status).toBe('paused');
    expect(db.runTasks.list(runId, 'pending').filter((t) => t.stage === JUDGE_STAGE).length).toBeGreaterThan(0);
    expect(db.runTasks.list(runId).filter((t) => t.stage === CRITIC_STAGE)).toHaveLength(0);
    expect(critic.calls).toBe(0);
  });
});

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
    expect(findings[0]?.rationale).toContain('[the critic disagreed]');
    expect(findings[0]?.rationale).toContain('Доказ описує намір, а не виконання.');
    expect(findings[0]?.evidence.length).toBeGreaterThan(0);
  });

  it('«Продовжити» після збою критика не ставить другого критика тим самим findings', async () => {
    const { runId } = planRun(db, config(), MODELS);
    const judge = fakeProvider('judge');
    const broke = fakeProvider('critic', {
      critic: { agree: true },
      failFirst: 100,
      failWith: () => new LlmError('insufficient_credit', '402', { providerId: 'openrouter' }),
    });

    const first = await executeRun({ db, judge, critic: broke }, runId, { concurrency: 1 });
    expect(first.status).toBe('failed');
    const queued = db.runTasks.list(runId).filter((t) => t.stage === CRITIC_STAGE);
    expect(queued.length).toBeGreaterThan(0);

    const critic = fakeProvider('critic', { critic: { agree: true } });
    await executeRun({ db, judge, critic }, runId, { concurrency: 1 });

    const all = db.runTasks.list(runId).filter((t) => t.stage === CRITIC_STAGE);
    expect(all).toHaveLength(queued.length);
    expect(critic.calls).toBe(queued.length);
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

// ─── Позначки стандарту ──────────────────────────────────────────────────────

describe('позначки стандарту (judge.v2 / critic.v2)', () => {
  const LEGEND = [
    { code: 'P', label: 'Policy / procedure', meaning: 'The site must have a documented policy/procedure' },
    { code: 'R', label: 'Records', meaning: 'The site must have accurately completed records' },
    { code: 'O', label: 'Observation', meaning: 'Compliance will be verified through observation of the site' },
  ];

  /** Вимоги секції 10 — з позначками Tesco, версія — з легендою. */
  function markTesco(): void {
    const [c101, c102] = db.clauses.list(s.specVersionId);
    db.clauses.patch(c101!.id, { markers: ['P', 'R'] });
    db.clauses.patch(c102!.id, { markers: ['P', 'O'] });
    db.specs.setMarkerLegend(s.specVersionId, LEGEND);
  }

  it('судження отримує позначки вимог і легенду; прогін пише версію judge.v2', async () => {
    markTesco();
    const requests: Array<CompleteRequest<unknown>> = [];
    const { runId } = planRun(db, config(), { ...MODELS, promptVersion: 'judge.v2' });
    await executeRun({ db, judge: fakeProvider('judge', { requests }) }, runId, { concurrency: 1 });

    const section10 = requests.find((r) => r.messages[0]?.content.includes('no="10.1"'));
    expect(section10?.promptVersion).toBe('judge.v2');
    expect(section10?.messages[0]?.content).toContain('markers="P, R"');
    expect(section10?.messages[0]?.content).toContain('markers="P, O"');
    expect(section10?.cachedPrefix).toContain('<marker_legend count="3">');
    // Вимога без позначок — без атрибута.
    const section12 = requests.find((r) => r.messages[0]?.content.includes('no="12.1"'));
    expect(section12?.messages[0]?.content).not.toContain('markers=');
    expect(section10?.cacheInput).toMatchObject({ markerLegend: LEGEND });
  });

  it('стандарт без позначок — у запиті ні легенди, ні атрибутів', async () => {
    const requests: Array<CompleteRequest<unknown>> = [];
    const { runId } = planRun(db, config(), MODELS);
    await executeRun({ db, judge: fakeProvider('judge', { requests }) }, runId, { concurrency: 1 });

    for (const req of requests) {
      expect(req.cachedPrefix).not.toContain('marker_legend');
      expect(req.messages[0]?.content).not.toContain('markers=');
    }
  });

  it('outside_evidence стає outsideEvidence; порожній рядок — null', async () => {
    markTesco();
    const { runId } = planRun(db, config(), MODELS);
    const judge = fakeProvider('judge', {
      judge: (nos) =>
        nos.map((no) =>
          finding({
            clause_no: no,
            outside_evidence: no === '10.1' ? '  Inspect the signed visit reports.  ' : no === '10.2' ? '   ' : undefined,
          }),
        ),
    });

    await executeRun({ db, judge }, runId, { concurrency: 1 });

    const byClause = new Map(db.findings.listByRun(runId).map((f) => [f.clause.clauseNo, f]));
    expect(byClause.get('10.1')?.outsideEvidence).toBe('Inspect the signed visit reports.');
    expect(byClause.get('10.2')?.outsideEvidence).toBeNull();
    expect(byClause.get('12.1')?.outsideEvidence).toBeNull();
    // Записи поза документом — не причина знижувати: compliant лишається compliant.
    expect(byClause.get('10.1')?.verdict).toBe('compliant');
  });

  it('критик бачить позначки, лише свої пункти легенди і висновок «поза документом»', async () => {
    markTesco();
    const requests: Array<CompleteRequest<unknown>> = [];
    const { runId } = planRun(db, config(), MODELS);
    const judge = fakeProvider('judge', {
      judge: (nos) =>
        nos.map((no) => finding({ clause_no: no, outside_evidence: no === '10.1' ? 'Inspect the records.' : undefined })),
    });
    const critic = fakeProvider('critic', { critic: { agree: true }, requests });

    await executeRun({ db, judge, critic }, runId, { concurrency: 1 });

    const for101 = requests.find((r) => r.messages[0]?.content.includes('no="10.1"'));
    expect(for101?.promptVersion).toBe('critic.v2');
    const user = for101?.messages[0]?.content ?? '';
    expect(user).toContain('<clause no="10.1" markers="P, R">');
    expect(user).toContain('<marker_legend count="2">');
    expect(user).toContain('label="Records"');
    expect(user).not.toContain('label="Observation"');
    expect(user).toContain('<claimed_outside_evidence>\nInspect the records.\n</claimed_outside_evidence>');

    // Вимога без позначок — критик без легенди.
    const for121 = requests.find((r) => r.messages[0]?.content.includes('no="12.1"'));
    expect(for121?.messages[0]?.content).not.toContain('marker_legend');
  });

  it('незгода критика зберігає «перевірити поза документом»', async () => {
    markTesco();
    const { runId } = planRun(db, config(), MODELS);
    const judge = fakeProvider('judge', {
      judge: (nos) => nos.map((no) => finding({ clause_no: no, outside_evidence: `Verify records for ${no}.` })),
    });
    const critic = fakeProvider('critic', { critic: { agree: false, reason: 'The bullets are not all covered.' } });

    await executeRun({ db, judge, critic }, runId, { concurrency: 1 });

    const f101 = db.findings.listByRun(runId).find((f) => f.clause.clauseNo === '10.1');
    expect(f101?.verdict).toBe('needs_human_review');
    expect(f101?.outsideEvidence).toBe('Verify records for 10.1.');
  });
});

// ─── Мова результатів ────────────────────────────────────────────────────────

describe('мова результатів', () => {
  /**
   * Службові позначки пишуться мовою результатів; `''` (мовою стандарту) →
   * англійська, бо стандарти англомовні.
   */
  const cases: Array<[ResultsLanguage, 'en' | 'nl' | 'uk']> = [
    ['', 'en'],
    ['en', 'en'],
    ['nl', 'nl'],
    ['uk', 'uk'],
  ];

  it.each(cases)('позначки у findings для «%s» — мовою %s', async (language, catalog) => {
    db.settings.set({ resultsLanguage: language, uiLanguage: 'en' });
    const markers = mainMessages(catalog).results;

    const { runId } = planRun(db, config(), MODELS);
    // Секція 10: перша вимога — compliant без підтвердженої цитати, другу модель
    // проігнорувала. Секція 12: compliant з добрим доказом — його заперечить критик.
    const judge = fakeProvider('judge', {
      judge: (nos) =>
        nos[0] === '10.1'
          ? [finding({ clause_no: '10.1', evidence: [{ quote: 'Вигадана цитата.' }] })]
          : nos.map((no) => finding({ clause_no: no })),
    });
    const critic = fakeProvider('critic', { critic: { agree: false, reason: 'Too thin.' } });

    await executeRun({ db, judge, critic }, runId, { concurrency: 1 });

    const byClause = new Map(db.findings.listByRun(runId).map((f) => [f.clause.clauseNo, f]));
    expect(byClause.get('10.1')?.rationale.startsWith(markers.unverifiedEvidence)).toBe(true);
    expect(byClause.get('10.2')?.rationale).toBe(markers.noConclusion);
    expect(byClause.get('12.1')?.rationale.startsWith(`${markers.criticDisagreed} Too thin.`)).toBe(true);
  });

  it('позначка поза scope — мовою результатів', () => {
    db.settings.set({ resultsLanguage: 'uk' });
    const { runId } = planRun(db, config(), MODELS, {
      scope: new Map([[s.documentVersionId, new Set(['10'])]]),
    });

    const outside = db.findings.listByRun(runId).filter((f) => f.clause.sectionNo === '12');
    expect(outside[0]?.rationale).toBe(mainMessages('uk').results.outOfScope);
  });

  it('мова йде в промпт судження і критика та в ключ кешу', async () => {
    db.settings.set({ resultsLanguage: 'nl' });
    const requests: Array<CompleteRequest<unknown>> = [];
    const { runId } = planRun(db, config(), MODELS);

    await executeRun(
      {
        db,
        judge: fakeProvider('judge', { requests }),
        critic: fakeProvider('critic', { critic: { agree: true }, requests }),
      },
      runId,
      { concurrency: 1 },
    );

    const judgeReq = requests.find((r) => r.stage === 'judge');
    const criticReq = requests.find((r) => r.stage === 'critic');
    expect(judgeReq?.messages[0]?.content).toContain('in Dutch');
    expect(criticReq?.messages[0]?.content).toContain('Write `reason` and `missingElements` in Dutch');
    expect(judgeReq?.cacheInput).toMatchObject({ language: 'nl' });
    expect(criticReq?.cacheInput).toMatchObject({ language: 'nl' });
  });

  it('мовою стандарту — без інструкції і без мови в ключі кешу', async () => {
    const requests: Array<CompleteRequest<unknown>> = [];
    const { runId } = planRun(db, config(), MODELS);

    await executeRun({ db, judge: fakeProvider('judge', { requests }) }, runId, { concurrency: 1 });

    expect(requests[0]?.messages[0]?.content).not.toContain('Write `rationale`');
    expect(requests[0]?.cacheInput).not.toHaveProperty('language');
  });

  it('прогін тримає мову старту, навіть якщо налаштування змінили до продовження', async () => {
    db.settings.set({ resultsLanguage: 'uk' });
    const { runId } = planRun(db, config(), MODELS);
    db.settings.set({ resultsLanguage: 'nl' });

    const requests: Array<CompleteRequest<unknown>> = [];
    await executeRun({ db, judge: fakeProvider('judge', { requests }) }, runId, { concurrency: 1 });

    expect(requests[0]?.messages[0]?.content).toContain('in Ukrainian');
  });
});

describe('етапи завдань', () => {
  it('усі заплановані завдання належать етапу judge', () => {
    const { runId } = planRun(db, config(), MODELS);
    expect(db.runTasks.list(runId).every((t) => t.stage === JUDGE_STAGE)).toBe(true);
  });
});
