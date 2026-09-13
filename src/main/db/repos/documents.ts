/**
 * Документи виробництва та їхні версії.
 *
 * `DocumentVersionDto` містить `byteSize` і `pageCount`, яких немає в таблиці
 * `document_version` — вони приходять JOIN-ом з `blob` і `extraction`.
 * Тому всі вибірки версій ідуть через `VERSION_SELECT`.
 */

import type { DocumentDto, DocumentKind, DocumentVersionDto } from '@shared/domain';
import {
  nowIso,
  toDocumentDto,
  toDocumentVersionDto,
  type DocumentRow,
  type DocumentVersionRow,
} from '../mappers';
import { BaseRepo, toId, type SqliteDb } from '../types';

const VERSION_SELECT = `
  SELECT dv.id, dv.document_id, dv.version_label, dv.blob_hash, dv.extraction_id,
         dv.lang, dv.effective_from, dv.imported_at,
         b.byte_size AS byte_size,
         e.page_count AS page_count
  FROM document_version dv
  JOIN blob b ON b.hash = dv.blob_hash
  LEFT JOIN extraction e ON e.id = dv.extraction_id
`;

export interface DocumentInput {
  title: string;
  docNumber?: string | null;
  processOwner?: string | null;
  kind?: DocumentKind | null;
  createdAt?: string;
}

export interface DocumentPatch {
  title?: string;
  docNumber?: string | null;
  processOwner?: string | null;
  kind?: DocumentKind | null;
}

export interface DocumentVersionInput {
  documentId: number;
  versionLabel: string;
  blobHash: string;
  extractionId?: number | null;
  lang?: string | null;
  effectiveFrom?: string | null;
  importedAt?: string;
}

export interface DocumentQuery {
  search?: string;
  kind?: DocumentKind;
}

export class DocumentsRepo extends BaseRepo {
  constructor(db: SqliteDb) {
    super(db);
  }

  // ─── Документи ─────────────────────────────────────────────────────────────

  create(input: DocumentInput): DocumentDto {
    const res = this.stmt(
      'INSERT INTO document (title, doc_number, process_owner, kind, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(
      input.title,
      input.docNumber ?? null,
      input.processOwner ?? null,
      input.kind ?? null,
      input.createdAt ?? nowIso(),
    );
    const dto = this.get(toId(res));
    if (!dto) throw new Error('Не вдалося прочитати щойно створений документ');
    return dto;
  }

  get(id: number): DocumentDto | null {
    const row = this.stmt<DocumentRow>('SELECT * FROM document WHERE id = ?').get(id);
    if (!row) return null;
    return toDocumentDto(row, this.listVersions(id));
  }

  /** Список із версіями. Версії тягнемо одним запитом на всі документи (без N+1). */
  list(query: DocumentQuery = {}): DocumentDto[] {
    const where: string[] = [];
    const params: Array<string | number> = [];

    if (query.search) {
      where.push('(d.title LIKE ? ESCAPE \'\\\' OR d.doc_number LIKE ? ESCAPE \'\\\' OR d.process_owner LIKE ? ESCAPE \'\\\')');
      const like = `%${escapeLike(query.search)}%`;
      params.push(like, like, like);
    }
    if (query.kind) {
      where.push('d.kind = ?');
      params.push(query.kind);
    }

    const sql =
      'SELECT d.* FROM document d' +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY d.doc_number IS NULL, d.doc_number, d.title, d.id';

    const rows = this.stmt<DocumentRow>(sql).all(...params);
    if (rows.length === 0) return [];

    const versionsByDoc = this.versionsFor(rows.map((r) => r.id));
    return rows.map((row) => toDocumentDto(row, versionsByDoc.get(row.id) ?? []));
  }

