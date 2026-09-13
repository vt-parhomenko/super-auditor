/**
 * Реєстр вимог: Stage 1 (LLM-екстракт) + обов'язкова ручна вичитка.
 *
 * Поки `clauses_status != 'reviewed'`, прогін аудиту заблокований —
 * тому `clauses:markReviewed` це не косметика, а ворота якості (architecture.md §6).
 */

import type { IpcHandlers } from '@shared/ipc';
import type { IpcContext } from '../context';
import { notFound, validation } from '../errors';
import { requireOrchestrator } from '../orchestratorPort';
import { requireClause, requireId, requireSpecVersion } from './guards';

export type ClauseHandlers = Pick<
  IpcHandlers,
  | 'clauses:list'
  | 'clauses:get'
  | 'clauses:patch'
  | 'clauses:create'
  | 'clauses:delete'
  | 'clauses:extract'
  | 'clauses:markReviewed'
>;

export function clauseHandlers(ctx: IpcContext): ClauseHandlers {
  const { db } = ctx;

  return {
    'clauses:list': (specVersionId) => db.clauses.list(requireId(specVersionId, 'specVersionId')),

    'clauses:get': (clauseId) => db.clauses.get(requireId(clauseId, 'clauseId')),

    'clauses:patch': (clauseId, patch) => {
      requireClause(db, clauseId);
      const updated = db.clauses.patch(clauseId, patch);
      if (!updated) throw notFound('Вимогу', clauseId);
      return updated;
    },

    'clauses:create': (specVersionId, clause) => {
      requireSpecVersion(db, specVersionId);
      const clauseNo = String(clause?.clauseNo ?? '').trim();
      const requirementText = String(clause?.requirementText ?? '').trim();
      if (clauseNo.length === 0) throw validation('Номер вимоги не може бути порожнім');
      if (requirementText.length === 0) throw validation('Текст вимоги не може бути порожнім');

      // Вимога, додана людиною, вичитаною вже є за визначенням.
      return db.clauses.create(specVersionId, {
        ...clause,
        clauseNo,
        requirementText,
        reviewStatus: 'edited',
      });
    },

    'clauses:delete': (clauseId) => {
      if (!db.clauses.delete(requireId(clauseId, 'clauseId'))) throw notFound('Вимогу', clauseId);
    },

    'clauses:extract': async (specVersionId) => {
      const version = requireSpecVersion(db, specVersionId);
      if (version.extractionId === null) {
        throw validation(
          'У версії специфікації немає екстракції тексту — спочатку переімпортуйте файл',
          { specVersionId },
        );
      }
      return requireOrchestrator().extractClauses(specVersionId);
    },

    'clauses:markReviewed': (specVersionId) => {
      requireSpecVersion(db, specVersionId);
      const counts = db.clauses.reviewCounts(specVersionId);
      const total = counts.auto + counts.confirmed + counts.edited + counts.flagged;

      if (total === 0) {
        throw validation('Реєстр порожній — немає чого позначати вичитаним', { specVersionId });
      }

      const pending = counts.auto + counts.flagged;
      if (pending > 0) {
        throw validation(
          `Реєстр не вичитано до кінця: ${counts.auto} без підтвердження, ${counts.flagged} позначено прапорцем`,
          { auto: counts.auto, flagged: counts.flagged, total },
        );
      }

      db.specs.setClausesStatus(specVersionId, 'reviewed');
    },
  };
}
