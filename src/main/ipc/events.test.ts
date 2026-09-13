import { describe, expect, it, vi } from 'vitest';
import { createEmitter, emit, NOOP_EMITTER, type WindowLike } from './events';

function fakeWindow(state: { window?: boolean; contents?: boolean } = {}): {
  win: WindowLike;
  send: ReturnType<typeof vi.fn>;
} {
  const send = vi.fn();
  const win: WindowLike = {
    isDestroyed: () => state.window ?? false,
    webContents: {
      isDestroyed: () => state.contents ?? false,
      send,
    },
  };
  return { win, send };
}

describe('emit', () => {
  it('надсилає подію живому вікну', () => {
    const { win, send } = fakeWindow();
    const payload = { kind: 'documents' } as const;

    expect(emit(win, 'library:changed', payload)).toBe(true);
    expect(send).toHaveBeenCalledWith('library:changed', payload);
  });

  it('мовчки нічого не робить, якщо вікна вже немає', () => {
    expect(emit(null, 'toast', { level: 'info', message: 'привіт' })).toBe(false);
    expect(emit(undefined, 'toast', { level: 'info', message: 'привіт' })).toBe(false);

    const destroyed = fakeWindow({ window: true });
    expect(emit(destroyed.win, 'toast', { level: 'info', message: 'привіт' })).toBe(false);
    expect(destroyed.send).not.toHaveBeenCalled();

    const closedContents = fakeWindow({ contents: true });
    expect(emit(closedContents.win, 'toast', { level: 'info', message: 'привіт' })).toBe(false);
    expect(closedContents.send).not.toHaveBeenCalled();
  });

  it('не дає надіслати канал поза контрактом', () => {
    const { win } = fakeWindow();
    // @ts-expect-error — канал не з IpcEvents
    expect(() => emit(win, 'run:whatever', {})).toThrow(/Невідомий канал події/);
  });
});

describe('createEmitter', () => {
  it('питає вікно на кожній відправці, а не кешує посилання', () => {
    let current: WindowLike | null = null;
    const emitter = createEmitter(() => current);

    expect(emitter.toast('info', 'ще немає вікна')).toBe(false);

    const { win, send } = fakeWindow();
    current = win;
    expect(emitter.emit('run:finished', { runId: 1, status: 'done' })).toBe(true);
    expect(emitter.toast('warn', 'обережно')).toBe(true);
    expect(send).toHaveBeenCalledWith('toast', { level: 'warn', message: 'обережно' });
  });
});

describe('NOOP_EMITTER', () => {
  it('нічого не робить і не падає', () => {
    expect(NOOP_EMITTER.emit('usage:updated', { runId: 1, usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, costUsd: 0 } })).toBe(false);
    expect(NOOP_EMITTER.toast('info', 'x')).toBe(false);
  });
});
