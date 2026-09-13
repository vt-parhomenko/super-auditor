/**
 * Реєстр вимог — найкритичніший агрегат (Stage 1).
 *
 * `sortKey` і `textHash` тут ПОХІДНІ: репозиторій перераховує їх сам при кожній
 * зміні `clauseNo`/`requirementText`. Інакше після ручної правки в UI діф версій
 * спеки почне брехати, а сортування розсиплеться.
 */

import { createHash } from 'node:crypto';
import { clauseSortKey, type ClauseDto, type ClausePatch, type Module, type Obligation } from '@shared/domain';
import { toClauseDto, toJson, type ClauseRow } from '../mappers';
import { BaseRepo, toId, type SqliteDb } from '../types';

export interface ClauseInput {
  clauseNo: string;
  requirementText: string;
  sectionNo?: string | null;
  sectionTitle?: string | null;
  topic?: string | null;
  modules?: Module[];
  obligation?: Obligation | null;
  pageFrom?: number | null;
  pageTo?: number | null;
  reviewStatus?: ClauseDto['reviewStatus'];
  /** Якщо не задано — рахується з `requirementText`. */
  textHash?: string;
}

export interface SectionInfo {
  sectionNo: string;
  sectionTitle: string | null;
  clauseCount: number;
}

export type ClauseDiffEntry =
  | { kind: 'added'; clause: ClauseDto }
  | { kind: 'removed'; clause: ClauseDto }
  | { kind: 'modified'; from: ClauseDto; to: ClauseDto }
  | { kind: 'renumbered'; from: ClauseDto; to: ClauseDto };

export interface ClauseDiffResult {
  fromSpecVersionId: number;
  toSpecVersionId: number;
  added: ClauseDto[];
  removed: ClauseDto[];
  modified: Array<{ from: ClauseDto; to: ClauseDto }>;
  renumbered: Array<{ from: ClauseDto; to: ClauseDto }>;
  unchanged: number;
  entries: ClauseDiffEntry[];
}

/**
 * Нормалізація перед хешуванням: пробіли й юнікод-форма не мають створювати
 * фальшиві «modified» у діфі між версіями спеки.
 */
export function normalizeClauseText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

export function clauseTextHash(text: string): string {
  return createHash('sha256').update(normalizeClauseText(text), 'utf8').digest('hex');
}

export class ClausesRepo extends BaseRepo {
  constructor(db: SqliteDb) {
    super(db);
  }

  list(specVersionId: number): ClauseDto[] {
    return this.stmt<ClauseRow>(
      'SELECT * FROM clause WHERE spec_version_id = ? ORDER BY sort_key, clause_no',
    )
      .all(specVersionId)
      .map(toClauseDto);
  }

  listBySection(specVersionId: number, sectionNo: string): ClauseDto[] {
    return this.stmt<ClauseRow>(
      'SELECT * FROM clause WHERE spec_version_id = ? AND section_no = ? ORDER BY sort_key, clause_no',
    )
      .all(specVersionId, sectionNo)
      .map(toClauseDto);
  }

  get(id: number): ClauseDto | null {
    const row = this.stmt<ClauseRow>('SELECT * FROM clause WHERE id = ?').get(id);
    return row ? toClauseDto(row) : null;
  }

  getByNo(specVersionId: number, clauseNo: string): ClauseDto | null {
    const row = this.stmt<ClauseRow>(
      'SELECT * FROM clause WHERE spec_version_id = ? AND clause_no = ?',
    ).get(specVersionId, clauseNo);
    return row ? toClauseDto(row) : null;
  }

  getMany(ids: readonly number[]): ClauseDto[] {
    if (ids.length === 0) return [];
    return this.stmt<ClauseRow>(
      `SELECT * FROM clause WHERE id IN (${this.placeholders(ids.length)}) ORDER BY sort_key`,
    )
      .all(...ids)
      .map(toClauseDto);
  }

