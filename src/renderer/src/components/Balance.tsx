import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import type { ProviderBalance, ProviderStatus } from '@shared/ipc';
import { qk } from '@renderer/hooks/keys';
import { useIpcEvent } from '@renderer/hooks/useIpcEvent';
import {
  useClearManagementKey,
  useProviderBalance,
  useProviders,
  useSetManagementKey,
} from '@renderer/hooks/useSettings';
import { useT, type Messages } from '@renderer/i18n';
import { balanceHeadline, balanceLevel, formatBalanceUsd, type BalanceHeadline } from '@renderer/lib/balance';
import { formatDateTime, formatRelative } from '@renderer/lib/format';
import { providerLinks } from '@renderer/lib/providerLinks';
import { toast } from '@renderer/store/ui';

/** Провайдери, чий баланс має сенс питати: вміють його віддати й мають ключ. */
function balanceProviders(list: readonly ProviderStatus[] | undefined): ProviderStatus[] {
  return (list ?? []).filter((p) => p.supportsBalance === true && p.configured);
}

// ─── Індикатор у шапці ───────────────────────────────────────────────────────

/**
 * Компактний баланс у верхній панелі. Невидимий, доки жоден провайдер не вміє
 * віддавати баланс. Помилки не тостить: це фонове опитування, і тост кожні
 * п'ять хвилин офлайн був би спамом — лише тихий прочерк із підказкою.
 */
export function BalanceIndicator() {
  const providers = useProviders();
  const qc = useQueryClient();
  const list = balanceProviders(providers.data);

  // Гроші списуються прогоном — після нього баланс точно інший. Події прогресу
  // свідомо не чіпаємо: їх десятки на хвилину, а провайдер оновлює цифри із затримкою.
  useIpcEvent(
    'run:finished',
    () => void qc.invalidateQueries({ queryKey: qk.providerBalance() }),
    list.length > 0,
  );

  if (list.length === 0) return null;
  return (
    <>
      {list.map((provider) => (
        <BalanceChip key={provider.id} provider={provider} />
      ))}
    </>
  );
}

function chipText(t: Messages, headline: BalanceHeadline): string {
  const amount = formatBalanceUsd(headline.amountUsd);
  switch (headline.kind) {
    case 'account':
      return amount;
    case 'keyRemaining':
      return t.balance.chipKeyRemaining(amount);
    case 'keyMonth':
      return t.balance.chipKeyMonth(amount);
    case 'keyTotal':
      return t.balance.chipKeyTotal(amount);
  }
}

function chipTip(t: Messages, provider: string, headline: BalanceHeadline, when: string): string {
  switch (headline.kind) {
    case 'account':
      return t.balance.tipAccount(provider, when);
    case 'keyRemaining':
      return t.balance.tipKeyRemaining(provider, when);
    case 'keyMonth':
      return t.balance.tipKeyMonth(provider, when);
    case 'keyTotal':
      return t.balance.tipKeyTotal(provider, when);
  }
}

function BalanceChip({ provider }: { provider: ProviderStatus }) {
  const t = useT();
  const balance = useProviderBalance(provider.id);

  if (balance.isPending) return null;

  const headline = balanceHeadline(balance.data);
  if (!headline || !balance.data) {
    const tip = balance.error
      ? t.balance.tipFailed(provider.label, balance.error.message)
      : t.balance.tipUnavailable(provider.label);
    return (
      <Link to="/settings" className="balance-chip is-unavailable" title={tip} aria-label={tip}>
        <span className="balance-chip-provider">{provider.label}</span>
        <span aria-hidden="true">—</span>
      </Link>
    );
  }

  const text = chipText(t, headline);
  const tipParts = [chipTip(t, provider.label, headline, formatRelative(balance.data.fetchedAt))];
  if (headline.level === 'low' || headline.level === 'critical') tipParts.push(t.balance.tipLow);
  tipParts.push(t.balance.tipOpenSettings);
  const tip = tipParts.join(' ');

  return (
    <Link
      to="/settings"
      className={`balance-chip level-${headline.level}`}
      title={tip}
      aria-label={`${provider.label} ${text}. ${tip}`}
    >
      <span className="balance-chip-provider">{provider.label}</span>
      <span className="balance-chip-value">{text}</span>
    </Link>
  );
}

// ─── Панель у картці провайдера ──────────────────────────────────────────────

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="balance-figure">
      <span className="balance-figure-label">{label}</span>
      <span className={`balance-figure-value ${tone ?? ''}`}>{value}</span>
    </div>
  );
}

