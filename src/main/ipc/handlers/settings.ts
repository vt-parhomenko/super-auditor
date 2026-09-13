/** Налаштування застосунку. Значення нормалізує репозиторій (clamp concurrency тощо). */

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
      if (!patch || typeof patch !== 'object') throw validation('Порожній патч налаштувань');

      if (patch.theme !== undefined && !THEMES.includes(patch.theme)) {
        throw validation(`Невідома тема: ${JSON.stringify(patch.theme)}`);
      }
      if (patch.concurrency !== undefined && !Number.isFinite(patch.concurrency)) {
        throw validation('concurrency має бути числом');
      }
      if (patch.localOnly !== undefined && typeof patch.localOnly !== 'boolean') {
        throw validation('localOnly має бути булевим');
      }

      return db.settings.set(patch);
    },
  };
}
