/**
 * Профілі виробництва та Stage 3 — детермінований фільтр застосовності.
 *
 * ADR-4: `not_applicable` ніколи не вирішує модель. Правила рахуються тут,
 * матеріалізуються в `clause_applicability` і редагуються людиною.
 */

import { computeApplicability } from '@main/pipeline/applicability';
import type { IpcHandlers } from '@shared/ipc';
import type { IpcContext } from '../context';
import { validation } from '../errors';
import { requireClause, requireId, requireSiteProfile, requireSpecVersion } from './guards';

export type SiteHandlers = Pick<
  IpcHandlers,
  | 'sites:list'
  | 'sites:save'
  | 'sites:delete'
  | 'sites:recomputeApplicability'
  | 'sites:setApplicabilityOverride'
>;

export function siteHandlers(ctx: IpcContext): SiteHandlers {
  const { db } = ctx;

  return {
    'sites:list': () => db.siteProfiles.list(),

    'sites:save': (profile) => {
      const name = String(profile?.name ?? '').trim();
      if (name.length === 0) throw validation('Назва профілю виробництва не може бути порожньою');
      if (profile.id !== undefined) requireSiteProfile(db, profile.id);

      return db.siteProfiles.save({
        ...profile,
        name,
        modules: profile.modules ?? [],
        certifications: profile.certifications ?? [],
        products: profile.products ?? [],
        processes: profile.processes ?? [],
        notes: profile.notes ?? null,
      });
    },

    'sites:delete': (siteProfileId) => {
      requireSiteProfile(db, siteProfileId);
      db.siteProfiles.delete(siteProfileId);
    },

    'sites:recomputeApplicability': (siteProfileId, specVersionId) => {
      const site = requireSiteProfile(db, siteProfileId);
      requireSpecVersion(db, specVersionId);

      const clauses = db.clauses.list(specVersionId);
      if (clauses.length === 0) {
        throw validation('У версії специфікації ще немає вимог — спочатку Stage 1', {
          specVersionId,
        });
      }

      const report = computeApplicability(clauses, site);
      // Рядки з overridden_by_user = 1 репозиторій не чіпає — рішення людини головніше.
      return db.siteProfiles.recompute(
        site.id,
        clauses.map((clause) => {
          const decision = report.decisions.get(clause.id);
          return {
            clauseId: clause.id,
            applicable: decision?.applicable ?? true,
            reason: decision?.reason ?? 'in scope',
          };
        }),
      );
    },

    'sites:setApplicabilityOverride': (siteProfileId, clauseId, applicable, reason) => {
      requireSiteProfile(db, siteProfileId);
      requireClause(db, clauseId);
      const text = String(reason ?? '').trim();
      if (text.length === 0) throw validation('Причина перевизначення обовʼязкова');
      db.siteProfiles.setOverride(
        requireId(siteProfileId, 'siteProfileId'),
        requireId(clauseId, 'clauseId'),
        Boolean(applicable),
        text,
      );
    },
  };
}
