import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type Db } from '@main/db';
import { LlmError, describeFatalLlmError, isFatalLlmError } from '@main/llm';
import type { CompleteResult, LlmProvider } from '@main/llm';
import { executeRun, planRun } from './runEngine';

/**
 * Реальний випадок: під час прогону закінчився баланс Anthropic.
 *
 * Anthropic віддає це звичайним 400 `invalid_request_error`, тому без окремої
 * перевірки прогін сумлінно зробив би той самий приречений виклик для КОЖНОГО
 * з 13 завдань, а користувач побачив би стос однакових помилок замість однієї
 * зрозумілої причини.
 */

const TEXT = 'Pest Management 0068. Checked monthly by Attack.';
const MODELS = { judge: 'fake', critic: null, promptVersion: 'judge.v1' };

let db: Db;
let specVersionId: number;
let docVersionId: number;

function failingProvider(error: unknown): LlmProvider & { calls: number } {
  const p = {
    id: 'fake',
    label: 'Fake',
    models: ['fake-model'],
    calls: 0,
    caps: {
      contextWindow: 200_000,
      promptCaching: false,
      structuredOutput: 'tool' as const,
      citations: false,
      documentInput: [] as Array<'pdf' | 'text'>,
      maxOutputTokens: 8000,
      cloud: true,
    },
    isConfigured: () => true,
    async complete<T>(): Promise<CompleteResult<T>> {
      p.calls += 1;
      throw error;
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
    text: TEXT,
    pageCount: 1,
    pages: [{ pageNo: 1, charStart: 0, charEnd: TEXT.length }],
  });
  const doc = db.documents.create({ title: 'Pest Management' });
  docVersionId = db.documents.addVersion({
    documentId: doc.id,
    versionLabel: '002',
    blobHash: 'a'.repeat(64),
    extractionId: ex.id,
  }).id;

  const spec = db.specs.create({ name: 'Tesco' });
  specVersionId = db.specs.addVersion({ specificationId: spec.id, versionLabel: '5.0', blobHash: 'b'.repeat(64) }).id;

  // Чотири секції → чотири завдання, щоб було видно, зупинився прогін чи ні.
  db.clauses.createMany(specVersionId, [
    { clauseNo: '1.1', sectionNo: '1', requirementText: 'A must exist.', obligation: 'must' },
    { clauseNo: '2.1', sectionNo: '2', requirementText: 'B must exist.', obligation: 'must' },
    { clauseNo: '3.1', sectionNo: '3', requirementText: 'C must exist.', obligation: 'must' },
    { clauseNo: '4.1', sectionNo: '4', requirementText: 'D must exist.', obligation: 'must' },
  ]);
});

const plan = () =>
  planRun(db, { specVersionId, siteProfileId: null, documentVersionIds: [docVersionId] }, MODELS);

describe('класифікація фатальних помилок', () => {
  it('вичерпаний баланс і проблеми з доступом — фатальні', () => {
    for (const kind of ['insufficient_credit', 'auth', 'not_configured', 'cloud_blocked'] as const) {
      expect(isFatalLlmError(new LlmError(kind, 'x', { providerId: 'anthropic' }))).toBe(true);
    }
  });

  it('перевантаження і збої мережі — НЕ фатальні, їх можна пережити', () => {
    for (const kind of ['rate_limit', 'transport', 'api', 'schema'] as const) {
      expect(isFatalLlmError(new LlmError(kind, 'x', { providerId: 'anthropic' }))).toBe(false);
    }
  });

  it('звичайна помилка не вважається фатальною для LLM', () => {
    expect(isFatalLlmError(new Error('щось пішло не так'))).toBe(false);
  });

  it('пояснення про баланс каже, що робити далі', () => {
    const text = describeFatalLlmError(
      new LlmError('insufficient_credit', 'credit balance is too low', { providerId: 'anthropic' }),
    );

    expect(text).toContain('баланс');
    expect(text).toContain('Продовжити');
  });
});

describe('прогін при вичерпаному балансі', () => {
  const creditError = () =>
    new LlmError('insufficient_credit', 'Your credit balance is too low', {
      providerId: 'anthropic',
    });

  it('зупиняється після ПЕРШОГО виклику, а не перемелює всі завдання', async () => {
    const { runId } = plan();
    const judge = failingProvider(creditError());

    const report = await executeRun({ db, judge }, runId, { concurrency: 1 });

    expect(judge.calls).toBe(1);
    expect(report.status).toBe('failed');
  });

  it('причина потрапляє в прогін, а не лишається в run_task', async () => {
    const { runId } = plan();

    await executeRun({ db, judge: failingProvider(creditError()) }, runId, { concurrency: 1 });

    const run = db.runs.get(runId);
    expect(run?.status).toBe('failed');
    expect(run?.error).toContain('Вичерпано баланс');
    expect(run?.error).toContain('Продовжити');
  });

  it('завдання повертаються в чергу — після поповнення прогін доробить', async () => {
    const { runId } = plan();

    await executeRun({ db, judge: failingProvider(creditError()) }, runId, { concurrency: 1 });

    // Жодне завдання не має лишитись у 'failed' назавжди: провини завдання тут немає.
    expect(db.runTasks.list(runId, 'failed')).toHaveLength(0);
    expect(db.runTasks.list(runId, 'pending')).toHaveLength(4);
  });

  it('після поповнення прогін продовжується й доходить до кінця', async () => {
    const { runId } = plan();
    await executeRun({ db, judge: failingProvider(creditError()) }, runId, { concurrency: 1 });

    const working: LlmProvider = {
      ...failingProvider(null),
      async complete<T>(): Promise<CompleteResult<T>> {
        return {
          data: [] as T,
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

    const report = await executeRun({ db, judge: working }, runId, { concurrency: 1 });

    expect(report.status).toBe('done');
    expect(db.runTasks.list(runId, 'done')).toHaveLength(4);
  });

  it('невірний ключ так само зупиняє одразу', async () => {
    const { runId } = plan();
    const judge = failingProvider(
      new LlmError('auth', 'invalid x-api-key', { providerId: 'anthropic' }),
    );

    const report = await executeRun({ db, judge }, runId, { concurrency: 1 });

    expect(judge.calls).toBe(1);
    expect(db.runs.get(runId)?.error).toContain('Ключ API відхилено');
    expect(report.status).toBe('failed');
  });

  it('нефатальна помилка НЕ зупиняє прогін — решта завдань виконується', async () => {
    const { runId } = plan();
    const judge = failingProvider(
      new LlmError('api', 'тимчасова помилка', { providerId: 'anthropic' }),
    );

    await executeRun({ db, judge }, runId, { concurrency: 1 });

    expect(judge.calls).toBe(4);
    expect(db.runTasks.list(runId, 'failed')).toHaveLength(4);
  });
});
