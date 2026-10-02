/**
 * Findings і людське рев'ю.
 *
 * Рев'ю ніколи не перезаписує машинний вердикт: `finding_review` лежить окремо,
 * а UI показує ефективний вердикт (`effectiveVerdict`). Так видно, де людина
 * не погодилась з моделлю — це вхід для eval.
 */

import type { IpcHandlers } from '@shared/ipc';
import type { IpcContext } from '../context';
import { notFound, validation } from '../errors';
import { requireId, requireRun } from './guards';

export type FindingHandlers = Pick<
  IpcHandlers,
  'findings:list' | 'findings:get' | 'findings:review' | 'findings:clearReview'
>;

const MAX_PAGE = 500;

export function findingHandlers(ctx: IpcContext): FindingHandlers {
  const { db } = ctx;

  return {
    'findings:list': (query) => {
      if (!query || typeof query !== 'object') throw validation((m) => m.findings.emptyQuery);
      requireRun(db, query.runId);
      // Ліміт зверху: renderer малює віртуалізований список, а не 20 тисяч рядків.
      const limit = Math.min(query.limit ?? 100, MAX_PAGE);
      return db.findings.list({ ...query, limit });
    },

    'findings:get': (findingId) => db.findings.get(requireId(findingId, 'findingId')),

    'findings:review': (findingId, review) => {
      const finding = db.findings.get(requireId(findingId, 'findingId'));
      if (!finding) throw notFound('finding', findingId);

      return db.findings.saveReview(finding.id, {
        humanVerdict: review?.humanVerdict ?? null,
        humanSeverity: review?.humanSeverity ?? null,
        note: review?.note ?? null,
      });
    },

    'findings:clearReview': (findingId) => {
      if (!db.findings.get(requireId(findingId, 'findingId'))) throw notFound('finding', findingId);
      db.findings.clearReview(findingId);
    },
  };
}
