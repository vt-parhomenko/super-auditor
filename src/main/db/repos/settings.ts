/**
 * `AppSettings` із `@shared/ipc` поверх key-value таблиці `app_setting`.
 *
 * Один ключ на поле, а не один рядок з великим JSON: так `settings:set`
 * із частковим патчем не може випадково затерти чуже поле, а майбутні
 * налаштування додаються без міграції.
 *
 * Значення зберігаються як JSON — щоб `concurrency` лишався числом,
 * а `localOnly` булевим, без вгадування типу при читанні.
 */

import { isLanguage, type Language, type ResultsLanguage } from '@shared/domain';
import type { AppSettings } from '@shared/ipc';
import { BaseRepo, type SqliteDb } from '../types';

export const DEFAULT_SETTINGS: AppSettings = {
  routing: {},
  concurrency: 3,
  localOnly: false,
  theme: 'system',
  // Порожньо — висновки мовою стандарту. Цитати завжди лишаються оригіналом.
  resultsLanguage: '',
  // Renderer перезапише розв'язаною мовою при першому ж запуску вікна.
  uiLanguage: 'en',
};

const THEMES: readonly AppSettings['theme'][] = ['system', 'light', 'dark'];

/**
 * Мова результатів: одна з підтримуваних або `''`. Значення їде просто в промпт,
 * тож довільний рядок не приймаємо. Колись тут дозволялись будь-які коди BCP-47
 * (`de`, `uk-UA`) — такі старі значення читаються як «мовою стандарту».
 */
export function isResultsLanguage(value: unknown): value is ResultsLanguage {
  return value === '' || isLanguage(value);
}

function readResultsLanguage(value: unknown): ResultsLanguage | null {
  return isResultsLanguage(value) ? value : null;
}

function readUiLanguage(value: unknown): Language | null {
  return isLanguage(value) ? value : null;
}

export class SettingsRepo extends BaseRepo {
  constructor(db: SqliteDb) {
    super(db);
  }

  /** Повні налаштування: збережені значення поверх дефолтів. */
  get(): AppSettings {
    const raw = this.all();
    return {
      routing: readRouting(raw['routing']) ?? DEFAULT_SETTINGS.routing,
      concurrency: readConcurrency(raw['concurrency']) ?? DEFAULT_SETTINGS.concurrency,
      localOnly: readBoolean(raw['localOnly']) ?? DEFAULT_SETTINGS.localOnly,
      theme: readTheme(raw['theme']) ?? DEFAULT_SETTINGS.theme,
      resultsLanguage:
        readResultsLanguage(raw['resultsLanguage']) ?? DEFAULT_SETTINGS.resultsLanguage,
      uiLanguage: readUiLanguage(raw['uiLanguage']) ?? DEFAULT_SETTINGS.uiLanguage,
    };
  }

  /** Частковий патч. Ключі, яких немає в патчі, лишаються як були. */
  set(patch: Partial<AppSettings>): AppSettings {
    const write = this.db.transaction(() => {
      if (patch.routing !== undefined) this.setRaw('routing', patch.routing);
      if (patch.concurrency !== undefined) this.setRaw('concurrency', clampConcurrency(patch.concurrency));
      if (patch.localOnly !== undefined) this.setRaw('localOnly', patch.localOnly);
      if (patch.theme !== undefined) this.setRaw('theme', patch.theme);
      // Мови нормалізуються так само, як concurrency: невалідне значення стає
      // типовим, а не лягає в базу. Зрозумілу помилку дає хендлер `settings:set`.
      if (patch.resultsLanguage !== undefined) {
        this.setRaw(
          'resultsLanguage',
          readResultsLanguage(patch.resultsLanguage) ?? DEFAULT_SETTINGS.resultsLanguage,
        );
      }
      if (patch.uiLanguage !== undefined) {
        this.setRaw('uiLanguage', readUiLanguage(patch.uiLanguage) ?? DEFAULT_SETTINGS.uiLanguage);
      }
    });
    write();
    return this.get();
  }

  reset(): AppSettings {
    this.stmt('DELETE FROM app_setting').run();
    return this.get();
  }

  // ─── Довільні ключі (для речей поза AppSettings) ───────────────────────────

  getRaw<T = unknown>(key: string): T | undefined {
    const row = this.stmt<{ value: string }>('SELECT value FROM app_setting WHERE key = ?').get(key);
    if (!row) return undefined;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return undefined;
    }
  }

  setRaw(key: string, value: unknown): void {
    this.stmt(
      `INSERT INTO app_setting (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(key, JSON.stringify(value ?? null));
  }

  deleteRaw(key: string): boolean {
    return this.stmt('DELETE FROM app_setting WHERE key = ?').run(key).changes > 0;
  }

  all(): Record<string, unknown> {
    const rows = this.stmt<{ key: string; value: string }>('SELECT key, value FROM app_setting').all();
    const out: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        out[row.key] = JSON.parse(row.value);
      } catch {
        out[row.key] = undefined;
      }
    }
    return out;
  }
}

function clampConcurrency(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS.concurrency;
  return Math.min(16, Math.max(1, Math.trunc(value)));
}

function readConcurrency(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? clampConcurrency(value) : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function readTheme(value: unknown): AppSettings['theme'] | null {
  return typeof value === 'string' && THEMES.includes(value as AppSettings['theme'])
    ? (value as AppSettings['theme'])
    : null;
}

function readRouting(value: unknown): AppSettings['routing'] | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as AppSettings['routing'];
}
