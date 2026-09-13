import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron', () => ({
  app: { getPath: () => process.cwd(), isPackaged: false },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.alloc(0),
    decryptString: () => '',
  },
}));

const { EncryptionUnavailableError, InMemorySecrets, SafeStorageSecrets } = await import('./secrets');

/** Фейковий safeStorage: «шифрування» — це XOR, достатньо щоб побачити, що це не плейнтекст. */
function fakeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (text: string) =>
      Buffer.from([...Buffer.from(text, 'utf8')].map((b) => b ^ 0x5a)),
    decryptString: (buf: Buffer) =>
      Buffer.from([...buf].map((b) => b ^ 0x5a)).toString('utf8'),
  };
}

let root: string;
let file: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sa-secrets-'));
  file = join(root, 'secrets.json');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('SafeStorageSecrets', () => {
  it('зберігає, читає й видаляє ключ', () => {
    const store = new SafeStorageSecrets({ filePath: () => file, storage: fakeStorage() });

    expect(store.hasApiKey('anthropic')).toBe(false);
    expect(store.getApiKey('anthropic')).toBeNull();

    store.setApiKey('anthropic', 'sk-ant-таємниця');
    expect(store.hasApiKey('anthropic')).toBe(true);
    expect(store.getApiKey('anthropic')).toBe('sk-ant-таємниця');
    expect(store.listConfigured()).toEqual(['anthropic']);

    store.clearApiKey('anthropic');
    expect(store.hasApiKey('anthropic')).toBe(false);
    expect(store.getApiKey('anthropic')).toBeNull();
  });

  it('на диску лежить шифротекст, а не ключ', () => {
    const store = new SafeStorageSecrets({ filePath: () => file, storage: fakeStorage() });
    store.setApiKey('anthropic', 'sk-ant-таємниця');

    const raw = readFileSync(file, 'utf8');
    expect(existsSync(file)).toBe(true);
    expect(raw).not.toContain('sk-ant');
    expect(JSON.parse(raw).keys.anthropic).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('переживає перевідкриття сховища', () => {
    new SafeStorageSecrets({ filePath: () => file, storage: fakeStorage() }).setApiKey(
      'anthropic',
      'ключ-1',
    );
    const reopened = new SafeStorageSecrets({ filePath: () => file, storage: fakeStorage() });
    expect(reopened.getApiKey('ANTHROPIC')).toBe('ключ-1');
  });

  it('без safeStorage не зберігає нічого — кидає зрозумілу помилку', () => {
    const store = new SafeStorageSecrets({ filePath: () => file, storage: fakeStorage(false) });

    expect(() => store.setApiKey('anthropic', 'sk-ant-таємниця')).toThrow(
      EncryptionUnavailableError,
    );
    expect(existsSync(file)).toBe(false);
  });

  it('ключ, який не розшифровується, не валить застосунок', () => {
    const logger = { warn: vi.fn() };
    writeFileSync(file, JSON.stringify({ version: 1, keys: { anthropic: 'не-base64-зовсім' } }));

    const store = new SafeStorageSecrets({
      filePath: () => file,
      logger,
      storage: {
        ...fakeStorage(),
        decryptString: () => {
          throw new Error('bad ciphertext');
        },
      },
    });

    expect(store.getApiKey('anthropic')).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('пошкоджений файл читається як порожній', () => {
    const logger = { warn: vi.fn() };
    writeFileSync(file, '{ це не json');
    const store = new SafeStorageSecrets({ filePath: () => file, logger, storage: fakeStorage() });

    expect(store.listConfigured()).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('порожній ключ — це видалення, а не збереження порожнечі', () => {
    const store = new SafeStorageSecrets({ filePath: () => file, storage: fakeStorage() });
    store.setApiKey('anthropic', 'ключ');
    store.setApiKey('anthropic', '   ');
    expect(store.hasApiKey('anthropic')).toBe(false);
  });
});

describe('InMemorySecrets', () => {
  it('поводиться як SafeStorageSecrets, але без диска', () => {
    const store = new InMemorySecrets();
    store.setApiKey('Anthropic', ' ключ ');
    expect(store.getApiKey('anthropic')).toBe('ключ');
    expect(store.listConfigured()).toEqual(['anthropic']);
    store.clearApiKey('anthropic');
    expect(store.hasApiKey('anthropic')).toBe(false);
  });
});
