/**
 * Екстракції тексту (Stage 0) разом із прив'язкою офсетів до сторінок.
 *
 * `extraction_page` пишеться в тій самій транзакції, що й `extraction`:
 * екстракція без сторінок ламає клікабельні цитати, тож напів-стану бути не може.
 */

import type { ExtractionDto, ExtractionMetaDto, ExtractionMethod, PageRange } from '@shared/domain';
import {
  nowIso,
  toExtractionDto,
  toExtractionMetaDto,
  toPageRange,
  type ExtractionMetaRow,
  type ExtractionPageRow,
  type ExtractionRow,
} from '../mappers';
import { BaseRepo, toId, type SqliteDb } from '../types';

const META_COLUMNS =
  'id, blob_hash, method, tool_version, page_count, char_count, quality, created_at';

export interface ExtractionInput {
  blobHash: string;
  method: ExtractionMethod;
  toolVersion: string;
  text: string;
  pageCount?: number | null;
  /** Якщо не задано — рахуємо з `text`. */
  charCount?: number | null;
  quality?: number | null;
  pages?: PageRange[];
  createdAt?: string;
}

export class ExtractionsRepo extends BaseRepo {
  constructor(db: SqliteDb) {
    super(db);
  }

  insert(input: ExtractionInput): ExtractionDto {
    const insertAll = this.db.transaction((): number => {
      const res = this.stmt(
        `INSERT INTO extraction (blob_hash, method, tool_version, text, page_count, char_count, quality, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.blobHash,
        input.method,
        input.toolVersion,
        input.text,
        input.pageCount ?? null,
        input.charCount ?? input.text.length,
        input.quality ?? null,
        input.createdAt ?? nowIso(),
      );
      const id = toId(res);
      this.replacePagesInternal(id, input.pages ?? []);
      return id;
    });

    const id = insertAll();
    const dto = this.get(id);
    if (!dto) throw new Error(`Не вдалося прочитати щойно вставлену екстракцію ${id}`);
    return dto;
  }

  /** Ідемпотентна вставка: UNIQUE (blob_hash, method, tool_version). */
  upsert(input: ExtractionInput): ExtractionDto {
    const existing = this.findBy(input.blobHash, input.method, input.toolVersion);
    if (existing) return existing;
    return this.insert(input);
  }

  get(id: number): ExtractionDto | null {
    const row = this.stmt<ExtractionRow>('SELECT * FROM extraction WHERE id = ?').get(id);
    if (!row) return null;
    return toExtractionDto(row, this.pageRows(id));
  }

  /** Без важкого `text` — для списків і перевірок якості. */
  getMeta(id: number): ExtractionMetaDto | null {
    const row = this.stmt<ExtractionMetaRow>(
      `SELECT ${META_COLUMNS} FROM extraction WHERE id = ?`,
    ).get(id);
    return row ? toExtractionMetaDto(row) : null;
  }

  /** Тільки текст — для верифікації цитат (Stage 5), без сторінок. */
  getText(id: number): string | null {
    const row = this.stmt<{ text: string }>('SELECT text FROM extraction WHERE id = ?').get(id);
    return row ? row.text : null;
  }

  findBy(blobHash: string, method: ExtractionMethod, toolVersion: string): ExtractionDto | null {
    const row = this.stmt<ExtractionRow>(
      'SELECT * FROM extraction WHERE blob_hash = ? AND method = ? AND tool_version = ?',
    ).get(blobHash, method, toolVersion);
    if (!row) return null;
    return toExtractionDto(row, this.pageRows(row.id));
  }

  listForBlob(blobHash: string): ExtractionMetaDto[] {
    return this.stmt<ExtractionMetaRow>(
      `SELECT ${META_COLUMNS} FROM extraction WHERE blob_hash = ? ORDER BY created_at DESC, id DESC`,
    )
      .all(blobHash)
      .map(toExtractionMetaDto);
  }

  /** Найкраща наявна екстракція блоба: спершу за якістю, потім за свіжістю. */
  best(blobHash: string): ExtractionMetaDto | null {
    const row = this.stmt<ExtractionMetaRow>(
      `SELECT ${META_COLUMNS} FROM extraction WHERE blob_hash = ?
       ORDER BY COALESCE(quality, 0) DESC, created_at DESC, id DESC LIMIT 1`,
    ).get(blobHash);
    return row ? toExtractionMetaDto(row) : null;
  }

  pages(extractionId: number): PageRange[] {
    return this.pageRows(extractionId).map(toPageRange);
  }

  /** Сторінка, якій належить офсет. Потрібно для «стрибка на сторінку» з цитати. */
  pageAtOffset(extractionId: number, charOffset: number): number | null {
    const row = this.stmt<{ page_no: number }>(
      `SELECT page_no FROM extraction_page
       WHERE extraction_id = ? AND char_start <= ? AND char_end > ?
       ORDER BY page_no LIMIT 1`,
    ).get(extractionId, charOffset, charOffset);
    return row ? row.page_no : null;
  }

  /** Перезаписує прив'язку сторінок цілком (напр. після перенормалізації тексту). */
  replacePages(extractionId: number, pages: PageRange[]): void {
    this.db.transaction(() => this.replacePagesInternal(extractionId, pages))();
  }

  setQuality(id: number, quality: number | null): void {
    this.stmt('UPDATE extraction SET quality = ? WHERE id = ?').run(quality, id);
  }

  delete(id: number): boolean {
    return this.stmt('DELETE FROM extraction WHERE id = ?').run(id).changes > 0;
  }

  private replacePagesInternal(extractionId: number, pages: PageRange[]): void {
    this.stmt('DELETE FROM extraction_page WHERE extraction_id = ?').run(extractionId);
    const insert = this.stmt(
      'INSERT INTO extraction_page (extraction_id, page_no, char_start, char_end) VALUES (?, ?, ?, ?)',
    );
    for (const page of pages) {
      insert.run(extractionId, page.pageNo, page.charStart, page.charEnd);
    }
  }

  private pageRows(extractionId: number): ExtractionPageRow[] {
    return this.stmt<ExtractionPageRow>(
      'SELECT * FROM extraction_page WHERE extraction_id = ? ORDER BY page_no',
    ).all(extractionId);
  }
}
