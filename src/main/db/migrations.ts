/**
 * Версійований раннер міграцій на `PRAGMA user_version`.
 *
 * Правила:
 *  - версії — послідовні цілі, починаючи з 1, без дірок;
 *  - кожна міграція застосовується у власній транзакції разом із записом
 *    нової `user_version`, тож падіння посередині не лишає напів-стан;
 *  - міграції ІДЕМПОТЕНТНІ на рівні раннера: повторний `migrate()` на вже
 *    мігрованій БД не робить нічого;
 *  - жодного «drop and recreate»: міграція 2+ дописує/змінює схему,
 *    а не перестворює її.
 *
 * Додаючи міграцію N: додайте елемент у `MIGRATIONS` і НЕ змінюйте тіла
 * попередніх — вони вже застосовані на робочих базах.
 *
 * Якщо майбутня міграція вимагатиме перебудови таблиці (12-крокова процедура
 * SQLite), `foreign_keys` треба вимкнути ЗОВНІ транзакції — див. `migrate()`.
 */

import schemaSql from './schema.sql?raw';
import type { SqliteDb } from './types';

export interface Migration {
  /** Послідовний номер, 1-based. */
  readonly version: number;
  /** Людиночитна назва — потрапляє в лог і в результат `migrate()`. */
  readonly name: string;
  /** Викликається всередині транзакції. */
  up(db: SqliteDb): void;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial-schema',
    up(db) {
      db.exec(schemaSql);
    },
  },
  {
    version: 2,
    name: 'llm-spend-ledger',
    up(db) {
      // `llm_call` — це КЕШ: його первинний ключ `cache_key`, тож два однакові
      // виклики там схлопуються в один рядок. Для обліку витрат потрібен журнал,
      // де кожен виклик — окремий запис, зокрема ті, що не належать жодному
      // прогону (екстракція реєстру вимог, профілювання документа).
      db.exec(`
        CREATE TABLE llm_spend (
          id             INTEGER PRIMARY KEY,
          stage          TEXT NOT NULL,
          provider       TEXT NOT NULL,
          model          TEXT NOT NULL,
          prompt_version TEXT,
          input_tokens   INTEGER NOT NULL DEFAULT 0,
          cached_tokens  INTEGER NOT NULL DEFAULT 0,
          output_tokens  INTEGER NOT NULL DEFAULT 0,
          cost_usd       REAL    NOT NULL DEFAULT 0,
          latency_ms     INTEGER,
          -- Свідомо БЕЗ зовнішніх ключів. Журнал витрат — фінансовий факт:
          -- гроші витрачені, навіть якщо прогін згодом видалили. FK тут ще й
          -- мовчки губив би записи (вставка з неіснуючим id падає, а помилку
          -- обліку ми не маємо права піднімати нагору — вона коштувала б
          -- уже оплаченого результату).
          run_id          INTEGER,
          spec_version_id INTEGER,
          from_cache     INTEGER NOT NULL DEFAULT 0,
          created_at     TEXT NOT NULL
        );
        CREATE INDEX idx_llm_spend_created ON llm_spend(created_at);
        CREATE INDEX idx_llm_spend_run ON llm_spend(run_id);
      `);
    },
  },
  {
    version: 3,
    name: 'run-launch-settings',
    up(db) {
      // Прогін, розпочатий на моделі X, після зміни налаштувань тихо продовжувався
      // б на моделі Y — і половина findings прийшла б від іншої моделі, ніж записано
      // в `model_judge`. Тому маршрутизацію фіксуємо на старті, а resume бере її звідси.
      // Те саме з мовою висновків: один прогін — одна мова.
      //
      //   routing          JSON {"judge": ModelRef, "critic": ModelRef | null}
      //   results_language '' | 'en' | 'nl' | 'uk'
      //
      // NULL — прогін зі старої версії: resume бере поточні налаштування, як і раніше.
      db.exec(`
        ALTER TABLE audit_run ADD COLUMN routing TEXT;
        ALTER TABLE audit_run ADD COLUMN results_language TEXT;
      `);
    },
  },
  {
    version: 4,
    name: 'standard-markers',
    up(db) {
      // Позначки біля вимог — власні коди стандарту (Tesco: P / R / O; GlobalG.A.P.:
      // «Major Must»; BRCGS: «Fundamental»), а розшифровка — його ж легенда.
      // Раніше застосунок знав лише P/R/O і читав їх як «модулі застосовності»,
      // хоча стандарт Tesco (стор. 10, «Clause Layout») пояснює їх як тип доказу.
      //
      //   clause.markers             JSON ["P","R"] — дослівно, як надруковано
      //   spec_version.marker_legend JSON [{code,label,meaning}] | NULL
      db.exec(`
        ALTER TABLE clause ADD COLUMN markers TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE spec_version ADD COLUMN marker_legend TEXT;
      `);

      // `modules` заповнювала лише екстракція у форматі Tesco (clause_extract.v1
      // читав саме колонки P R O таблиці), тож це рівно надруковані позначки стандарту.
      db.exec(`
        UPDATE clause SET markers = modules
         WHERE json_valid(modules) AND json_type(modules) = 'array';
      `);

      // Легенда — слова самого стандарту Tesco зі стор. 10. Тут літерал, а не
      // спільна константа: міграція має назавжди робити те саме, що й сьогодні.
      const tescoLegend = JSON.stringify([
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
      db.prepare(
        `UPDATE spec_version SET marker_legend = ?
          WHERE id IN (SELECT DISTINCT spec_version_id FROM clause
                        WHERE json_valid(modules) AND json_type(modules) = 'array'
                          AND json_array_length(modules) > 0)`,
      ).run(tescoLegend);
    },
  },
  {
    version: 5,
    name: 'finding-outside-evidence',
    up(db) {
      // Документ не може бути записом і не може показати практику на місці. Коли
      // легенда стандарту каже, що вимога доводиться записами чи оглядом (Tesco:
      // R / O), `judge.v2` не знижує за це вердикт, а пише окремо, що аудитор має
      // перевірити поза документом. Окрема колонка, а не дописка в `gap`: «чого
      // бракує документу» і «що перевірити на аудиті» — різні речі для людини.
      //
      // NULL — нічого перевіряти поза документом, або finding від `judge.v1`.
      db.exec('ALTER TABLE finding ADD COLUMN outside_evidence TEXT;');
    },
  },
];

export const LATEST_VERSION: number = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);

