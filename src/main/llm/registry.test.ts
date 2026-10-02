import { describe, expect, it } from 'vitest';
import type { AppSettings } from '@shared/ipc';
import { CachedProvider } from './cache';
import { LlmCloudBlockedError, LlmNotConfiguredError } from './errors';
import { AnthropicProvider } from './providers/anthropic';
import { OpenAiCompatibleProvider } from './providers/openaiCompatible';
import { clauseExtractV1 } from './prompts';
import { buildRequest } from './request';
import { createDefaultRegistry, DEFAULT_ROUTING, ProviderRegistry, resolveRouting } from './registry';
import { bindModel, ModelBoundProvider } from './binding';
import type { LlmCacheEntry, LlmCacheStore, LlmProvider } from './types';
import { clauseExtractInput } from './__fixtures__/samples';

const keys = (map: Record<string, string>) => (id: string) => map[id] ?? null;

describe('DEFAULT_ROUTING', () => {
  it('відповідає architecture.md §7', () => {
    expect(DEFAULT_ROUTING).toEqual({
      clause_extract: { provider: 'anthropic', model: 'claude-sonnet-5', effort: 'medium' },
      spec_summary: { provider: 'anthropic', model: 'claude-sonnet-5', effort: 'medium' },
      doc_profile: { provider: 'anthropic', model: 'claude-haiku-4-5' },
      judge: { provider: 'anthropic', model: 'claude-opus-5', effort: 'high' },
      critic: { provider: 'anthropic', model: 'claude-opus-5', effort: 'high' },
    });
  });

  it('користувацьке налаштування перекриває дефолт', () => {
    const settings: Pick<AppSettings, 'routing'> = {
      routing: { judge: { provider: 'ollama', model: 'qwen3:14b', effort: 'low' } },
    };
    expect(resolveRouting('judge', settings)).toEqual({
      provider: 'ollama',
      model: 'qwen3:14b',
      effort: 'low',
    });
    expect(resolveRouting('critic', settings)).toEqual(DEFAULT_ROUTING.critic);
  });

  it('інший провайдер без моделі → модель за замовчуванням ЦЬОГО провайдера, не id Anthropic', () => {
    const settings = { routing: { judge: { provider: 'openrouter', model: '' } } } as Pick<AppSettings, 'routing'>;
    expect(resolveRouting('judge', settings, null, (id) => (id === 'openrouter' ? 'anthropic/claude-sonnet-5' : null))).toEqual({
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-5',
      effort: 'high',
    });
    // Без довідника моделей — порожньо, а не `claude-opus-5` під OpenRouter.
    expect(resolveRouting('judge', settings).model).toBe('');
  });

  it('той самий провайдер без моделі → модель етапу за замовчуванням', () => {
    const settings = { routing: { doc_profile: { provider: 'anthropic', model: '  ' } } } as Pick<AppSettings, 'routing'>;
    expect(resolveRouting('doc_profile', settings)).toEqual({ provider: 'anthropic', model: 'claude-haiku-4-5' });
  });

  it('невалідний effort відкидається; порожній effort — «за замовчуванням моделі»', () => {
    const bogus = {
      routing: { judge: { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'turbo' } },
    } as unknown as Pick<AppSettings, 'routing'>;
    expect(resolveRouting('judge', bogus)).toEqual({ provider: 'anthropic', model: 'claude-opus-5-5' });

    const blank = {
      routing: { judge: { provider: 'anthropic', model: 'claude-opus-5-5', effort: '' } },
    } as unknown as Pick<AppSettings, 'routing'>;
    expect(resolveRouting('judge', blank)).toEqual({ provider: 'anthropic', model: 'claude-opus-5-5' });

    const unset = { routing: { judge: { provider: 'anthropic', model: 'claude-opus-5-5' } } } as Pick<AppSettings, 'routing'>;
    expect(resolveRouting('judge', unset).effort).toBe('high');
  });

  it('повністю порожній ref у Налаштуваннях — дефолт етапу', () => {
    const settings = { routing: { judge: { provider: '', model: '' } } } as Pick<AppSettings, 'routing'>;
    expect(resolveRouting('judge', settings)).toEqual(DEFAULT_ROUTING.judge);
  });
});

