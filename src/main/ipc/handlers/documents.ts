/** Бібліотека документів. Чисте читання/запис через репозиторії. */

import type { IpcHandlers } from '@shared/ipc';
import type { IpcContext } from '../context';
import { notFound, validation } from '../errors';
import { requireId } from './guards';

export type DocumentHandlers = Pick<
  IpcHandlers,
  'documents:list' | 'documents:get' | 'documents:update' | 'documents:delete' | 'documents:runs'
>;

export function documentHandlers(ctx: IpcContext): DocumentHandlers {
  const { db, events } = ctx;

  return {
    // Картка документа показує метрики останнього прогону, тож список одразу
    // йде зі статистикою — інакше renderer робив би N запитів на N карток.
    'documents:list': (query) => {
      const documents = db.documents.list(query ?? {});
      const latest = db.runs.latestForDocuments(documents.map((d) => d.id));
      return documents.map((d) => ({ ...d, lastRun: latest.get(d.id) ?? null }));
    },

    'documents:get': (documentId) => {
      const id = requireId(documentId, 'documentId');
      const document = db.documents.get(id);
      if (!document) return null;
      return { ...document, lastRun: db.runs.forDocument(id)[0] ?? null };
    },

    'documents:runs': (documentId) => db.runs.forDocument(requireId(documentId, 'documentId')),

    'documents:update': (documentId, patch) => {
      const updated = db.documents.update(requireId(documentId, 'documentId'), patch);
      if (!updated) throw notFound('document', documentId);
      events.emit('library:changed', { kind: 'documents' });
    },

    'documents:delete': (documentId) => {
      const document = db.documents.get(requireId(documentId, 'documentId'));
      if (!document) throw notFound('document', documentId);

      // Версію, яку вже судили, БД не віддасть видалити (FOREIGN KEY на
      // audit_run_document). Кажемо це людською мовою, а не «constraint failed».
      const versionIds = new Set(document.versions.map((version) => version.id));
      const blocking = db.runs
        .list()
        .filter((run) => run.documentVersionIds.some((id) => versionIds.has(id)));
      if (blocking.length > 0) {
        throw validation((m) => m.documents.usedInRuns(blocking.length), {
          runIds: blocking.map((run) => run.id),
        });
      }

      // Блоби лишаються на диску: їх може ділити інший документ (content-addressed
      // сховище дедуплікує), прибирає їх окремий збирач сміття по listOrphans().
      db.documents.delete(document.id);
      events.emit('library:changed', { kind: 'documents' });
    },
  };
}
