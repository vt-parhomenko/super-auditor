/**
 * Реєстр провайдерів і маршрутизація по етапах (architecture.md §7).
 *
 * Ключі API беруться через передану функцію-геттер — інтеграцію з `safeStorage`
 * робить інший шар. Тут ні `fs`, ні `electron`. Живі каталоги моделей
 * зберігаються через передані `loadCatalogue`/`saveCatalogue`.
 */

import { isEffort, type ModelInfo, type ModelRef, type Stage } from '@shared/domain';
import type { AppSettings, ProviderBalance, ProviderStatus } from '@shared/ipc';
import { bindModel } from './binding';
import { LlmCloudBlockedError, LlmNotConfiguredError, LlmUnsupportedError } from './errors';
import { AnthropicProvider, ANTHROPIC_PROVIDER_ID, type StoredAnthropicCatalogue } from './providers/anthropic';
import { OpenAiCompatibleProvider, type FetchLike, type OpenAiCompatibleOptions } from './providers/openaiCompatible';
import {
  OPENROUTER_MANAGEMENT_KEY_ID,
  OPENROUTER_PROVIDER_ID,
  OpenRouterProvider,
  type OpenRouterProviderOptions,
} from './providers/openrouter';
import type { StoredOpenRouterCatalogue } from './providers/openrouterCatalogue';
import type { LlmProvider } from './types';

/** Маршрутизація за замовчуванням. Переозначається через `AppSettings.routing`. */
export const DEFAULT_ROUTING: Record<Stage, ModelRef> = {
  clause_extract: { provider: 'anthropic', model: 'claude-sonnet-5', effort: 'medium' },
  spec_summary: { provider: 'anthropic', model: 'claude-sonnet-5', effort: 'medium' },
  doc_profile: { provider: 'anthropic', model: 'claude-haiku-4-5' },
  judge: { provider: 'anthropic', model: 'claude-opus-5', effort: 'high' },
  critic: { provider: 'anthropic', model: 'claude-opus-5', effort: 'high' },
};

/** Модель провайдера за замовчуванням — для етапу, де вибрано лише провайдера. */
export type DefaultModelLookup = (providerId: string) => string | null | undefined;

/**
 * Зливає DEFAULT_ROUTING з користувацьким переозначенням.
 * Пріоритет: конфігурація прогону → Налаштування → дефолт етапу.
 *
 * Якщо вибрано іншого провайдера, але модель лишилась порожньою, беремо
 * модель за замовчуванням САМЕ цього провайдера — id Anthropic під
 * OpenRouter (`openrouter` + `claude-opus-5`) був би невалідним. Невідомий
 * провайдер без моделі отримує порожній id — `resolveProvider` однаково
 * зупиниться на «невідомий провайдер». Невалідний effort відкидається.
 */
