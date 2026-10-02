/**
 * Провайдер, привʼязаний до конкретної моделі етапу.
 *
 * Навіщо: конвеєр бере модель як `provider.models[0]`, а effort — з промпта.
 * Без привʼязки маршрутизація з Налаштувань (або з конфігурації прогону)
 * мовчки ігнорувалась: профіль документа йшов на Opus замість Haiku, а
 * вибраний користувачем effort не доходив до API. Привʼязаний провайдер
 * виправляє це в одному місці, і всі місця виклику працюють без змін:
 *  - `models` — рівно `[ref.model]`, тож `models[0]` і є маршрутизована модель;
 *  - `complete()` підставляє `req.model ??= ref.model`;
 *  - `ref.effort` перекриває effort промпта: явний вибір користувача
 *    важливіший за дефолт, зашитий у промпт.
 */

import type { ModelRef } from '@shared/domain';
import type { ModelPricing } from './cost';
import type { CompleteRequest, CompleteResult, LlmProvider } from './types';

export class ModelBoundProvider implements LlmProvider {
  readonly id: string;
  readonly label: string;
  readonly caps: LlmProvider['caps'];
  readonly models: readonly string[];
  readonly defaultModel: string;

  constructor(
    readonly inner: LlmProvider,
    readonly ref: ModelRef,
  ) {
    this.id = inner.id;
    this.label = inner.label;
    this.caps = inner.caps;
    this.models = Object.freeze([ref.model]);
    this.defaultModel = ref.model;
  }

  isConfigured(): boolean {
    return this.inner.isConfigured();
  }

  pricingFor(model: string): ModelPricing | null {
    return this.inner.pricingFor?.(model) ?? null;
  }

  complete<T>(req: CompleteRequest<T>, signal: AbortSignal): Promise<CompleteResult<T>> {
    const bound: CompleteRequest<T> = { ...req, model: req.model ?? this.ref.model };
    if (this.ref.effort) bound.effort = this.ref.effort;
    return this.inner.complete(bound, signal);
  }
}

/** Привʼязує провайдера до моделі й effort етапу. Повторна привʼязка — до нового ref. */
export function bindModel(provider: LlmProvider, ref: ModelRef): LlmProvider {
  const inner = provider instanceof ModelBoundProvider ? provider.inner : provider;
  return new ModelBoundProvider(inner, ref);
}
