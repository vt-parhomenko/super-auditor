/**
 * Findings, докази та людське рев'ю.
 *
 * ADR-6: `finding.verdict` — це вердикт моделі, він НІКОЛИ не перезаписується.
 * Людська правка живе окремо в `finding_review` і накладається зверху при
 * читанні (`effectiveVerdict`). Саме тому пара (ai, human) придатна як eval-набір.
 *
 * `list()` тягне докази й рев'ю пакетно: сторінка на 50 findings — це 3 запити,
 * а не 101.
 */

import type {
  EvidenceDto,
  EvidenceSource,
  FindingDto,
  FindingQuery,
  HumanReviewDto,
  Severity,
  Verdict,
} from '@shared/domain';
import {
  FINDING_CLAUSE_COLUMNS,
  nowIso,
  toEvidenceDto,
  toFindingDto,
  toHumanReviewDto,
  type EvidenceRow,
  type FindingJoinedRow,
  type FindingReviewRow,
} from '../mappers';
import { BaseRepo, toId, type SqliteDb } from '../types';
import { escapeLike } from './documents';

export interface EvidenceInput {
  documentVersionId: number;
  quote: string;
  pageNo?: number | null;
  charStart?: number | null;
  charEnd?: number | null;
  source: EvidenceSource;
  verified?: boolean;
}

export interface FindingInput {
  runId: number;
  clauseId: number;
  /** null — зведений finding по всьому набору документів. */
  documentVersionId: number | null;
  verdict: Verdict;
  severity?: Severity | null;
  confidence?: number | null;
  rationale: string;
  gap?: string | null;
  recommendation?: string | null;
  /** Що перевірити поза документом (записи, огляд на місці) — див. `FindingDto.outsideEvidence`. */
  outsideEvidence?: string | null;
  createdAt?: string;
  evidence?: EvidenceInput[];
}

export interface HumanReviewInput {
  humanVerdict: Verdict | null;
  humanSeverity: Severity | null;
  note: string | null;
  reviewedAt?: string;
}

export interface FindingPage {
  items: FindingDto[];
  total: number;
}

const FINDING_SELECT = `
  SELECT f.*, ${FINDING_CLAUSE_COLUMNS}
  FROM finding f
  JOIN clause c ON c.id = f.clause_id
`;

export class FindingsRepo extends BaseRepo {
  constructor(db: SqliteDb) {
    super(db);
  }

  // ─── Запис ─────────────────────────────────────────────────────────────────

