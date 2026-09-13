/**
 * Ключі API — тільки в main, тільки зашифровані (architecture.md §12).
 *
 * Шифрування робить `safeStorage`: DPAPI на Windows, Keychain на macOS,
 * kwallet/libsecret на Linux. Зашифрований blob лежить у `<storageRoot>/secrets.json`
 * у base64. Файл сам по собі нічого не дає — без ключа ОС/користувача він не
 * розшифровується.
 *
 * Свідомо НЕ пишемо ключ відкритим текстом, якщо шифрування недоступне
 * (наприклад, Linux без keyring): краще зрозуміла помилка, ніж тихо
 * збережений у плейнтексті ключ, про який користувач не знає.
 *
 * `getApiKey` існує тільки для main-процесу: у renderer ключ не потрапляє
 * ніколи, `providers:list` віддає лише `configured: boolean`.
 */

import { safeStorage } from 'electron';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { storageRoot } from './paths';

const FILE_NAME = 'secrets.json';
const FORMAT_VERSION = 1;

interface SecretsFile {
  version: number;
  /** providerId → base64(safeStorage.encryptString(key)) */
  keys: Record<string, string>;
}

/** Системне шифрування недоступне — зберігати ключ нема куди. */
export class EncryptionUnavailableError extends Error {
  constructor() {
    super(
      'Системне сховище паролів недоступне (safeStorage). ' +
        'Ключ API не збережено — інакше він лежав би на диску відкритим текстом. ' +
        'На Linux потрібен gnome-keyring або kwallet; на Windows і macOS перевірте профіль користувача.',
    );
    this.name = 'EncryptionUnavailableError';
  }
}

export interface SecretsStore {
  setApiKey(providerId: string, apiKey: string): void;
  /** ТІЛЬКИ для main. Ніколи не віддавати в renderer. */
  getApiKey(providerId: string): string | null;
  clearApiKey(providerId: string): void;
  hasApiKey(providerId: string): boolean;
  /** Провайдери, для яких ключ збережено. */
  listConfigured(): string[];
}

/** Мінімальна поверхня `safeStorage` — щоб підмінити в тестах. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface SafeStorageSecretsOptions {
  /** Шлях до файлу. За замовчуванням `<storageRoot>/secrets.json`, обчислюється лениво. */
  filePath?: () => string;
  storage?: SafeStorageLike;
  logger?: { warn(...args: unknown[]): void };
}

export class SafeStorageSecrets implements SecretsStore {
  private readonly filePath: () => string;
  private readonly storage: () => SafeStorageLike;
  private readonly logger: { warn(...args: unknown[]): void };
  /** Розшифровані ключі: decryptString коштує сисвиклику, а isConfigured() смикають часто. */
  private readonly cache = new Map<string, string | null>();

  constructor(options: SafeStorageSecretsOptions = {}) {
    this.filePath = options.filePath ?? (() => join(storageRoot(), FILE_NAME));
    const injected = options.storage;
    this.storage = injected ? () => injected : () => safeStorage as unknown as SafeStorageLike;
    this.logger = options.logger ?? console;
  }

  setApiKey(providerId: string, apiKey: string): void {
    const id = normalizeId(providerId);
    const value = apiKey.trim();
    if (value.length === 0) {
      this.clearApiKey(id);
      return;
    }

    const storage = this.storage();
    if (!storage.isEncryptionAvailable()) throw new EncryptionUnavailableError();

    const file = this.read();
    file.keys[id] = storage.encryptString(value).toString('base64');
    this.write(file);
    this.cache.set(id, value);
  }

  getApiKey(providerId: string): string | null {
    const id = normalizeId(providerId);
    const cached = this.cache.get(id);
    if (cached !== undefined) return cached;

    const encoded = this.read().keys[id];
    if (!encoded) {
      this.cache.set(id, null);
      return null;
    }

    const storage = this.storage();
    if (!storage.isEncryptionAvailable()) {
      // Ключ є, але розшифрувати нічим — не падаємо, провайдер просто «не налаштований».
      this.logger.warn(`[secrets] шифрування недоступне, ключ «${id}» не прочитано`);
      return null;
    }

    try {
      const key = storage.decryptString(Buffer.from(encoded, 'base64'));
      this.cache.set(id, key);
      return key;
    } catch (err) {
      // Типовий випадок: файл перенесли з іншої машини або профілю.
      this.logger.warn(`[secrets] не вдалось розшифрувати ключ «${id}»:`, err);
      this.cache.set(id, null);
      return null;
    }
  }

