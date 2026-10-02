import { describe, expect, it } from 'vitest';

import { EFFORTS, type ModelInfo } from '@shared/domain';
import type { ProviderStatus } from '@shared/ipc';
import {
  choiceWithEffort,
  choiceWithModel,
  choiceWithProvider,
  defaultModelId,
  effortChoices,
  formatContextWindow,
  formatPricePair,
  formatUsdPerMTok,
  groupModels,
  LISTED_MODELS_MAX,
  listedModels,
  modelOptionLabel,
  normalizeProviderStatus,
  supportedEffort,
  toModelRef,
} from './models';

function model(id: string, patch: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id,
    label: id,
    vendor: null,
    contextWindow: null,
    maxOutputTokens: null,
    inputPerMTok: null,
    outputPerMTok: null,
    cacheReadPerMTok: null,
    efforts: null,
    recommended: false,
    tier: null,
    ...patch,
  };
}

function provider(id: string, modelInfo: ModelInfo[], patch: Partial<ProviderStatus> = {}): ProviderStatus {
  return {
    id,
    label: id,
    configured: true,
    cloud: true,
    models: modelInfo.map((m) => m.id),
    modelInfo,
    allowCustomModel: false,
    catalogueUpdatedAt: null,
    error: null,
    ...patch,
  };
}

const opus = model('anthropic/claude-opus-5.5', {
  label: 'Claude Opus 5.5',
  vendor: 'Anthropic',
  inputPerMTok: 4,
  outputPerMTok: 20,
  efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  recommended: true,
  tier: 'top',
});
const luna = model('openai/gpt-6-luna', {
  label: 'GPT-6 Luna',
  vendor: 'OpenAI',
  inputPerMTok: 0.1,
  outputPerMTok: 0.5,
  efforts: ['high', 'low'],
  recommended: true,
  tier: 'budget',
});
const haiku = model('anthropic/claude-haiku-4.5', {
  label: 'Claude Haiku 4.5',
  vendor: 'Anthropic',
  efforts: [],
  recommended: true,
});
const llama = model('meta-llama/llama-4-scout', { label: 'Llama 4 Scout', vendor: 'Meta' });
const command = model('cohere/command-a', { label: 'Command A', vendor: 'Cohere' });
const oldOpus = model('anthropic/claude-3-opus', { label: 'Claude 3 Opus', vendor: 'Anthropic' });
const raw = model('local-model', { label: 'local-model' });

describe('groupModels', () => {
  it('ставить розробників із рекомендованими першими, у кураторському порядку', () => {
    const groups = groupModels([llama, opus, raw, luna, command, haiku, oldOpus]);
    expect(groups.map((g) => g.vendor)).toEqual(['Anthropic', 'OpenAI', 'Cohere', 'Meta', null]);
  });

  it('у групі рекомендовані першими, решта — за назвою', () => {
    const groups = groupModels([oldOpus, haiku, opus]);
    expect(groups[0]?.models.map((m) => m.id)).toEqual([haiku.id, opus.id, oldOpus.id]);
  });

  it('невідомий розробник завжди останній, навіть якщо модель рекомендована', () => {
    const groups = groupModels([model('x', { recommended: true }), luna]);
    expect(groups.map((g) => g.vendor)).toEqual(['OpenAI', null]);
  });

  it('порожній список — порожні групи', () => {
    expect(groupModels([])).toEqual([]);
  });
});

describe('listedModels / defaultModelId', () => {
  const openrouter = provider('openrouter', [llama, opus, luna], { allowCustomModel: true });
  const anthropic = provider('anthropic', [oldOpus, opus]);

  it('для провайдера з довільним id показує лише куровані', () => {
    expect(listedModels(openrouter).map((m) => m.id)).toEqual([opus.id, luna.id]);
  });

  it('для решти — увесь список', () => {
    expect(listedModels(anthropic)).toHaveLength(2);
    expect(listedModels(undefined)).toEqual([]);
  });

  it('довільний id без кураторського списку: невеликий каталог — увесь, великий — жодного', () => {
    const local = provider('local', [llama, command], { allowCustomModel: true, cloud: false });
    expect(listedModels(local).map((m) => m.id)).toEqual([llama.id, command.id]);
    const huge = provider(
      'huge',
      Array.from({ length: LISTED_MODELS_MAX + 1 }, (_, i) => model(`m-${i}`)),
      { allowCustomModel: true },
    );
    expect(listedModels(huge)).toEqual([]);
  });

  it('модель за замовчуванням — перша рекомендована', () => {
    expect(defaultModelId(openrouter)).toBe(opus.id);
    expect(defaultModelId(provider('p', [llama, command]))).toBe(llama.id);
    expect(defaultModelId(provider('p', []))).toBe('');
    expect(defaultModelId(undefined)).toBe('');
  });
});

describe('effortChoices', () => {
  it('невідомі можливості — усі рівні', () => {
    expect(effortChoices(llama)).toEqual({ efforts: EFFORTS, disabled: false });
    expect(effortChoices(undefined)).toEqual({ efforts: EFFORTS, disabled: false });
  });

  it('порожній список — поле вимкнене', () => {
    expect(effortChoices(haiku)).toEqual({ efforts: [], disabled: true });
  });

  it('лише підтримувані рівні, у канонічному порядку', () => {
    expect(effortChoices(luna).efforts).toEqual(['low', 'high']);
  });
});

describe('supportedEffort', () => {
  it('лишає підтримуваний рівень', () => {
    expect(supportedEffort('high', luna)).toBe('high');
    expect(supportedEffort('xhigh', llama)).toBe('xhigh');
  });

  it('відкидає непідтримуваний або невалідний', () => {
    expect(supportedEffort('max', luna)).toBeUndefined();
    expect(supportedEffort('high', haiku)).toBeUndefined();
    expect(supportedEffort('turbo', opus)).toBeUndefined();
    expect(supportedEffort(undefined, opus)).toBeUndefined();
  });
});