/**
 * Баланс за даними провайдера. Рахунок і ключ — окремими блоками з окремими
 * заголовками: «скільки лишилось грошей» і «скільки витратив цей ключ» не можна
 * зливати в одне число.
 */
export function BalancePanel({ provider }: { provider: ProviderStatus }) {
  const t = useT();
  const balance = useProviderBalance(provider.id);
  const links = providerLinks(provider.id);
  const data = balance.data;

  return (
    <div className="balance-panel">
      <div className="row-between">
        <span className="section-title">{t.balance.panelTitle(provider.label)}</span>
        <div className="row">
          {data && (
            <span className="xsmall dim" title={formatDateTime(data.fetchedAt)}>
              {t.balance.fetchedAt(formatRelative(data.fetchedAt))}
            </span>
          )}
          <button
            type="button"
            className="btn btn-sm"
            disabled={balance.isFetching}
            onClick={() => void balance.refetch()}
          >
            {balance.isFetching ? t.balance.refreshing : t.balance.refresh}
          </button>
        </div>
      </div>

      {balance.isPending ? (
        <span className="xsmall dim">{t.common.loading}</span>
      ) : balance.error ? (
        <div className="callout callout-warn">{t.balance.tipFailed(provider.label, balance.error.message)}</div>
      ) : !data ? (
        <div className="callout">{t.balance.unavailable}</div>
      ) : (
        <BalanceFigures provider={provider} balance={data} />
      )}

      <ManagementKeyForm provider={provider} rejected={data?.accountUnavailableReason === 'management_key_rejected'} />

      {links.credits && (
        <a href={links.credits} target="_blank" rel="noreferrer noopener" className="btn btn-sm balance-link">
          {t.balance.openCredits(provider.label)} ↗
        </a>
      )}
    </div>
  );
}

