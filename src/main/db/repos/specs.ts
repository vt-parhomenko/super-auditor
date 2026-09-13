/**
 * Специфікації, їхні версії та `spec_summary`.
 *
 * `SpecVersionDto` несе лічильники вимог (`clauseCount`, `reviewedClauseCount`) —
 * UI показує «вичитано 47/183» і блокує прогін, поки реєстр не вичитано.
 * Лічильники рахуються підзапитами в тому ж SELECT, щоб не робити N+1.
 */

import type { ClausesStatus, SpecSummaryDto, SpecVersionDto, SpecificationDto } from '@shared/domain';
import {
  nowIso,
  toJson,
  toSpecSummaryDto,
  toSpecVersionDto,
  toSpecificationDto,
  type SpecSummaryRow,
  type SpecVersionRow,
  type SpecificationRow,
} from '../mappers';
import { BaseRepo, toId, type SqliteDb } from '../types';

const VERSION_SELECT = `
  SELECT sv.id, sv.specification_id, sv.version_label, sv.blob_hash, sv.extraction_id,
         sv.effective_from, sv.clauses_status,
         (SELECT COUNT(*) FROM clause c WHERE c.spec_version_id = sv.id) AS clause_count,
         (SELECT COUNT(*) FROM clause c WHERE c.spec_version_id = sv.id
            AND c.review_status IN ('confirmed','edited')) AS reviewed_clause_count
  FROM spec_version sv
`;

export interface SpecificationInput {
  name: string;
  issuer?: string | null;
  code?: string | null;
  cloudAllowed?: boolean;
}

export interface SpecVersionInput {
  specificationId: number;
  versionLabel: string;
  blobHash: string;
  extractionId?: number | null;
  effectiveFrom?: string | null;
  clausesStatus?: ClausesStatus;
}

export interface SpecSummaryInput {
  specVersionId: number;
  summary: string;
  scope?: string | null;
  gradingRules?: string | null;
  sectionSummaries?: Record<string, string>;
  model?: string | null;
  promptVersion?: string | null;
  createdAt?: string;
}

export class SpecsRepo extends BaseRepo {
  constructor(db: SqliteDb) {
    super(db);
  }

  // ─── Специфікації ──────────────────────────────────────────────────────────

  create(input: SpecificationInput): SpecificationDto {
    const res = this.stmt(
      'INSERT INTO specification (name, issuer, code, cloud_allowed) VALUES (?, ?, ?, ?)',
    ).run(input.name, input.issuer ?? null, input.code ?? null, input.cloudAllowed ? 1 : 0);
    const dto = this.get(toId(res));
    if (!dto) throw new Error('Не вдалося прочитати щойно створену специфікацію');
    return dto;
  }

  get(id: number): SpecificationDto | null {
    const row = this.stmt<SpecificationRow>('SELECT * FROM specification WHERE id = ?').get(id);
    if (!row) return null;
    return toSpecificationDto(row, this.listVersions(id));
  }

  list(): SpecificationDto[] {
    const rows = this.stmt<SpecificationRow>(
      'SELECT * FROM specification ORDER BY name, id',
    ).all();
    if (rows.length === 0) return [];

    const versionRows = this.stmt<SpecVersionRow>(
      `${VERSION_SELECT} WHERE sv.specification_id IN (${this.placeholders(rows.length)})
       ORDER BY sv.specification_id, sv.version_label DESC, sv.id DESC`,
    ).all(...rows.map((r) => r.id));

    const bySpec = new Map<number, SpecVersionDto[]>();
    for (const vr of versionRows) {
      const list = bySpec.get(vr.specification_id);
      if (list) list.push(toSpecVersionDto(vr));
      else bySpec.set(vr.specification_id, [toSpecVersionDto(vr)]);
    }

    return rows.map((row) => toSpecificationDto(row, bySpec.get(row.id) ?? []));
  }

  /** ADR-8: явне рішення користувача про відправку вмісту в хмарний API. */
  setCloudAllowed(specificationId: number, allowed: boolean): void {
    this.stmt('UPDATE specification SET cloud_allowed = ? WHERE id = ?').run(allowed ? 1 : 0, specificationId);
  }

