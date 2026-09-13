/**
 * Єдина точка доступу renderer до IPC.
 *
 * Навіщо обгортка, а не прямий `window.api`:
 *  1. Бекенд (хендлери в main) може бути ще не реалізований — Electron у цьому разі
 *     кидає «No handler registered for 'X'». Ми розпізнаємо це і кидаємо типізовану
 *     `BackendNotReadyError`, щоб екрани показали плейсхолдер, а не аварію.
 *  2. Режим `?mock=1` / `VITE_MOCK=1` підміняє реалізацію фікстурами — див. mocks/.
 *  3. Прибираємо шум Electron з тексту помилки («Error invoking remote method …»).
 */

import { IPC_CHANNELS } from '@shared/ipc';
import type { IpcChannel, IpcEventChannel, IpcEvents, RendererApi } from '@shared/ipc';
import { getMessages } from '@renderer/i18n';

// ─── Помилки ─────────────────────────────────────────────────────────────────

/** Канал існує в контракті, але main його ще не зареєстрував. */
export class BackendNotReadyError extends Error {
  readonly channel: string;

  constructor(channel: string, options?: { cause?: unknown }) {
    super(getMessages().api.backendNotReady(channel), options);
    this.name = 'BackendNotReadyError';
    this.channel = channel;
  }
}

/** Preload не встиг виконатись або сторінку відкрито поза Electron. */
export class BridgeMissingError extends Error {
  constructor() {
    super(getMessages().api.bridgeMissing);
    this.name = 'BridgeMissingError';
  }
}

/** Будь-яка помилка з main із уже почищеним текстом. */
export class IpcCallError extends Error {
  readonly channel: string;

  constructor(channel: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'IpcCallError';
    this.channel = channel;
  }
}

export function isBackendNotReady(error: unknown): error is BackendNotReadyError | BridgeMissingError {
  return error instanceof BackendNotReadyError || error instanceof BridgeMissingError;
}

const NO_HANDLER_RE = /no handler registered/i;

/** Прибирає обгортку Electron: `Error invoking remote method 'ch': Error: текст`. */
function cleanMessage(raw: string): string {
  return raw
    .replace(/^Error invoking remote method '[^']*':\s*/i, '')
    .replace(/^(Error|TypeError):\s*/i, '')
    .trim();
}

function toError(channel: IpcChannel, error: unknown): Error {
  const raw = error instanceof Error ? error.message : String(error);
  if (NO_HANDLER_RE.test(raw)) return new BackendNotReadyError(channel, { cause: error });
  const message = cleanMessage(raw) || getMessages().api.channelFailed(channel);
  return new IpcCallError(channel, message, { cause: error });
}

// ─── Режим фікстур ───────────────────────────────────────────────────────────

function detectMock(): boolean {
  if (import.meta.env.VITE_MOCK === '1' || import.meta.env.VITE_MOCK === 'true') return true;
  if (typeof window === 'undefined') return false;
  const { search, hash } = window.location;
  if (new URLSearchParams(search).get('mock') === '1') return true;
  // hash-роутер: index.html#/runs?mock=1
  const q = hash.indexOf('?');
  if (q >= 0) return new URLSearchParams(hash.slice(q)).get('mock') === '1';
  return false;
}

/** Обчислюється один раз при завантаженні модуля. */
export const IS_MOCK = detectMock();

// ─── Реалізація ──────────────────────────────────────────────────────────────

type Invoker = (...args: unknown[]) => Promise<unknown>;

let installed: RendererApi | null = null;

/** Підміняє джерело даних (використовує mock-режим). */
export function installApi(impl: RendererApi): void {
  installed = impl;
}

function bridge(): RendererApi | null {
  if (installed) return installed;
  return typeof window !== 'undefined' && window.api ? window.api : null;
}

function makeInvoker(channel: IpcChannel): Invoker {
  return async (...args: unknown[]) => {
    const target = bridge();
    if (!target) throw new BridgeMissingError();
    const fn = (target as unknown as Record<string, Invoker | undefined>)[channel];
    if (typeof fn !== 'function') throw new BackendNotReadyError(channel);
    try {
      return await fn(...args);
    } catch (error) {
      throw toError(channel, error);
    }
  };
}

const invokers: Record<string, Invoker> = {};
for (const channel of IPC_CHANNELS) invokers[channel] = makeInvoker(channel);

function subscribe<E extends IpcEventChannel>(
  event: E,
  listener: (payload: IpcEvents[E]) => void,
): () => void {
  const target = bridge();
  if (!target) return () => {};
  try {
    return target.on(event, listener);
  } catch {
    return () => {};
  }
}

/**
 * Типізований фасад контракту. Викликати можна лише канали з `IPC_CHANNELS` —
 * вигадати новий неможливо, бо об'єкт будується зі списку контракту.
 */
export const api: RendererApi = Object.assign(invokers, { on: subscribe }) as unknown as RendererApi;