describe('ModelBoundProvider', () => {
  const recorder = () => {
    const seen: Array<{ model: string | undefined; effort: string | undefined }> = [];
    const provider = {
      id: 'stub',
      label: 'Stub',
      caps: {
        contextWindow: 1000,
        promptCaching: false,
        structuredOutput: 'schema' as const,
        citations: false,
        documentInput: ['text' as const],
        maxOutputTokens: 1000,
        cloud: false,
      },
      models: ['first-model', 'routed-model'],
      isConfigured: () => true,
      pricingFor: (model: string) =>
        model === 'routed-model'
          ? { inputPerMTok: 3, outputPerMTok: 9, cacheReadPerMTok: 0.3, cacheWritePerMTok: 3.75, contextWindow: 1 }
          : null,
      complete: async (req: { model?: string; effort?: string }) => {
        seen.push({ model: req.model, effort: req.effort });
        return {
          data: { clauses: [] },
          citations: [],
          usage: { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 },
          costUsd: 0,
          modelId: req.model ?? 'first-model',
          providerId: 'stub',
          latencyMs: 0,
          raw: null,
          fromCache: false,
        };
      },
    };
    return { provider: provider as never as LlmProvider, seen };
  };

  it('models = [ref.model]; complete підставляє модель, якщо запит її не задав', async () => {
    const { provider, seen } = recorder();
    const bound = bindModel(provider, { provider: 'stub', model: 'routed-model' });
    expect(bound.models).toEqual(['routed-model']);

    const req = buildRequest(clauseExtractV1, clauseExtractInput);
    delete req.model;
    await bound.complete(req, new AbortController().signal);
    expect(seen[0]?.model).toBe('routed-model');
  });

  it('effort маршрутизації перекриває дефолт промпта; без нього лишається промптовий', async () => {
    const { provider, seen } = recorder();
    const req = buildRequest(clauseExtractV1, clauseExtractInput); // промпт: medium

    await bindModel(provider, { provider: 'stub', model: 'routed-model', effort: 'max' }).complete(
      req,
      new AbortController().signal,
    );
    await bindModel(provider, { provider: 'stub', model: 'routed-model' }).complete(req, new AbortController().signal);

    expect(seen.map((s) => s.effort)).toEqual(['max', 'medium']);
    expect(req.effort).toBe('medium'); // вихідний запит не мутується
  });

  it('пробрасує id, label, caps, isConfigured і pricingFor', () => {
    const { provider } = recorder();
    const bound = bindModel(provider, { provider: 'stub', model: 'routed-model' });
    expect(bound.id).toBe('stub');
    expect(bound.label).toBe('Stub');
    expect(bound.caps).toBe(provider.caps);
    expect(bound.isConfigured()).toBe(true);
    expect(bound.pricingFor?.('routed-model')?.inputPerMTok).toBe(3);
    expect(bound.pricingFor?.('unknown')).toBeNull();
  });

  it('повторна привʼязка не вкладає обгортки одна в одну', () => {
    const { provider } = recorder();
    const once = bindModel(provider, { provider: 'stub', model: 'a' });
    const twice = bindModel(once, { provider: 'stub', model: 'b' }) as ModelBoundProvider;
    expect(twice.inner).toBe(provider);
    expect(twice.models).toEqual(['b']);
  });

  it('CachedProvider теж пробрасує pricingFor', () => {
    const { provider } = recorder();
    const cached = new CachedProvider(provider, { store: { get: () => null, set: () => undefined } });
    expect(cached.pricingFor('routed-model')?.outputPerMTok).toBe(9);
  });
});

