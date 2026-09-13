/**
 * Відкриття з'єднання з SQLite і виставлення PRAGMA.
 *
 * WAL — бо в застосунку два процеси (main + utilityProcess-воркер) пишуть у ту
 * саму базу: читачі не блокують писача. `busy_timeout` рятує від миттєвого
 * SQLITE_BUSY, коли воркер тримає запис. `synchronous=NORMAL` — стандартний
 * компроміс для WAL: втратити можна лише хвіст останньої транзакції при
 * падінні ОС, не цілісність файлу.
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate, type MigrationResult } from './migrations';
import type { SqliteDb } from './types';

export interface OpenDbOptions {
  /** Прогнати міграції одразу після відкриття. За замовчуванням — так. */
  runMigrations?: boolean;
  /** Мілісекунди очікування зняття блокування. */
  busyTimeoutMs?: number;
  readonly?: boolean;
  /** Логер SQL для дебагу (`verbose` better-sqlite3). */
  verbose?: (message?: unknown, ...args: unknown[]) => void;
}

const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

export function openDb(path: string, options: OpenDbOptions = {}): SqliteDb {
  const { runMigrations = true, busyTimeoutMs = DEFAULT_BUSY_TIMEOUT_MS, readonly = false } = options;

  if (path !== ':memory:' && !path.startsWith('file:')) {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path, {
    readonly,
    timeout: busyTimeoutMs,
    ...(options.verbose ? { verbose: options.verbose } : {}),
  });

  applyPragmas(db, busyTimeoutMs, readonly);

  if (runMigrations && !readonly) migrate(db);

  return db;
}

/** База в пам'яті для тестів: та сама схема, ті самі PRAGMA (де вони мають сенс). */
export function openTestDb(): SqliteDb {
  return openDb(':memory:');
}

export function applyPragmas(db: SqliteDb, busyTimeoutMs: number, readonly = false): void {
  // Для ':memory:' WAL недоступний — SQLite мовчки лишає 'memory'. Це не помилка.
  if (!readonly) db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma(`busy_timeout = ${Math.max(0, Math.trunc(busyTimeoutMs))}`);
  db.pragma('synchronous = NORMAL');
}

export function runMigrationsOn(db: SqliteDb): MigrationResult {
  return migrate(db);
}

/** Дає SQLite злити WAL у основний файл — перед бекапом чи закриттям застосунку. */
export function checkpoint(db: SqliteDb): void {
  db.pragma('wal_checkpoint(TRUNCATE)');
}
