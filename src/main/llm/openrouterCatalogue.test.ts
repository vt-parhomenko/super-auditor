/**
 * Каталог моделей OpenRouter: розбір живого `GET /models`, фільтри,
 * порядок для UI, застарілість і фонове оновлення. Без мережі.
 */

import { describe, expect, it, vi } from 'vitest';
import { LlmError } from './errors';
import type { FetchLike } from './providers/openaiCompatible';
import {
  CATALOGUE_MAX_AGE_MS,
  OPENROUTER_CURATED_IDS,
  OpenRouterCatalogue,
  openRouterCatalogueId,
  parseOpenRouterModels,
  type StoredOpenRouterCatalogue,
} from './providers/openrouterCatalogue';
import { OPENROUTER_SNAPSHOT, OPENROUTER_SNAPSHOT_DATE } from './providers/openrouterSnapshot';
import { createDefaultRegistry } from './registry';

/** Елемент `data[]` у тій формі, яку повертає справжній `GET /api/v1/models`. */
function raw(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    canonical_slug: `${id}-20260921`,
    name: `Acme: ${id.split('/')[1] ?? id}`,
    created: 1790094732,
    context_length: 1_000_000,
    architecture: { modality: 'text->text', input_modalities: ['text'], output_modalities: ['text'] },
    pricing: { prompt: '0.000004', completion: '0.00002', input_cache_read: '0.0000002', input_cache_write: '0.000005' },
    top_provider: { context_length: 1_000_000, max_completion_tokens: 128_000, is_moderated: true },
    supported_parameters: ['max_tokens', 'reasoning', 'response_format', 'structured_outputs', 'tools'],
    reasoning: { mandatory: true, supported_efforts: ['max', 'xhigh', 'high', 'medium', 'low'], default_effort: 'high' },
    ...over,
  };
}

const CATALOGUE_JSON = {
  data: [
    raw('anthropic/claude-opus-5.5', { name: 'Anthropic: Claude Opus 5.5', pricing: { prompt: '0.0000035', completion: '0.0000175' } }),
    raw('acme/plain', {
      name: 'Acme: Plain',
      supported_parameters: ['max_tokens', 'response_format'],
      reasoning: undefined,
      top_provider: { context_length: 32_000, max_completion_tokens: null },
    }),
    raw('acme/thinker', {
      name: 'Acme: Thinker',
      reasoning: { mandatory: false, supported_efforts: ['high', 'minimal', 'none'] },
    }),
    raw('acme/budget-thinker', { name: 'Acme: Budget Thinker', reasoning: { mandatory: false } }),
    raw('zeta/alpha', { name: 'Zeta: Alpha' }),
    raw('x-ai/grok-9', { name: 'SpaceXAI: Grok 9' }),
    raw('~anthropic/claude-opus-latest'),
    raw('acme/plain:free'),
    raw('anthropic/claude-opus-5.5:batch'),
    raw('openrouter/auto', { pricing: { prompt: '-1', completion: '-1' } }),
    raw('acme/image-maker', { architecture: { input_modalities: ['text'], output_modalities: ['image'] } }),
    { id: 42 },
    'junk',
  ],
};