export interface MigrationResult {
  from: number;
  to: number;
  applied: string[];
}

export function userVersion(db: SqliteDb): number {
  const value = db.pragma('user_version', { simple: true });
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function setUserVersion(db: SqliteDb, version: number): void {
  if (!Number.isInteger(version) || version < 0) {
    throw new Error(`Некоректна версія схеми: ${String(version)}`);
  }
  // PRAGMA не приймає плейсхолдери — тому число валідуємо вручну вище.
  db.exec(`PRAGMA user_version = ${version}`);
}

function assertSequential(migrations: readonly Migration[]): void {
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  sorted.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new Error(
        `Міграції мають бути послідовними від 1: очікували ${i + 1}, отримали ${m.version} (${m.name})`,
      );
    }
  });
}

/**
 * Доганяє схему до останньої версії. Безпечно викликати на кожному відкритті БД.
 */
export function migrate(db: SqliteDb, migrations: readonly Migration[] = MIGRATIONS): MigrationResult {
  assertSequential(migrations);

  const from = userVersion(db);
  const target = migrations.reduce((max, m) => Math.max(max, m.version), 0);

  if (from > target) {
    throw new Error(
      `База новіша за застосунок: user_version=${from}, підтримується ${target}. ` +
        'Оновіть Super Auditor або відкрийте резервну копію.',
    );
  }

  const pending = [...migrations].sort((a, b) => a.version - b.version).filter((m) => m.version > from);
  const applied: string[] = [];

  for (const migration of pending) {
    // Транзакція на кожну міграцію окремо: часткове оновлення краще за повний відкат
    // усього ланцюга, а `user_version` завжди відповідає реально застосованому стану.
    const run = db.transaction(() => {
      migration.up(db);
      setUserVersion(db, migration.version);
    });
    run.immediate();
    applied.push(`${migration.version}:${migration.name}`);
  }

  return { from, to: userVersion(db), applied };
}
