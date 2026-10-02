/**
 * Баланс і витрати OpenRouter.
 *
 * Два різні рівні, які не можна змішувати (див. `ProviderBalance`):
 *  - КЛЮЧ: `GET /key` зі звичайним ключем — скільки витратив цей ключ і скільки
 *    лишилось до його ліміту (якщо ліміт задано);
 *  - РАХУНОК: `GET /credits` — `total_credits − total_usage`. Працює ЛИШЕ з
 *    management-ключем; звичайний отримує 403 «Only management keys can
 *    perform this operation». Тому `/credits` зі звичайним ключем навіть не
 *    пробуємо, а management-ключ ніколи не йде у виклики моделей.
 *
 * Користувач чекає відповідь (верхня панель, Налаштування), тому: таймаут
 * 15 с, без повторів, результат кешується ~60 с, а паралельні запити з тим
 * самим набором ключів зливаються в один.
 */

import type { ProviderBalance } from '@shared/ipc';
import { LlmError } from '../errors';
import type { FetchLike } from './openaiCompatible';
import { OPENROUTER_API_BASE } from './openrouterCatalogue';

const PROVIDER_ID = 'openrouter';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_TTL_MS = 60_000;

export interface OpenRouterKeyInfo {
  label: string | null;
  limit: number | null;
  limitRemaining: number | null;
  limitReset: string | null;
  usage: number | null;
  usageDaily: number | null;
  usageWeekly: number | null;
  usageMonthly: number | null;
  isFreeTier: boolean | null;
  expiresAt: string | null;
}

export interface OpenRouterCredits {
  totalCredits: number;
  totalUsage: number;
}

export interface AccountRequestOptions {
  fetchImpl?: FetchLike;
  baseUrl?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** HTTP-відповідь із помилкою; `status: null` — до сервера не достукались. */
export class OpenRouterAccountError extends LlmError {
  readonly status: number | null;

  constructor(status: number | null, message: string, cause?: unknown) {
    const kind = status === 401 || status === 403 ? 'auth' : status === null ? 'transport' : 'api';
    super(kind, message, {
      providerId: PROVIDER_ID,
      retryable: status === null || status === 429 || (status !== null && status >= 500),
      cause,
    });
    this.name = 'OpenRouterAccountError';
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function getJson(path: string, bearer: string, opts: AccountRequestOptions): Promise<Record<string, unknown>> {
  const doFetch = opts.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
  if (!doFetch) throw new OpenRouterAccountError(null, 'global fetch is unavailable');

  const url = `${(opts.baseUrl ?? OPENROUTER_API_BASE).replace(/\/+$/, '')}${path}`;
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' },
      signal,
    });
  } catch (err) {
    if (opts.signal?.aborted) throw new LlmError('aborted', 'Request aborted', { providerId: PROVIDER_ID });
    const reason = timeout.aborted ? 'timed out' : ((err as Error)?.message ?? String(err));
    throw new OpenRouterAccountError(null, `Cannot reach ${url}: ${reason}`, err);
  }

  const text = await response.text().catch(() => '');
  let body: unknown = null;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const error = isRecord(body) && isRecord(body.error) ? body.error : null;
    const message = str(error?.message) ?? (text.slice(0, 300) || response.statusText);
    throw new OpenRouterAccountError(response.status, `OpenRouter ${path} returned ${response.status}: ${message}`);
  }
  if (!isRecord(body) || !isRecord(body.data)) {
    throw new OpenRouterAccountError(response.status, `OpenRouter ${path} returned an unexpected body`);
  }
  return body.data;
}

/** `GET /key` — дані про ключ, яким автентифікуємось. Токенів не витрачає. */
export async function fetchOpenRouterKeyInfo(apiKey: string, opts: AccountRequestOptions = {}): Promise<OpenRouterKeyInfo> {
  const data = await getJson('/key', apiKey, opts);
  return {
    label: str(data.label),
    limit: num(data.limit),
    limitRemaining: num(data.limit_remaining),
    limitReset: str(data.limit_reset),
    usage: num(data.usage),
    usageDaily: num(data.usage_daily),
    usageWeekly: num(data.usage_weekly),
    usageMonthly: num(data.usage_monthly),
    isFreeTier: typeof data.is_free_tier === 'boolean' ? data.is_free_tier : null,
    expiresAt: str(data.expires_at),
  };
}

/** `GET /credits` — ЛИШЕ з management-ключем. */
export async function fetchOpenRouterCredits(managementKey: string, opts: AccountRequestOptions = {}): Promise<OpenRouterCredits> {
  const data = await getJson('/credits', managementKey, opts);
  const totalCredits = num(data.total_credits);
  const totalUsage = num(data.total_usage);
  if (totalCredits === null || totalUsage === null) {
    throw new OpenRouterAccountError(200, 'OpenRouter /credits returned no totals');
  }
  return { totalCredits, totalUsage };
}

