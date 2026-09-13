/**
 * Профілі виробництва й матеріалізована застосовність вимог (ADR-4, Stage 3).
 *
 * Ключове правило: перерахунок детермінованих правил НЕ затирає рядки,
 * позначені `overridden_by_user`. N/A завжди лишається за людиною.
 */

import type { ClauseApplicabilityDto, Module, SiteProfileDto } from '@shared/domain';
import {
  toClauseApplicabilityDto,
  toJson,
  toSiteProfileDto,
  type ClauseApplicabilityRow,
  type SiteProfileRow,
} from '../mappers';
import { BaseRepo, toId, type SqliteDb } from '../types';

export interface SiteProfileInput {
  id?: number;
  name: string;
  modules: Module[];
  certifications: string[];
  products: string[];
  processes: string[];
  notes: string | null;
}

export interface ApplicabilityInput {
  clauseId: number;
  applicable: boolean;
  reason: string;
}

export interface ApplicabilityCounts {
  applicable: number;
  notApplicable: number;
}

export class SiteProfilesRepo extends BaseRepo {
  constructor(db: SqliteDb) {
    super(db);
  }

  // ─── Профілі ───────────────────────────────────────────────────────────────

  list(): SiteProfileDto[] {
    return this.stmt<SiteProfileRow>('SELECT * FROM site_profile ORDER BY name, id')
      .all()
      .map(toSiteProfileDto);
  }

  get(id: number): SiteProfileDto | null {
    const row = this.stmt<SiteProfileRow>('SELECT * FROM site_profile WHERE id = ?').get(id);
    return row ? toSiteProfileDto(row) : null;
  }

