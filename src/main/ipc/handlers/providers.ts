/**
 * Провайдери LLM і ключі API.
 *
 * Інваріант шару: ключ ніколи не перетинає межу IPC у бік renderer.
 * `providers:list` віддає лише `configured` / `managementKeyConfigured: boolean`,
 * `providers:test` — лише `{ ok, message }`. Самі ключі живуть у `safeStorage`
 * (див. `@main/secrets`); management-ключ OpenRouter — там само, під окремим id.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  ANTHROPIC_PROVIDER_ID,
  OPENROUTER_PROVIDER_ID,
  OpenRouterAccountError,
  fetchOpenRouterKeyInfo,
  formatUsd,
  type FetchLike,
  type LlmProvider,
} from '@main/llm';
import { mainMessages, providerName, uiMessages, type MainMessages } from '@main/i18n';
import type { IpcHandlers, ProviderStatus } from '@shared/ipc';
import type { IpcContext } from '../context';
import { notFound, validation } from '../errors';

export type ProviderHandlers = Pick<
  IpcHandlers,
  | 'providers:list'
  | 'providers:setApiKey'
  | 'providers:clearApiKey'
  | 'providers:test'
  | 'providers:refreshModels'
  | 'providers:balance'
  | 'providers:setManagementKey'
  | 'providers:clearManagementKey'
>;

export interface ProviderTestResult {
  ok: boolean;
  message: string;
}

/** Тексти `providers:*` мовою інтерфейсу. */
type ProviderMessages = MainMessages['providers'];

/**
 * Перевірка доступності провайдера. Підмінюється в тестах, щоб не ходити в мережу.
 * `m` — тексти мовою інтерфейсу: результат іде прямо на екран.
 */
export type ProviderProbe = (
  provider: LlmProvider,
  apiKey: string | null,
  m: ProviderMessages,
) => Promise<ProviderTestResult>;

export interface ProviderHandlerOptions {
  probe?: ProviderProbe;
}

export function providerHandlers(
  ctx: IpcContext,
  options: ProviderHandlerOptions = {},
): ProviderHandlers {
  const probe = options.probe ?? defaultProbe;

  const find = (providerId: string): LlmProvider => {
    const id = String(providerId ?? '').trim().toLowerCase();
    if (id.length === 0) throw validation((m) => m.providers.idMissing);
    const provider = ctx.providers.get(id);
    if (!provider) throw notFound('provider', providerId);
    return provider;
  };

  /** Провайдер із management-ключем (OpenRouter) — інакше зрозуміла відмова. */
  const managementKeyIdOf = (provider: LlmProvider): string => {
    if (!provider.managementKeyId) {
      throw validation((m) => m.providers.managementKeyUnsupported(provider.label));
    }
    return provider.managementKeyId;
  };

  const statusOf = (provider: LlmProvider): ProviderStatus => {
    const status = ctx.providers.providerStatus(provider.id);
    if (!status) throw notFound('provider', provider.id);
    return status;
  };

  return {
    'providers:list': (): ProviderStatus[] => ctx.providers.listProviderStatus(),

    'providers:setApiKey': (providerId, apiKey) => {
      const provider = find(providerId);
      const key = String(apiKey ?? '').trim();
      if (key.length === 0) throw validation((m) => m.providers.keyEmpty);
      // Кидає EncryptionUnavailableError, якщо safeStorage недоступний —
      // краще зрозуміла помилка, ніж ключ у плейнтексті.
      ctx.secrets.setApiKey(provider.id, key);
    },

    'providers:clearApiKey': (providerId) => {
      const provider = find(providerId);
      ctx.secrets.clearApiKey(provider.id);
    },

    'providers:test': async (providerId) => {
      const provider = find(providerId);
      const m = uiMessages(ctx.db).providers;

      if (!provider.isConfigured()) {
        return { ok: false, message: m.notConfigured(provider.label) };
      }

      if (!ctx.allowNetwork) {
        return { ok: true, message: m.networkCheckDisabled };
      }

      return probe(provider, ctx.secrets.getApiKey(provider.id), m);
    },

    'providers:refreshModels': async (providerId) => {
      const provider = find(providerId);
      // Офлайн — віддаємо те, що є (вбудований список або збережений каталог).
      if (!ctx.allowNetwork) return statusOf(provider);
      return ctx.providers.refreshModels(provider.id);
    },

    'providers:balance': async (providerId) => {
      const provider = find(providerId);
      if (!provider.supportsBalance || !provider.isConfigured() || !ctx.allowNetwork) return null;
      return ctx.providers.balance(provider.id);
    },

    'providers:setManagementKey': (providerId, key) => {
      const provider = find(providerId);
      const id = managementKeyIdOf(provider);
      const value = String(key ?? '').trim();
      if (value.length === 0) throw validation((m) => m.providers.managementKeyEmpty);
      ctx.secrets.setApiKey(id, value);
    },

    'providers:clearManagementKey': (providerId) => {
      const provider = find(providerId);
      ctx.secrets.clearApiKey(managementKeyIdOf(provider));
    },
  };
}

