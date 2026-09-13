import { describe, expect, it } from 'vitest';
import type { AppSettings } from '@shared/ipc';
import { CachedProvider } from './cache';
import { LlmCloudBlockedError, LlmNotConfiguredError } from './errors';
import { AnthropicProvider } from './providers/anthropic';
import { OpenAiCompatibleProvider } from './providers/openaiCompatible';
import { clauseExtractV1 } from './prompts';
import { buildRequest } from './request';
import { createDefaultRegistry, DEFAULT_ROUTING, ProviderRegistry, resolveRouting } from './registry';
import type { LlmCacheEntry, LlmCacheStore } from './types';
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

    expect(anthropic).toMatchObject({ configured: true, cloud: true, error: null });
    expect(anthropic?.models).toEqual(['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']);
    expect(ollama).toMatchObject({ configured: true, cloud: false });
    expect(JSON.stringify(statuses)).not.toContain('sk-test');
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