  /** Insert або update — рівно те, що потрібно IPC `sites:save`. */
  save(input: SiteProfileInput): SiteProfileDto {
    const modules = toJson(input.modules);
    const certifications = toJson(input.certifications);
    const products = toJson(input.products);
    const processes = toJson(input.processes);

    let id: number;
    if (input.id === undefined) {
      const res = this.stmt(
        `INSERT INTO site_profile (name, modules, certifications, products, processes, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(input.name, modules, certifications, products, processes, input.notes);
      id = toId(res);
    } else {
      this.stmt(
        `UPDATE site_profile
            SET name = ?, modules = ?, certifications = ?, products = ?, processes = ?, notes = ?
          WHERE id = ?`,
      ).run(input.name, modules, certifications, products, processes, input.notes, input.id);
      id = input.id;
    }

    const dto = this.get(id);
    if (!dto) throw new Error(`Профіль виробництва ${id} не знайдено після збереження`);
    return dto;
  }

  delete(id: number): boolean {
    return this.stmt('DELETE FROM site_profile WHERE id = ?').run(id).changes > 0;
  }

  // ─── Застосовність ─────────────────────────────────────────────────────────

  getApplicability(siteProfileId: number, clauseId: number): ClauseApplicabilityDto | null {
    const row = this.stmt<ClauseApplicabilityRow>(
      'SELECT * FROM clause_applicability WHERE site_profile_id = ? AND clause_id = ?',
    ).get(siteProfileId, clauseId);
    return row ? toClauseApplicabilityDto(row) : null;
  }

  listApplicability(siteProfileId: number, specVersionId?: number): ClauseApplicabilityDto[] {
    if (specVersionId === undefined) {
      return this.stmt<ClauseApplicabilityRow>(
        'SELECT * FROM clause_applicability WHERE site_profile_id = ? ORDER BY clause_id',
      )
        .all(siteProfileId)
        .map(toClauseApplicabilityDto);
    }
    return this.stmt<ClauseApplicabilityRow>(
      `SELECT ca.* FROM clause_applicability ca
       JOIN clause c ON c.id = ca.clause_id
       WHERE ca.site_profile_id = ? AND c.spec_version_id = ?
       ORDER BY c.sort_key`,
    )
      .all(siteProfileId, specVersionId)
      .map(toClauseApplicabilityDto);
  }

  /**
   * Результат перерахунку детермінованих правил.
   * Рядки з `overridden_by_user = 1` лишаються недоторканими.
   */
  recompute(siteProfileId: number, rows: readonly ApplicabilityInput[]): ApplicabilityCounts {
    const apply = this.db.transaction((items: readonly ApplicabilityInput[]) => {
      const upsert = this.stmt(
        `INSERT INTO clause_applicability (site_profile_id, clause_id, applicable, reason, overridden_by_user)
         VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(site_profile_id, clause_id) DO UPDATE SET
           applicable = excluded.applicable,
           reason = excluded.reason
         WHERE clause_applicability.overridden_by_user = 0`,
      );
      for (const item of items) {
        upsert.run(siteProfileId, item.clauseId, item.applicable ? 1 : 0, item.reason);
      }
    });
    apply(rows);

    const clauseIds = rows.map((r) => r.clauseId);
    return this.counts(siteProfileId, clauseIds);
  }

  /** Ручне перевизначення користувача — має пріоритет над правилами. */
  setOverride(siteProfileId: number, clauseId: number, applicable: boolean, reason: string): void {
    this.stmt(
      `INSERT INTO clause_applicability (site_profile_id, clause_id, applicable, reason, overridden_by_user)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(site_profile_id, clause_id) DO UPDATE SET
         applicable = excluded.applicable,
         reason = excluded.reason,
         overridden_by_user = 1`,
    ).run(siteProfileId, clauseId, applicable ? 1 : 0, reason);
  }

  clearOverride(siteProfileId: number, clauseId: number): void {
    this.stmt(
      'UPDATE clause_applicability SET overridden_by_user = 0 WHERE site_profile_id = ? AND clause_id = ?',
    ).run(siteProfileId, clauseId);
  }

  /**
   * Id застосовних вимог версії спеки.
   * Відсутність рядка = «застосовно»: правила ще не рахували, а різати набір
   * мовчки не можна (краще зайвий finding, ніж пропущена невідповідність).
   */
  applicableClauseIds(specVersionId: number, siteProfileId: number | null): number[] {
    if (siteProfileId === null) {
      return this.stmt<{ id: number }>(
        'SELECT id FROM clause WHERE spec_version_id = ? ORDER BY sort_key',
      )
        .all(specVersionId)
        .map((r) => r.id);
    }
    return this.stmt<{ id: number }>(
      `SELECT c.id FROM clause c
       LEFT JOIN clause_applicability ca
         ON ca.clause_id = c.id AND ca.site_profile_id = ?
       WHERE c.spec_version_id = ? AND COALESCE(ca.applicable, 1) = 1
       ORDER BY c.sort_key`,
    )
      .all(siteProfileId, specVersionId)
      .map((r) => r.id);
  }

  countApplicable(specVersionId: number, siteProfileId: number | null): number {
    if (siteProfileId === null) {
      const row = this.stmt<{ n: number }>(
        'SELECT COUNT(*) AS n FROM clause WHERE spec_version_id = ?',
      ).get(specVersionId);
      return row?.n ?? 0;
    }
    const row = this.stmt<{ n: number }>(
      `SELECT COUNT(*) AS n FROM clause c
       LEFT JOIN clause_applicability ca
         ON ca.clause_id = c.id AND ca.site_profile_id = ?
       WHERE c.spec_version_id = ? AND COALESCE(ca.applicable, 1) = 1`,
    ).get(siteProfileId, specVersionId);
    return row?.n ?? 0;
  }

  private counts(siteProfileId: number, clauseIds: readonly number[]): ApplicabilityCounts {
    if (clauseIds.length === 0) return { applicable: 0, notApplicable: 0 };
    const row = this.stmt<{ yes: number; no: number }>(
      `SELECT SUM(applicable = 1) AS yes, SUM(applicable = 0) AS no
       FROM clause_applicability
       WHERE site_profile_id = ? AND clause_id IN (${this.placeholders(clauseIds.length)})`,
    ).get(siteProfileId, ...clauseIds);
    return { applicable: Number(row?.yes ?? 0), notApplicable: Number(row?.no ?? 0) };
  }
}
