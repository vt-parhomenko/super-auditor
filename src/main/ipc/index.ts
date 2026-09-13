/**
 * Публічний API шару IPC. `main/index.ts` імпортує тільки звідси.
 *
 *   const ipc = installIpc({ db, getWindow: () => mainWindow });
 *   setOrchestrator(createOrchestrator({ db, events: ipc.context.events }));
 */

import type { BrowserWindow } from 'electron';
import type { Db } from '@main/db';
import { createDefaultRegistry, type ProviderRegistry } from '@main/llm';
import { secrets as sharedSecrets, type SecretsStore } from '@main/secrets';
import type { IpcHandlers } from '@shared/ipc';
import type { IpcContext } from './context';
import { createEmitter, type IpcEmitter } from './events';
import type { ErrorLogger } from './errors';
import { createHandlers, type CreateHandlersOptions } from './handlers';
import { registerIpcHandlers, type IpcMainLike } from './registry';

export interface InstallIpcOptions {
  db: Db;
  /** Поточне вікно — для діалогів і подій. */
  getWindow: () => BrowserWindow | null;
  secrets?: SecretsStore;
  providers?: ProviderRegistry;
  /** false → `providers:test` не ходить у мережу. За замовчуванням — з env. */
  allowNetwork?: boolean;
  ipc?: IpcMainLike;
  logger?: ErrorLogger;
  handlers?: CreateHandlersOptions;
}

export interface InstalledIpc {
  context: IpcContext;
  handlers: IpcHandlers;
  events: IpcEmitter;
  /** Знімає реєстрацію всіх каналів. */
  dispose(): void;
}

/** Офлайн-режим для CI та тестів: `SUPER_AUDITOR_OFFLINE=1`. */
export function networkAllowedByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env['SUPER_AUDITOR_OFFLINE'];
  return flag !== '1' && flag !== 'true';
}

export function installIpc(options: InstallIpcOptions): InstalledIpc {
  const store = options.secrets ?? sharedSecrets();
  const events = createEmitter(options.getWindow);

  const providers =
    options.providers ??
    createDefaultRegistry({ getApiKey: (providerId) => store.getApiKey(providerId) });

  const context: IpcContext = {
    db: options.db,
    events,
    secrets: store,
    providers,
    allowNetwork: options.allowNetwork ?? networkAllowedByEnv(),
    getWindow: options.getWindow,
  };

  const handlers = createHandlers(context, options.handlers);
  const dispose = registerIpcHandlers(handlers, {
    ...(options.ipc ? { ipc: options.ipc } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
  });

  return { context, handlers, events, dispose };
}

export type { IpcContext } from './context';
export {
  IPC_ERROR_CODES,
  IpcError,
  busy,
  cloudBlocked,
  formatIpcErrorMessage,
  internal,
  isIpcError,
  isIpcErrorCode,
  notFound,
  parseIpcErrorMessage,
  providerNotConfigured,
  serializeIpcError,
  toIpcError,
  validation,
  type ErrorLogger,
  type IpcErrorCode,
  type IpcErrorShape,
} from './errors';
export {
  NOOP_EMITTER,
  createEmitter,
  emit,
  type IpcEmitter,
  type WebContentsLike,
  type WindowLike,
} from './events';
export {
  hasOrchestrator,
  requireOrchestrator,
  setOrchestrator,
  type RunEstimate,
  type RunOrchestrator,
} from './orchestratorPort';
export {
  assertContractShape,
  contractChannels,
  registerIpcHandlers,
  type IpcMainLike,
  type RegisterOptions,
} from './registry';
export { createHandlers, type CreateHandlersOptions } from './handlers';
