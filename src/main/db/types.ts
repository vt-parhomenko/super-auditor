/**
 * Тонкі аліаси навколо типів better-sqlite3 + базовий клас репозиторію
 * з кешем підготовлених стейтментів.
 *
 * `better-sqlite3` синхронний — жодного `async` у шарі БД немає й не має бути.
 */

import type BetterSqlite3 from 'better-sqlite3';

export type SqliteDb = BetterSqlite3.Database;
export type SqliteStatement<R = unknown> = BetterSqlite3.Statement<unknown[], R>;
export type RunResult = { changes: number; lastInsertRowid: number | bigint };

/** Параметри, які можна передати в стейтмент. */
export type BindValue = string | number | bigint | Buffer | null;

/**
 * База для всіх репозиторіїв.
 *
 * `prepare()` коштує помітно дорожче за `run()/get()`, тому кожен SQL готується
 * рівно один раз і живе разом із репозиторієм. Для запитів зі змінним набором
 * фільтрів (напр. `findings.list`) ключем кешу є сам згенерований SQL —
 * унікальних форм там одиниці десятків, тож кеш не росте безмежно.
 */
export abstract class BaseRepo {
  readonly db: SqliteDb;
  readonly #stmts = new Map<string, SqliteStatement<unknown>>();

  constructor(db: SqliteDb) {
    this.db = db;
  }

  protected stmt<R = unknown>(sql: string): SqliteStatement<R> {
    const cached = this.#stmts.get(sql);
    if (cached) return cached as SqliteStatement<R>;
    const prepared = this.db.prepare(sql) as SqliteStatement<R>;
    this.#stmts.set(sql, prepared as SqliteStatement<unknown>);
    return prepared;
  }

  /** `?, ?, ?` для `IN (...)`. Кількість плейсхолдерів — частина ключа кешу SQL. */
  protected placeholders(count: number): string {
    return new Array(count).fill('?').join(', ');
  }

  /** Скидає кеш стейтментів (потрібно лише перед закриттям з'єднання). */
  protected clearStatements(): void {
    this.#stmts.clear();
  }
}

/** `lastInsertRowid` приходить як `number | bigint`; у нас усі id вміщаються в number. */
export function toId(result: RunResult): number {
  return Number(result.lastInsertRowid);
}