export function resolveRouting(
  stage: Stage,
  settings?: Pick<AppSettings, 'routing'> | null,
  override?: Partial<Record<Stage, ModelRef>> | null,
  defaultModelFor?: DefaultModelLookup,
): ModelRef {
  const fallback = DEFAULT_ROUTING[stage];
  const source = [override?.[stage], settings?.routing?.[stage]].find(
    (ref): ref is ModelRef => !!ref && (nonEmpty(ref.provider) !== null || nonEmpty(ref.model) !== null),
  );
  if (!source) return { ...fallback };

  const provider = nonEmpty(source.provider) ?? fallback.provider;
  const model =
    nonEmpty(source.model) ??
    (provider === fallback.provider ? fallback.model : (nonEmpty(defaultModelFor?.(provider)) ?? ''));

  const ref: ModelRef = { provider, model };
  // undefined → дефолт етапу; '' чи сміття → «effort моделі за замовчуванням».
  const effort: unknown = source.effort === undefined ? fallback.effort : source.effort;
  if (isEffort(effort)) ref.effort = effort;
  return ref;
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

export interface ResolvedProvider {
  /**
   * Провайдер, ПРИВʼЯЗАНИЙ до моделі етапу: `models` = `[model.model]`,
   * `complete()` підставляє цю модель і effort маршрутизації (див. `binding.ts`).
   */
  provider: LlmProvider;
  model: ModelRef;
}

export interface ResolveOptions {
  /** ADR-8: чи дозволила специфікація відправку в хмару. */
  cloudAllowed?: boolean;
  routingOverride?: Partial<Record<Stage, ModelRef>> | null;
}

export type ApiKeyGetter = (providerId: string) => string | null | undefined;

export interface RegistryOptions {
  getApiKey: ApiKeyGetter;
  /** Локальні OpenAI-сумісні ендпоінти. */
  localProviders?: OpenAiCompatibleOptions[];
  /** Готові провайдери — для тестів і нестандартних збірок. */
  providers?: LlmProvider[];
  /**
   * Чи можна самим ходити в мережу поза викликами моделей (фонове оновлення
   * каталогів). За замовчуванням — ні: тести й офлайн-збірки мережі не чіпають.
   */
  allowNetwork?: boolean;
  /** Збережений живий каталог провайдера (`llm.catalogue.<id>`); undefined — немає. */
  loadCatalogue?: (providerId: string) => unknown;
  saveCatalogue?: (providerId: string, value: unknown) => void;
  /** Додаткові налаштування OpenRouter; `false` — не реєструвати його зовсім. */
  openRouter?: false | Partial<Omit<OpenRouterProviderOptions, 'getApiKey' | 'getManagementKey'>>;
  /** Підміна fetch для OpenRouter (тести). */
  fetchImpl?: FetchLike;
  now?: () => number;
}

export class ProviderRegistry {
  private readonly providers = new Map<string, LlmProvider>();

  constructor(private readonly options: RegistryOptions) {
    for (const provider of options.providers ?? []) this.register(provider);
  }

  register(provider: LlmProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): LlmProvider | undefined {
    return this.providers.get(id);
  }

  list(): LlmProvider[] {
    return [...this.providers.values()];
  }

  /** Модель за замовчуванням провайдера (для етапу, де вибрано лише провайдера). */
  defaultModelFor(providerId: string): string | null {
    const provider = this.providers.get(providerId);
    if (!provider) return null;
    return provider.defaultModel ?? provider.models[0] ?? null;
  }

  /**
   * Форма для IPC `providers:list`. Сама в мережу не ходить; застарілий
   * каталог (OpenRouter) лише запускає фонове оновлення, якщо мережу дозволено.
   */
  listProviderStatus(): ProviderStatus[] {
    return this.list().map((provider) => {
      provider.refreshModelsInBackground?.();
      return statusOf(provider);
    });
  }

  /** Статус одного провайдера; null — такого немає. */
  providerStatus(providerId: string): ProviderStatus | null {
    const provider = this.providers.get(providerId);
    return provider ? statusOf(provider) : null;
  }

  /**
   * Оновлює список моделей із живого каталогу. Провайдер без живого каталогу
   * (локальний) просто повертає поточний статус.
   */
  async refreshModels(providerId: string, signal?: AbortSignal): Promise<ProviderStatus> {
    const provider = this.providers.get(providerId);
    if (!provider) throw new LlmNotConfiguredError(providerId, `Unknown provider "${providerId}"`);
    if (provider.refreshModels) await provider.refreshModels(signal);
    return statusOf(provider);
  }

  /** Баланс провайдера; null — провайдер його не віддає або немає ключа. */
  async balance(providerId: string, signal?: AbortSignal): Promise<ProviderBalance | null> {
    const provider = this.providers.get(providerId);
    if (!provider?.supportsBalance || !provider.balance) return null;
    if (!provider.isConfigured()) return null;
    return provider.balance(signal);
  }

  /** Розвʼязана маршрутизація етапу — без перевірок ключів і хмари. */
  routingFor(
    stage: Stage,
    settings?: Pick<AppSettings, 'routing'> | null,
    override?: Partial<Record<Stage, ModelRef>> | null,
  ): ModelRef {
    return resolveRouting(stage, settings, override, (id) => this.defaultModelFor(id));
  }

  /**
   * Провайдер і модель для етапу. Кидає, якщо провайдера немає, він не
   * налаштований, або хмара заборонена (ADR-8 / `settings.localOnly`).
   * Повернений провайдер привʼязаний до моделі й effort маршрутизації.
   */
  resolveProvider(
    stage: Stage,
    settings?: (Pick<AppSettings, 'routing'> & Partial<Pick<AppSettings, 'localOnly'>>) | null,
    opts: ResolveOptions = {},
  ): ResolvedProvider {
    const model = this.routingFor(stage, settings, opts.routingOverride);
    const provider = this.providers.get(model.provider);
    if (!provider) {
      throw new LlmNotConfiguredError(model.provider, `Unknown provider "${model.provider}" for stage "${stage}"`);
    }
    if (provider.caps.cloud) {
      if (settings?.localOnly) {
        throw new LlmCloudBlockedError(
          provider.id,
          `Local-only mode is on: stage "${stage}" cannot use cloud provider "${provider.id}"`,
        );
      }
      if (opts.cloudAllowed === false) {
        throw new LlmCloudBlockedError(
          provider.id,
          `This specification is not allowed to leave the machine (cloudAllowed = false)`,
        );
      }
    }
    if (!provider.isConfigured()) throw new LlmNotConfiguredError(provider.id);
    if (model.model.length === 0) {
      throw new LlmUnsupportedError(provider.id, `No model is selected for stage "${stage}"`);
    }
    return { provider: bindModel(provider, model), model };
  }

  get apiKeyGetter(): ApiKeyGetter {
    return this.options.getApiKey;
  }
}

function statusOf(provider: LlmProvider): ProviderStatus {
  const configured = provider.isConfigured();
  const modelInfo = provider.listModelInfo?.() ?? provider.models.map(unknownModelInfo);
  return {
    id: provider.id,
    label: provider.label,
    configured,
    cloud: provider.caps.cloud,
    models: modelInfo.map((info) => info.id),
    modelInfo,
    allowCustomModel: provider.allowCustomModel ?? false,
    catalogueUpdatedAt: provider.catalogueUpdatedAt?.() ?? null,
    supportsBalance: provider.supportsBalance === true,
    managementKeyConfigured: provider.managementKeyConfigured?.() ?? false,
    error: configured ? null : 'API key or endpoint is not configured',
  };
}

/** Провайдер без опису моделей — лише id, решта невідома. */
function unknownModelInfo(id: string): ModelInfo {
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
  };
}

