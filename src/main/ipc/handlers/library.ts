/**
 * Видалення специфікацій і документів (цілих або однієї версії).
 *
 * Хендлери тонкі: уся логіка — у `pipeline/libraryDeletion` (план, зупинка
 * живих перевірок, транзакція, прибирання файлів). Тут лише перевірка входу,
 * зрозуміле «не знайдено» і події для renderer.
 */

import { isLibraryDeleteKind, type IpcHandlers, type LibraryDeleteTarget } from '@shared/ipc';
import { deleteFromLibrary, libraryDeleteImpact } from '@main/pipeline/libraryDeletion';
import type { IpcContext } from '../context';
import { notFound, validation } from '../errors';
import { requireOrchestrator } from '../orchestratorPort';
import { requireId } from './guards';

export type LibraryHandlers = Pick<IpcHandlers, 'library:deleteImpact' | 'library:delete'>;

/** Межа довіри: renderer типізований, але сюди може прийти що завгодно. */
function requireDeleteTarget(value: unknown): LibraryDeleteTarget {
  const kind = typeof value === 'object' && value !== null ? (value as { kind?: unknown }).kind : undefined;
  if (!isLibraryDeleteKind(kind)) {
    throw validation((m) => m.library.invalidTarget(String(JSON.stringify(value ?? null))));
  }
  const id = requireId((value as { id?: unknown }).id, `${kind}Id`);
  return { kind, id };
}

export function libraryHandlers(ctx: IpcContext): LibraryHandlers {
  const { db, events } = ctx;

  return {
    'library:deleteImpact': (target) => {
      const checked = requireDeleteTarget(target);
      const impact = libraryDeleteImpact(db, checked);
      if (!impact) throw notFound(checked.kind, checked.id);
      return impact;
    },

    'library:delete': async (target) => {
      const checked = requireDeleteTarget(target);
      const impact = await deleteFromLibrary(
        // Оркестратор беремо лише тоді, коли справді є що зупиняти: видалення
        // без живих перевірок не мусить залежати від того, чи він підключений.
        { db, cancelRun: (runId) => requireOrchestrator().cancelRun(runId) },
        checked,
      );
      if (!impact) throw notFound(checked.kind, checked.id);

      const isSpec = checked.kind === 'specification' || checked.kind === 'specVersion';
      if (isSpec) events.emit('library:changed', { kind: 'specifications' });
      // Картки документів показують останню перевірку — після видалення перевірок
      // за стандартом вони теж застаріли.
      if (!isSpec || impact.runs.length > 0) events.emit('library:changed', { kind: 'documents' });
      return impact;
    },
  };
}
