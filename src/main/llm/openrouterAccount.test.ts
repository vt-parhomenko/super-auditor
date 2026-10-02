/**
 * Баланс OpenRouter: рівень ключа (`/key`, звичайний ключ) і рівень рахунку
 * (`/credits`, лише management-ключ). Без мережі.
 */

import { describe, expect, it, vi } from 'vitest';
import { LlmError } from './errors';
import type { FetchLike } from './providers/openaiCompatible';
import { OpenRouterAccount, OpenRouterAccountError, fetchOpenRouterKeyInfo } from './providers/openrouterAccount';
import { OpenRouterProvider } from './providers/openrouter';

const KEY_DATA = {
  label: 'sk-or-v1-au7...890',
  limit: 100,
  limit_remaining: 74.5,
  limit_reset: 'monthly',
  usage: 25.5,
  usage_daily: 1.25,
  usage_weekly: 5,
  usage_monthly: 25.5,
  is_free_tier: false,
  expires_at: null,
};

interface Route {
  status: number;
  body: unknown;
}

function accountFetch(routes: { key?: Route; credits?: Route }) {
  const calls: Array<{ path: string; auth: string }> = [];
  const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
    const path = new URL(url).pathname.replace('/api/v1', '');
    const auth = (init.headers as Record<string, string>).authorization ?? '';
    calls.push({ path, auth });
    const route = path === '/key' ? routes.key : path === '/credits' ? routes.credits : undefined;
    if (!route) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(route.body), { status: route.status, headers: { 'content-type': 'application/json' } });
  });
  return { fetchImpl, calls };
}

const keyOk: Route = { status: 200, body: { data: KEY_DATA } };
const creditsOk: Route = { status: 200, body: { data: { total_credits: 100.5, total_usage: 25.75 } } };
const creditsForbidden: Route = {
  status: 403,
  body: { error: { code: 403, message: 'Only management keys can perform this operation' } },
};

function account(
  fetchImpl: FetchLike,
  keys: { api?: string | null; management?: string | null } = {},
  now: () => number = () => Date.parse('2026-10-02T12:00:00.000Z'),
): OpenRouterAccount {
  return new OpenRouterAccount({
    getApiKey: () => (keys.api === undefined ? 'sk-or-inference' : keys.api),
    getManagementKey: () => keys.management ?? null,
    fetchImpl,
    now,
  });
}

