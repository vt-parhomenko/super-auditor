/**
 * `providers:test` — єдиний канал, який має право торкнутись мережі.
 * Тому тут перевіряється і прапорець вимкнення мережі, і мапінг помилок.
 */

import { describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { createTestDb } from '@main/db';
import { mainMessages } from '@main/i18n';
import { createDefaultRegistry, type FetchLike, type LlmProvider } from '@main/llm';
import { InMemorySecrets } from '@main/secrets';
import type { IpcContext } from './context';
import { NOOP_EMITTER } from './events';
import { defaultProbe, describeAnthropicError, probeOpenRouter, providerHandlers } from './handlers/providers';
import { catalogueKey, installIpc } from './index';

vi.mock('electron', () => ({
  app: { getPath: () => process.cwd(), isPackaged: false },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.alloc(0),
    decryptString: () => '',
  },
}));

/** Повідомлення перевіряємо українською — мова інтерфейсу береться з налаштувань. */
const UK = mainMessages('uk').providers;

function ukDb(): ReturnType<typeof createTestDb> {
  const db = createTestDb();
  db.settings.set({ uiLanguage: 'uk' });
  return db;
}

function makeContext(allowNetwork: boolean): { ctx: IpcContext; secrets: InMemorySecrets } {
  const secrets = new InMemorySecrets();
  const ctx: IpcContext = {
    db: ukDb(),
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

    const result = await defaultProbe(provider, null, UK);
    expect(result).toEqual({
      ok: false,
      message: 'Ключ Anthropic не знайдено в захищеному сховищі',
    });
    ctx.db.close();
  });
});

// ─── OpenRouter: моделі, баланс, management-ключ ─────────────────────────────

const KEY_DATA = {
  label: 'sk-or-v1-au7...890',
  limit: 100,
  limit_remaining: 74.5,
  limit_reset: 'monthly',
  usage: 25.5,
  usage_daily: 1,
  usage_weekly: 5,
  usage_monthly: 25.5,
  is_free_tier: false,
};

/** Заглушка всього, що OpenRouter віддає без токенів: /models, /key, /credits. */
function openRouterFetch() {
  const calls: Array<{ path: string; auth: string | undefined }> = [];
  const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
    const path = new URL(url).pathname.replace('/api/v1', '');
    calls.push({ path, auth: (init.headers as Record<string, string> | undefined)?.authorization });
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (path === '/models') {
      return json({
        data: [
          {
            id: 'acme/new-model',
            name: 'Acme: New Model',
            context_length: 100_000,
            pricing: { prompt: '0.000001', completion: '0.000002' },
            top_provider: { max_completion_tokens: 8_000 },
            supported_parameters: ['response_format', 'structured_outputs'],
            architecture: { output_modalities: ['text'] },
          },
        ],
      });
    }
    if (path === '/key') return json({ data: KEY_DATA });
    if (path === '/credits') return json({ data: { total_credits: 50, total_usage: 20 } });
    return json({ error: { message: 'not found' } }, 404);
  });
  return { fetchImpl, calls };
}

function makeOpenRouterContext(allowNetwork: boolean) {
  const secrets = new InMemorySecrets();
  const { fetchImpl, calls } = openRouterFetch();
  const ctx: IpcContext = {
    db: createTestDb(),
    events: NOOP_EMITTER,
    secrets,
    providers: createDefaultRegistry({ getApiKey: (id) => secrets.getApiKey(id), fetchImpl }),
    allowNetwork,
    getWindow: () => null,
  };
  return { ctx, secrets, calls, handlers: providerHandlers(ctx) };
}

