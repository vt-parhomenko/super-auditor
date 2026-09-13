/**
 * Реєстр провайдерів і маршрутизація по етапах (architecture.md §7).
 *
 * Ключі API беруться через передану функцію-геттер — інтеграцію з `safeStorage`
 * робить інший шар. Тут ні `fs`, ні `electron`.
 */

import type { ModelRef, Stage } from '@shared/domain';
import type { AppSettings, ProviderStatus } from '@shared/ipc';
import { LlmCloudBlockedError, LlmNotConfiguredError } from './errors';
import { AnthropicProvider, ANTHROPIC_PROVIDER_ID } from './providers/anthropic';
import { OpenAiCompatibleProvider, type OpenAiCompatibleOptions } from './providers/openaiCompatible';
import type { LlmProvider } from './types';

/** Маршрутизація за замовчуванням. Переозначається через `AppSettings.routing`. */
export const DEFAULT_ROUTING: Record<Stage, ModelRef> = {
  clause_extract: { provider: 'anthropic', model: 'claude-sonnet-5', effort: 'medium' },
  spec_summary: { provider: 'anthropic', model: 'claude-sonnet-5', effort: 'medium' },
  doc_profile: { provider: 'anthropic', model: 'claude-haiku-4-5' },
  judge: { provider: 'anthropic', model: 'claude-opus-5', effort: 'high' },
  critic: { provider: 'anthropic', model: 'claude-opus-5', effort: 'high' },
};

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

/** Зливає DEFAULT_ROUTING з користувацьким переозначенням. */
export function resolveRouting(
  stage: Stage,
  settings?: Pick<AppSettings, 'routing'> | null,
  override?: Partial<Record<Stage, ModelRef>> | null,
): ModelRef {
  const fallback = DEFAULT_ROUTING[stage];
  const fromOverride = override?.[stage];
  if (fromOverride) return fromOverride;

  const fromSettings = settings?.routing?.[stage];
  if (!fromSettings) return fallback;

  const ref: ModelRef = {
    provider: fromSettings.provider || fallback.provider,
    model: fromSettings.model || fallback.model,
  };
  const effort = fromSettings.effort ?? fallback.effort;
  if (effort && EFFORTS.has(effort)) ref.effort = effort as ModelRef['effort'];
  return ref;
}

export interface ResolvedProvider {
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

  /** Форма для IPC `providers:list`. Мережу не чіпає. */
  listProviderStatus(): ProviderStatus[] {
    return this.list().map((provider) => ({
      id: provider.id,
      label: provider.label,
      configured: provider.isConfigured(),
      cloud: provider.caps.cloud,
      models: [...provider.models],
      error: provider.isConfigured() ? null : 'API key or endpoint is not configured',
    }));
  }

  /**
   * Провайдер і модель для етапу. Кидає, якщо провайдера немає, він не
   * налаштований, або хмара заборонена (ADR-8 / `settings.localOnly`).
   */
  resolveProvider(
    stage: Stage,
    settings?: (Pick<AppSettings, 'routing'> & Partial<Pick<AppSettings, 'localOnly'>>) | null,
    opts: ResolveOptions = {},
  ): ResolvedProvider {
    const model = resolveRouting(stage, settings, opts.routingOverride);
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
    return { provider, model };
  }

  get apiKeyGetter(): ApiKeyGetter {
    return this.options.getApiKey;
  }
}

/** Реєстр за замовчуванням: Anthropic + опційні локальні ендпоінти. */
export function createDefaultRegistry(options: RegistryOptions): ProviderRegistry {
  const registry = new ProviderRegistry(options);

  if (!registry.get(ANTHROPIC_PROVIDER_ID)) {
    registry.register(
      new AnthropicProvider({ getApiKey: () => options.getApiKey(ANTHROPIC_PROVIDER_ID) }),
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
