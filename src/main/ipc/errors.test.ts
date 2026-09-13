import { describe, expect, it, vi } from 'vitest';
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
      notFound('Документ', 42).shape,
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