/**
 * Найдешевша можлива перевірка — запит без токенів, який усе одно проходить
 * автентифікацію: для Anthropic це GET `/v1/models`, для OpenRouter — GET `/key`.
 * Жодного платного виклику моделі тут бути не повинно.
 */
export const defaultProbe: ProviderProbe = async (provider, apiKey, m) => {
  if (provider.id === ANTHROPIC_PROVIDER_ID) return probeAnthropic(apiKey, m);
  if (provider.id === OPENROUTER_PROVIDER_ID) return probeOpenRouter(apiKey, m);
  return { ok: true, message: m.probeNotImplemented(provider.label) };
};

async function probeAnthropic(apiKey: string | null, m: ProviderMessages): Promise<ProviderTestResult> {
  const name = providerName(ANTHROPIC_PROVIDER_ID);
  if (!apiKey) return { ok: false, message: m.keyNotFound(name) };

  // maxRetries: 0 — користувач чекає відповідь у діалозі, ретраї тут тільки шкодять.
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 15_000 });

  try {
    const models = await client.models.list({ limit: 1 });
    const first = models.data[0]?.id;
    return {
      ok: true,
      message: first ? m.connectionOkWithModel(name, first) : m.connectionOk(name),
    };
  } catch (err) {
    return { ok: false, message: describeAnthropicError(err, m) };
  }
}

/**
 * OpenRouter: GET `/key` перевіряє ключ і заодно віддає витрати й ліміт
 * ключа — їх показуємо одразу, це нічого не коштує.
 */
export async function probeOpenRouter(
  apiKey: string | null,
  m: ProviderMessages = mainMessages(null).providers,
  fetchImpl?: FetchLike,
): Promise<ProviderTestResult> {
  const name = providerName(OPENROUTER_PROVIDER_ID);
  if (!apiKey) return { ok: false, message: m.keyNotFound(name) };

  try {
    const info = await fetchOpenRouterKeyInfo(apiKey, fetchImpl ? { fetchImpl } : {});
    const parts = [m.keyValid(name, info.label)];
    if (info.usage !== null) parts.push(m.keyUsage(formatUsd(info.usage)));
    if (info.limit !== null) {
      const remaining = info.limitRemaining !== null ? formatUsd(info.limitRemaining) : null;
      parts.push(m.keyLimit(formatUsd(info.limit), remaining, info.limitReset));
    } else {
      parts.push(m.noKeyLimit);
    }
    if (info.isFreeTier) parts.push(m.freeTier);
    return { ok: true, message: parts.join(' ') };
  } catch (err) {
    return { ok: false, message: describeOpenRouterError(err, m) };
  }
}

/** Мапінг помилок OpenRouter у текст, з якого зрозуміло, що робити далі. */
export function describeOpenRouterError(
  err: unknown,
  m: ProviderMessages = mainMessages(null).providers,
): string {
  if (err instanceof OpenRouterAccountError) {
    switch (err.status) {
      case 401:
        return m.keyRejected;
      case 403:
        return m.permissionDenied;
      case 429:
        return m.rateLimited;
      case null:
        return m.noConnection('openrouter.ai');
      default:
        return m.httpError(providerName(OPENROUTER_PROVIDER_ID), err.status, err.message);
    }
  }
  return err instanceof Error ? err.message : String(err);
}

/** Мапінг помилок Anthropic у текст, з якого зрозуміло, що робити далі. */
export function describeAnthropicError(
  err: unknown,
  m: ProviderMessages = mainMessages(null).providers,
): string {
  if (err instanceof Anthropic.AuthenticationError) return m.keyRejected;
  if (err instanceof Anthropic.PermissionDeniedError) return m.permissionDenied;
  if (err instanceof Anthropic.RateLimitError) return m.rateLimited;
  if (err instanceof Anthropic.APIConnectionError) return m.noConnection('api.anthropic.com');
  if (err instanceof Anthropic.APIError) {
    const status = typeof err.status === 'number' ? err.status : null;
    return m.httpError(providerName(ANTHROPIC_PROVIDER_ID), status, err.message);
  }
  return err instanceof Error ? err.message : String(err);
}
