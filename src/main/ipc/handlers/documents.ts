/**
 * Бібліотека документів. Чисте читання/запис через репозиторії.
 *
 * Видалення документа живе в `library:delete` (handlers/library.ts): воно зачіпає
 * перевірки й файли, тож має одне місце для документів і специфікацій.
 */

import type { IpcHandlers } from '@shared/ipc';
import type { IpcContext } from '../context';
import { notFound } from '../errors';
import { requireId } from './guards';

export type DocumentHandlers = Pick<
  IpcHandlers,
  'documents:list' | 'documents:get' | 'documents:update' | 'documents:runs'
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
  };
}
