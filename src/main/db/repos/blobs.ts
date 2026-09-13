/**
 * Content-addressed сховище (§4 architecture.md).
 * Ім'я блоба = SHA-256 вмісту, тому вставка ідемпотентна: повторний імпорт
 * того самого файлу не створює нічого нового.
 */

import type { BlobDto } from '@shared/domain';
import { nowIso, toBlobDto, type BlobRow } from '../mappers';
import { BaseRepo, type SqliteDb } from '../types';

export interface BlobInput {
  hash: string;
  relPath: string;
  byteSize: number;
  mime: string;
  createdAt?: string;
}

export class BlobsRepo extends BaseRepo {
  constructor(db: SqliteDb) {
    super(db);
  }

  /**
   * Вставляє блоб, якщо його ще немає. Повертає `{ blob, duplicate }` —
   * `duplicate` потрібен імпорту, щоб спитати користувача, чи створювати версію.
   */
  insert(input: BlobInput): { blob: BlobDto; duplicate: boolean } {
    const existing = this.get(input.hash);
    if (existing) return { blob: existing, duplicate: true };

    this.stmt(
      'INSERT INTO blob (hash, rel_path, byte_size, mime, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(input.hash, input.relPath, input.byteSize, input.mime, input.createdAt ?? nowIso());

    const blob = this.get(input.hash);
    if (!blob) throw new Error(`Не вдалося прочитати щойно вставлений блоб ${input.hash}`);
    return { blob, duplicate: false };
  }

  get(hash: string): BlobDto | null {
    const row = this.stmt<BlobRow>('SELECT * FROM blob WHERE hash = ?').get(hash);
    return row ? toBlobDto(row) : null;
  }

  exists(hash: string): boolean {
    return this.stmt<{ n: number }>('SELECT 1 AS n FROM blob WHERE hash = ?').get(hash) !== undefined;
  }

  list(): BlobDto[] {
    return this.stmt<BlobRow>('SELECT * FROM blob ORDER BY created_at DESC, hash')
      .all()
      .map(toBlobDto);
  }

  /**
   * Блоби, на які більше ніхто не посилається — кандидати на прибирання з диска.
   * Сам файл видаляє ingest, БД лише знає, що посилань немає.
   */
  listOrphans(): BlobDto[] {
    return this.stmt<BlobRow>(
      `SELECT b.* FROM blob b
       WHERE NOT EXISTS (SELECT 1 FROM document_version dv WHERE dv.blob_hash = b.hash)
         AND NOT EXISTS (SELECT 1 FROM spec_version sv WHERE sv.blob_hash = b.hash)
         AND NOT EXISTS (SELECT 1 FROM extraction e WHERE e.blob_hash = b.hash)
       ORDER BY b.created_at`,
    )
      .all()
      .map(toBlobDto);
  }

  /** Кине SQLITE_CONSTRAINT_FOREIGNKEY, якщо на блоб ще посилаються. */
  delete(hash: string): boolean {
    return this.stmt('DELETE FROM blob WHERE hash = ?').run(hash).changes > 0;
  }
}
