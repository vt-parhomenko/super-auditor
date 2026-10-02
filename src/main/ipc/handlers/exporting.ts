/** Stage 6 — експорт результатів прогону. Формує файл оркестратор. */

import type { ExportFormat, IpcHandlers } from '@shared/ipc';
import type { IpcContext } from '../context';
import { validation } from '../errors';
import { requireOrchestrator } from '../orchestratorPort';
import { requireRun } from './guards';

export type ExportHandlers = Pick<IpcHandlers, 'export:run'>;

const FORMATS: readonly ExportFormat[] = ['xlsx', 'markdown', 'pdf', 'json'];

export function exportHandlers(ctx: IpcContext): ExportHandlers {
  const { db } = ctx;

  return {
    'export:run': async (runId, format) => {
      requireRun(db, runId);
      if (!FORMATS.includes(format)) {
        throw validation((m) => m.exporting.unknownFormat(String(JSON.stringify(format))));
      }
      return requireOrchestrator().exportRun(runId, format);
    },
  };
}