describe('parseOpenRouterModels', () => {
  const entries = parseOpenRouterModels(CATALOGUE_JSON);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));

  it('рухомі псевдоніми, каталожні варіанти, роутери й не-текстові моделі відкидаються', () => {
    expect(entries.map((entry) => entry.id)).toEqual([
      'anthropic/claude-opus-5.5',
      'acme/plain',
      'acme/thinker',
      'acme/budget-thinker',
      'zeta/alpha',
      'x-ai/grok-9',
    ]);
  });

  it('ціни: рядки USD за токен → USD за 1M; відсутня ціна кешу — null', () => {
    expect(byId.get('zeta/alpha')).toMatchObject({
      inputPerMTok: 4,
      outputPerMTok: 20,
      cacheReadPerMTok: 0.2,
      cacheWritePerMTok: 5,
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
    });
    expect(byId.get('anthropic/claude-opus-5.5')).toMatchObject({
      inputPerMTok: 3.5,
      outputPerMTok: 17.5,
      cacheReadPerMTok: null,
      cacheWritePerMTok: null,
    });
  });

  it('reasoning: параметр, рівні як є (з none/minimal), відсутні рівні — null', () => {
    expect(byId.get('acme/plain')).toMatchObject({ reasoning: false, supportedEfforts: null, structuredOutputs: false, maxOutputTokens: null });
    expect(byId.get('acme/thinker')).toMatchObject({ reasoning: true, supportedEfforts: ['high', 'minimal', 'none'] });
    expect(byId.get('acme/budget-thinker')).toMatchObject({ reasoning: true, supportedEfforts: null, reasoningMandatory: false });
    expect(byId.get('zeta/alpha')).toMatchObject({ reasoningMandatory: true, structuredOutputs: true });
  });

  it('сміття на вході не валить розбір', () => {
    expect(parseOpenRouterModels(null)).toEqual([]);
    expect(parseOpenRouterModels({ data: 'nope' })).toEqual([]);
  });
});

describe('знімок', () => {
  it('усі 19 кураторських моделей, дата знімка зафіксована', () => {
    expect(OPENROUTER_SNAPSHOT_DATE).toBe('2026-10-02');
    expect(OPENROUTER_CURATED_IDS).toEqual([
      'anthropic/claude-opus-5.5',
      'anthropic/claude-sonnet-5.5',
      'anthropic/claude-fable-5.1',
      'anthropic/claude-opus-5',
      'anthropic/claude-sonnet-5',
      'anthropic/claude-haiku-4.5',
      'openai/gpt-6-luna',
      'openai/gpt-6-luna-pro',
      'openai/gpt-6-sol',
      'openai/gpt-6.1-sol',
      'deepseek/deepseek-v4-pro',
      'deepseek/deepseek-v4-pro-0813',
      'deepseek/deepseek-v4.1-flash',
      'google/gemini-3.1-pro-preview',
      'google/gemini-3.8-flash',
      'qwen/qwen3.8-max-0902',
      'moonshotai/kimi-k3',
      'z-ai/glm-5.3',
      'x-ai/grok-4.7',
    ]);
    expect(OPENROUTER_SNAPSHOT.every((entry) => entry.inputPerMTok !== null && entry.outputPerMTok !== null)).toBe(true);
  });
});

