/**
 * Ціни моделей і облік вартості (architecture.md §7).
 *
 * Ціни — Anthropic first-party, долари за 1M токенів. Кешоване читання
 * тарифікується ~10% від вхідного, запис у кеш — 125% (ephemeral 5 хв).
 */

import type { LlmUsage } from './types';

export interface ModelPricing {
  /** $ за 1M вхідних токенів. */
  inputPerMTok: number;
  /** $ за 1M вихідних токенів. */
  outputPerMTok: number;
  /** $ за 1M токенів, прочитаних із кешу (~10% від input). */
  cacheReadPerMTok: number;
  /** $ за 1M токенів, записаних у кеш (~125% від input). */
  cacheWritePerMTok: number;
  contextWindow: number;
}

const CACHE_READ_RATIO = 0.1;
const CACHE_WRITE_RATIO = 1.25;

function anthropicPricing(
  inputPerMTok: number,
  outputPerMTok: number,
  contextWindow: number,
): ModelPricing {
  return {
    inputPerMTok,
    outputPerMTok,
    cacheReadPerMTok: inputPerMTok * CACHE_READ_RATIO,
    cacheWritePerMTok: inputPerMTok * CACHE_WRITE_RATIO,
    contextWindow,
  };
}

/** ID моделей — дослівні, без суфіксів із датами. */
export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = Object.freeze({
  'claude-opus-5': anthropicPricing(5, 25, 1_000_000),
  'claude-sonnet-5': anthropicPricing(2, 10, 1_000_000),
  'claude-haiku-4-5': anthropicPricing(1, 5, 200_000),
});

/** Локальні моделі коштують 0 — але облік токенів усе одно ведемо. */
export const FREE_PRICING: ModelPricing = Object.freeze({
  inputPerMTok: 0,
  outputPerMTok: 0,
  cacheReadPerMTok: 0,
  cacheWritePerMTok: 0,
  contextWindow: 32_768,
});

export function getPricing(model: string): ModelPricing | null {
  return MODEL_PRICING[model] ?? null;
}

export function contextWindowOf(model: string, fallback = 200_000): number {
  return MODEL_PRICING[model]?.contextWindow ?? fallback;
}

/**
 * Вартість одного виклику в USD.
 * Невідома модель → 0 (не вигадуємо ціну; лічильник у UI просто не зросте).
 */
export function estimateCost(model: string, usage: LlmUsage, pricing?: ModelPricing): number {
  const p = pricing ?? getPricing(model);
  if (!p) return 0;
  const perToken = (rate: number, tokens: number): number => (rate * tokens) / 1_000_000;
  return (
    perToken(p.inputPerMTok, usage.input) +
    perToken(p.cacheReadPerMTok, usage.cachedInput) +
    perToken(p.cacheWritePerMTok, usage.cacheWrite) +
    perToken(p.outputPerMTok, usage.output)
  );
}

/**
 * Оцінка ДО прогону — коли ще немає usage, а є тільки прикидка кількості токенів.
 * `cachedShare` 0..1 — яка частка вхідних токенів очікувано прийде з кешу.
 */
export function estimateCostForTokens(
  model: string,
  opts: { inputTokens: number; outputTokens: number; cachedShare?: number },
): number {
  const cachedShare = Math.min(Math.max(opts.cachedShare ?? 0, 0), 1);
  const cached = Math.round(opts.inputTokens * cachedShare);
  return estimateCost(model, {
    input: opts.inputTokens - cached,
    cachedInput: cached,
    cacheWrite: 0,
    output: opts.outputTokens,
  });
}

/** Формат для UI. Дрібні суми не мають виглядати як `$0.00`. */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '$0.00';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs === 0) return '$0.00';
  if (abs < 0.0001) return `${sign}<$0.0001`;
  if (abs < 0.01) return `${sign}$${abs.toFixed(4)}`;
  if (abs < 1000) return `${sign}$${abs.toFixed(2)}`;
  return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    input: a.input + b.input,
    cachedInput: a.cachedInput + b.cachedInput,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
  };
}