describe('ProviderRegistry', () => {
  const build = (map: Record<string, string> = {}) =>
    createDefaultRegistry({
      getApiKey: keys(map),
      localProviders: [
        { id: 'ollama', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:14b' },
      ],
    });

  it('реєструє Anthropic і локальний ендпоінт', () => {
    const registry = build();
    expect(registry.get('anthropic')).toBeInstanceOf(AnthropicProvider);
    expect(registry.get('ollama')).toBeInstanceOf(OpenAiCompatibleProvider);
  });

  it('listProviderStatus показує стан без мережі й без ключів', () => {
    const statuses = build({ anthropic: 'sk-test' }).listProviderStatus();
    const anthropic = statuses.find((status) => status.id === 'anthropic');
    const ollama = statuses.find((status) => status.id === 'ollama');

    expect(statuses.map((status) => status.id)).toEqual(['anthropic', 'openrouter', 'ollama']);
    expect(anthropic).toMatchObject({
      configured: true,
      cloud: true,
      error: null,
      allowCustomModel: false,
      catalogueUpdatedAt: null,
      supportsBalance: false,
      managementKeyConfigured: false,
    });
    expect(anthropic?.models).toEqual([
      'claude-opus-5-5',
      'claude-fable-5-1',
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-haiku-4-5',
    ]);
    expect(anthropic?.modelInfo.map((info) => info.id)).toEqual(anthropic?.models);
    expect(ollama).toMatchObject({ configured: true, cloud: false, allowCustomModel: true });
    expect(JSON.stringify(statuses)).not.toContain('sk-test');
  });

  it('ModelInfo Anthropic: ціни, вендор, клас і рівні effort', () => {
    const infos = build().listProviderStatus().find((status) => status.id === 'anthropic')!.modelInfo;
    const byId = new Map(infos.map((info) => [info.id, info]));

    expect(byId.get('claude-opus-5-5')).toMatchObject({
      label: 'Claude Opus 5.5',
      vendor: 'Anthropic',
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      inputPerMTok: 4,
      outputPerMTok: 20,
      cacheReadPerMTok: 0.2,
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      recommended: true,
      tier: 'top',
    });
    expect(byId.get('claude-fable-5-1')?.tier).toBe('top');
    expect(byId.get('claude-sonnet-5')?.tier).toBe('balanced');
    // Haiku 4.5 відповідає помилкою на effort — UI має вимкнути поле.
    expect(byId.get('claude-haiku-4-5')).toMatchObject({ tier: 'budget', efforts: [], contextWindow: 200_000 });
  });

  it('OpenRouter: без ключа не налаштований, але показує кураторський каталог і баланс', () => {
    const openrouter = build().listProviderStatus().find((status) => status.id === 'openrouter');
    expect(openrouter).toMatchObject({
      label: 'OpenRouter',
      configured: false,
      cloud: true,
      allowCustomModel: true,
      catalogueUpdatedAt: null,
      supportsBalance: true,
      managementKeyConfigured: false,
    });
    expect(openrouter?.models[0]).toBe('anthropic/claude-opus-5.5');
    expect(openrouter?.modelInfo.every((info) => info.recommended)).toBe(true);
    expect(openrouter?.models).toContain('openai/gpt-6-luna');
    expect(openrouter?.models).toContain('deepseek/deepseek-v4-pro');
  });

  it('managementKeyConfigured відображає ключ `openrouter:management`', () => {
    const status = build({ openrouter: 'sk-or', 'openrouter:management': 'sk-or-mgmt' })
      .listProviderStatus()
      .find((s) => s.id === 'openrouter');
    expect(status).toMatchObject({ configured: true, managementKeyConfigured: true });
    expect(JSON.stringify(status)).not.toContain('sk-or');
  });

  it('без ключа статус — not configured', () => {
    const anthropic = build().listProviderStatus().find((status) => status.id === 'anthropic');
    expect(anthropic?.configured).toBe(false);
    expect(anthropic?.error).toBeTruthy();
  });

  it('resolveProvider віддає провайдера і ModelRef етапу', () => {
    const resolved = build({ anthropic: 'sk-test' }).resolveProvider('judge');
    expect(resolved.provider.id).toBe('anthropic');
    expect(resolved.model).toEqual({ provider: 'anthropic', model: 'claude-opus-5', effort: 'high' });
  });

  it('провайдер привʼязаний до моделі етапу: models[0] — маршрутизована модель, а не перша в списку', () => {
    const registry = build({ anthropic: 'sk-test' });
    // Раніше профіль документа йшов на перший id провайдера (Opus) замість Haiku.
    const profiler = registry.resolveProvider('doc_profile');
    expect(profiler.provider.models).toEqual(['claude-haiku-4-5']);
    expect(profiler.provider.id).toBe('anthropic');
    expect(profiler.provider.pricingFor?.('claude-haiku-4-5')?.inputPerMTok).toBe(1);
  });

  it('провайдер без моделі в маршрутизації отримує СВОЮ модель за замовчуванням', () => {
    const registry = build({ openrouter: 'sk-or' });
    const resolved = registry.resolveProvider('judge', {
      routing: { judge: { provider: 'openrouter', model: '' } },
    });
    expect(resolved.model).toEqual({ provider: 'openrouter', model: 'anthropic/claude-sonnet-5', effort: 'high' });
    expect(resolved.provider.models).toEqual(['anthropic/claude-sonnet-5']);
  });

  it('конфігурація прогону перекриває Налаштування', () => {
    const registry = build({ anthropic: 'sk-test', openrouter: 'sk-or' });
    const resolved = registry.resolveProvider(
      'judge',
      { routing: { judge: { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'max' } } },
      { routingOverride: { judge: { provider: 'openrouter', model: 'openai/gpt-6-luna', effort: 'low' } } },
    );
    expect(resolved.model).toEqual({ provider: 'openrouter', model: 'openai/gpt-6-luna', effort: 'low' });
  });

  it('localOnly блокує хмарного провайдера (ADR-8)', () => {
    expect(() =>
      build({ anthropic: 'sk-test' }).resolveProvider('judge', { routing: {}, localOnly: true }),
    ).toThrow(LlmCloudBlockedError);
  });

  it('cloudAllowed=false блокує хмарного провайдера', () => {
    expect(() =>
      build({ anthropic: 'sk-test' }).resolveProvider('judge', null, { cloudAllowed: false }),
    ).toThrow(LlmCloudBlockedError);
  });

  it('невідомий провайдер у маршрутизації → LlmNotConfiguredError', () => {
    expect(() =>
      build({ anthropic: 'sk-test' }).resolveProvider('judge', {
        routing: { judge: { provider: 'vertex', model: 'x' } },
      }),
    ).toThrow(LlmNotConfiguredError);
  });

  it('провайдер без ключа → LlmNotConfiguredError', () => {
    expect(() => build().resolveProvider('judge')).toThrow(LlmNotConfiguredError);
  });

  it('порожній реєстр можна наповнити вручну', () => {
    const registry = new ProviderRegistry({ getApiKey: () => null });
    expect(registry.list()).toHaveLength(0);
  });
});

describe('CachedProvider', () => {
  class MemoryStore implements LlmCacheStore {
    readonly entries = new Map<string, LlmCacheEntry>();
    get(key: string): LlmCacheEntry | null {
      return this.entries.get(key) ?? null;
    }
    set(key: string, entry: LlmCacheEntry): void {
      this.entries.set(key, entry);
    }
  }

  const stubProvider = (calls: { n: number }) =>
    ({
      id: 'stub',
      label: 'Stub',
      caps: {
        contextWindow: 1000,
        promptCaching: false,
        structuredOutput: 'schema' as const,
        citations: false,
        documentInput: ['text' as const],
        maxOutputTokens: 1000,
        cloud: false,
      },
      models: ['stub-1'],
      isConfigured: () => true,
      complete: async () => {
        calls.n += 1;
        return {
          data: { clauses: [] },
          citations: [],
          usage: { input: 10, cachedInput: 0, cacheWrite: 0, output: 5 },
          costUsd: 0.01,
          modelId: 'stub-1',
          providerId: 'stub',
          latencyMs: 1,
          raw: null,
          fromCache: false,
        };
      },
    }) as never;

  it('другий однаковий виклик іде з кешу і не накручує вартість', async () => {
    const store = new MemoryStore();
    const calls = { n: 0 };
    const cached = new CachedProvider(stubProvider(calls), { store });
    const req = buildRequest(clauseExtractV1, clauseExtractInput, { model: 'stub-1' });

    const first = await cached.complete(req, new AbortController().signal);
    const second = await cached.complete(req, new AbortController().signal);

    expect(calls.n).toBe(1);
    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(second.costUsd).toBe(0);
    expect(second.usage).toEqual({ input: 0, cachedInput: 0, cacheWrite: 0, output: 0 });
    expect(store.entries.size).toBe(1);
  });

  it('зміна промпт-версії інвалідовує кеш', async () => {
    const store = new MemoryStore();
    const calls = { n: 0 };
    const cached = new CachedProvider(stubProvider(calls), { store });
    const req = buildRequest(clauseExtractV1, clauseExtractInput, { model: 'stub-1' });

    await cached.complete(req, new AbortController().signal);
    await cached.complete({ ...req, promptVersion: 'clause_extract.v2' }, new AbortController().signal);

    expect(calls.n).toBe(2);
    expect(store.entries.size).toBe(2);
  });
});