  create(specVersionId: number, input: ClauseInput): ClauseDto {
    const res = this.insertStmt().run(
      specVersionId,
      input.clauseNo,
      clauseSortKey(input.clauseNo),
      input.sectionNo ?? null,
      input.sectionTitle ?? null,
      input.topic ?? null,
      input.requirementText,
      toJson(input.modules ?? []),
      input.obligation ?? null,
      input.pageFrom ?? null,
      input.pageTo ?? null,
      input.textHash ?? clauseTextHash(input.requirementText),
      input.reviewStatus ?? 'auto',
    );
    const dto = this.get(toId(res));
    if (!dto) throw new Error('Не вдалося прочитати щойно створену вимогу');
    return dto;
  }

  /** Пакетна вставка результату Stage 1 — одна транзакція на всю сторінку/версію. */
  createMany(specVersionId: number, inputs: readonly ClauseInput[]): number {
    const insert = this.db.transaction((rows: readonly ClauseInput[]): number => {
      let count = 0;
      for (const input of rows) {
        this.insertStmt().run(
          specVersionId,
          input.clauseNo,
          clauseSortKey(input.clauseNo),
          input.sectionNo ?? null,
          input.sectionTitle ?? null,
          input.topic ?? null,
          input.requirementText,
          toJson(input.modules ?? []),
          input.obligation ?? null,
          input.pageFrom ?? null,
          input.pageTo ?? null,
          input.textHash ?? clauseTextHash(input.requirementText),
          input.reviewStatus ?? 'auto',
        );
        count += 1;
      }
      return count;
    });
    return insert(inputs);
  }