describe('переходи вибору', () => {
  const openrouter = provider('openrouter', [opus, luna, haiku], { allowCustomModel: true });
  const anthropic = provider('anthropic', [model('claude-opus-5-5', { recommended: true, efforts: null })]);
  const providers = [anthropic, openrouter];

  it('зміна провайдера підставляє рекомендовану модель і зберігає сумісний effort', () => {
    expect(choiceWithProvider({ provider: 'anthropic', model: 'claude-opus-5-5', effort: 'max' }, providers, 'openrouter')).toEqual({
      provider: 'openrouter',
      model: opus.id,
      effort: 'max',
    });
  });

  it('зміна провайдера з порожнього стану', () => {
    expect(choiceWithProvider(null, providers, 'anthropic')).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-5-5',
    });
  });

  it('зміна моделі відкидає effort, якого нова модель не приймає', () => {
    const current = { provider: 'openrouter', model: opus.id, effort: 'max' };
    expect(choiceWithModel(current, openrouter, luna.id)).toEqual({ provider: 'openrouter', model: luna.id });
    expect(choiceWithModel({ ...current, effort: 'low' }, openrouter, luna.id)).toEqual({
      provider: 'openrouter',
      model: luna.id,
      effort: 'low',
    });
    expect(choiceWithModel({ ...current, effort: 'low' }, openrouter, haiku.id)).toEqual({
      provider: 'openrouter',
      model: haiku.id,
    });
  });

  it('власний id поза каталогом зберігає будь-який валідний effort', () => {
    const current = { provider: 'openrouter', model: opus.id, effort: 'xhigh' };
    expect(choiceWithModel(current, openrouter, 'mistralai/mistral-large')).toEqual({
      provider: 'openrouter',
      model: 'mistralai/mistral-large',
      effort: 'xhigh',
    });
  });

  it('effort: порожній рядок знімає значення', () => {
    const current = { provider: 'openrouter', model: opus.id, effort: 'high' };
    expect(choiceWithEffort(current, '')).toEqual({ provider: 'openrouter', model: opus.id });
    expect(choiceWithEffort(current, 'low')).toEqual({ provider: 'openrouter', model: opus.id, effort: 'low' });
  });

  it('toModelRef пропускає невалідний effort', () => {
    expect(toModelRef({ provider: 'a', model: 'b', effort: 'nope' })).toEqual({ provider: 'a', model: 'b' });
    expect(toModelRef({ provider: 'a', model: 'b', effort: 'high' })).toEqual({ provider: 'a', model: 'b', effort: 'high' });
  });
});

describe('normalizeProviderStatus', () => {
  it('добудовує modelInfo зі списку id для старішого main', () => {
    const legacy = {
      id: 'anthropic',
      label: 'Anthropic',
      configured: true,
      cloud: true,
      models: ['claude-opus-5'],
      error: null,
    } as unknown as ProviderStatus;
    const status = normalizeProviderStatus(legacy);
    expect(status.modelInfo.map((m) => m.id)).toEqual(['claude-opus-5']);
    expect(status.modelInfo[0]?.efforts).toBeNull();
    expect(status.allowCustomModel).toBe(false);
    expect(status.catalogueUpdatedAt).toBeNull();
  });

  it('не чіпає повний статус', () => {
    const full = provider('openrouter', [opus], { allowCustomModel: true, catalogueUpdatedAt: '2026-10-01T00:00:00.000Z' });
    expect(normalizeProviderStatus(full)).toEqual(full);
  });
});

describe('ціни й контекст', () => {
  it('formatUsdPerMTok', () => {
    expect(formatUsdPerMTok(4)).toBe('$4');
    expect(formatUsdPerMTok(20)).toBe('$20');
    expect(formatUsdPerMTok(0.1)).toBe('$0.10');
    expect(formatUsdPerMTok(0.209)).toBe('$0.209');
    expect(formatUsdPerMTok(0.02)).toBe('$0.02');
    expect(formatUsdPerMTok(0.017)).toBe('$0.017');
    expect(formatUsdPerMTok(2.7)).toBe('$2.70');
    expect(formatUsdPerMTok(13.5)).toBe('$13.50');
    expect(formatUsdPerMTok(0)).toBe('$0');
    expect(formatUsdPerMTok(0.0005)).toBe('$0.0005');
    expect(formatUsdPerMTok(null)).toBeNull();
    expect(formatUsdPerMTok(-1)).toBeNull();
  });

  it('formatPricePair', () => {
    expect(formatPricePair(opus)).toBe('$4/$20');
    expect(formatPricePair(luna)).toBe('$0.10/$0.50');
    expect(formatPricePair({ inputPerMTok: 1, outputPerMTok: null })).toBeNull();
  });

  it('formatContextWindow', () => {
    expect(formatContextWindow(1_000_000)).toBe('1M');
    expect(formatContextWindow(1_048_576)).toBe('1.05M');
    expect(formatContextWindow(200_000)).toBe('200K');
    expect(formatContextWindow(131_072)).toBe('131K');
    expect(formatContextWindow(512)).toBe('512');
    expect(formatContextWindow(null)).toBeNull();
    expect(formatContextWindow(0)).toBeNull();
  });

  it('modelOptionLabel', () => {
    expect(modelOptionLabel(opus, 'top')).toBe('Claude Opus 5.5 · $4/$20 · top');
    expect(modelOptionLabel(llama)).toBe('Llama 4 Scout');
    expect(modelOptionLabel(model('id-only', { label: '' }))).toBe('id-only');
  });
});
