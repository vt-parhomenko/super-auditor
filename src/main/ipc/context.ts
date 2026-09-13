/**
 * Усе, що потрібно хендлерам, приходить одним об'єктом — тоді кожну групу
 * можна протестувати на базі в пам'яті, не піднімаючи ані Electron, ані мережу.
 */

import type { BrowserWindow } from 'electron';
import type { Db } from '@main/db';
import type { ProviderRegistry } from '@main/llm';
import type { SecretsStore } from '@main/secrets';
import type { IpcEmitter } from './events';

export interface IpcContext {
  readonly db: Db;
  /** Події в renderer. */
  readonly events: IpcEmitter;
  /** Ключі API. У renderer не потрапляють ніколи. */
  readonly secrets: SecretsStore;
  readonly providers: ProviderRegistry;
  /** false → `providers:test` не ходить у мережу (тести, офлайн-режим). */
  readonly allowNetwork: boolean;
  /** Вікно для модальних діалогів. `null` — вікна зараз немає. */
  getWindow(): BrowserWindow | null;
}
