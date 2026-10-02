/**
 * Ціни моделей і облік вартості (architecture.md §7).
 *
 * Ціни Anthropic first-party — долари за 1M токенів. Ціни кешу задаємо ЯВНО
 * для кожної моделі: старе правило «читання = 10%, запис = 125% від входу»
 * не тримається на Opus 5.5 (читання $0.20 при вході $4) і Fable 5.1
 * (читання $0.25 при вході $10). Ціни інших провайдерів (OpenRouter) приходять
 * через `LlmProvider.pricingFor()` з їхнього каталогу.
 */

import type { LlmUsage } from './types';

export interface ModelPricing {
  /** $ за 1M вхідних токенів. */
  inputPerMTok: number;
  /** $ за 1M вихідних токенів. */
  outputPerMTok: number;
  /** $ за 1M токенів, прочитаних із кешу. */
  cacheReadPerMTok: number;
  /** $ за 1M токенів, записаних у кеш (ephemeral 5 хв). */
  cacheWritePerMTok: number;
  contextWindow: number;
}

function pricing(
  inputPerMTok: number,
  outputPerMTok: number,
  cacheReadPerMTok: number,
  cacheWritePerMTok: number,
  contextWindow: number,
): ModelPricing {
  return Object.freeze({ inputPerMTok, outputPerMTok, cacheReadPerMTok, cacheWritePerMTok, contextWindow });
}

/**
 * ID моделей — дослівні, без суфіксів із датами (довідник Claude API, жовтень 2026).
 *
 * `claude-sonnet-5-5` тут лише заради ціни: first-party id виведено з
 * шаблону назв і НЕ перевірено, тому в статичному списку вибору його немає.
 * Ціна спрацює, тільки якщо живий `/v1/models` поверне саме такий id.
 */
export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = Object.freeze({
  'claude-opus-5-5': pricing(4, 20, 0.2, 5, 1_000_000),
  'claude-fable-5-1': pricing(10, 50, 0.25, 12.5, 1_000_000),
  'claude-opus-5': pricing(5, 25, 0.5, 6.25, 1_000_000),
  'claude-sonnet-5': pricing(2, 10, 0.2, 2.5, 1_000_000),
  'claude-sonnet-5-5': pricing(2, 10, 0.2, 2.5, 1_000_000),
  'claude-haiku-4-5': pricing(1, 5, 0.1, 1.25, 200_000),
});

/** Локальні моделі коштують 0 — але облік токенів усе одно ведемо. */
export const FREE_PRICING: ModelPricing = Object.freeze({
  inputPerMTok: 0,
  outputPerMTok: 0,
  cacheReadPerMTok: 0,
  cacheWritePerMTok: 0,
  contextWindow: 32_768,
});

/** Ціна з вбудованої таблиці Anthropic. Для інших провайдерів — `provider.pricingFor()`. */
export function getPricing(model: string): ModelPricing | null {
  return MODEL_PRICING[model] ?? null;
}

export function contextWindowOf(model: string, fallback = 200_000): number {
  return MODEL_PRICING[model]?.contextWindow ?? fallback;
}

/**
 * Вартість одного виклику в USD.
 * Невідома модель → 0 (не вигадуємо ціну; лічильник у UI просто не зросте).
 * `pricing: null` — явно «ціна невідома», таблицю Anthropic тоді не беремо.
 */
export function estimateCost(model: string, usage: LlmUsage, pricing?: ModelPricing | null): number {
  const p = pricing === undefined ? getPricing(model) : pricing;
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
 * `pricing` — ціни з `provider.pricingFor(model)`; без нього — таблиця Anthropic.
 */
export function estimateCostForTokens(
  model: string,
  opts: { inputTokens: number; outputTokens: number; cachedShare?: number },
  pricing?: ModelPricing | null,
): number {
  const cachedShare = Math.min(Math.max(opts.cachedShare ?? 0, 0), 1);
  const cached = Math.round(opts.inputTokens * cachedShare);
  return estimateCost(
    model,
    {
      input: opts.inputTokens - cached,
      cachedInput: cached,
      cacheWrite: 0,
      output: opts.outputTokens,
    },
    pricing,
  );
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