export interface OpenRouterAccountOptions {
  getApiKey: () => string | null | undefined;
  getManagementKey: () => string | null | undefined;
  fetchImpl?: FetchLike;
  baseUrl?: string;
  now?: () => number;
  ttlMs?: number;
  timeoutMs?: number;
}

/** Округлення до центів прибирає хвости з плаваючою комою (100.5 − 25.75). */
function money(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export class OpenRouterAccount {
  private cache: { key: string; expiresAt: number; value: ProviderBalance } | null = null;
  private inFlight: { key: string; promise: Promise<ProviderBalance> } | null = null;

  constructor(private readonly opts: OpenRouterAccountOptions) {}

  managementKeyConfigured(): boolean {
    const key = this.opts.getManagementKey();
    return typeof key === 'string' && key.length > 0;
  }

  /** Скидає кеш — напр. після зміни ключів. */
  invalidate(): void {
    this.cache = null;
  }

  /**
   * Баланс. `null` — немає основного ключа. Помилка `/key` (невірний ключ,
   * мережа) кидається: без неї немає що показати. Помилка `/credits` — ні:
   * дані ключа однаково корисні, а причина йде в `accountUnavailableReason`.
   */
  async balance(signal?: AbortSignal): Promise<ProviderBalance | null> {
    const apiKey = this.opts.getApiKey();
    if (!apiKey) return null;
    const managementKey = this.opts.getManagementKey() || null;
    // Ключі порівнюємо лише в памʼяті main-процесу; назовні вони не йдуть.
    const cacheKey = `${apiKey}\u0000${managementKey ?? ''}`;

    const now = this.now();
    if (this.cache && this.cache.key === cacheKey && this.cache.expiresAt > now) return this.cache.value;
    if (this.inFlight && this.inFlight.key === cacheKey) return this.inFlight.promise;

    const promise = this.load(apiKey, managementKey, signal);
    this.inFlight = { key: cacheKey, promise };
    try {
      const value = await promise;
      this.cache = { key: cacheKey, expiresAt: this.now() + (this.opts.ttlMs ?? DEFAULT_TTL_MS), value };
      return value;
    } finally {
      if (this.inFlight?.promise === promise) this.inFlight = null;
    }
  }

  private async load(apiKey: string, managementKey: string | null, signal?: AbortSignal): Promise<ProviderBalance> {
    const request: AccountRequestOptions = {
      ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}),
      ...(this.opts.baseUrl ? { baseUrl: this.opts.baseUrl } : {}),
      ...(signal ? { signal } : {}),
      ...(this.opts.timeoutMs ? { timeoutMs: this.opts.timeoutMs } : {}),
    };

    const [key, credits] = await Promise.all([
      fetchOpenRouterKeyInfo(apiKey, request),
      managementKey
        ? fetchOpenRouterCredits(managementKey, request).then(
            (value) => ({ ok: true as const, value }),
            (error: unknown) => ({ ok: false as const, error }),
          )
        : Promise.resolve(null),
    ]);

    let accountUnavailableReason: ProviderBalance['accountUnavailableReason'] = null;
    let account: OpenRouterCredits | null = null;
    if (credits === null) {
      accountUnavailableReason = 'management_key_required';
    } else if (credits.ok) {
      account = credits.value;
    } else {
      if (credits.error instanceof LlmError && credits.error.kind === 'aborted') throw credits.error;
      const status = credits.error instanceof OpenRouterAccountError ? credits.error.status : null;
      accountUnavailableReason = status === 401 || status === 403 ? 'management_key_rejected' : 'error';
    }

    return {
      providerId: PROVIDER_ID,
      accountRemainingUsd: account ? money(account.totalCredits - account.totalUsage) : null,
      accountTotalCreditsUsd: account ? account.totalCredits : null,
      accountTotalUsageUsd: account ? account.totalUsage : null,
      accountUnavailableReason,
      keyLimitUsd: key.limit,
      keyLimitRemainingUsd: key.limitRemaining,
      keyLimitReset: key.limitReset,
      keyUsageUsd: key.usage,
      keyUsageDailyUsd: key.usageDaily,
      keyUsageWeeklyUsd: key.usageWeekly,
      keyUsageMonthlyUsd: key.usageMonthly,
      isFreeTier: key.isFreeTier,
      fetchedAt: new Date(this.now()).toISOString(),
    };
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }
}
