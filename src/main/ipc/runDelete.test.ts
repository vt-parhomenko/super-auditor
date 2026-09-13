import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type Db } from '@main/db';
import { seed } from '@main/db/fixtures';
import { setOrchestrator } from './orchestratorPort';
import { createHandlers } from './handlers';
import { createEmitter } from './events';
import type { IpcContext } from './context';

/**
 * Ручне видалення прогону.
 *
 * Дві властивості, за якими тут легко помилитись:
 *  • живий прогін треба спершу зупинити — інакше його смуги виконання
 *    продовжать писати findings у щойно видалений рядок;
 *  • журнал витрат НЕ видаляється: гроші витрачені незалежно від того,
 *    чи потрібен нам результат.
 */

let db: Db;
let handlers: ReturnType<typeof createHandlers>;
let cancelled: number[];

function context(): IpcContext {
  return {
    db,
    events: createEmitter(() => null),
    secrets: { getApiKey: () => null, setApiKey: () => {}, clearApiKey: () => {}, hasApiKey: () => false },
    providers: { listProviderStatus: () => [] },
    allowNetwork: false,
    getWindow: () => null,
  } as unknown as IpcContext;
}

beforeEach(() => {
  db = createTestDb();
  cancelled = [];
  handlers = createHandlers(context());

  setOrchestrator({
    extractClauses: async () => 0,
    buildDocProfile: async () => ({}) as never,
    estimateRun: async () => ({ tasks: 0, inputTokens: 0, costUsd: 0 }),
    startRun: async () => 0,
    pauseRun: async () => {},
    resumeRun: async () => {},
    cancelRun: async (id) => {
      cancelled.push(id);
      db.runs.setStatus(id, 'cancelled');
    },
    exportRun: async () => ({ path: '' }),
  });
});

describe('runs:delete', () => {
  it('видаляє прогін разом із findings, доказами й чергою', async () => {
    const s = seed({ db });
    db.findings.upsert({
      runId: s.runId,
      clauseId: s.clauseIds['10.1']!,
      documentVersionId: s.pestVersionId,
      verdict: 'partial',
      severity: 'major',
      rationale: 'частково',
      evidence: [{ documentVersionId: s.pestVersionId, quote: 'q', verified: true, source: 'model_quote' }],
    });
    db.runTasks.enqueue(s.runId, { stage: 'judge', payload: {} });

    expect(db.findings.listByRun(s.runId).length).toBeGreaterThan(0);

    await handlers['runs:delete'](s.runId);

    expect(db.runs.get(s.runId)).toBeNull();
    expect(db.findings.listByRun(s.runId)).toEqual([]);
    expect(db.runTasks.list(s.runId)).toEqual([]);
  });

  it('журнал витрат переживає видалення прогону', async () => {
    const s = seed({ db });
    db.spend.record({
      stage: 'judge',
      provider: 'anthropic',
      model: 'claude-opus-5',
      costUsd: 1.5,
      runId: s.runId,
    });

    await handlers['runs:delete'](s.runId);

    // Витрата — факт, а не властивість прогону.
    expect(db.spend.summary().total).toBeCloseTo(1.5);
    expect(db.spend.recent()[0]?.runId).toBe(s.runId);
  });

  it('живий прогін спершу зупиняється', async () => {
    const s = seed({ db });
    db.runs.setStatus(s.runId, 'running');

    await handlers['runs:delete'](s.runId);

    expect(cancelled).toEqual([s.runId]);
    expect(db.runs.get(s.runId)).toBeNull();
  });

  it('завершений прогін видаляється без зупинки', async () => {
    const s = seed({ db });
    db.runs.setStatus(s.runId, 'done');

    await handlers['runs:delete'](s.runId);

    expect(cancelled).toEqual([]);
  });

  it('неіснуючий прогін дає зрозумілу помилку', async () => {
    // Код помилки живе в полі `code`; префікс `[NOT_FOUND]` у текст додає вже
    // шар реєстрації каналів, коли серіалізує помилку для renderer.
    await expect(handlers['runs:delete'](99_999)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: expect.stringContaining('не знайдено'),
    });
  });

  it('картки документів оновлюються після видалення', async () => {
    const s = seed({ db });
    const emitted: string[] = [];
    const ctx = context();
    const spy = vi.spyOn(ctx.events, 'emit').mockImplementation((event: string) => {
      emitted.push(event);
      return undefined as never;
    });
    const local = createHandlers(ctx);

    await local['runs:delete'](s.runId);

    expect(emitted).toContain('library:changed');
    spy.mockRestore();
  });

  it('документ більше не показує видалений прогін', async () => {
    const s = seed({ db });
    const version = db.documents.getVersion(s.pestVersionId)!;

    expect(db.runs.forDocument(version.documentId).length).toBeGreaterThan(0);
    expect(db.runs.forDocument(version.documentId)[0]?.runId).toBe(s.runId);
    await handlers['runs:delete'](s.runId);
    expect(db.runs.forDocument(version.documentId)).toEqual([]);
  });
});