  update(id: number, patch: Partial<SpecificationInput>): SpecificationDto | null {
    const sets: string[] = [];
    const params: Array<string | number | null> = [];
    if (patch.name !== undefined) {
      sets.push('name = ?');
      params.push(patch.name);
    }
    if (patch.issuer !== undefined) {
      sets.push('issuer = ?');
      params.push(patch.issuer);
    }
    if (patch.code !== undefined) {
      sets.push('code = ?');
      params.push(patch.code);
    }
    if (patch.cloudAllowed !== undefined) {
      sets.push('cloud_allowed = ?');
      params.push(patch.cloudAllowed ? 1 : 0);
    }
    if (sets.length > 0) {
      params.push(id);
      this.stmt(`UPDATE specification SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }
    return this.get(id);
  }

  delete(id: number): boolean {
    return this.stmt('DELETE FROM specification WHERE id = ?').run(id).changes > 0;
  }

  // ─── Версії ────────────────────────────────────────────────────────────────

  addVersion(input: SpecVersionInput): SpecVersionDto {
    const res = this.stmt(
      `INSERT INTO spec_version
         (specification_id, version_label, blob_hash, extraction_id, effective_from, clauses_status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      input.specificationId,
      input.versionLabel,
      input.blobHash,
      input.extractionId ?? null,
      input.effectiveFrom ?? null,
      input.clausesStatus ?? 'pending',
    );
    const dto = this.getVersion(toId(res));
    if (!dto) throw new Error('Не вдалося прочитати щойно створену версію специфікації');
    return dto;
  }

  getVersion(id: number): SpecVersionDto | null {
    const row = this.stmt<SpecVersionRow>(`${VERSION_SELECT} WHERE sv.id = ?`).get(id);
    return row ? toSpecVersionDto(row) : null;
  }

  listVersions(specificationId: number): SpecVersionDto[] {
    return this.stmt<SpecVersionRow>(
      `${VERSION_SELECT} WHERE sv.specification_id = ? ORDER BY sv.version_label DESC, sv.id DESC`,
    )
      .all(specificationId)
      .map(toSpecVersionDto);
  }

  findVersionByBlob(blobHash: string): SpecVersionDto | null {
    const row = this.stmt<SpecVersionRow>(
      `${VERSION_SELECT} WHERE sv.blob_hash = ? ORDER BY sv.id LIMIT 1`,
    ).get(blobHash);
    return row ? toSpecVersionDto(row) : null;
  }

  setClausesStatus(specVersionId: number, status: ClausesStatus): void {
    this.stmt('UPDATE spec_version SET clauses_status = ? WHERE id = ?').run(status, specVersionId);
  }

  setVersionExtraction(specVersionId: number, extractionId: number | null): void {
    this.stmt('UPDATE spec_version SET extraction_id = ? WHERE id = ?').run(extractionId, specVersionId);
  }

  deleteVersion(id: number): boolean {
    return this.stmt('DELETE FROM spec_version WHERE id = ?').run(id).changes > 0;
  }

  /** Прогін аудиту заблокований, поки реєстр не вичитано (Stage 1). */
  isReviewed(specVersionId: number): boolean {
    const row = this.stmt<{ clauses_status: string }>(
      'SELECT clauses_status FROM spec_version WHERE id = ?',
    ).get(specVersionId);
    return row?.clauses_status === 'reviewed';
  }

  // ─── spec_summary ──────────────────────────────────────────────────────────

  getSummary(specVersionId: number): SpecSummaryDto | null {
    const row = this.stmt<SpecSummaryRow>(
      'SELECT * FROM spec_summary WHERE spec_version_id = ?',
    ).get(specVersionId);
    return row ? toSpecSummaryDto(row) : null;
  }

  upsertSummary(input: SpecSummaryInput): SpecSummaryDto {
    this.stmt(
      `INSERT INTO spec_summary
         (spec_version_id, summary, scope, grading_rules, section_summaries, model, prompt_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(spec_version_id) DO UPDATE SET
         summary = excluded.summary,
         scope = excluded.scope,
         grading_rules = excluded.grading_rules,
         section_summaries = excluded.section_summaries,
         model = excluded.model,
         prompt_version = excluded.prompt_version,
         created_at = excluded.created_at`,
    ).run(
      input.specVersionId,
      input.summary,
      input.scope ?? null,
      input.gradingRules ?? null,
      toJson(input.sectionSummaries ?? {}),
      input.model ?? null,
      input.promptVersion ?? null,
      input.createdAt ?? nowIso(),
    );
    const dto = this.getSummary(input.specVersionId);
    if (!dto) throw new Error('Не вдалося прочитати щойно збережений spec_summary');
    return dto;
  }

  /** Правила оцінювання підставляються в system-промпт судді (Stage 4). */
  gradingRules(specVersionId: number): string | null {
    const row = this.stmt<{ grading_rules: string | null }>(
      'SELECT grading_rules FROM spec_summary WHERE spec_version_id = ?',
    ).get(specVersionId);
    return row?.grading_rules ?? null;
  }

  deleteSummary(specVersionId: number): boolean {
    return this.stmt('DELETE FROM spec_summary WHERE spec_version_id = ?').run(specVersionId).changes > 0;
  }
}