describe('OpenRouterCatalogue — UI', () => {
  it('без живого каталогу — лише кураторський знімок, усі рекомендовані', () => {
    const infos = new OpenRouterCatalogue().listModelInfo();
    expect(infos.map((info) => info.id)).toEqual(OPENROUTER_CURATED_IDS);
    expect(infos.every((info) => info.recommended)).toBe(true);

    const byId = new Map(infos.map((info) => [info.id, info]));
    expect(byId.get('openai/gpt-6-luna')).toMatchObject({
      label: 'GPT-6 Luna',
      vendor: 'OpenAI',
      tier: 'budget',
      inputPerMTok: 0.1,
      // `none` прибрано — це не наш рівень effort.
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    });
    expect(byId.get('anthropic/claude-opus-5.5')).toMatchObject({ vendor: 'Anthropic', tier: 'top', label: 'Claude Opus 5.5' });
    expect(byId.get('anthropic/claude-haiku-4.5')).toMatchObject({ tier: 'budget', efforts: null });
    expect(byId.get('x-ai/grok-4.7')).toMatchObject({ vendor: 'xAI', label: 'Grok 4.7', tier: 'balanced' });
    expect(byId.get('moonshotai/kimi-k3')?.vendor).toBe('Moonshot AI');
    expect(byId.get('z-ai/glm-5.3')?.vendor).toBe('Z.ai');
    expect(byId.get('deepseek/deepseek-v4-pro')?.efforts).toEqual(['high', 'xhigh']);
    expect(byId.get('google/gemini-3.1-pro-preview')?.tier).toBe('top');
  });

  it('з живим каталогом: кураторські першими, решта за розробником і назвою; живі дані перекривають знімок', () => {
    const stored: StoredOpenRouterCatalogue = {
      version: 1,
      fetchedAt: '2026-10-02T08:00:00.000Z',
      models: parseOpenRouterModels(CATALOGUE_JSON),
    };
    const catalogue = new OpenRouterCatalogue({ load: () => stored, now: () => Date.parse('2026-10-02T09:00:00.000Z') });
    const infos = catalogue.listModelInfo();

    expect(infos.slice(0, OPENROUTER_CURATED_IDS.length).map((info) => info.id)).toEqual(OPENROUTER_CURATED_IDS);
    expect(infos.slice(OPENROUTER_CURATED_IDS.length).map((info) => info.id)).toEqual([
      'acme/budget-thinker',
      'acme/plain',
      'acme/thinker',
      'x-ai/grok-9',
      'zeta/alpha',
    ]);
    const rest = infos.slice(OPENROUTER_CURATED_IDS.length);
    expect(rest.every((info) => !info.recommended && info.tier === null)).toBe(true);
    expect(rest.find((info) => info.id === 'acme/plain')?.efforts).toEqual([]);
    expect(rest.find((info) => info.id === 'acme/thinker')?.efforts).toEqual(['high']);
    expect(rest.find((info) => info.id === 'x-ai/grok-9')?.vendor).toBe('xAI');
    expect(rest.find((info) => info.id === 'zeta/alpha')?.vendor).toBe('Zeta');

    // Свіжа ціна з живого каталогу важливіша за знімок.
    expect(infos[0]).toMatchObject({ id: 'anthropic/claude-opus-5.5', inputPerMTok: 3.5, recommended: true, tier: 'top' });
    expect(catalogue.updatedAt()).toBe('2026-10-02T08:00:00.000Z');
  });

  it('маршрутні суфікси відкидаються при пошуку, каталожні — ні', () => {
    expect(openRouterCatalogueId('openai/gpt-6-luna:nitro:exacto')).toBe('openai/gpt-6-luna');
    expect(openRouterCatalogueId('acme/x:free:nitro')).toBe('acme/x:free');
    expect(new OpenRouterCatalogue().lookup('openai/gpt-6-luna:floor')?.id).toBe('openai/gpt-6-luna');
    expect(new OpenRouterCatalogue().lookup('acme/nothing')).toBeNull();
  });

  it('зіпсований збережений каталог ігнорується', () => {
    expect(new OpenRouterCatalogue({ load: () => ({ version: 2 }) }).updatedAt()).toBeNull();
    expect(new OpenRouterCatalogue({ load: () => { throw new Error('db closed'); } }).isStale()).toBe(true);
  });
});

