import { describe, expect, it } from 'vitest';

import type { ProviderBalance } from '@shared/ipc';
import { balanceHeadline, balanceLevel, formatBalanceUsd } from './balance';

function balance(patch: Partial<ProviderBalance> = {}): ProviderBalance {
  return {
    providerId: 'openrouter',
    accountRemainingUsd: null,
    accountTotalCreditsUsd: null,
    accountTotalUsageUsd: null,
    accountUnavailableReason: 'management_key_required',
    keyLimitUsd: null,
    keyLimitRemainingUsd: null,
    keyLimitReset: null,
    keyUsageUsd: null,
    keyUsageDailyUsd: null,
    keyUsageWeeklyUsd: null,
    keyUsageMonthlyUsd: null,
    isFreeTier: null,
    fetchedAt: '2026-10-02T10:00:00.000Z',
    ...patch,
  };
}

describe('balanceHeadline', () => {
  it('залишок на рахунку важливіший за витрати', () => {
    expect(
      balanceHeadline(balance({ accountRemainingUsd: 74.5, keyLimitRemainingUsd: 100, keyUsageMonthlyUsd: 25.5 })),
    ).toEqual({ kind: 'account', amountUsd: 74.5, level: 'ok' });
  });

  it('ліміт ключа, що скінчиться раніше за рахунок, — головне число', () => {
    expect(balanceHeadline(balance({ accountRemainingUsd: 74.5, keyLimitRemainingUsd: 0.4 }))).toEqual({
      kind: 'keyRemaining',
      amountUsd: 0.4,
      level: 'critical',
    });
  });

  it('без management-ключа — залишок ліміту ключа', () => {
    expect(balanceHeadline(balance({ keyLimitRemainingUsd: 3.2, keyUsageMonthlyUsd: 25.5 }))).toEqual({
      kind: 'keyRemaining',
      amountUsd: 3.2,
      level: 'low',
    });
  });

  it('без ліміту — витрати ключа за місяць, і вони ніколи не «закінчуються»', () => {
    expect(balanceHeadline(balance({ keyUsageMonthlyUsd: 0.4, keyUsageUsd: 40 }))).toEqual({
      kind: 'keyMonth',
      amountUsd: 0.4,
      level: 'neutral',
    });
  });

  it('останній шанс — загальні витрати ключа', () => {
    expect(balanceHeadline(balance({ keyUsageUsd: 40 }))?.kind).toBe('keyTotal');
  });

  it('нічого немає — нічого не показуємо', () => {
    expect(balanceHeadline(balance())).toBeNull();
    expect(balanceHeadline(null)).toBeNull();
    expect(balanceHeadline(balance({ accountRemainingUsd: Number.NaN }))).toBeNull();
  });
});

describe('balanceLevel', () => {
  it('пороги $5 і $1', () => {
    expect(balanceLevel(5)).toBe('ok');
    expect(balanceLevel(4.99)).toBe('low');
    expect(balanceLevel(1)).toBe('low');
    expect(balanceLevel(0.99)).toBe('critical');
    expect(balanceLevel(-2)).toBe('critical');
  });
});

describe('formatBalanceUsd', () => {
  it('дві цифри, нуль і перевитрата видно чесно', () => {
    expect(formatBalanceUsd(74.5)).toBe('$74.50');
    expect(formatBalanceUsd(0)).toBe('$0.00');
    expect(formatBalanceUsd(0.004)).toBe('$0.00');
    expect(formatBalanceUsd(-1.2)).toBe('-$1.20');
    expect(formatBalanceUsd(null)).toBe('—');
  });
});
