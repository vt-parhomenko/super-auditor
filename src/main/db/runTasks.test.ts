import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, type Db } from './index';
import { seed, type SeedResult } from './fixtures';

let s: SeedResult;
let db: Db;

beforeEach(() => {
  s = seed();
  db = s.db;
});

afterEach(() => {
  db.close();
});

describe('run_task — черга', () => {
  it('круговий рейс із JSON-payload', () => {
    const task = db.runTasks.enqueue(s.runId, {
      stage: 'judge',
      payload: { documentVersionId: s.pestVersionId, clauseIds: [1, 2, 3] },
    });

    expect(task).toMatchObject({
      runId: s.runId,
      stage: 'judge',
      status: 'pending',
      attempts: 0,
      lastError: null,
    });
    expect(task.payload).toEqual({ documentVersionId: s.pestVersionId, clauseIds: [1, 2, 3] });
    expect(db.runTasks.get(task.id)).toEqual(task);
  });

  it('enqueueMany + list за статусом', () => {
    db.runTasks.enqueueMany(s.runId, [
      { stage: 'doc_profile', payload: { documentVersionId: s.pestVersionId } },
      { stage: 'judge', payload: { section: '10' } },
      { stage: 'critic', payload: { section: '10' } },
    ]);
    expect(db.runTasks.list(s.runId)).toHaveLength(3);
    expect(db.runTasks.list(s.runId, 'pending')).toHaveLength(3);
    expect(db.runTasks.list(s.runId, 'done')).toHaveLength(0);
  });

  it('claimNext переводить pending → running і збільшує attempts', () => {
    const enqueued = db.runTasks.enqueue(s.runId, { stage: 'judge', payload: null });

    const claimed = db.runTasks.claimNext(s.runId);
    expect(claimed).toMatchObject({ id: enqueued.id, status: 'running', attempts: 1 });

    // другого pending немає
    expect(db.runTasks.claimNext(s.runId)).toBeNull();
  });

  it('claimNext ніколи не віддає те саме завдання двічі', () => {
    db.runTasks.enqueueMany(
      s.runId,
      Array.from({ length: 25 }, (_, i) => ({ stage: 'judge', payload: { i } })),
    );

    const seen: number[] = [];
    for (;;) {
      const task = db.runTasks.claimNext(s.runId);
      if (!task) break;
      seen.push(task.id);
      if (seen.length > 100) throw new Error('claimNext не завершується');
    }

    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
    expect(db.runs.taskCounts(s.runId)).toMatchObject({ pending: 0, running: 25 });
  });

  it('claimNext із фільтром за етапом', () => {
    db.runTasks.enqueueMany(s.runId, [
      { stage: 'doc_profile', payload: 1 },
      { stage: 'judge', payload: 2 },
      { stage: 'judge', payload: 3 },
    ]);

    const judge = db.runTasks.claimNext(s.runId, 'judge');
    expect(judge?.stage).toBe('judge');
    expect(judge?.payload).toBe(2);
    expect(db.runTasks.claimNext(s.runId, 'critic')).toBeNull();
  });

  it('complete / fail / skip і повторна постановка в чергу', () => {
    db.runTasks.enqueueMany(s.runId, [
      { stage: 'judge', payload: 1 },
      { stage: 'judge', payload: 2 },
      { stage: 'judge', payload: 3 },
    ]);

    const a = db.runTasks.claimNext(s.runId);
    const b = db.runTasks.claimNext(s.runId);
    const c = db.runTasks.claimNext(s.runId);
    expect(a && b && c).toBeTruthy();
    if (!a || !b || !c) return;

    db.runTasks.complete(a.id);
    db.runTasks.fail(b.id, '429 rate limit');
    db.runTasks.skip(c.id, 'вимога N/A');

    expect(db.runs.taskCounts(s.runId)).toEqual({
      pending: 0,
      running: 0,
      done: 1,
      failed: 1,
      skipped: 1,
      total: 3,
    });
    expect(db.runTasks.get(b.id)?.lastError).toBe('429 rate limit');

    expect(db.runTasks.requeueFailed(s.runId)).toBe(1);
    const retried = db.runTasks.claimNext(s.runId);
    expect(retried?.id).toBe(b.id);
    expect(retried?.attempts).toBe(2);
  });

  it('fail(retry) одразу повертає завдання в чергу', () => {
    db.runTasks.enqueue(s.runId, { stage: 'judge', payload: 1 });
    const task = db.runTasks.claimNext(s.runId);
    if (!task) throw new Error('немає завдання');

    db.runTasks.fail(task.id, 'таймаут', true);
    expect(db.runTasks.get(task.id)?.status).toBe('pending');
    expect(db.runTasks.claimNext(s.runId)?.attempts).toBe(2);
  });

  it('requeueStale повертає завислі running після падіння процесу', () => {
    db.runTasks.enqueueMany(s.runId, [
      { stage: 'judge', payload: 1 },
      { stage: 'judge', payload: 2 },
    ]);
    db.runTasks.claimNext(s.runId);
    db.runTasks.claimNext(s.runId);
    expect(db.runs.taskCounts(s.runId).running).toBe(2);

    expect(db.runTasks.requeueStale(s.runId)).toBe(2);
    expect(db.runs.taskCounts(s.runId).pending).toBe(2);
  });

  it('progress рахує done+skipped і показує поточний етап', () => {
    db.runTasks.enqueueMany(s.runId, [
      { stage: 'judge', payload: 1 },
      { stage: 'judge', payload: 2 },
      { stage: 'critic', payload: 3 },
    ]);
    db.runs.markStarted(s.runId);
    const first = db.runTasks.claimNext(s.runId);
    if (first) db.runTasks.complete(first.id);

    const progress = db.runs.progress(s.runId);
    expect(progress).toMatchObject({
      runId: s.runId,
      status: 'running',
      stage: 'judge',
      tasksTotal: 3,
      tasksDone: 1,
      tasksFailed: 0,
    });
  });

  it('невідомий стейдж у черзі не ламає RunProgress.stage', () => {
    db.runTasks.enqueue(s.runId, { stage: 'profile', payload: null });
    expect(db.runs.progress(s.runId).stage).toBeNull();
  });
});