  /**
   * Вставка або оновлення за UNIQUE (run_id, clause_id, document_version_id).
   * Докази перезаписуються цілком: повторний прогін вимоги має давати
   * той самий стан, а не накопичувати дублікати цитат.
   *
   * Увага: для зведеного finding (`documentVersionId = null`) UNIQUE не працює —
   * у SQLite NULL != NULL. Такі рядки шукаємо явно.
   */
  upsert(input: FindingInput): FindingDto {
    const write = this.db.transaction((): number => {
      const existingId = this.findId(input.runId, input.clauseId, input.documentVersionId);
      let id: number;

      if (existingId === null) {
        const res = this.stmt(
          `INSERT INTO finding
             (run_id, clause_id, document_version_id, verdict, severity, confidence,
              rationale, gap, recommendation, outside_evidence, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          input.runId,
          input.clauseId,
          input.documentVersionId,
          input.verdict,
          input.severity ?? null,
          input.confidence ?? null,
          input.rationale,
          input.gap ?? null,
          input.recommendation ?? null,
          input.outsideEvidence ?? null,
          input.createdAt ?? nowIso(),
        );
        id = toId(res);
      } else {
        id = existingId;
        this.stmt(
          `UPDATE finding SET verdict = ?, severity = ?, confidence = ?, rationale = ?,
                              gap = ?, recommendation = ?, outside_evidence = ?, created_at = ?
            WHERE id = ?`,
        ).run(
          input.verdict,
          input.severity ?? null,
          input.confidence ?? null,
          input.rationale,
          input.gap ?? null,
          input.recommendation ?? null,
          input.outsideEvidence ?? null,
          input.createdAt ?? nowIso(),
          id,
        );
      }

      if (input.evidence !== undefined) this.replaceEvidenceInternal(id, input.evidence);
      return id;
    });

    const id = write();
    const dto = this.get(id);
    if (!dto) throw new Error(`Не вдалося прочитати finding ${id}`);
    return dto;
  }

  /** Пакетна вставка результату одного judge-виклику — одна транзакція. */
  upsertMany(inputs: readonly FindingInput[]): FindingDto[] {
    const write = this.db.transaction((items: readonly FindingInput[]): FindingDto[] =>
      items.map((item) => this.upsert(item)),
    );
    return write(inputs);
  }

  findId(runId: number, clauseId: number, documentVersionId: number | null): number | null {
    const row =
      documentVersionId === null
        ? this.stmt<{ id: number }>(
            'SELECT id FROM finding WHERE run_id = ? AND clause_id = ? AND document_version_id IS NULL',
          ).get(runId, clauseId)
        : this.stmt<{ id: number }>(
            'SELECT id FROM finding WHERE run_id = ? AND clause_id = ? AND document_version_id = ?',
          ).get(runId, clauseId, documentVersionId);
    return row ? row.id : null;
  }

  delete(id: number): boolean {
    return this.stmt('DELETE FROM finding WHERE id = ?').run(id).changes > 0;
  }

  deleteByRun(runId: number): number {
    return this.stmt('DELETE FROM finding WHERE run_id = ?').run(runId).changes;
  }

  // ─── Читання ───────────────────────────────────────────────────────────────

  get(id: number): FindingDto | null {
    const row = this.stmt<FindingJoinedRow>(`${FINDING_SELECT} WHERE f.id = ?`).get(id);
    if (!row) return null;
    const evidence = this.evidenceFor([row.id]).get(row.id) ?? [];
    const review = this.getReview(row.id);
    return toFindingDto(row, evidence, review);
  }

  /**
   * Сторінка findings із фільтрами IPC-контракту.
   * `total` — кількість до пагінації, рахується тим самим WHERE.
   */
  list(query: FindingQuery): FindingPage {
    const { where, params } = this.buildWhere(query);
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

    const countRow = this.stmt<{ n: number }>(
      `SELECT COUNT(*) AS n FROM finding f JOIN clause c ON c.id = f.clause_id${whereSql}`,
    ).get(...params);
    const total = countRow?.n ?? 0;

    const limit = query.limit ?? -1; // -1 = без обмеження (семантика SQLite)
    const offset = query.offset ?? 0;

    const rows = this.stmt<FindingJoinedRow>(
      `${FINDING_SELECT}${whereSql}
       ORDER BY c.sort_key, f.document_version_id, f.id
       LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset);

    return { items: this.hydrate(rows), total };
  }

  /** Усі findings прогону без пагінації — для експорту й діфів. */
  listByRun(runId: number): FindingDto[] {
    const rows = this.stmt<FindingJoinedRow>(
      `${FINDING_SELECT} WHERE f.run_id = ? ORDER BY c.sort_key, f.document_version_id, f.id`,
    ).all(runId);
    return this.hydrate(rows);
  }

  /** Лічильники вердиктів прогону з урахуванням людських правок. */
  countsByVerdict(runId: number): Array<{ verdict: Verdict; count: number }> {
    return this.stmt<{ eff_verdict: string; n: number }>(
      // Псевдонім НЕ може називатись `verdict`: у SQLite GROUP BY спершу шукає
      // однойменну колонку таблиці (f.verdict), і групування піде не по тому виразу.
      `SELECT COALESCE(fr.human_verdict, f.verdict) AS eff_verdict, COUNT(*) AS n
       FROM finding f
       LEFT JOIN finding_review fr ON fr.finding_id = f.id
       WHERE f.run_id = ?
       GROUP BY eff_verdict`,
    )
      .all(runId)
      .map((row) => ({ verdict: row.eff_verdict as Verdict, count: row.n }));
  }

  // ─── Докази ────────────────────────────────────────────────────────────────

  addEvidence(findingId: number, evidence: readonly EvidenceInput[]): EvidenceDto[] {
    const insert = this.db.transaction((items: readonly EvidenceInput[]) => {
      for (const item of items) this.insertEvidence(findingId, item);
    });
    insert(evidence);
    return this.listEvidence(findingId);
  }

  replaceEvidence(findingId: number, evidence: readonly EvidenceInput[]): EvidenceDto[] {
    this.db.transaction(() => this.replaceEvidenceInternal(findingId, evidence))();
    return this.listEvidence(findingId);
  }

  listEvidence(findingId: number): EvidenceDto[] {
    return this.stmt<EvidenceRow>(
      'SELECT * FROM finding_evidence WHERE finding_id = ? ORDER BY id',
    )
      .all(findingId)
      .map(toEvidenceDto);
  }

  /** Пост-верифікація цитат (Stage 5). */
  setEvidenceVerified(evidenceId: number, verified: boolean): void {
    this.stmt('UPDATE finding_evidence SET verified = ? WHERE id = ?').run(verified ? 1 : 0, evidenceId);
  }

  /** «compliant без жодного verified-доказу» — кандидат на needs_human_review. */
  hasVerifiedEvidence(findingId: number): boolean {
    const row = this.stmt<{ n: number }>(
      'SELECT COUNT(*) AS n FROM finding_evidence WHERE finding_id = ? AND verified = 1',
    ).get(findingId);
    return (row?.n ?? 0) > 0;
  }

  // ─── Рев'ю ─────────────────────────────────────────────────────────────────

  getReview(findingId: number): HumanReviewDto | null {
    const row = this.stmt<FindingReviewRow>(
      'SELECT * FROM finding_review WHERE finding_id = ?',
    ).get(findingId);
    return row ? toHumanReviewDto(row) : null;
  }

  saveReview(findingId: number, review: HumanReviewInput): HumanReviewDto {
    this.stmt(
      `INSERT INTO finding_review (finding_id, human_verdict, human_severity, note, reviewed_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(finding_id) DO UPDATE SET
         human_verdict = excluded.human_verdict,
         human_severity = excluded.human_severity,
         note = excluded.note,
         reviewed_at = excluded.reviewed_at`,
    ).run(
      findingId,
      review.humanVerdict,
      review.humanSeverity,
      review.note,
      review.reviewedAt ?? nowIso(),
    );
    const dto = this.getReview(findingId);
    if (!dto) throw new Error(`Не вдалося прочитати рев'ю finding ${findingId}`);
    return dto;
  }

  clearReview(findingId: number): boolean {
    return this.stmt('DELETE FROM finding_review WHERE finding_id = ?').run(findingId).changes > 0;
  }

  /** Кейси для eval: людина не погодилась із моделлю (§14). */
  disagreements(runId: number): FindingDto[] {
    const rows = this.stmt<FindingJoinedRow>(
      `${FINDING_SELECT}
       JOIN finding_review fr ON fr.finding_id = f.id
       WHERE f.run_id = ? AND fr.human_verdict IS NOT NULL AND fr.human_verdict <> f.verdict
       ORDER BY c.sort_key, f.id`,
    ).all(runId);
    return this.hydrate(rows);
  }

  // ─── Внутрішнє ─────────────────────────────────────────────────────────────

  private buildWhere(query: FindingQuery): { where: string[]; params: Array<string | number> } {
    const where: string[] = ['f.run_id = ?'];
    const params: Array<string | number> = [query.runId];

    if (query.verdicts && query.verdicts.length > 0) {
      where.push(`f.verdict IN (${this.placeholders(query.verdicts.length)})`);
      params.push(...query.verdicts);
    }
    if (query.severities && query.severities.length > 0) {
      where.push(`f.severity IN (${this.placeholders(query.severities.length)})`);
      params.push(...query.severities);
    }
    if (query.sectionNo !== undefined) {
      where.push('c.section_no = ?');
      params.push(query.sectionNo);
    }
    if (query.documentVersionId !== undefined) {
      where.push('f.document_version_id = ?');
      params.push(query.documentVersionId);
    }
    if (query.unreviewed !== undefined) {
      where.push(
        query.unreviewed
          ? 'NOT EXISTS (SELECT 1 FROM finding_review fr WHERE fr.finding_id = f.id)'
          : 'EXISTS (SELECT 1 FROM finding_review fr WHERE fr.finding_id = f.id)',
      );
    }
    if (query.search) {
      const like = `%${escapeLike(query.search)}%`;
      where.push(
        "(f.rationale LIKE ? ESCAPE '\\' OR f.gap LIKE ? ESCAPE '\\' OR f.recommendation LIKE ? ESCAPE '\\'" +
          " OR f.outside_evidence LIKE ? ESCAPE '\\'" +
          " OR c.clause_no LIKE ? ESCAPE '\\' OR c.topic LIKE ? ESCAPE '\\' OR c.requirement_text LIKE ? ESCAPE '\\')",
      );
      params.push(like, like, like, like, like, like, like);
    }

    return { where, params };
  }

  /** Пакетне довантаження доказів і рев'ю — без N+1. */
  private hydrate(rows: FindingJoinedRow[]): FindingDto[] {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const evidence = this.evidenceFor(ids);
    const reviews = this.reviewsFor(ids);
    return rows.map((row) => toFindingDto(row, evidence.get(row.id) ?? [], reviews.get(row.id) ?? null));
  }

  private evidenceFor(findingIds: readonly number[]): Map<number, EvidenceDto[]> {
    const out = new Map<number, EvidenceDto[]>();
    if (findingIds.length === 0) return out;
    const rows = this.stmt<EvidenceRow>(
      `SELECT * FROM finding_evidence WHERE finding_id IN (${this.placeholders(findingIds.length)})
       ORDER BY finding_id, id`,
    ).all(...findingIds);
    for (const row of rows) {
      const list = out.get(row.finding_id);
      if (list) list.push(toEvidenceDto(row));
      else out.set(row.finding_id, [toEvidenceDto(row)]);
    }
    return out;
  }

  private reviewsFor(findingIds: readonly number[]): Map<number, HumanReviewDto> {
    const out = new Map<number, HumanReviewDto>();
    if (findingIds.length === 0) return out;
    const rows = this.stmt<FindingReviewRow>(
      `SELECT * FROM finding_review WHERE finding_id IN (${this.placeholders(findingIds.length)})`,
    ).all(...findingIds);
    for (const row of rows) out.set(row.finding_id, toHumanReviewDto(row));
    return out;
  }

  private replaceEvidenceInternal(findingId: number, evidence: readonly EvidenceInput[]): void {
    this.stmt('DELETE FROM finding_evidence WHERE finding_id = ?').run(findingId);
    for (const item of evidence) this.insertEvidence(findingId, item);
  }

  private insertEvidence(findingId: number, item: EvidenceInput): void {
    this.stmt(
      `INSERT INTO finding_evidence
         (finding_id, document_version_id, quote, page_no, char_start, char_end, source, verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      findingId,
      item.documentVersionId,
      item.quote,
      item.pageNo ?? null,
      item.charStart ?? null,
      item.charEnd ?? null,
      item.source,
      item.verified ? 1 : 0,
    );
  }
}

/** Вердикт, який бачить користувач: людський має пріоритет над модельним (ADR-6). */
export function effectiveVerdict(finding: Pick<FindingDto, 'verdict' | 'review'>): Verdict {
  return finding.review?.humanVerdict ?? finding.verdict;
}

export function effectiveSeverity(finding: Pick<FindingDto, 'severity' | 'review'>): Severity | null {
  return finding.review?.humanSeverity ?? finding.severity;
}