  update(id: number, patch: DocumentPatch): DocumentDto | null {
    const sets: string[] = [];
    const params: Array<string | number | null> = [];
    if (patch.title !== undefined) {
      sets.push('title = ?');
      params.push(patch.title);
    }
    if (patch.docNumber !== undefined) {
      sets.push('doc_number = ?');
      params.push(patch.docNumber);
    }
    if (patch.processOwner !== undefined) {
      sets.push('process_owner = ?');
      params.push(patch.processOwner);
    }
    if (patch.kind !== undefined) {
      sets.push('kind = ?');
      params.push(patch.kind);
    }
    if (sets.length > 0) {
      params.push(id);
      this.stmt(`UPDATE document SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }
    return this.get(id);
  }

  /** Каскадно видаляє версії й профілі документа (ON DELETE CASCADE у схемі). */
  delete(id: number): boolean {
    return this.stmt('DELETE FROM document WHERE id = ?').run(id).changes > 0;
  }

  // ─── Версії ────────────────────────────────────────────────────────────────

  addVersion(input: DocumentVersionInput): DocumentVersionDto {
    const res = this.stmt(
      `INSERT INTO document_version
         (document_id, version_label, blob_hash, extraction_id, lang, effective_from, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.documentId,
      input.versionLabel,
      input.blobHash,
      input.extractionId ?? null,
      input.lang ?? null,
      input.effectiveFrom ?? null,
      input.importedAt ?? nowIso(),
    );
    const dto = this.getVersion(toId(res));
    if (!dto) throw new Error('Не вдалося прочитати щойно створену версію документа');
    return dto;
  }

  getVersion(id: number): DocumentVersionDto | null {
    const row = this.stmt<DocumentVersionRow>(`${VERSION_SELECT} WHERE dv.id = ?`).get(id);
    return row ? toDocumentVersionDto(row) : null;
  }

  listVersions(documentId: number): DocumentVersionDto[] {
    return this.stmt<DocumentVersionRow>(
      `${VERSION_SELECT} WHERE dv.document_id = ? ORDER BY dv.version_label DESC, dv.id DESC`,
    )
      .all(documentId)
      .map(toDocumentVersionDto);
  }

  /** Версії для набору документів одним запитом. */
  versionsFor(documentIds: readonly number[]): Map<number, DocumentVersionDto[]> {
    const out = new Map<number, DocumentVersionDto[]>();
    if (documentIds.length === 0) return out;

    const rows = this.stmt<DocumentVersionRow>(
      `${VERSION_SELECT} WHERE dv.document_id IN (${this.placeholders(documentIds.length)})
       ORDER BY dv.document_id, dv.version_label DESC, dv.id DESC`,
    ).all(...documentIds);

    for (const row of rows) {
      const list = out.get(row.document_id);
      if (list) list.push(toDocumentVersionDto(row));
      else out.set(row.document_id, [toDocumentVersionDto(row)]);
    }
    return out;
  }

  /** Версії за id — для матриці покриття й експорту. */
  getVersions(ids: readonly number[]): DocumentVersionDto[] {
    if (ids.length === 0) return [];
    return this.stmt<DocumentVersionRow>(
      `${VERSION_SELECT} WHERE dv.id IN (${this.placeholders(ids.length)}) ORDER BY dv.id`,
    )
      .all(...ids)
      .map(toDocumentVersionDto);
  }

  /** Дедуплікація при імпорті: цей блоб уже прив'язаний до якоїсь версії? */
  findVersionByBlob(blobHash: string): DocumentVersionDto | null {
    const row = this.stmt<DocumentVersionRow>(
      `${VERSION_SELECT} WHERE dv.blob_hash = ? ORDER BY dv.id LIMIT 1`,
    ).get(blobHash);
    return row ? toDocumentVersionDto(row) : null;
  }

  setVersionExtraction(versionId: number, extractionId: number | null): void {
    this.stmt('UPDATE document_version SET extraction_id = ? WHERE id = ?').run(extractionId, versionId);
  }

  setVersionLang(versionId: number, lang: string | null): void {
    this.stmt('UPDATE document_version SET lang = ? WHERE id = ?').run(lang, versionId);
  }

  deleteVersion(id: number): boolean {
    return this.stmt('DELETE FROM document_version WHERE id = ?').run(id).changes > 0;
  }

  /** Заголовок і мітка версії для UI (матриця покриття, експорт). */
  versionLabels(ids: readonly number[]): Map<number, { title: string; versionLabel: string }> {
    const out = new Map<number, { title: string; versionLabel: string }>();
    if (ids.length === 0) return out;
    const rows = this.stmt<{ id: number; title: string; version_label: string }>(
      `SELECT dv.id, d.title, dv.version_label
       FROM document_version dv JOIN document d ON d.id = dv.document_id
       WHERE dv.id IN (${this.placeholders(ids.length)})`,
    ).all(...ids);
    for (const row of rows) out.set(row.id, { title: row.title, versionLabel: row.version_label });
    return out;
  }
}

/** `%`, `_` і `\` у користувацькому пошуку — літерали, а не шаблон. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
