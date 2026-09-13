/**
 * Облік витрат застосунку.
 *
 * Anthropic не має ендпоінта «залишок коштів» — доступні лише звіти про
 * витрати організації через Admin API з окремим адмінським ключем. Тому
 * показуємо те, що знаємо точно й безкоштовно: скільки витратив цей застосунок,
 * з розбивкою по етапах конвеєра.
 */

import type { IpcHandlers } from '@shared/ipc';
import type { IpcContext } from '../context';

export type UsageHandlers = Pick<IpcHandlers, 'usage:spend' | 'usage:recent'>;

const MAX_RECENT = 500;

export function usageHandlers(ctx: IpcContext): UsageHandlers {
  const { db } = ctx;

  return {
    'usage:spend': () => db.spend.summary(),

    'usage:recent': (limit) => {
      const n = typeof limit === 'number' && Number.isFinite(limit) ? Math.trunc(limit) : 50;
      return db.spend.recent(Math.min(Math.max(n, 1), MAX_RECENT));
    },
  };
}
