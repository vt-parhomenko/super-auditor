import { describe, expect, it, vi } from 'vitest';
import { LocalizedError } from '@main/i18n';
import { LlmCloudBlockedError, LlmError, LlmNotConfiguredError } from '@main/llm';
import {
  IPC_ERROR_CODES,
  IpcError,
  formatIpcErrorMessage,
  notFound,
  parseIpcErrorMessage,
  serializeIpcError,
  toIpcError,
  validation,
} from './errors';

describe('коди помилок', () => {
  it('покриває всі випадки, які розрізняє UI', () => {
    expect([...IPC_ERROR_CODES]).toEqual([
      'NOT_FOUND',
      'VALIDATION',
      'CLOUD_BLOCKED',
      'PROVIDER_NOT_CONFIGURED',
      'BUSY',
      'INTERNAL',
    ]);
  });
});

describe('формат повідомлення', () => {
  it('кодує код і деталі так, щоб їх можна було розібрати назад', () => {
    const message = formatIpcErrorMessage({
      code: 'VALIDATION',
      message: 'Реєстр не вичитано',
      details: { auto: 3, flagged: 1 },
    });

    expect(message.startsWith('[VALIDATION] Реєстр не вичитано')).toBe(true);
    expect(parseIpcErrorMessage(message)).toEqual({
      code: 'VALIDATION',
      message: 'Реєстр не вичитано',
      details: { auto: 3, flagged: 1 },
    });
  });

  it('переживає обгортку Electron «Error invoking remote method»', () => {
    const raw = `Error invoking remote method 'documents:get': Error: ${formatIpcErrorMessage(
      notFound('document', 42).shapeIn('uk'),
    )}`;

    expect(parseIpcErrorMessage(raw)).toEqual({
      code: 'NOT_FOUND',
      message: 'Документ 42 не знайдено',
    });
  });

  it('повертає null для чужого повідомлення', () => {
    expect(parseIpcErrorMessage('ECONNREFUSED 127.0.0.1:11434')).toBeNull();
    expect(parseIpcErrorMessage('[WHATEVER] щось')).toBeNull();
  });
});

describe('мова повідомлень', () => {
  it('ключ каталогу рендериться мовою, яку обирає межа IPC', () => {
    const err = validation((m) => m.runs.noDocuments, { field: 'documentVersionIds' });

    // `message` — англійською, для логів і стеків.
    expect(err.message).toBe('No documents selected for the run');
    expect(err.shape).toEqual({
      code: 'VALIDATION',
      message: 'No documents selected for the run',
      details: { field: 'documentVersionIds' },
    });
    expect(err.shapeIn('uk').message).toBe('Не вибрано жодного документа для перевірки');
    expect(err.shapeIn('nl').message).toBe('Er zijn geen documenten geselecteerd voor de auditrun');
  });

  it('notFound складає фразу каталогом: відмінок і порядок слів різні', () => {
    expect(notFound('specification', 7).localize('en')).toBe('Specification 7 not found');
    expect(notFound('specification', 7).localize('uk')).toBe('Специфікацію 7 не знайдено');
    expect(notFound('specification', 7).localize('nl')).toBe('Norm 7 niet gevonden');
    expect(notFound('blob').localize('en')).toBe('Blob not found');
  });

  it('готовий рядок лишається як є в будь-якій мові', () => {
    expect(validation('raw text').localize('uk')).toBe('raw text');
  });

  it('serializeIpcError віддає текст мовою інтерфейсу', () => {
    const outbound = serializeIpcError(notFound('run', 5), 'runs:get', { error: () => {} }, 'uk');
    expect(outbound.message).toBe('[NOT_FOUND] Перевірку 5 не знайдено');
  });
});

describe('toIpcError', () => {
  it('лишає IpcError як є', () => {
    const err = validation('погано');
    expect(toIpcError(err)).toBe(err);
  });

  it('розкладає помилки шару LLM по кодах', () => {
    expect(toIpcError(new LlmCloudBlockedError('anthropic', 'ні')).code).toBe('CLOUD_BLOCKED');
    expect(toIpcError(new LlmNotConfiguredError('anthropic')).code).toBe('PROVIDER_NOT_CONFIGURED');
    expect(
      toIpcError(new LlmError('rate_limit', '429', { providerId: 'anthropic' })).code,
    ).toBe('BUSY');
    expect(toIpcError(new LlmError('schema', 'zod', { providerId: 'anthropic' })).code).toBe(
      'INTERNAL',
    );
  });

  it('усе інше — INTERNAL', () => {
    expect(toIpcError(new Error('бум')).code).toBe('INTERNAL');
    expect(toIpcError('рядок').code).toBe('INTERNAL');
  });

  it('помилки LLM отримують людський текст мовою інтерфейсу', () => {
    const credit = new LlmError('insufficient_credit', 'credit balance is too low', {
      providerId: 'openrouter',
    });
    const message = toIpcError(credit, 'uk').localize('uk');
    expect(message).toContain('Вичерпано баланс OpenRouter');
    expect(message).toContain('credit balance is too low');

    const unconfigured = toIpcError(new LlmNotConfiguredError('anthropic'), 'nl');
    expect(unconfigured.code).toBe('PROVIDER_NOT_CONFIGURED');
    expect(unconfigured.localize('nl')).toContain('Anthropic is niet geconfigureerd');
  });

  it('помилки шарів без мови (LocalizedError) локалізуються тут', () => {
    const deep = new LocalizedError((m) => m.secrets.encryptionUnavailable);
    expect(deep.message).toContain('safeStorage');

    const ipc = toIpcError(deep, 'uk');
    expect(ipc.code).toBe('INTERNAL');
    expect(ipc.localize('uk')).toContain('Системне сховище паролів');
  });

  it('порушення цілісності SQLite — VALIDATION мовою інтерфейсу', () => {
    const sqlite = Object.assign(new Error('FOREIGN KEY constraint failed'), {
      code: 'SQLITE_CONSTRAINT_FOREIGNKEY',
    });
    const ipc = toIpcError(sqlite, 'uk');
    expect(ipc.code).toBe('VALIDATION');
    expect(ipc.shapeIn('uk').message).toContain('суперечить цілісності даних');
    expect(ipc.shapeIn('en').message).toContain('data integrity');
  });
});

describe('serializeIpcError', () => {
  it('логує повний стек у main і не віддає його назовні', () => {
    const logger = { error: vi.fn() };
    const source = new IpcError('BUSY', 'зайнято');
    source.stack = 'IpcError: зайнято\n    at secretInternalFrame (/src/main/secret.ts:1:1)';

    const outbound = serializeIpcError(source, 'runs:start', logger);

    expect(outbound.message).toBe('[BUSY] зайнято');
    expect(outbound.stack).toBe('Error: [BUSY] зайнято');
    expect(outbound.stack).not.toContain('secretInternalFrame');

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(String(logger.error.mock.calls[0]?.[0])).toContain('secretInternalFrame');
  });
});
