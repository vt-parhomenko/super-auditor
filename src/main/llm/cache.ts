/**
 * Обгортка провайдера кешем (ADR-7, architecture.md §9).
 *
 * Реалізацію `LlmCacheStore` підключає шар БД — тут ми лише будуємо ключ
 * і серіалізуємо результат. Кеш віддає `fromCache: true` і нульовий usage:
 * повторний прогін не має накручувати лічильник вартості.
 */

import { cacheKeyForRequest } from './request';
import type {
  CompleteRequest,
  CompleteResult,
  LlmCacheEntry,
  LlmCacheStore,
  LlmProvider,
} from './types';
import { emptyLlmUsage } from './types';

interface CachedPayload {
  data: unknown;
  citations: CompleteResult<unknown>['citations'];
}

export interface CachedProviderOptions {
  store: LlmCacheStore;
  /** false → кеш ігнорується, але результат усе одно пишеться. */
  read?: boolean;
  write?: boolean;
}

export class CachedProvider implements LlmProvider {
  readonly id: string;
  readonly label: string;
  readonly caps: LlmProvider['caps'];
  readonly models: readonly string[];

  constructor(
    private readonly inner: LlmProvider,
    private readonly opts: CachedProviderOptions,
  ) {
    this.id = inner.id;
    this.label = inner.label;
    this.caps = inner.caps;
    this.models = inner.models;
  }

  isConfigured(): boolean {
    return this.inner.isConfigured();
  }

  async complete<T>(req: CompleteRequest<T>, signal: AbortSignal): Promise<CompleteResult<T>> {
    const model = req.model ?? this.models[0] ?? 'unknown';
    const key = cacheKeyForRequest(req, model);

    if (this.opts.read !== false) {
      const hit = await this.opts.store.get(key);
      if (hit) {
        const payload = safeParsePayload(hit.responseJson);
        if (payload) {
          const validated = req.schema.safeParse(payload.data);
          if (validated.success) {
            return {
              data: validated.data,
              citations: payload.citations ?? [],
              usage: emptyLlmUsage(),
              costUsd: 0,
              modelId: hit.model,
              providerId: hit.provider,
              latencyMs: 0,
              raw: payload,
              fromCache: true,
            };
          }
        }
        // Зіпсований або застарілий запис — просто йдемо в провайдер.
      }
    }

    const result = await this.inner.complete(req, signal);

    if (this.opts.write !== false) {
      const entry: LlmCacheEntry = {
        stage: req.stage,
        provider: result.providerId,
        model: result.modelId,
        promptVersion: req.promptVersion,
        responseJson: JSON.stringify({ data: result.data, citations: result.citations }),
        usage: result.usage,
        costUsd: result.costUsd,
        latencyMs: result.latencyMs,
        createdAt: new Date().toISOString(),
      };
      await this.opts.store.set(key, entry);
    }

    return result;
  }
}

export function withCache(provider: LlmProvider, opts: CachedProviderOptions): LlmProvider {
  return new CachedProvider(provider, opts);
}

function safeParsePayload(json: string): CachedPayload | null {
  try {
    const parsed = JSON.parse(json) as Partial<CachedPayload>;
    if (parsed && typeof parsed === 'object' && 'data' in parsed) {
      return { data: parsed.data, citations: parsed.citations ?? [] };
    }
    return null;
  } catch {
    return null;
  }
}