describe('OpenRouterCatalogue — оновлення', () => {
  const NOW = Date.parse('2026-10-02T12:00:00.000Z');

  function modelsFetch(body: unknown = CATALOGUE_JSON, status = 200) {
    const urls: string[] = [];
    const fetchImpl = vi.fn<FetchLike>(async (url) => {
      urls.push(url);
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    });
    return { fetchImpl, urls };
  }

  const storedAt = (iso: string) => (): StoredOpenRouterCatalogue => ({
    version: 1,
    fetchedAt: iso,
    models: parseOpenRouterModels({ data: [raw('acme/old', { name: 'Acme: Old' })] }),
  });

  it('застарілість: немає каталогу або старший за 24 год', () => {
    expect(new OpenRouterCatalogue({ now: () => NOW }).isStale()).toBe(true);
    expect(new OpenRouterCatalogue({ now: () => NOW, load: storedAt('2026-10-02T11:00:00.000Z') }).isStale()).toBe(false);
    const old = new Date(NOW - CATALOGUE_MAX_AGE_MS - 60_000).toISOString();
    expect(new OpenRouterCatalogue({ now: () => NOW, load: storedAt(old) }).isStale()).toBe(true);
  });

  it('без дозволу на мережу фонове оновлення нічого не робить', () => {
    const { fetchImpl } = modelsFetch();
    new OpenRouterCatalogue({ fetchImpl, now: () => NOW }).refreshInBackground();
    new OpenRouterCatalogue({ fetchImpl, now: () => NOW, allowNetwork: false }).refreshInBackground();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('застарілий каталог оновлюється у фоні один раз, результат зберігається', async () => {
    const { fetchImpl, urls } = modelsFetch();
    const saved: StoredOpenRouterCatalogue[] = [];
    const old = new Date(NOW - 2 * CATALOGUE_MAX_AGE_MS).toISOString();
    const catalogue = new OpenRouterCatalogue({
      fetchImpl,
      allowNetwork: true,
      now: () => NOW,
      load: storedAt(old),
      save: (value) => saved.push(value),
    });

    catalogue.refreshInBackground();
    catalogue.refreshInBackground(); // поки триває — другий запит не йде
    await catalogue.pending();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(urls[0]).toBe('https://openrouter.ai/api/v1/models');
    expect(saved).toHaveLength(1);
    expect(catalogue.updatedAt()).toBe('2026-10-02T12:00:00.000Z');
    expect(catalogue.lookup('zeta/alpha')).not.toBeNull();
    expect(catalogue.lookup('acme/old')).toBeNull();

    // Тепер свіжий — більше в мережу не ходимо.
    catalogue.refreshInBackground();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('фонова помилка не кидає і не повторюється на кожен виклик', async () => {
    const { fetchImpl } = modelsFetch({ error: 'down' }, 503);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const catalogue = new OpenRouterCatalogue({ fetchImpl, allowNetwork: true, now: () => NOW });

    catalogue.refreshInBackground();
    await catalogue.pending()?.catch(() => undefined);
    catalogue.refreshInBackground();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(catalogue.updatedAt()).toBeNull();
    warn.mockRestore();
  });

  it('явне оновлення кидає LlmError; порожня відповідь не стирає робочий каталог', async () => {
    const failing = new OpenRouterCatalogue({ fetchImpl: modelsFetch({}, 500).fetchImpl, now: () => NOW });
    await expect(failing.refresh()).rejects.toBeInstanceOf(LlmError);

    const empty = new OpenRouterCatalogue({
      fetchImpl: modelsFetch({ data: [] }).fetchImpl,
      now: () => NOW,
      load: storedAt('2026-09-01T00:00:00.000Z'),
    });
    await expect(empty.refresh()).rejects.toBeInstanceOf(LlmError);
    expect(empty.lookup('acme/old')).not.toBeNull();
  });

  it('реєстр: listProviderStatus запускає фонове оновлення, лише коли мережу дозволено', async () => {
    const { fetchImpl } = modelsFetch();
    const saved: Array<[string, unknown]> = [];
    const offline = createDefaultRegistry({ getApiKey: () => null, fetchImpl, now: () => NOW });
    offline.listProviderStatus();
    expect(fetchImpl).not.toHaveBeenCalled();

    const online = createDefaultRegistry({
      getApiKey: () => null,
      fetchImpl,
      now: () => NOW,
      allowNetwork: true,
      saveCatalogue: (id, value) => saved.push([id, value]),
    });
    online.listProviderStatus();
    const openrouter = online.get('openrouter') as unknown as { catalogue: OpenRouterCatalogue };
    await openrouter.catalogue.pending();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(saved.map(([id]) => id)).toEqual(['openrouter']);
    const status = online.providerStatus('openrouter');
    expect(status?.catalogueUpdatedAt).toBe('2026-10-02T12:00:00.000Z');
    expect(status?.models).toContain('zeta/alpha');
  });

  it('реєстр: явний refreshModels повертає свіжий статус; невідомий провайдер — помилка', async () => {
    const { fetchImpl } = modelsFetch();
    const registry = createDefaultRegistry({ getApiKey: () => null, fetchImpl, now: () => NOW });
    const status = await registry.refreshModels('openrouter');
    expect(status.catalogueUpdatedAt).toBe('2026-10-02T12:00:00.000Z');
    expect(status.modelInfo.length).toBeGreaterThan(OPENROUTER_CURATED_IDS.length);
    await expect(registry.refreshModels('vertex')).rejects.toBeInstanceOf(LlmError);
  });
});