function BalanceFigures({ provider, balance }: { provider: ProviderStatus; balance: ProviderBalance }) {
  const t = useT();
  const remaining = balance.accountRemainingUsd;
  const reason = balance.accountUnavailableReason;
  const limitRemaining = balance.keyLimitRemainingUsd;

  return (
    <>
      <div className="col" style={{ gap: 'var(--sp-1)' }}>
        <span className="xsmall" style={{ fontWeight: 650 }}>
          {t.balance.accountTitle}
        </span>
        {remaining != null ? (
          <div className="balance-figures">
            <Figure
              label={t.balance.accountRemaining}
              value={formatBalanceUsd(remaining)}
              tone={`level-${balanceLevel(remaining)}`}
            />
            <Figure label={t.balance.accountTotal} value={formatBalanceUsd(balance.accountTotalCreditsUsd)} />
            <Figure label={t.balance.accountUsed} value={formatBalanceUsd(balance.accountTotalUsageUsd)} />
          </div>
        ) : reason === 'management_key_rejected' ? (
          <div className="callout callout-danger">{t.balance.accountKeyRejected(provider.label)}</div>
        ) : reason === 'error' ? (
          <div className="callout callout-warn">{t.balance.accountError}</div>
        ) : (
          <div className="callout callout-info">{t.balance.accountNeedsKey}</div>
        )}
      </div>

      <div className="col" style={{ gap: 'var(--sp-1)' }}>
        <span className="row xsmall" style={{ fontWeight: 650 }}>
          {t.balance.keyTitle}
          {balance.isFreeTier && <span className="chip">{t.balance.freeTier}</span>}
        </span>
        <div className="balance-figures">
          <Figure label={t.balance.keyToday} value={formatBalanceUsd(balance.keyUsageDailyUsd)} />
          <Figure label={t.balance.keyWeek} value={formatBalanceUsd(balance.keyUsageWeeklyUsd)} />
          <Figure label={t.balance.keyMonth} value={formatBalanceUsd(balance.keyUsageMonthlyUsd)} />
          <Figure label={t.balance.keyTotal} value={formatBalanceUsd(balance.keyUsageUsd)} />
          <Figure
            label={t.balance.keyLimit}
            value={
              balance.keyLimitUsd != null
                ? `${formatBalanceUsd(balance.keyLimitUsd)} · ${t.balance.limitReset(balance.keyLimitReset)}`
                : t.balance.keyNoLimit
            }
          />
          {limitRemaining != null && (
            <Figure
              label={t.balance.keyLimitLeft}
              value={formatBalanceUsd(limitRemaining)}
              tone={`level-${balanceLevel(limitRemaining)}`}
            />
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Необов'язковий management-ключ. Подаємо чесно: він може керувати API-ключами
 * користувача, тож пояснення поруч із полем — не дрібний шрифт, а суть рішення.
 */
function ManagementKeyForm({ provider, rejected }: { provider: ProviderStatus; rejected: boolean }) {
  const t = useT();
  const [key, setKey] = useState('');
  const save = useSetManagementKey();
  const clear = useClearManagementKey();
  const configured = provider.managementKeyConfigured === true;
  const createUrl = providerLinks(provider.id).managementKeys;

  return (
    <div className="col" style={{ gap: 'var(--sp-1)' }}>
      <span className="row xsmall" style={{ fontWeight: 650 }}>
        {t.balance.managementKeyLabel}
        {configured && (
          <span className={rejected ? 'badge badge-s-critical' : 'badge badge-verified'}>
            {t.balance.managementKeySaved}
          </span>
        )}
      </span>
      <div className="row wrap">
        <input
          className="input"
          style={{ maxWidth: 300 }}
          type="password"
          autoComplete="off"
          aria-label={t.balance.managementKeyLabel}
          placeholder={configured ? t.balance.managementKeyNewPlaceholder : t.balance.managementKeyPlaceholder}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <button
          type="button"
          className="btn"
          disabled={key.trim() === '' || save.isPending}
          onClick={() =>
            save.mutate(
              { providerId: provider.id, key: key.trim() },
              {
                onSuccess: () => {
                  setKey('');
                  toast('info', t.balance.managementKeySavedToast);
                },
                onError: (error) => toast('error', error.message),
              },
            )
          }
        >
          {t.balance.managementKeySave}
        </button>
        {configured && (
          <button
            type="button"
            className="btn btn-danger"
            disabled={clear.isPending}
            onClick={() => clear.mutate(provider.id, { onError: (error) => toast('error', error.message) })}
          >
            {t.balance.managementKeyRemove}
          </button>
        )}
        {createUrl && (
          <a href={createUrl} target="_blank" rel="noreferrer noopener" className="xsmall">
            {t.balance.managementKeyCreate} ↗
          </a>
        )}
      </div>
      <span className="field-hint">{t.balance.managementKeyHint}</span>
    </div>
  );
}

// ─── Витрати за даними провайдера ────────────────────────────────────────────

/**
 * Поруч із власним обліком застосунку — цифри, які називає сам провайдер.
 * Підписані окремо: вони включають і виклики цим ключем поза застосунком,
 * тож розбіжність із нашим обліком — норма, а не помилка.
 */
export function ReportedSpend() {
  const providers = useProviders();
  const list = balanceProviders(providers.data);
  if (list.length === 0) return null;
  return (
    <>
      {list.map((provider) => (
        <ReportedSpendRow key={provider.id} provider={provider} />
      ))}
    </>
  );
}

function ReportedSpendRow({ provider }: { provider: ProviderStatus }) {
  const t = useT();
  const balance = useProviderBalance(provider.id);
  const data = balance.data;

  return (
    <div className="col" style={{ gap: 'var(--sp-2)' }}>
      <span className="section-title" title={t.settings.spendReportedHint}>
        {t.settings.spendReported(provider.label)}
      </span>
      {!data ? (
        <span className="xsmall dim">
          {balance.isPending
            ? t.common.loading
            : balance.error
              ? t.balance.tipFailed(provider.label, balance.error.message)
              : t.balance.unavailable}
        </span>
      ) : (
        <>
          <div className="spend-totals">
            <div className="spend-total">
              <span className="stat-label">{t.settings.spendToday}</span>
              <span className="spend-total-value">{formatBalanceUsd(data.keyUsageDailyUsd)}</span>
            </div>
            <div className="spend-total">
              <span className="stat-label">{t.settings.spendMonth}</span>
              <span className="spend-total-value">{formatBalanceUsd(data.keyUsageMonthlyUsd)}</span>
            </div>
            <div className="spend-total">
              <span className="stat-label">{t.settings.spendTotal}</span>
              <span className="spend-total-value">{formatBalanceUsd(data.keyUsageUsd)}</span>
            </div>
            {data.accountRemainingUsd != null && (
              <div className="spend-total">
                <span className="stat-label">{t.balance.accountRemaining}</span>
                <span className={`spend-total-value level-${balanceLevel(data.accountRemainingUsd)}`}>
                  {formatBalanceUsd(data.accountRemainingUsd)}
                </span>
              </div>
            )}
          </div>
          <span className="field-hint">
            {t.settings.spendReportedHint}{' '}
            <span className="nowrap" title={formatDateTime(data.fetchedAt)}>
              ({t.balance.fetchedAt(formatRelative(data.fetchedAt))})
            </span>
          </span>
        </>
      )}
    </div>
  );
}
