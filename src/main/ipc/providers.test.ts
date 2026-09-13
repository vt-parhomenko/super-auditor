/**
 * `providers:test` — єдиний канал, який має право торкнутись мережі.
 * Тому тут перевіряється і прапорець вимкнення мережі, і мапінг помилок.
 */

import { describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { createTestDb } from '@main/db';
import { createDefaultRegistry, type LlmProvider } from '@main/llm';
import { InMemorySecrets } from '@main/secrets';
import type { IpcContext } from './context';
import { NOOP_EMITTER } from './events';
import { defaultProbe, describeAnthropicError, providerHandlers } from './handlers/providers';

vi.mock('electron', () => ({
  app: { getPath: () => process.cwd(), isPackaged: false },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.alloc(0),
    decryptString: () => '',
  },
}));

function makeContext(allowNetwork: boolean): { ctx: IpcContext; secrets: InMemorySecrets } {
  const secrets = new InMemorySecrets();
  const ctx: IpcContext = {
    db: createTestDb(),
    events: NOOP_EMITTER,
    secrets,
    providers: createDefaultRegistry({ getApiKey: (id) => secrets.getApiKey(id) }),
    allowNetwork,
    getWindow: () => null,
  };
  return { ctx, secrets };
}

describe('providers:test', () => {
  it('без мережі не викликає probe взагалі', async () => {
    const { ctx, secrets } = makeContext(false);
    secrets.setApiKey('anthropic', 'sk-ant-x');
    const probe = vi.fn();

    const handlers = providerHandlers(ctx, { probe });
    const result = await handlers['providers:test']('anthropic');

    expect(probe).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Мережеву перевірку вимкнено');
    ctx.db.close();
  });

  it('з мережею передає в probe провайдера і ключ, але наверх ключ не віддає', async () => {
    const { ctx, secrets } = makeContext(true);
    secrets.setApiKey('anthropic', 'sk-ant-секрет');
    const probe = vi.fn(async (_provider: LlmProvider, _apiKey: string | null) => ({
      ok: true,
      message: 'усе працює',
    }));

    const handlers = providerHandlers(ctx, { probe });
    const result = await handlers['providers:test']('anthropic');

    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe.mock.calls[0]?.[1]).toBe('sk-ant-секрет');
    expect(result).toEqual({ ok: true, message: 'усе працює' });
    expect(JSON.stringify(result)).not.toContain('sk-ant');
    ctx.db.close();
  });

  it('без ключа навіть не намагається йти в мережу', async () => {
    const { ctx } = makeContext(true);
    const probe = vi.fn();

    const handlers = providerHandlers(ctx, { probe });
    const result = await handlers['providers:test']('anthropic');

    expect(probe).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('не налаштований');
    ctx.db.close();
  });
});

describe('defaultProbe', () => {
  it('для Anthropic без ключа не робить запиту', async () => {
    const { ctx } = makeContext(true);
    const provider = ctx.providers.get('anthropic')!;

    const result = await defaultProbe(provider, null);
    expect(result).toEqual({
      ok: false,
      message: 'Ключ Anthropic не знайдено в захищеному сховищі',
    });
    ctx.db.close();
  });
});

describe('describeAnthropicError', () => {
  const body = { type: 'error', error: { type: 'authentication_error', message: 'invalid' } };

  it('401 → підказка про ключ', () => {
    const err = new Anthropic.AuthenticationError(401, body, '401', new Headers());
    expect(describeAnthropicError(err)).toContain('Ключ API відхилено (401)');
  });

  it('403 → підказка про права', () => {
    const err = new Anthropic.PermissionDeniedError(403, body, '403', new Headers());
    expect(describeAnthropicError(err)).toContain('Доступ заборонено (403)');
  });

  it('429 → ключ дійсний, просто ліміт', () => {
    const err = new Anthropic.RateLimitError(429, body, '429', new Headers());
    expect(describeAnthropicError(err)).toContain('ліміт запитів');
  });

  it('обрив зʼєднання → підказка про мережу й проксі', () => {
    const err = new Anthropic.APIConnectionError({ message: 'Connection error.' });
    expect(describeAnthropicError(err)).toContain('Немає зʼєднання');
  });

  it('решта помилок доходить текстом, а не «[object Object]»', () => {
    expect(describeAnthropicError(new Error('щось інше'))).toBe('щось інше');
    expect(describeAnthropicError('рядок')).toBe('рядок');
  });
});
