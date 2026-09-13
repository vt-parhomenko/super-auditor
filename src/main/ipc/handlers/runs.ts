/**
 * Прогони аудиту.
 *
 * Читальні канали йдуть прямо в репозиторії (better-sqlite3 синхронний —
 * жодного зайвого `async`). Усе, що рухає прогін, делегується оркестратору
 * через `orchestratorPort`: IPC не знає ані про черги, ані про воркери.
 */

import type { RunConfig } from '@shared/domain';
import type { IpcHandlers } from '@shared/ipc';
import type { Db } from '@main/db';
import type { IpcContext } from '../context';
import { notFound, validation } from '../errors';
import { requireOrchestrator } from '../orchestratorPort';
import { requireDocumentVersion, requireId, requireRun, requireSpecVersion } from './guards';

export type RunHandlers = Pick<
  IpcHandlers,
  | 'runs:list'
  | 'runs:get'
  | 'runs:estimate'
  | 'runs:start'
  | 'runs:pause'
  | 'runs:resume'
  | 'runs:cancel'
  | 'runs:progress'
  | 'runs:summary'
  | 'runs:coverage'
  | 'runs:gaps'
  | 'runs:delete'
>;

/**
 * Спільна перевірка конфігурації для `estimate` і `start`.
 *
 * Головні ворота — вичитаний реєстр вимог: якщо Stage 1 не підтверджений
 * людиною, усе, що далі, безглузде (architecture.md §6).
 */
function validateConfig(db: Db, config: RunConfig): void {
  if (!config || typeof config !== 'object') throw validation('Порожня конфігурація прогону');

  const specVersion = requireSpecVersion(db, config.specVersionId);
  if (specVersion.clausesStatus !== 'reviewed') {
    throw validation(
      'Реєстр вимог не вичитано — прогін заблоковано до підтвердження Stage 1',
      { specVersionId: specVersion.id, clausesStatus: specVersion.clausesStatus },
    );
  }

  const documentVersionIds = config.documentVersionIds ?? [];
  if (!Array.isArray(documentVersionIds) || documentVersionIds.length === 0) {
    throw validation('Не вибрано жодного документа для прогону');
  }
  for (const id of documentVersionIds) requireDocumentVersion(db, id);

  if (config.siteProfileId !== null && config.siteProfileId !== undefined) {
    if (!db.siteProfiles.get(requireId(config.siteProfileId, 'siteProfileId'))) {
      throw validation(`Профіль виробництва ${config.siteProfileId} не знайдено`);
    }
  }
}

export function runHandlers(ctx: IpcContext): RunHandlers {
  const { db, events } = ctx;

  return {
    'runs:list': () => db.runs.list(),

    'runs:get': (runId) => db.runs.get(requireId(runId, 'runId')),

    'runs:estimate': async (config) => {
      validateConfig(db, config);
      return requireOrchestrator().estimateRun(config);
    },

    'runs:start': async (config) => {
      validateConfig(db, config);
      return requireOrchestrator().startRun(config);
    },

    'runs:pause': async (runId) => {
      requireRun(db, runId);
      await requireOrchestrator().pauseRun(runId);
    },

    'runs:resume': async (runId) => {
      requireRun(db, runId);
      await requireOrchestrator().resumeRun(runId);
    },

    'runs:cancel': async (runId) => {
      requireRun(db, runId);
      await requireOrchestrator().cancelRun(runId);
    },

    'runs:progress': (runId) => {
      requireRun(db, runId);
      return db.runs.progress(runId);
    },

    'runs:summary': (runId) => {
      requireRun(db, runId);
      return db.runs.summary(runId);
    },

    'runs:coverage': (runId) => {
      requireRun(db, runId);
      return db.runs.coverage(runId);
    },

    'runs:gaps': (runId) => {
      requireRun(db, runId);
      return db.runs.gaps(runId);
    },

    'runs:delete': async (runId) => {
      const run = requireRun(db, runId);

      // Живий прогін спершу зупиняємо: інакше його смуги виконання
      // продовжували б писати findings у щойно видалений рядок.
      if (run.status === 'running' || run.status === 'queued') {
        await requireOrchestrator().cancelRun(run.id);
      }

      // findings, докази, рев'ю, черга завдань і зв'язки з документами йдуть
      // каскадом (ON DELETE CASCADE у схемі). Журнал витрат навмисно лишається:
      // гроші витрачені незалежно від того, чи потрібен нам результат.
      if (!db.runs.delete(run.id)) throw notFound('Прогін', runId);

      events.emit('library:changed', { kind: 'documents' });
    },
  };
}
