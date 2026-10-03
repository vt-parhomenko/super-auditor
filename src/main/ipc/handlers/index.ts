/**
 * Збірка всіх груп хендлерів в один об'єкт контракту.
 *
 * Тип `IpcHandlers` тут не декорація: якщо група забула канал або додала
 * зайвий, `createHandlers` не скомпілюється. Рантайм-дублікат цієї перевірки —
 * `assertContractShape` у registry.ts.
 */

import type { IpcHandlers } from '@shared/ipc';
import type { IpcContext } from '../context';
import { clauseHandlers } from './clauses';
import { docProfileHandlers } from './docProfiles';
import { documentHandlers } from './documents';
import { exportHandlers } from './exporting';
import { findingHandlers } from './findings';
import { importHandlers } from './importing';
import { libraryHandlers } from './library';
import { providerHandlers, type ProviderHandlerOptions } from './providers';
import { runHandlers } from './runs';
import { usageHandlers } from './usage';
import { settingsHandlers } from './settings';
import { siteHandlers } from './sites';
import { specHandlers } from './specs';

export interface CreateHandlersOptions {
  providers?: ProviderHandlerOptions;
}

export function createHandlers(
  ctx: IpcContext,
  options: CreateHandlersOptions = {},
): IpcHandlers {
  return {
    ...documentHandlers(ctx),
    ...libraryHandlers(ctx),
    ...specHandlers(ctx),
    ...clauseHandlers(ctx),
    ...importHandlers(ctx),
    ...siteHandlers(ctx),
    ...docProfileHandlers(ctx),
    ...runHandlers(ctx),
    ...findingHandlers(ctx),
    ...settingsHandlers(ctx),
    ...usageHandlers(ctx),
    ...providerHandlers(ctx, options.providers),
    ...exportHandlers(ctx),
  };
}

export { clauseHandlers } from './clauses';
export { docProfileHandlers } from './docProfiles';
export { documentHandlers } from './documents';
export { exportHandlers } from './exporting';
export { findingHandlers } from './findings';
export { importHandlers } from './importing';
export { libraryHandlers } from './library';
export {
  defaultProbe,
  providerHandlers,
  type ProviderHandlerOptions,
  type ProviderProbe,
  type ProviderTestResult,
} from './providers';
export { runHandlers } from './runs';
export { settingsHandlers } from './settings';
export { siteHandlers } from './sites';
export { specHandlers } from './specs';