/** Реєстр за замовчуванням: Anthropic + OpenRouter + опційні локальні ендпоінти. */
export function createDefaultRegistry(options: RegistryOptions): ProviderRegistry {
  const registry = new ProviderRegistry(options);
  const load = (providerId: string) => () => options.loadCatalogue?.(providerId);

  // Порядок має значення: Anthropic першим — це дефолтний провайдер маршрутизації.
  if (!registry.get(ANTHROPIC_PROVIDER_ID)) {
    registry.register(
      new AnthropicProvider({
        getApiKey: () => options.getApiKey(ANTHROPIC_PROVIDER_ID),
        loadCatalogue: load(ANTHROPIC_PROVIDER_ID),
        saveCatalogue: (value: StoredAnthropicCatalogue) => options.saveCatalogue?.(ANTHROPIC_PROVIDER_ID, value),
        ...(options.now ? { now: options.now } : {}),
      }),
    );
  }

  if (options.openRouter !== false && !registry.get(OPENROUTER_PROVIDER_ID)) {
    registry.register(
      new OpenRouterProvider({
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.now ? { now: options.now } : {}),
        ...(options.openRouter ?? {}),
        getApiKey: () => options.getApiKey(OPENROUTER_PROVIDER_ID),
        getManagementKey: () => options.getApiKey(OPENROUTER_MANAGEMENT_KEY_ID),
        allowNetwork: options.openRouter?.allowNetwork ?? options.allowNetwork === true,
        loadCatalogue: load(OPENROUTER_PROVIDER_ID),
        saveCatalogue: (value: StoredOpenRouterCatalogue) => options.saveCatalogue?.(OPENROUTER_PROVIDER_ID, value),
      }),
    );
  }

  for (const local of options.localProviders ?? []) {
    const id = local.id ?? 'openai-compatible';
    if (registry.get(id)) continue;
    registry.register(
      new OpenAiCompatibleProvider({
        ...local,
        id,
        getApiKey: local.getApiKey ?? (() => options.getApiKey(id)),
      }),
    );
  }

  return registry;
}
