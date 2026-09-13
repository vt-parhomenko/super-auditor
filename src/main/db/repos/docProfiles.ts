/**
 * Профілі документів (Stage 2).
 *
 * UNIQUE (document_version_id, model, prompt_version): для однієї версії
 * документа можуть співіснувати профілі від різних моделей/промптів —
 * це потрібно, щоб порівнювати якість. `getLatest` віддає найсвіжіший.
 */

import type { DocProfileDto, DocumentKind } from '@shared/domain';
import { nowIso, toDocProfileDto, toJson, type DocProfileRow } from '../mappers';
import { BaseRepo, toId, type SqliteDb } from '../types';

export interface DocProfileInput {
  documentVersionId: number;
  summary: string;
  docType?: DocumentKind | null;
  processes?: string[];
  candidateClauses?: string[];
  model: string;
  promptVersion: string;
  createdAt?: string;
}

export class DocProfilesRepo extends BaseRepo {
  constructor(db: SqliteDb) {
    super(db);
  }

  /** Ідемпотентно за (documentVersionId, model, promptVersion). */
  upsert(input: DocProfileInput): DocProfileDto {
    const res = this.stmt(
      `INSERT INTO doc_profile
         (document_version_id, summary, doc_type, processes, candidate_clauses, model, prompt_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(document_version_id, model, prompt_version) DO UPDATE SET
         summary = excluded.summary,
         doc_type = excluded.doc_type,
         processes = excluded.processes,
         candidate_clauses = excluded.candidate_clauses,
         created_at = excluded.created_at`,
    ).run(
      input.documentVersionId,
      input.summary,
      input.docType ?? null,
      toJson(input.processes ?? []),
      toJson(input.candidateClauses ?? []),
      input.model,
      input.promptVersion,
      input.createdAt ?? nowIso(),
    );

    // ON CONFLICT DO UPDATE теж повертає lastInsertRowid, але надійніше перечитати за ключем.
    const dto = this.find(input.documentVersionId, input.model, input.promptVersion);
    if (dto) return dto;

    const byId = this.get(toId(res));
    if (!byId) throw new Error('Не вдалося прочитати щойно збережений doc_profile');
    return byId;
  }

  get(id: number): DocProfileDto | null {
    const row = this.stmt<DocProfileRow>('SELECT * FROM doc_profile WHERE id = ?').get(id);
    return row ? toDocProfileDto(row) : null;
  }

  find(documentVersionId: number, model: string, promptVersion: string): DocProfileDto | null {
    const row = this.stmt<DocProfileRow>(
      'SELECT * FROM doc_profile WHERE document_version_id = ? AND model = ? AND prompt_version = ?',
    ).get(documentVersionId, model, promptVersion);
    return row ? toDocProfileDto(row) : null;
  }

  /** Найсвіжіший профіль версії документа — те, що показує UI. */
  getLatest(documentVersionId: number): DocProfileDto | null {
    const row = this.stmt<DocProfileRow>(
      `SELECT * FROM doc_profile WHERE document_version_id = ?
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    ).get(documentVersionId);
    return row ? toDocProfileDto(row) : null;
  }

  listFor(documentVersionId: number): DocProfileDto[] {
    return this.stmt<DocProfileRow>(
      'SELECT * FROM doc_profile WHERE document_version_id = ? ORDER BY created_at DESC, id DESC',
    )
      .all(documentVersionId)
      .map(toDocProfileDto);
  }

  /** Найсвіжіші профілі для набору версій — один запит на весь прогін. */
  latestFor(documentVersionIds: readonly number[]): Map<number, DocProfileDto> {
    const out = new Map<number, DocProfileDto>();
    if (documentVersionIds.length === 0) return out;

    const rows = this.stmt<DocProfileRow>(
      `SELECT * FROM doc_profile
       WHERE document_version_id IN (${this.placeholders(documentVersionIds.length)})
       ORDER BY document_version_id, created_at DESC, id DESC`,
    ).all(...documentVersionIds);

    for (const row of rows) {
      if (!out.has(row.document_version_id)) out.set(row.document_version_id, toDocProfileDto(row));
    }
    return out;
  }

  delete(id: number): boolean {
    return this.stmt('DELETE FROM doc_profile WHERE id = ?').run(id).changes > 0;
  }
}
