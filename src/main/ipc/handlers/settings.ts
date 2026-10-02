/** Налаштування застосунку. Значення нормалізує репозиторій (clamp concurrency тощо). */

import { isResultsLanguage } from '@main/db';
import { isLanguage } from '@shared/domain';
import type { AppSettings, IpcHandlers } from '@shared/ipc';
import type { IpcContext } from '../context';
import { validation } from '../errors';

export type SettingsHandlers = Pick<IpcHandlers, 'settings:get' | 'settings:set'>;

const THEMES: readonly AppSettings['theme'][] = ['system', 'light', 'dark'];

export function settingsHandlers(ctx: IpcContext): SettingsHandlers {
  const { db } = ctx;

  return {
    'settings:get': () => db.settings.get(),

    'settings:set': (patch) => {
      if (!patch || typeof patch !== 'object') throw validation((m) => m.settings.emptyPatch);

      if (patch.theme !== undefined && !THEMES.includes(patch.theme)) {
        const value = JSON.stringify(patch.theme);
        throw validation((m) => m.settings.unknownTheme(value));
      }
      if (patch.concurrency !== undefined && !Number.isFinite(patch.concurrency)) {
        throw validation((m) => m.settings.concurrencyNotNumber);
      }
      if (patch.localOnly !== undefined && typeof patch.localOnly !== 'boolean') {
        throw validation((m) => m.settings.localOnlyNotBoolean);
      }
      // Мова результатів їде просто в промпт — лише мови застосунку або `''`.
      if (patch.resultsLanguage !== undefined && !isResultsLanguage(patch.resultsLanguage)) {
        const value = String(JSON.stringify(patch.resultsLanguage));
        throw validation((m) => m.settings.invalidResultsLanguage(value));
      }
      if (patch.uiLanguage !== undefined && !isLanguage(patch.uiLanguage)) {
        const value = String(JSON.stringify(patch.uiLanguage));
        throw validation((m) => m.settings.invalidUiLanguage(value));
      }

      return db.settings.set(patch);
    },
  };
}
