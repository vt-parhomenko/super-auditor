/** Stage 2 — профілі версій документів. */

import type { IpcHandlers } from '@shared/ipc';
import type { IpcContext } from '../context';
import { validation } from '../errors';
import { requireOrchestrator } from '../orchestratorPort';
import { requireDocumentVersion, requireId } from './guards';

export type DocProfileHandlers = Pick<IpcHandlers, 'docProfiles:get' | 'docProfiles:build'>;

export function docProfileHandlers(ctx: IpcContext): DocProfileHandlers {
  const { db } = ctx;

  return {
    /** Найсвіжіший профіль версії; `null` — Stage 2 ще не проганяли. */
    'docProfiles:get': (documentVersionId) =>
      db.docProfiles.getLatest(requireId(documentVersionId, 'documentVersionId')),

    'docProfiles:build': async (documentVersionId) => {
      const version = requireDocumentVersion(db, documentVersionId);
      if (version.extractionId === null) {
        throw validation((m) => m.docProfiles.noExtraction, { documentVersionId });
      }
      return requireOrchestrator().buildDocProfile(documentVersionId);
    },
  };
}
