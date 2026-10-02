/**
 * Баланс провайдера: яке число винести в шапку і чи час тривожитись.
 *
 * Чиста логіка без React і каталогів — тестується юніт-тестом. Головне правило:
 * не видавати одне число за інше. Залишок на РАХУНКУ, залишок ЛІМІТУ ключа і
 * ВИТРАТИ ключа — три різні речі, і підпис у UI залежить від того, що саме
 * вдалося отримати.
 */

import type { ProviderBalance } from '@shared/ipc';

export type BalanceHeadlineKind = 'account' | 'keyRemaining' | 'keyMonth' | 'keyTotal';

/**
 * `low`/`critical` — лише для залишків: витрати за місяць «закінчитись» не можуть,
 * тож для них рівень завжди `neutral`.
 */
export type BalanceLevel = 'ok' | 'low' | 'critical' | 'neutral';

export interface BalanceHeadline {
  kind: BalanceHeadlineKind;
  amountUsd: number;
  level: BalanceLevel;
}

/** Нижче цих сум залишок підсвічується жовтим / червоним. */
export const BALANCE_LOW_USD = 5;
export const BALANCE_CRITICAL_USD = 1;

export function balanceLevel(remainingUsd: number): BalanceLevel {
  if (remainingUsd < BALANCE_CRITICAL_USD) return 'critical';
  if (remainingUsd < BALANCE_LOW_USD) return 'low';
  return 'ok';
}

const finite = (value: number | null | undefined): value is number =>
  value != null && Number.isFinite(value);

/**
 * Найкорисніше доступне число, у порядку цінності: залишок на рахунку →
 * залишок ліміту ключа → витрати ключа за місяць → витрати ключа загалом.
 * null — показувати нічого.
 *
 * Якщо відомі обидва залишки, у шапку йде МЕНШИЙ: прогін зупиниться на тому
 * обмеженні, що скінчиться першим. Зелені «$74.50 на рахунку» при $0.40 до
 * ліміту ключа обіцяли б роботу, якої не буде.
 */
export function balanceHeadline(balance: ProviderBalance | null | undefined): BalanceHeadline | null {
  if (!balance) return null;
  if (
    finite(balance.accountRemainingUsd) &&
    finite(balance.keyLimitRemainingUsd) &&
    balance.keyLimitRemainingUsd < balance.accountRemainingUsd
  ) {
    const amountUsd = balance.keyLimitRemainingUsd;
    return { kind: 'keyRemaining', amountUsd, level: balanceLevel(amountUsd) };
  }
  if (finite(balance.accountRemainingUsd)) {
    const amountUsd = balance.accountRemainingUsd;
    return { kind: 'account', amountUsd, level: balanceLevel(amountUsd) };
  }
  if (finite(balance.keyLimitRemainingUsd)) {
    const amountUsd = balance.keyLimitRemainingUsd;
    return { kind: 'keyRemaining', amountUsd, level: balanceLevel(amountUsd) };
  }
  if (finite(balance.keyUsageMonthlyUsd)) {
    return { kind: 'keyMonth', amountUsd: balance.keyUsageMonthlyUsd, level: 'neutral' };
  }
  if (finite(balance.keyUsageUsd)) {
    return { kind: 'keyTotal', amountUsd: balance.keyUsageUsd, level: 'neutral' };
  }
  return null;
}

/**
 * Сума балансу: завжди дві цифри після крапки й знак мінуса для перевитрати.
 * `formatCost` тут не годиться: він показує «<$0.01» для дрібниць і ковтає
 * від'ємні значення, а залишок на рахунку буває і нульовим, і від'ємним.
 */
export function formatBalanceUsd(usd: number | null | undefined): string {
  if (!finite(usd)) return '—';
  const sign = usd < 0 ? '-' : '';
  return `${sign}$${Math.abs(usd).toFixed(2)}`;
}