describe('providers:refreshModels', () => {
  it('офлайн — поточний статус без жодного запиту', async () => {
    const { ctx, calls, handlers } = makeOpenRouterContext(false);
    const status = await handlers['providers:refreshModels']('openrouter');
    expect(calls).toHaveLength(0);
    expect(status).toMatchObject({ id: 'openrouter', catalogueUpdatedAt: null, allowCustomModel: true });
    expect(status.models[0]).toBe('anthropic/claude-opus-5.5');
    ctx.db.close();
  });

  it('з мережею — свіжий каталог OpenRouter без ключа (публічний /models)', async () => {
    const { ctx, calls, handlers } = makeOpenRouterContext(true);
    const status = await handlers['providers:refreshModels']('OpenRouter');
    expect(calls.map((call) => call.path)).toEqual(['/models']);
    expect(calls[0]?.auth).toBeUndefined();
    expect(status.catalogueUpdatedAt).not.toBeNull();
    expect(status.models).toContain('acme/new-model');
    expect(status.modelInfo.find((info) => info.id === 'acme/new-model')).toMatchObject({ recommended: false, efforts: [] });
    ctx.db.close();
  });

  it('невідомий провайдер — NOT_FOUND', async () => {
    const { ctx, handlers } = makeOpenRouterContext(true);
    await expect(handlers['providers:refreshModels']('skynet')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    ctx.db.close();
  });
});

describe('providers:balance і management-ключ', () => {
  it('null: офлайн, без ключа, або провайдер без балансу', async () => {
    const offline = makeOpenRouterContext(false);
    offline.secrets.setApiKey('openrouter', 'sk-or-inference');
    expect(await offline.handlers['providers:balance']('openrouter')).toBeNull();
    expect(offline.calls).toHaveLength(0);
    offline.ctx.db.close();

    const online = makeOpenRouterContext(true);
    expect(await online.handlers['providers:balance']('openrouter')).toBeNull(); // ключа ще немає
    online.secrets.setApiKey('anthropic', 'sk-ant-x');
    expect(await online.handlers['providers:balance']('anthropic')).toBeNull();
    expect(online.calls).toHaveLength(0);
    online.ctx.db.close();
  });

  it('звичайний ключ — дані ключа; рахунок потребує management-ключа', async () => {
    const { ctx, secrets, calls, handlers } = makeOpenRouterContext(true);
    secrets.setApiKey('openrouter', 'sk-or-inference');

    const balance = await handlers['providers:balance']('openrouter');
    expect(balance).toMatchObject({
      providerId: 'openrouter',
      keyLimitRemainingUsd: 74.5,
      keyUsageUsd: 25.5,
      accountRemainingUsd: null,
      accountUnavailableReason: 'management_key_required',
    });
    expect(calls.map((call) => call.path)).toEqual(['/key']);
    ctx.db.close();
  });

  it('setManagementKey зберігає ключ під окремим id; статус показує лише прапорець; /credits — з ним', async () => {
    const { ctx, secrets, calls, handlers } = makeOpenRouterContext(true);
    secrets.setApiKey('openrouter', 'sk-or-inference');

    await handlers['providers:setManagementKey']('openrouter', '  sk-or-mgmt-секрет  ');
    expect(secrets.getApiKey('openrouter:management')).toBe('sk-or-mgmt-секрет');
    expect(secrets.getApiKey('openrouter')).toBe('sk-or-inference');

    const statuses = await handlers['providers:list']();
    const status = statuses.find((s) => s.id === 'openrouter');
    expect(status).toMatchObject({ supportsBalance: true, managementKeyConfigured: true });
    expect(JSON.stringify(statuses)).not.toContain('sk-or');

    const balance = await handlers['providers:balance']('openrouter');
    expect(balance).toMatchObject({ accountRemainingUsd: 30, accountUnavailableReason: null });
    expect(calls).toContainEqual({ path: '/credits', auth: 'Bearer sk-or-mgmt-секрет' });
    expect(calls).toContainEqual({ path: '/key', auth: 'Bearer sk-or-inference' });

    await handlers['providers:clearManagementKey']('openrouter');
    expect(secrets.hasApiKey('openrouter:management')).toBe(false);
    expect((await handlers['providers:list']()).find((s) => s.id === 'openrouter')?.managementKeyConfigured).toBe(false);
    ctx.db.close();
  });

  it('VALIDATION: порожній management-ключ або провайдер без нього', async () => {
    const { ctx, handlers } = makeOpenRouterContext(true);
    expect(() => handlers['providers:setManagementKey']('openrouter', '   ')).toThrow(
      expect.objectContaining({ code: 'VALIDATION' }),
    );
    expect(() => handlers['providers:setManagementKey']('anthropic', 'sk-x')).toThrow(
      expect.objectContaining({ code: 'VALIDATION' }),
    );
    expect(() => handlers['providers:clearManagementKey']('anthropic')).toThrow(
      expect.objectContaining({ code: 'VALIDATION' }),
    );
    ctx.db.close();
  });
});

describe('probeOpenRouter', () => {
  it('без ключа — без запиту', async () => {
    const { fetchImpl } = openRouterFetch();
    expect(await probeOpenRouter(null, UK, fetchImpl)).toEqual({
      ok: false,
      message: 'Ключ OpenRouter не знайдено в захищеному сховищі',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('успіх показує витрати й ліміт ключа — це нічого не коштує', async () => {
    const { fetchImpl, calls } = openRouterFetch();
    const result = await probeOpenRouter('sk-or-x', UK, fetchImpl);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Ключ OpenRouter дійсний');
    expect(result.message).toContain('$25.50');
    expect(result.message).toContain('залишок $74.50');
    expect(result.message).toContain('щомісяця');
    expect(result.message).not.toContain('sk-or-x');
    expect(calls).toEqual([{ path: '/key', auth: 'Bearer sk-or-x' }]);
  });

  it('401 — підказка про ключ; обрив — про мережу', async () => {
    const rejected: FetchLike = async () =>
      new Response(JSON.stringify({ error: { code: 401, message: 'User not found.' } }), { status: 401 });
    expect((await probeOpenRouter('sk', UK, rejected)).message).toContain('відхилено (401)');

    const offline: FetchLike = async () => {
      throw new TypeError('fetch failed');
    };
    const result = await probeOpenRouter('sk', UK, offline);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Немає зʼєднання з openrouter.ai');
  });
});

describe('installIpc — каталоги моделей у БД', () => {
  it('оновлений каталог OpenRouter зберігається в app_setting і переживає перезапуск', async () => {
    const { fetchImpl } = openRouterFetch();
    vi.stubGlobal('fetch', fetchImpl);
    const handlersByChannel = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const ipc = { handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => handlersByChannel.set(channel, listener), removeHandler: () => undefined };
    const db = createTestDb();
    try {
      const first = installIpc({ db, getWindow: () => null, secrets: new InMemorySecrets(), allowNetwork: true, ipc, logger: { error: () => {} } });
      await handlersByChannel.get('providers:refreshModels')?.({}, 'openrouter');
      expect(db.settings.getRaw(catalogueKey('openrouter'))).toMatchObject({ version: 1 });
      first.dispose();

      // Новий реєстр (як після перезапуску) піднімає каталог без мережі.
      const second = installIpc({ db, getWindow: () => null, secrets: new InMemorySecrets(), allowNetwork: false, ipc, logger: { error: () => {} } });
      const status = second.context.providers.providerStatus('openrouter');
      expect(status?.models).toContain('acme/new-model');
      expect(status?.catalogueUpdatedAt).not.toBeNull();
      second.dispose();
    } finally {
      vi.unstubAllGlobals();
      db.close();
    }
  });
});

describe('describeAnthropicError', () => {
  const body = { type: 'error', error: { type: 'authentication_error', message: 'invalid' } };

  it('401 → підказка про ключ', () => {
    const err = new Anthropic.AuthenticationError(401, body, '401', new Headers());
    expect(describeAnthropicError(err, UK)).toContain('Ключ API відхилено (401)');
  });

  it('403 → підказка про права', () => {
    const err = new Anthropic.PermissionDeniedError(403, body, '403', new Headers());
    expect(describeAnthropicError(err, UK)).toContain('Доступ заборонено (403)');
  });

  it('429 → ключ дійсний, просто ліміт', () => {
    const err = new Anthropic.RateLimitError(429, body, '429', new Headers());
    expect(describeAnthropicError(err, UK)).toContain('ліміт запитів');
  });

  it('обрив зʼєднання → підказка про мережу й проксі', () => {
    const err = new Anthropic.APIConnectionError({ message: 'Connection error.' });
    expect(describeAnthropicError(err, UK)).toContain('Немає зʼєднання');
  });

  it('решта помилок доходить текстом, а не «[object Object]»', () => {
    expect(describeAnthropicError(new Error('щось інше'), UK)).toBe('щось інше');
    expect(describeAnthropicError('рядок', UK)).toBe('рядок');
  });
});