describe('OpenRouterAccount.balance', () => {
  it('без management-ключа: лише /key, рахунок — management_key_required', async () => {
    const { fetchImpl, calls } = accountFetch({ key: keyOk, credits: creditsOk });
    const balance = await account(fetchImpl).balance();

    expect(calls).toEqual([{ path: '/key', auth: 'Bearer sk-or-inference' }]);
    expect(balance).toEqual({
      providerId: 'openrouter',
      accountRemainingUsd: null,
      accountTotalCreditsUsd: null,
      accountTotalUsageUsd: null,
      accountUnavailableReason: 'management_key_required',
      keyLimitUsd: 100,
      keyLimitRemainingUsd: 74.5,
      keyLimitReset: 'monthly',
      keyUsageUsd: 25.5,
      keyUsageDailyUsd: 1.25,
      keyUsageWeeklyUsd: 5,
      keyUsageMonthlyUsd: 25.5,
      isFreeTier: false,
      fetchedAt: '2026-10-02T12:00:00.000Z',
    });
  });

  it('з management-ключем: /credits іде САМЕ з ним, залишок = credits − usage', async () => {
    const { fetchImpl, calls } = accountFetch({ key: keyOk, credits: creditsOk });
    const balance = await account(fetchImpl, { management: 'sk-or-mgmt' }).balance();

    expect(calls).toContainEqual({ path: '/key', auth: 'Bearer sk-or-inference' });
    expect(calls).toContainEqual({ path: '/credits', auth: 'Bearer sk-or-mgmt' });
    expect(calls.some((call) => call.path === '/credits' && call.auth.includes('inference'))).toBe(false);
    expect(balance).toMatchObject({
      accountRemainingUsd: 74.75,
      accountTotalCreditsUsd: 100.5,
      accountTotalUsageUsd: 25.75,
      accountUnavailableReason: null,
      keyUsageUsd: 25.5,
    });
  });

  it('management-ключ відхилено (403/401) — management_key_rejected; дані ключа лишаються', async () => {
    for (const credits of [creditsForbidden, { status: 401, body: { error: { code: 401, message: 'nope' } } }]) {
      const { fetchImpl } = accountFetch({ key: keyOk, credits });
      const balance = await account(fetchImpl, { management: 'sk-or-wrong' }).balance();
      expect(balance).toMatchObject({
        accountRemainingUsd: null,
        accountUnavailableReason: 'management_key_rejected',
        keyLimitRemainingUsd: 74.5,
      });
    }
  });

  it('інший збій /credits — error', async () => {
    const { fetchImpl } = accountFetch({ key: keyOk, credits: { status: 500, body: { error: { message: 'boom' } } } });
    const balance = await account(fetchImpl, { management: 'sk-or-mgmt' }).balance();
    expect(balance?.accountUnavailableReason).toBe('error');
  });

  it('без основного ключа — null і жодного запиту', async () => {
    const { fetchImpl } = accountFetch({ key: keyOk });
    expect(await account(fetchImpl, { api: null, management: 'sk-or-mgmt' }).balance()).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('невірний основний ключ — помилка auth (кидається)', async () => {
    const { fetchImpl } = accountFetch({ key: { status: 401, body: { error: { code: 401, message: 'User not found.' } } } });
    const error = await account(fetchImpl).balance().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(OpenRouterAccountError);
    expect((error as OpenRouterAccountError).status).toBe(401);
    expect((error as LlmError).kind).toBe('auth');
  });

  it('кеш ~60 с: повтор і паралельні запити не дублюють мережу; зміна ключа скидає кеш', async () => {
    let now = Date.parse('2026-10-02T12:00:00.000Z');
    const keys: { api: string; management: string | null } = { api: 'sk-or-inference', management: null };
    const { fetchImpl } = accountFetch({ key: keyOk, credits: creditsOk });
    const acc = new OpenRouterAccount({
      getApiKey: () => keys.api,
      getManagementKey: () => keys.management,
      fetchImpl,
      now: () => now,
    });

    await Promise.all([acc.balance(), acc.balance()]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 30_000;
    await acc.balance();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 31_000;
    await acc.balance();
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    keys.management = 'sk-or-mgmt';
    const withAccount = await acc.balance();
    expect(fetchImpl).toHaveBeenCalledTimes(4); // /key + /credits
    expect(withAccount?.accountRemainingUsd).toBe(74.75);

    acc.invalidate();
    await acc.balance();
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it('помилки не кешуються', async () => {
    let fail = true;
    const fetchImpl = vi.fn<FetchLike>(async () =>
      fail
        ? new Response('{}', { status: 500 })
        : new Response(JSON.stringify({ data: KEY_DATA }), { status: 200 }),
    );
    const acc = account(fetchImpl);
    await expect(acc.balance()).rejects.toBeInstanceOf(LlmError);
    fail = false;
    await expect(acc.balance()).resolves.toMatchObject({ keyUsageUsd: 25.5 });
  });

  it('скасування — aborted, а не «немає мережі»', async () => {
    const controller = new AbortController();
    const fetchImpl: FetchLike = async (_url, init) => {
      controller.abort();
      throw init.signal?.reason ?? new Error('aborted');
    };
    const error = await account(fetchImpl).balance(controller.signal).catch((err: unknown) => err);
    expect((error as LlmError).kind).toBe('aborted');
  });
});

describe('fetchOpenRouterKeyInfo', () => {
  it('обрив мережі — transport зі status null', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new TypeError('fetch failed');
    };
    const error = (await fetchOpenRouterKeyInfo('sk', { fetchImpl }).catch((err: unknown) => err)) as OpenRouterAccountError;
    expect(error.status).toBeNull();
    expect(error.kind).toBe('transport');
  });

  it('неочікуване тіло — зрозуміла помилка', async () => {
    const fetchImpl: FetchLike = async () => new Response('{"ok":true}', { status: 200 });
    await expect(fetchOpenRouterKeyInfo('sk', { fetchImpl })).rejects.toThrow(/unexpected body/);
  });
});

describe('OpenRouterProvider — баланс', () => {
  it('management-ключ читається з окремого id і в статус не потрапляє', async () => {
    const { fetchImpl, calls } = accountFetch({ key: keyOk, credits: creditsOk });
    const provider = new OpenRouterProvider({
      getApiKey: () => 'sk-or-inference',
      getManagementKey: () => 'sk-or-mgmt',
      fetchImpl,
    });
    expect(provider.supportsBalance).toBe(true);
    expect(provider.managementKeyId).toBe('openrouter:management');
    expect(provider.managementKeyConfigured()).toBe(true);
    expect((await provider.balance())?.accountRemainingUsd).toBe(74.75);
    expect(calls.map((call) => call.path).sort()).toEqual(['/credits', '/key']);
  });
});
