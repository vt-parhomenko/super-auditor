import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { applyPragmas } from './connection';
import { LATEST_VERSION, MIGRATIONS, migrate, userVersion, type Migration } from './migrations';
import { createTestDb, type Db } from './index';

const EXPECTED_TABLES = [
  'app_setting',
  'audit_run',
  'audit_run_document',
  'blob',
  'clause',
  'clause_applicability',
  'doc_profile',
  'document',
  'document_version',
  'extraction',
  'extraction_page',
  'finding',
  'finding_evidence',
  'finding_review',
  'llm_call',
  'llm_spend',
  'run_task',
  'site_profile',
  'spec_summary',
  'spec_version',
  'specification',
];

let open: Db[] = [];

function fresh(): Db {
  const db = createTestDb();
  open.push(db);
  return db;
}

afterEach(() => {
  for (const db of open) db.close();
  open = [];
});

describe('migrations', () => {
  it('прогін створює всі таблиці зі схеми', () => {
    const db = fresh();
    const tables = db.raw
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((r) => r.name);

    expect(tables).toEqual(EXPECTED_TABLES);
    // 20 із першої міграції + `llm_spend` із другої (журнал витрат).
    expect(tables).toHaveLength(21);
  });

  it('виставляє user_version на останню версію', () => {
    const db = fresh();
    expect(db.schemaVersion()).toBe(LATEST_VERSION);
    expect(LATEST_VERSION).toBe(MIGRATIONS.length);
  });

  it('повторний прогін нічого не робить (ідемпотентність)', () => {
    const db = fresh();
    const result = migrate(db.raw);
    expect(result.applied).toEqual([]);
    expect(result.from).toBe(LATEST_VERSION);
    expect(result.to).toBe(LATEST_VERSION);
  });

  it('перший прогін звітує про застосовані міграції', () => {
    const raw = new Database(':memory:');
    applyPragmas(raw, 1000);
    const result = migrate(raw);
    expect(result.from).toBe(0);
    expect(result.to).toBe(LATEST_VERSION);
    expect(result.applied).toEqual([
      '1:initial-schema',
      '2:llm-spend-ledger',
      '3:run-launch-settings',
    ]);
    raw.close();
  });

  it('доганяє схему поетапно і застосовує лише нові міграції', () => {
    const raw = new Database(':memory:');
    applyPragmas(raw, 1000);

    const extra: Migration[] = [
      ...MIGRATIONS,
      {
        version: LATEST_VERSION + 1,
        name: 'add-scratch-table',
        up(db) {
          db.exec('CREATE TABLE scratch (id INTEGER PRIMARY KEY)');
        },
      },
    ];

    migrate(raw, MIGRATIONS);
    expect(userVersion(raw)).toBe(LATEST_VERSION);

    const second = migrate(raw, extra);
    expect(second.from).toBe(LATEST_VERSION);
    expect(second.applied).toEqual([`${LATEST_VERSION + 1}:add-scratch-table`]);
    expect(userVersion(raw)).toBe(LATEST_VERSION + 1);

    // Таблиця з міграції 1 не перестворювалась.
    const count = raw
      .prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'scratch'")
      .get();
    expect(count?.n).toBe(1);

    raw.close();
  });

  it('відкочує міграцію цілком, якщо вона впала', () => {
    const raw = new Database(':memory:');
    applyPragmas(raw, 1000);

    const broken: Migration[] = [
      ...MIGRATIONS,
      {
        version: LATEST_VERSION + 1,
        name: 'broken',
        up(db) {
          db.exec('CREATE TABLE half_done (id INTEGER PRIMARY KEY)');
          throw new Error('бум');
        },
      },
    ];

    expect(() => migrate(raw, broken)).toThrow('бум');
    expect(userVersion(raw)).toBe(LATEST_VERSION);
    const leftovers = raw
      .prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'half_done'")
      .get();
    expect(leftovers?.n).toBe(0);

    raw.close();
  });

  it('відмовляється відкривати базу, новішу за застосунок', () => {
    const raw = new Database(':memory:');
    applyPragmas(raw, 1000);
    migrate(raw);
    raw.exec(`PRAGMA user_version = ${LATEST_VERSION + 5}`);
    expect(() => migrate(raw)).toThrow(/новіша за застосунок/);
    raw.close();
  });

  it('валідує послідовність версій', () => {
    const raw = new Database(':memory:');
    const gapped: Migration[] = [
      { version: 1, name: 'one', up: () => undefined },
      { version: 3, name: 'three', up: () => undefined },
    ];
    expect(() => migrate(raw, gapped)).toThrow(/послідовними/);
    raw.close();
  });
});

describe('міграція 3: налаштування старту прогону', () => {
  it('додає audit_run.routing і audit_run.results_language', () => {
    const db = fresh();
    const columns = db.raw
      .prepare<[], { name: string }>("SELECT name FROM pragma_table_info('audit_run')")
      .all()
      .map((c) => c.name);
    expect(columns).toEqual(expect.arrayContaining(['routing', 'results_language']));
  });

  it('прогони, створені до міграції, отримують NULL — resume бере поточні налаштування', () => {
    const raw = new Database(':memory:');
    applyPragmas(raw, 1000);
    migrate(raw, MIGRATIONS.slice(0, 2));

    raw.exec(`
      INSERT INTO blob (hash, rel_path, byte_size, mime, created_at)
        VALUES ('${'a'.repeat(64)}', 'x', 1, 'application/pdf', '2026-01-01');
      INSERT INTO specification (name) VALUES ('Tesco');
      INSERT INTO spec_version (specification_id, version_label, blob_hash)
        VALUES (1, '5.0', '${'a'.repeat(64)}');
      INSERT INTO audit_run (spec_version_id, model_judge, prompt_version)
        VALUES (1, 'claude-opus-5', 'judge.v1');
    `);

    migrate(raw);
    const row = raw
      .prepare<[], { routing: string | null; results_language: string | null }>(
        'SELECT routing, results_language FROM audit_run WHERE id = 1',
      )
      .get();
    expect(row).toEqual({ routing: null, results_language: null });
    raw.close();
  });
});

describe('connection', () => {
  it('вмикає foreign_keys', () => {
    const db = fresh();
    expect(db.raw.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('foreign_keys реально блокує биті посилання', () => {
    const db = fresh();
    expect(() =>
      db.raw
        .prepare(
          "INSERT INTO document_version (document_id, version_label, blob_hash, imported_at) VALUES (999, '1', 'nope', '2026-01-01')",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/i);
  });

  it('transaction() відкочує зміни при помилці', () => {
    const db = fresh();
    expect(() =>
      db.transaction(() => {
        db.blobs.insert({ hash: 'f'.repeat(64), relPath: 'ff/ff/x.pdf', byteSize: 1, mime: 'application/pdf' });
        throw new Error('відкат');
      }),
    ).toThrow('відкат');
    expect(db.blobs.get('f'.repeat(64))).toBeNull();
  });
});