describe('claimNext під конкурентністю (два з’єднання, файлова БД)', () => {
  it('двоє воркерів разом розбирають чергу без дублів і без втрат', () => {
    const dir = mkdtempSync(join(tmpdir(), 'super-auditor-db-'));
    const path = join(dir, 'auditor.db');

    const owner = createDb(path);
    try {
      const fixture = seed({ db: owner });
      const TASKS = 200;
      owner.runTasks.enqueueMany(
        fixture.runId,
        Array.from({ length: TASKS }, (_, i) => ({ stage: 'judge', payload: { i } })),
      );

      const workerA = createDb(path);
      const workerB = createDb(path);
      try {
        const claimedA: number[] = [];
        const claimedB: number[] = [];

        // better-sqlite3 синхронний, тож «одночасність» тут — це чергування
        // викликів двох незалежних з'єднань до одного файлу.
        for (let i = 0; i < TASKS + 10; i += 1) {
          const a = workerA.runTasks.claimNext(fixture.runId);
          if (a) claimedA.push(a.id);
          const b = workerB.runTasks.claimNext(fixture.runId);
          if (b) claimedB.push(b.id);
          if (!a && !b) break;
        }

        const all = [...claimedA, ...claimedB];
        expect(all).toHaveLength(TASKS);
        expect(new Set(all).size).toBe(TASKS); // жодного дубля
        expect(claimedA.length).toBeGreaterThan(0);
        expect(claimedB.length).toBeGreaterThan(0);

        // Кожне завдання забрано рівно один раз → attempts = 1 у всіх.
        const attempts = owner.raw
          .prepare<[number], { attempts: number; n: number }>(
            'SELECT attempts, COUNT(*) AS n FROM run_task WHERE run_id = ? GROUP BY attempts',
          )
          .all(fixture.runId);
        expect(attempts).toEqual([{ attempts: 1, n: TASKS }]);

        expect(owner.runs.taskCounts(fixture.runId)).toMatchObject({ pending: 0, running: TASKS });
      } finally {
        workerA.close();
        workerB.close();
      }
    } finally {
      owner.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('другий воркер бачить завершення першого', () => {
    const dir = mkdtempSync(join(tmpdir(), 'super-auditor-db-'));
    const path = join(dir, 'auditor.db');

    const owner = createDb(path);
    const other = createDb(path);
    try {
      const fixture = seed({ db: owner });
      owner.runTasks.enqueueMany(fixture.runId, [
        { stage: 'judge', payload: 1 },
        { stage: 'judge', payload: 2 },
      ]);

      const first = owner.runTasks.claimNext(fixture.runId);
      if (!first) throw new Error('немає завдання');
      owner.runTasks.complete(first.id);

      expect(other.runTasks.get(first.id)?.status).toBe('done');
      const second = other.runTasks.claimNext(fixture.runId);
      expect(second?.id).not.toBe(first.id);
      expect(other.runs.taskCounts(fixture.runId)).toMatchObject({ done: 1, running: 1, pending: 0 });
    } finally {
      other.close();
      owner.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
