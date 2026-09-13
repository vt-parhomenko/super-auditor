import { describe, expect, it } from 'vitest';
import { addUsage, estimateCost, estimateCostForTokens, formatUsd, getPricing, MODEL_PRICING } from './cost';
import type { LlmUsage } from './types';

const usage = (over: Partial<LlmUsage> = {}): LlmUsage => ({
  input: 0,
  cachedInput: 0,
  cacheWrite: 0,
  output: 0,
  ...over,
});

describe('MODEL_PRICING', () => {
  it('має рівно три моделі з дослівними ID', () => {
    expect(Object.keys(MODEL_PRICING).sort()).toEqual([
      'claude-haiku-4-5',
      'claude-opus-5',
      'claude-sonnet-5',
    ]);
  });

  it('кешоване читання ~10%, запис ~125% від вхідного', () => {
    for (const [, price] of Object.entries(MODEL_PRICING)) {
      expect(price.cacheReadPerMTok).toBeCloseTo(price.inputPerMTok * 0.1, 10);
      expect(price.cacheWritePerMTok).toBeCloseTo(price.inputPerMTok * 1.25, 10);
    }
  });

  it('контекстні вікна відповідають документації', () => {
    expect(getPricing('claude-opus-5')?.contextWindow).toBe(1_000_000);
    expect(getPricing('claude-sonnet-5')?.contextWindow).toBe(1_000_000);
    expect(getPricing('claude-haiku-4-5')?.contextWindow).toBe(200_000);
  });
});

describe('estimateCost', () => {
  it('Opus 5: 1M вхідних + 1M вихідних = $30', () => {
    expect(estimateCost('claude-opus-5', usage({ input: 1_000_000, output: 1_000_000 }))).toBeCloseTo(30, 9);
  });

  it('Sonnet 5: 1M вхідних + 1M вихідних = $12', () => {
    expect(estimateCost('claude-sonnet-5', usage({ input: 1_000_000, output: 1_000_000 }))).toBeCloseTo(12, 9);
  });

  it('Haiku 4.5: 1M вхідних + 1M вихідних = $6', () => {
    expect(estimateCost('claude-haiku-4-5', usage({ input: 1_000_000, output: 1_000_000 }))).toBeCloseTo(6, 9);
  });

  it('кешоване читання коштує 10% від вхідного на кожній моделі', () => {
    for (const model of ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'] as const) {
      const plain = estimateCost(model, usage({ input: 1_000_000 }));
      const cached = estimateCost(model, usage({ cachedInput: 1_000_000 }));
      expect(cached).toBeCloseTo(plain * 0.1, 9);
    }
  });

  it('запис у кеш дорожчий за звичайний вхід', () => {
    const write = estimateCost('claude-opus-5', usage({ cacheWrite: 1_000_000 }));
    expect(write).toBeCloseTo(6.25, 9);
  });

  it('реалістичний judge-виклик рахується покомпонентно', () => {
    // 3k нових + 40k із кешу + 2k вихідних на Opus 5
    const cost = estimateCost('claude-opus-5', usage({ input: 3_000, cachedInput: 40_000, output: 2_000 }));
    expect(cost).toBeCloseTo(3_000 * 5e-6 + 40_000 * 0.5e-6 + 2_000 * 25e-6, 12);
  });

  it('невідома модель → 0, а не вигадана ціна', () => {
    expect(estimateCost('llama-3.1-8b', usage({ input: 1_000_000, output: 1_000_000 }))).toBe(0);
    expect(getPricing('llama-3.1-8b')).toBeNull();
  });
});

describe('estimateCostForTokens', () => {
  it('cachedShare розподіляє вхідні токени між тарифами', () => {
    const full = estimateCostForTokens('claude-opus-5', { inputTokens: 100_000, outputTokens: 0 });
    const cached = estimateCostForTokens('claude-opus-5', {
      inputTokens: 100_000,
      outputTokens: 0,
      cachedShare: 1,
    });
    expect(cached).toBeCloseTo(full * 0.1, 9);
  });
});

describe('formatUsd', () => {
  it('не ховає дрібні суми за $0.00', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.00004)).toBe('<$0.0001');
    expect(formatUsd(0.0042)).toBe('$0.0042');
    expect(formatUsd(1.239)).toBe('$1.24');
    expect(formatUsd(-2.5)).toBe('-$2.50');
    expect(formatUsd(12345.6)).toBe('$12,346');
  });
});

describe('addUsage', () => {
  it('сумує покомпонентно', () => {
    expect(addUsage(usage({ input: 1, output: 2 }), usage({ cachedInput: 3, cacheWrite: 4 }))).toEqual({
      input: 1,
      cachedInput: 3,
      cacheWrite: 4,
      output: 2,
    });
  });
});
