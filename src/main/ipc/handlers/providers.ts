/**
 * Провайдери LLM і ключі API.
 *
 * Інваріант шару: ключ ніколи не перетинає межу IPC у бік renderer.
 * `providers:list` віддає лише `configured: boolean`, `providers:test` —
 * лише `{ ok, message }`. Сам ключ живе в `safeStorage` (див. `@main/secrets`).
 */

import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_PROVIDER_ID, type LlmProvider } from '@main/llm';
import type { IpcHandlers, ProviderStatus } from '@shared/ipc';
import type { IpcContext } from '../context';
import { notFound, validation } from '../errors';

export type ProviderHandlers = Pick<
  IpcHandlers,
  'providers:list' | 'providers:setApiKey' | 'providers:clearApiKey' | 'providers:test'
>;

export interface ProviderTestResult {
  ok: boolean;
  message: string;
}

/** Перевірка доступності провайдера. Підмінюється в тестах, щоб не ходити в мережу. */
export type ProviderProbe = (
  provider: LlmProvider,
  apiKey: string | null,
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
    if (id.length === 0) throw validation('Не вказано providerId');
    const provider = ctx.providers.get(id);
    if (!provider) throw notFound('Провайдера', providerId);
    return provider;
  };

  return {
    'providers:list': (): ProviderStatus[] => ctx.providers.listProviderStatus(),

    'providers:setApiKey': (providerId, apiKey) => {
      const provider = find(providerId);
      const key = String(apiKey ?? '').trim();
      if (key.length === 0) throw validation('Ключ API не може бути порожнім');
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

      if (!provider.isConfigured()) {
        return {
          ok: false,
          message: `Провайдер «${provider.label}» не налаштований: немає ключа API або ендпоінта`,
        };
      }

      if (!ctx.allowNetwork) {
        return {
          ok: true,
          message: 'Мережеву перевірку вимкнено — перевірено лише наявність ключа',
        };
      }

      return probe(provider, ctx.secrets.getApiKey(provider.id));
    },
  };
}

/**
 * Найдешевша можлива перевірка: для Anthropic це GET `/v1/models` —
 * запит без токенів, який усе одно проходить автентифікацію.
 * Жодного платного виклику моделі тут бути не повинно.
 */
export const defaultProbe: ProviderProbe = async (provider, apiKey) => {
  if (provider.id === ANTHROPIC_PROVIDER_ID) return probeAnthropic(apiKey);
  return {
    ok: true,
    message: `Провайдер «${provider.label}» налаштований; мережева перевірка для нього не реалізована`,
  };
};

async function probeAnthropic(apiKey: string | null): Promise<ProviderTestResult> {
  if (!apiKey) {
    return { ok: false, message: 'Ключ Anthropic не знайдено в захищеному сховищі' };
  }

  // maxRetries: 0 — користувач чекає відповідь у діалозі, ретраї тут тільки шкодять.
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 15_000 });

  try {
    const models = await client.models.list({ limit: 1 });
    const first = models.data[0]?.id;
    return {
      ok: true,
      message: first
        ? `Зʼєднання з Anthropic працює, доступна модель ${first}`
        : 'Зʼєднання з Anthropic працює',
    };
  } catch (err) {
    return { ok: false, message: describeAnthropicError(err) };
  }
}

/** Мапінг помилок Anthropic у текст, з якого зрозуміло, що робити далі. */
export function describeAnthropicError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'Ключ API відхилено (401): перевірте, що він скопійований повністю і не відкликаний';
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return 'Доступ заборонено (403): у ключа немає прав на Messages API';
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'Ключ дійсний, але зараз спрацював ліміт запитів (429) — спробуйте за хвилину';
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return 'Немає зʼєднання з api.anthropic.com: перевірте мережу, проксі або фаєрвол';
  }
  if (err instanceof Anthropic.APIError) {
    const status = typeof err.status === 'number' ? ` (HTTP ${err.status})` : '';
    return `Провайдер повернув помилку${status}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
