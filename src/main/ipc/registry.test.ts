/**
 * Головний тест цього шару: зареєстровано РІВНО ті канали, що в контракті.
 * Розбіжність тут означає, що частина UI мовчки впаде в «Модуль ще не підключено».
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IPC_CHANNELS, type IpcHandlers } from '@shared/ipc';
import { createTestDb, type Db } from '@main/db';
import { setStorageRoot } from '@main/paths';
import { InMemorySecrets } from '@main/secrets';
import { assertContractShape, installIpc } from './index';

const electron = vi.hoisted(() => {
  const registered = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  return {
    registered,
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] as string[] })),
  };
});

vi.mock('electron', () => ({
  app: { getPath: () => process.cwd(), isPackaged: false },
  ipcMain: {
    handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) {
      if (electron.registered.has(channel)) {
        throw new Error(`Канал ${channel} уже зареєстровано`);
      }
      electron.registered.set(channel, listener);
    },
    removeHandler(channel: string) {
      electron.registered.delete(channel);
    },
  },
  dialog: { showOpenDialog: electron.showOpenDialog },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8'),
  },
  BrowserWindow: class {},
  shell: { openExternal: vi.fn() },
}));

let root: string;
let db: Db;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'sa-ipc-registry-'));
  setStorageRoot(root);
  db = createTestDb();
});

afterAll(() => {
  db.close();
  setStorageRoot(null);
  rmSync(root, { recursive: true, force: true });
});

afterEach(() => {
  electron.registered.clear();
});

function install() {
  return installIpc({
    db,
    getWindow: () => null,
    secrets: new InMemorySecrets(),
    allowNetwork: false,
    logger: { error: () => {} },
  });
}

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const listener = electron.registered.get(channel);
  if (!listener) throw new Error(`Канал ${channel} не зареєстровано`);
  return await listener({}, ...args);
}

describe('registerIpcHandlers', () => {
  it('реєструє рівно ті канали, що в IPC_CHANNELS — ні більше, ні менше', () => {
    const ipc = install();

    const registered = [...electron.registered.keys()].sort();
    const expected = [...IPC_CHANNELS].sort();

    expect(registered).toEqual(expected);
    // Число тримаємо явно, щоб випадково доданий канал не проліз непоміченим.
    // 49 базових + `blob:read` для вбудованого PDF-вьювера.
    expect(registered).toHaveLength(IPC_CHANNELS.length);
    // 49 базових + `blob:read` (PDF-вьювер) + `documents:runs`, `usage:spend`,
    // `usage:recent` (прогони в розрізі файлу та облік витрат) + `runs:delete`.
    expect(IPC_CHANNELS).toHaveLength(54);

    ipc.dispose();
  });

  it('усі канали контракту мають реалізацію-функцію', () => {
    const ipc = install();
    for (const channel of IPC_CHANNELS) {
      expect(typeof ipc.handlers[channel], channel).toBe('function');
    }
    ipc.dispose();
  });

  it('dispose знімає всі канали', () => {
    const ipc = install();
    expect(electron.registered.size).toBe(IPC_CHANNELS.length);
    ipc.dispose();
    expect(electron.registered.size).toBe(0);
  });

  it('другий installIpc без dispose падає на дублікаті каналу', () => {
    const first = install();
    expect(() => install()).toThrow(/уже зареєстровано/);
    first.dispose();
  });
});

describe('assertContractShape', () => {
  it('ловить відсутній канал', () => {
    const ipc = install();
    const broken = { ...ipc.handlers } as Partial<IpcHandlers>;
    delete broken['runs:gaps'];
    ipc.dispose();

    expect(() => assertContractShape(broken as IpcHandlers)).toThrow(/runs:gaps/);
  });

  it('ловить канал поза контрактом', () => {
    const ipc = install();
    const broken = { ...ipc.handlers, 'runs:teleport': () => undefined } as unknown as IpcHandlers;
    ipc.dispose();

    expect(() => assertContractShape(broken)).toThrow(/поза контрактом: runs:teleport/);
  });
});

describe('серіалізація помилок на межі IPC', () => {
  it('віддає код у повідомленні і не віддає стек', async () => {
    const ipc = install();

    const failure = (await invoke('documents:update', 999_999, { title: 'нема такого' }).then(
      () => null,
      (err: unknown) => err,
    )) as Error | null;

    expect(failure).toBeInstanceOf(Error);
    expect(failure?.message).toBe('[NOT_FOUND] Документ 999999 не знайдено');
    expect(failure?.stack).toBe('Error: [NOT_FOUND] Документ 999999 не знайдено');
    expect(failure?.name).toBe('Error');

    ipc.dispose();
  });
});
