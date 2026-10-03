import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { applyPragmas } from './connection';
import { LATEST_VERSION, MIGRATIONS, migrate, userVersion, type Migration } from './migrations';
import { createTestDb, wrapDb, type Db } from './index';

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
      '4:standard-markers',
      '5:finding-outside-evidence',
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

describe('міграція 4: позначки стандарту', () => {
  /** База на версії 3 з двома специфікаціями: Tesco (P/R/O) і без позначок. */
  function v3WithClauses(): Database.Database {
    const raw = new Database(':memory:');
    applyPragmas(raw, 1000);
    migrate(raw, MIGRATIONS.slice(0, 3));
    raw.exec(`
      INSERT INTO blob (hash, rel_path, byte_size, mime, created_at)
        VALUES ('${'a'.repeat(64)}', 'x', 1, 'application/pdf', '2026-01-01');
      INSERT INTO specification (name) VALUES ('Tesco'), ('ISO 9001');
      INSERT INTO spec_version (specification_id, version_label, blob_hash)
        VALUES (1, '5.0', '${'a'.repeat(64)}'), (2, '2015', '${'a'.repeat(64)}');
      INSERT INTO clause (spec_version_id, clause_no, sort_key, requirement_text, modules, text_hash)
        VALUES (1, '1.3', '001.003', 'Site management must review.', '["P","R"]', 'h1'),
               (1, '1.4', '001.004', 'The site must have resources.', '[]', 'h2'),
               (1, '1.5', '001.005', 'The site must plan.', 'not json', 'h3'),
               (2, '4.1', '004.001', 'The organization shall determine.', '[]', 'h4');
    `);
    return raw;
  }

  it('додає clause.markers і spec_version.marker_legend', () => {
    const db = fresh();
    const clauseColumns = db.raw
      .prepare<[], { name: string }>("SELECT name FROM pragma_table_info('clause')")
      .all()
      .map((c) => c.name);
    const versionColumns = db.raw
      .prepare<[], { name: string }>("SELECT name FROM pragma_table_info('spec_version')")
      .all()
      .map((c) => c.name);
    expect(clauseColumns).toContain('markers');
    expect(versionColumns).toContain('marker_legend');
  });

  it('переносить P/R/O у markers і дає версіям Tesco легенду стандарту', () => {
    const raw = v3WithClauses();
    migrate(raw);

    const markers = raw
      .prepare<[], { clause_no: string; markers: string }>('SELECT clause_no, markers FROM clause ORDER BY id')
      .all();
    expect(markers).toEqual([
      { clause_no: '1.3', markers: '["P","R"]' },
      { clause_no: '1.4', markers: '[]' },
      // Сміття в modules не переноситься — лишається типове '[]'.
      { clause_no: '1.5', markers: '[]' },
      { clause_no: '4.1', markers: '[]' },
    ]);

    const legends = raw
      .prepare<[], { id: number; marker_legend: string | null }>('SELECT id, marker_legend FROM spec_version ORDER BY id')
      .all();
    expect(legends[1]?.marker_legend).toBeNull();
    expect(JSON.parse(legends[0]?.marker_legend ?? 'null')).toEqual([
      {
        code: 'P',
        label: 'Policy / procedure',
        meaning: 'The site must have a documented policy/procedure that has been fully implemented',
      },
      {
        code: 'R',
        label: 'Records',
        meaning: 'The site must have comprehensive accurately completed records to demonstrate compliance',
      },
      {
        code: 'O',
        label: 'Observation',
        meaning: 'Compliance to the clause will be verified through observation of the site',
      },
    ]);
    raw.close();
  });

  it('після міграції репозиторій віддає markers і markerLegend', () => {
    const raw = v3WithClauses();
    migrate(raw);
    const db = wrapDb(raw);

    expect(db.clauses.getByNo(1, '1.3')?.markers).toEqual(['P', 'R']);
    expect(db.specs.getVersion(1)?.markerLegend?.map((item) => item.code)).toEqual(['P', 'R', 'O']);
    expect(db.specs.getVersion(2)?.markerLegend).toBeNull();
    db.close();
  });
});

describe('міграція 5: що перевірити поза документом', () => {
  it('додає finding.outside_evidence', () => {
    const db = fresh();
    const columns = db.raw
      .prepare<[], { name: string; notnull: number }>("SELECT name, \"notnull\" FROM pragma_table_info('finding')")
      .all();
    const column = columns.find((c) => c.name === 'outside_evidence');
    expect(column).toBeDefined();
    // NULL дозволено: findings від judge.v1 і стандарти без позначок нічого «поза документом» не мають.
    expect(column?.notnull).toBe(0);
  });

  it('findings, створені до міграції, отримують NULL і читаються репозиторієм', () => {
    const raw = new Database(':memory:');
    applyPragmas(raw, 1000);
    migrate(raw, MIGRATIONS.slice(0, 4));
    raw.exec(`
      INSERT INTO blob (hash, rel_path, byte_size, mime, created_at)
        VALUES ('${'a'.repeat(64)}', 'x', 1, 'application/pdf', '2026-01-01');
      INSERT INTO specification (name) VALUES ('Tesco');
      INSERT INTO spec_version (specification_id, version_label, blob_hash)
        VALUES (1, '5.0', '${'a'.repeat(64)}');
      INSERT INTO clause (spec_version_id, clause_no, sort_key, requirement_text, text_hash)
        VALUES (1, '10.3', '010.003', 'The site must have a pest programme.', 'h1');
      INSERT INTO audit_run (spec_version_id, model_judge, prompt_version)
        VALUES (1, 'claude-opus-5', 'judge.v1');
      INSERT INTO finding (run_id, clause_id, verdict, rationale, created_at)
        VALUES (1, 1, 'partial', 'Old finding.', '2026-01-01');
    `);

    migrate(raw);
    const db = wrapDb(raw);
    const finding = db.findings.listByRun(1)[0];
    expect(finding?.rationale).toBe('Old finding.');
    expect(finding?.outsideEvidence).toBeNull();
    db.close();
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