  /**
   * Ручна правка під час вичитки реєстру. `sortKey` і `textHash` перераховуються
   * автоматично; `reviewStatus` не чіпаємо, якщо не задано явно.
   */
  patch(id: number, patch: ClausePatch): ClauseDto | null {
    const sets: string[] = [];
    const params: Array<string | number | null> = [];

    if (patch.clauseNo !== undefined) {
      sets.push('clause_no = ?', 'sort_key = ?');
      params.push(patch.clauseNo, clauseSortKey(patch.clauseNo));
    }
    if (patch.sectionNo !== undefined) {
      sets.push('section_no = ?');
      params.push(patch.sectionNo);
    }
    if (patch.sectionTitle !== undefined) {
      sets.push('section_title = ?');
      params.push(patch.sectionTitle);
    }
    if (patch.topic !== undefined) {
      sets.push('topic = ?');
      params.push(patch.topic);
    }
    if (patch.requirementText !== undefined) {
      sets.push('requirement_text = ?', 'text_hash = ?');
      params.push(patch.requirementText, clauseTextHash(patch.requirementText));
    }
    if (patch.modules !== undefined) {
      sets.push('modules = ?');
      params.push(toJson(patch.modules));
    }
    if (patch.obligation !== undefined) {
      sets.push('obligation = ?');
      params.push(patch.obligation);
    }
    if (patch.reviewStatus !== undefined) {
      sets.push('review_status = ?');
      params.push(patch.reviewStatus);
    }

    if (sets.length > 0) {
      params.push(id);
      this.stmt(`UPDATE clause SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }
    return this.get(id);
  }

  setReviewStatus(id: number, status: ClauseDto['reviewStatus']): void {
    this.stmt('UPDATE clause SET review_status = ? WHERE id = ?').run(status, id);
  }

  delete(id: number): boolean {
    return this.stmt('DELETE FROM clause WHERE id = ?').run(id).changes > 0;
  }

  deleteAll(specVersionId: number): number {
    return this.stmt('DELETE FROM clause WHERE spec_version_id = ?').run(specVersionId).changes;
  }

  count(specVersionId: number): number {
    const row = this.stmt<{ n: number }>(
      'SELECT COUNT(*) AS n FROM clause WHERE spec_version_id = ?',
    ).get(specVersionId);
    return row?.n ?? 0;
  }

  /** Лічильники для індикатора «вичитано 47/183» і для блокування прогону. */
  reviewCounts(specVersionId: number): Record<ClauseDto['reviewStatus'], number> {
    const rows = this.stmt<{ review_status: string; n: number }>(
      'SELECT review_status, COUNT(*) AS n FROM clause WHERE spec_version_id = ? GROUP BY review_status',
    ).all(specVersionId);
    const out: Record<ClauseDto['reviewStatus'], number> = { auto: 0, confirmed: 0, edited: 0, flagged: 0 };
    for (const row of rows) {
      const key = row.review_status as ClauseDto['reviewStatus'];
      if (key in out) out[key] = row.n;
    }
    return out;
  }

  /** Секції версії спеки в правильному порядку — основа матриці покриття. */
  sections(specVersionId: number): SectionInfo[] {
    const rows = this.stmt<{ section_no: string; section_title: string | null; n: number }>(
      `SELECT section_no,
              (SELECT c2.section_title FROM clause c2
                WHERE c2.spec_version_id = c.spec_version_id AND c2.section_no = c.section_no
                  AND c2.section_title IS NOT NULL
                ORDER BY c2.sort_key LIMIT 1) AS section_title,
              COUNT(*) AS n
       FROM clause c
       WHERE c.spec_version_id = ? AND c.section_no IS NOT NULL
       GROUP BY c.section_no
       ORDER BY MIN(c.sort_key)`,
    ).all(specVersionId);
    return rows.map((row) => ({
      sectionNo: row.section_no,
      sectionTitle: row.section_title,
      clauseCount: row.n,
    }));
  }

  /**
   * Діф двох версій специфікації (§11 architecture.md).
   *
   * Алгоритм у два проходи:
   *  1. збіг за `clause_no` → однаковий `text_hash` = unchanged, інакше `modified`;
   *  2. з решти — збіг за `text_hash` = `renumbered`;
   *  3. що лишилось у A → `removed`, у B → `added`.
   *
   * Кілька вимог з однаковим `text_hash` зіставляються в порядку `sort_key`,
   * щоб результат був детермінованим.
   */
  diff(specVersionIdA: number, specVersionIdB: number): ClauseDiffResult {
    const from = this.list(specVersionIdA);
    const to = this.list(specVersionIdB);

    const byNoB = new Map<string, ClauseDto>();
    for (const clause of to) byNoB.set(clause.clauseNo, clause);

    const modified: Array<{ from: ClauseDto; to: ClauseDto }> = [];
    const renumbered: Array<{ from: ClauseDto; to: ClauseDto }> = [];
    const restA: ClauseDto[] = [];
    const matchedB = new Set<number>();
    let unchanged = 0;

    for (const a of from) {
      const b = byNoB.get(a.clauseNo);
      if (!b) {
        restA.push(a);
        continue;
      }
      matchedB.add(b.id);
      if (a.textHash === b.textHash) unchanged += 1;
      else modified.push({ from: a, to: b });
    }

    const restB = to.filter((b) => !matchedB.has(b.id));
    const byHashB = new Map<string, ClauseDto[]>();
    for (const b of restB) {
      const bucket = byHashB.get(b.textHash);
      if (bucket) bucket.push(b);
      else byHashB.set(b.textHash, [b]);
    }

    const removed: ClauseDto[] = [];
    for (const a of restA) {
      const bucket = byHashB.get(a.textHash);
      const b = bucket?.shift();
      if (b) {
        renumbered.push({ from: a, to: b });
        matchedB.add(b.id);
      } else {
        removed.push(a);
      }
    }

    const added = restB.filter((b) => !matchedB.has(b.id));

    const entries: ClauseDiffEntry[] = [
      ...added.map((clause): ClauseDiffEntry => ({ kind: 'added', clause })),
      ...removed.map((clause): ClauseDiffEntry => ({ kind: 'removed', clause })),
      ...modified.map((pair): ClauseDiffEntry => ({ kind: 'modified', from: pair.from, to: pair.to })),
      ...renumbered.map((pair): ClauseDiffEntry => ({ kind: 'renumbered', from: pair.from, to: pair.to })),
    ];

    return {
      fromSpecVersionId: specVersionIdA,
      toSpecVersionId: specVersionIdB,
      added,
      removed,
      modified,
      renumbered,
      unchanged,
      entries,
    };
  }

  private insertStmt() {
    return this.stmt(
      `INSERT INTO clause
         (spec_version_id, clause_no, sort_key, section_no, section_title, topic,
          requirement_text, modules, obligation, page_from, page_to, text_hash, review_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
  }
}
