import { beforeEach, describe, expect, it } from 'vitest';
import type { IpcEventChannel, IpcEvents } from '@shared/ipc';
import { createTestDb, type Db } from '@main/db';
import { seed, type SeedResult } from '@main/db/fixtures';
import { setOrchestrator } from './orchestratorPort';
import { createHandlers } from './handlers';
import type { IpcContext } from './context';
import type { IpcError } from './errors';

/**
 * Канали `library:deleteImpact` / `library:delete`: тонкі обгортки над
 * `pipeline/libraryDeletion`. Тут — те, що додає саме шар IPC: зупинка живих
 * перевірок через оркестратор, події для renderer і зрозумілі помилки.
 */

let db: Db;
let s: SeedResult;
let cancelled: number[];
let emitted: Array<{ event: IpcEventChannel; payload: unknown }>;
let handlers: ReturnType<typeof createHandlers>;

function context(): IpcContext {
  return {
    db,
    events: {
      emit: <E extends IpcEventChannel>(event: E, payload: IpcEvents[E]) => {
        emitted.push({ event, payload });
      },
      toast: () => {},
    },
    secrets: { getApiKey: () => null, setApiKey: () => {}, clearApiKey: () => {}, hasApiKey: () => false },
    providers: { listProviderStatus: () => [] },
    allowNetwork: false,
    getWindow: () => null,
  } as unknown as IpcContext;
}

function installOrchestrator(): void {
  setOrchestrator({
    extractClauses: async () => 0,
    buildDocProfile: async () => ({}) as never,
    estimateRun: async () => ({ tasks: 0, inputTokens: 0, costUsd: 0, model: null }),
    startRun: async () => 0,
    pauseRun: async () => {},
    resumeRun: async () => {},
    cancelRun: async (id) => {
      cancelled.push(id);
      db.runs.setStatus(id, 'cancelled');
    },
    exportRun: async () => ({ path: '' }),
  });
}

/** Хендлер може кинути й синхронно — тому приймаємо функцію, а не готовий проміс. */
async function rejection(call: () => unknown): Promise<IpcError> {
  return Promise.resolve()
    .then(call)
    .then(
    () => {
      throw new Error('очікували помилку');
    },
    (err: unknown) => err as IpcError,
  );
}

beforeEach(() => {
  db = createTestDb();
  s = seed({ db });
  db.runs.setStatus(s.runId, 'done');
  cancelled = [];
  emitted = [];
  handlers = createHandlers(context());
  installOrchestrator();
});

describe('library:deleteImpact', () => {
  it('рахує ціну й нічого не видаляє', async () => {
    const impact = await handlers['library:deleteImpact']({ kind: 'specVersion', id: s.specVersionId });
    expect(impact).toMatchObject({
      title: 'Tesco Ornamental Plant Standard v5.0',
      deletesParent: true,
      versions: 1,
      clauses: 5,
      runs: [{ id: s.runId, status: 'done' }],
    });
    expect(db.specs.getVersion(s.specVersionId)).not.toBeNull();
    expect(emitted).toEqual([]);
  });

  it('неіснуюча ціль — NOT_FOUND із назвою сутності мовою інтерфейсу', async () => {
    const error = await rejection(() => handlers['library:deleteImpact']({ kind: 'specVersion', id: 777 }));
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Specification version 777 not found');
    expect(error.localize('uk')).toBe('Версію специфікації 777 не знайдено');
  });

  it('невідомий вид цілі чи кривий id — VALIDATION', async () => {
    const wrongKind = await rejection(() => handlers['library:deleteImpact']({ kind: 'run', id: 1 } as never));
    expect(wrongKind.code).toBe('VALIDATION');
    expect(wrongKind.localize('nl')).toContain('Niets te verwijderen');

    const wrongId = await rejection(() => handlers['library:deleteImpact']({ kind: 'document', id: 1.5 }));
    expect(wrongId.code).toBe('VALIDATION');
    expect(wrongId.message).toContain('documentId');
  });
});

describe('library:delete', () => {
  it('специфікація: оновлює і список стандартів, і картки документів', async () => {
    const impact = await handlers['library:delete']({ kind: 'specification', id: s.specificationId });

    expect(impact.runs.map((run) => run.id)).toEqual([s.runId]);
    expect(db.specs.get(s.specificationId)).toBeNull();
    expect(emitted.map((e) => e.payload)).toEqual([{ kind: 'specifications' }, { kind: 'documents' }]);
  });

  it('документ без перевірок: подія лише для документів', async () => {
    const spare = db.documents.create({ title: 'Чернетка', kind: 'other' });
    await handlers['library:delete']({ kind: 'document', id: spare.id });
    expect(emitted.map((e) => e.payload)).toEqual([{ kind: 'documents' }]);
  });

  it('жива перевірка зупиняється через оркестратор', async () => {
    db.runs.setStatus(s.runId, 'running');
    await handlers['library:delete']({ kind: 'documentVersion', id: s.pestVersionId });
    expect(cancelled).toEqual([s.runId]);
    expect(db.runs.get(s.runId)).toBeNull();
  });

  it('без оркестратора: видаляє, коли зупиняти нічого', async () => {
    setOrchestrator(null);
    await handlers['library:delete']({ kind: 'specVersion', id: s.specVersionId });
    expect(db.specs.getVersion(s.specVersionId)).toBeNull();
  });

  it('без оркестратора й із живою перевіркою — відмова, і нічого не видалено', async () => {
    setOrchestrator(null);
    db.runs.setStatus(s.runId, 'running');
    const error = await rejection(() => handlers['library:delete']({ kind: 'specVersion', id: s.specVersionId }));
    expect(error.code).toBe('INTERNAL');
    expect(db.specs.getVersion(s.specVersionId)).not.toBeNull();
    expect(db.runs.get(s.runId)).not.toBeNull();
  });

  it('журнал витрат лишається', async () => {
    db.spend.record({ stage: 'judge', provider: 'anthropic', model: 'claude-opus-5', costUsd: 2, runId: s.runId });
    db.spend.record({
      stage: 'clause_extract',
      provider: 'anthropic',
      model: 'claude-opus-5',
      costUsd: 3,
      specVersionId: s.specVersionId,
    });
    await handlers['library:delete']({ kind: 'specification', id: s.specificationId });
    expect(db.spend.summary().total).toBeCloseTo(5);
  });

  it('повторне видалення — NOT_FOUND', async () => {
    await handlers['library:delete']({ kind: 'document', id: s.pestDocId });
    const error = await rejection(() => handlers['library:delete']({ kind: 'document', id: s.pestDocId }));
    expect(error.code).toBe('NOT_FOUND');
  });
});