  clearApiKey(providerId: string): void {
    const id = normalizeId(providerId);
    const file = this.read();
    if (id in file.keys) {
      delete file.keys[id];
      this.write(file);
    }
    this.cache.set(id, null);
  }

  hasApiKey(providerId: string): boolean {
    const id = normalizeId(providerId);
    const cached = this.cache.get(id);
    if (cached !== undefined) return cached !== null;
    return Boolean(this.read().keys[id]);
  }

  listConfigured(): string[] {
    return Object.keys(this.read().keys).sort();
  }

  /** Скидає кеш розшифрованих ключів — файл могли змінити ззовні. */
  invalidate(): void {
    this.cache.clear();
  }

  private read(): SecretsFile {
    const path = this.filePath();
    if (!existsSync(path)) return { version: FORMAT_VERSION, keys: {} };
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<SecretsFile>;
      const keys = parsed.keys;
      if (!keys || typeof keys !== 'object') return { version: FORMAT_VERSION, keys: {} };
      const clean: Record<string, string> = {};
      for (const [id, value] of Object.entries(keys)) {
        if (typeof value === 'string' && value.length > 0) clean[id] = value;
      }
      return { version: FORMAT_VERSION, keys: clean };
    } catch (err) {
      this.logger.warn('[secrets] файл ключів пошкоджено, читаю як порожній:', err);
      return { version: FORMAT_VERSION, keys: {} };
    }
  }

  /** Запис через тимчасовий файл і rename: обрив не лишить напівзаписаних ключів. */
  private write(file: SecretsFile): void {
    const path = this.filePath();
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(file, null, 2), { encoding: 'utf8', mode: 0o600 });
      renameSync(tmp, path);
    } catch (err) {
      rmSync(tmp, { force: true });
      throw err;
    }
    try {
      chmodSync(path, 0o600);
    } catch {
      // На Windows права файлів так не виставляються — це не помилка.
    }
  }
}

function normalizeId(providerId: string): string {
  const id = providerId.trim().toLowerCase();
  if (id.length === 0) throw new Error('providerId не може бути порожнім');
  return id;
}

// ─── Модульний фасад ─────────────────────────────────────────────────────────

let shared: SecretsStore | null = null;

/** Спільний екземпляр поверх `<storageRoot>/secrets.json`. */
export function secrets(): SecretsStore {
  if (!shared) shared = new SafeStorageSecrets();
  return shared;
}

/** Для тестів: підмінити спільний екземпляр. */
export function setSharedSecrets(impl: SecretsStore | null): void {
  shared = impl;
}

export function setApiKey(providerId: string, apiKey: string): void {
  secrets().setApiKey(providerId, apiKey);
}

export function getApiKey(providerId: string): string | null {
  return secrets().getApiKey(providerId);
}

export function clearApiKey(providerId: string): void {
  secrets().clearApiKey(providerId);
}

export function hasApiKey(providerId: string): boolean {
  return secrets().hasApiKey(providerId);
}

/** Сховище в пам'яті — для тестів. */
export class InMemorySecrets implements SecretsStore {
  private readonly keys = new Map<string, string>();

  setApiKey(providerId: string, apiKey: string): void {
    const value = apiKey.trim();
    if (value.length === 0) this.keys.delete(normalizeId(providerId));
    else this.keys.set(normalizeId(providerId), value);
  }

  getApiKey(providerId: string): string | null {
    return this.keys.get(normalizeId(providerId)) ?? null;
  }

  clearApiKey(providerId: string): void {
    this.keys.delete(normalizeId(providerId));
  }

  hasApiKey(providerId: string): boolean {
    return this.keys.has(normalizeId(providerId));
  }

  listConfigured(): string[] {
    return [...this.keys.keys()].sort();
  }
}
