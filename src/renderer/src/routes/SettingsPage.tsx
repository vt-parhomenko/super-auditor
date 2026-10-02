import { useState } from 'react';

import { STAGES, isLanguage, type ResultsLanguage, type SpendByStage, type Stage } from '@shared/domain';
import type { AppSettings, ProviderStatus } from '@shared/ipc';
import { BalancePanel, ReportedSpend } from '@renderer/components/Balance';
import { DataTable, type Column } from '@renderer/components/DataTable';
import { ModelHint, ModelPicker } from '@renderer/components/ModelPicker';
import { EmptyState, QueryState } from '@renderer/components/States';
import {
  useClearApiKey,
  useProviders,
  useRefreshModels,
  useSaveSettings,
  useSetApiKey,
  useSettings,
  useSpend,
  useTestProvider,
} from '@renderer/hooks/useSettings';
import { LOCALES, LOCALE_NAMES, useLocale, useT, type LocalePreference } from '@renderer/i18n';
import { formatCost, formatDateTime, formatNumber, formatRelative, formatTokens } from '@renderer/lib/format';
import { useLabels } from '@renderer/lib/labels';
import { ANTHROPIC_BILLING_URL, OPENROUTER_CREDITS_URL, providerLinks } from '@renderer/lib/providerLinks';
import { usePageContext } from '@renderer/store/topbar';
import { useUiStore, type ThemePreference } from '@renderer/store/ui';
import { toast } from '@renderer/store/ui';

/** Збережене значення могло прийти зі старих налаштувань ('de', 'fr'…) — показуємо «мовою стандарту». */
function toResultsLanguage(value: unknown): ResultsLanguage {
  return isLanguage(value) ? value : '';
}

export function SettingsPage() {
  const t = useT();
  usePageContext([{ label: t.nav.settings }]);

  const settings = useSettings();
  const providers = useProviders();
  const save = useSaveSettings();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const { preference: localePreference, setPreference: setLocalePreference } = useLocale();

  const patch = (updates: Partial<AppSettings>, onSuccess?: () => void) =>
    save.mutate(updates, { onSuccess, onError: (error) => toast('error', error.message) });

  // Самоназви мов — так їх знайде той, хто не читає поточну мову інтерфейсу.
  const localeOptions: Array<[LocalePreference, string]> = [
    ['system', t.settings.languageSystem],
    ...LOCALES.map((code): [LocalePreference, string] => [code, LOCALE_NAMES[code]]),
  ];

  return (
    <div className="page page-pad">
      <div className="page-head">
        <div>
          <h1>{t.settings.title}</h1>
          <p className="muted small">{t.settings.subtitle}</p>
        </div>
      </div>

      <div className="settings-grid">
        <section className="card card-pad col" style={{ gap: 'var(--sp-3)' }}>
          <div className="row-between">
            <h3>{t.settings.themeTitle}</h3>
          </div>
          <div className="seg" role="group" aria-label={t.settings.themeGroup}>
            {(
              [
                ['system', t.settings.themeSystem],
                ['light', t.settings.themeLight],
                ['dark', t.settings.themeDark],
              ] as Array<[ThemePreference, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={theme === value}
                className={theme === value ? 'active' : ''}
                onClick={() => {
                  setTheme(value);
                  patch({ theme: value });
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="field-hint">{t.settings.themeHint}</span>
        </section>

        <section className="card card-pad col" style={{ gap: 'var(--sp-3)' }}>
          <div className="row-between">
            <h3>{t.settings.languageTitle}</h3>
          </div>
          <div className="seg" role="group" aria-label={t.settings.languageGroup}>
            {localeOptions.map(([value, label]) => (
              <button
                key={value}
                type="button"
                lang={value === 'system' ? undefined : value}
                aria-pressed={localePreference === value}
                className={localePreference === value ? 'active' : ''}
                onClick={() => setLocalePreference(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="field-hint">{t.settings.languageHint}</span>
        </section>

        <QueryState
          isPending={settings.isPending}
          error={settings.error}
          data={settings.data}
          onRetry={() => void settings.refetch()}
        >
          {(current) => (
            <>
              <section className="card card-pad col" style={{ gap: 'var(--sp-3)' }}>
                <div className="row-between">
                  <h3>{t.settings.routingTitle}</h3>
                  <button
                    type="button"
                    className="btn btn-sm"
                    title={t.settings.routingResetTitle}
                    disabled={Object.keys(current.routing).length === 0 || save.isPending}
                    onClick={() => patch({ routing: {} }, () => toast('info', t.settings.routingResetDone))}
                  >
                    {t.settings.routingReset}
                  </button>
                </div>
                <p className="small muted">{t.settings.routingHint}</p>
                <div className="routing-row routing-head" aria-hidden="true">
                  <span>{t.settings.colStage}</span>
                  <span>{t.settings.colProvider}</span>
                  <span>{t.settings.colModel}</span>
                  <span>{t.settings.colEffort}</span>
                </div>
                {STAGES.map((stage) => (
                  <RoutingRow
                    key={stage}
                    stage={stage}
                    settings={current}
                    providers={providers.data ?? []}
                    onChange={(routing) => patch({ routing })}
                  />
                ))}
              </section>

              <section className="card card-pad col" style={{ gap: 'var(--sp-3)' }}>
                <h3>{t.settings.executionTitle}</h3>
                <div className="editor-grid">
                  <label className="field">
                    <span className="label">{t.settings.fieldConcurrency}</span>
                    <input
                      className="input tabnum"
                      type="number"
                      min={1}
                      max={16}
                      value={current.concurrency}
                      onChange={(e) => patch({ concurrency: Math.max(1, Math.min(16, Number(e.target.value) || 1)) })}
                    />
                    <span className="field-hint">{t.settings.concurrencyHint}</span>
                  </label>
                </div>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={current.localOnly}
                    onChange={(e) => patch({ localOnly: e.target.checked })}
                  />
                  <span>
                    <span style={{ fontWeight: 600 }}>{t.settings.localOnly}</span>
                    <span className="col xsmall dim">{t.settings.localOnlyHint}</span>
                  </span>
                </label>
              </section>

              <section className="card card-pad col" style={{ gap: 'var(--sp-3)' }}>
                <h3>{t.settings.resultsLanguageTitle}</h3>
                <div className="editor-grid">
                  <label className="field">
                    <span className="label">{t.settings.resultsLanguageLabel}</span>
                    <select
                      className="select"
                      value={toResultsLanguage(current.resultsLanguage)}
                      onChange={(e) => patch({ resultsLanguage: toResultsLanguage(e.target.value) })}
                    >
                      <option value="">{t.settings.resultsLanguageSpec}</option>
                      {LOCALES.map((code) => (
                        <option key={code} value={code} lang={code}>
                          {LOCALE_NAMES[code]}
                        </option>
                      ))}
                    </select>
                    <span className="field-hint">{t.settings.resultsLanguageHint}</span>
                  </label>
                </div>
                <div className="callout callout-info">{t.settings.resultsLanguageQuotes}</div>
              </section>

              <SpendSection />
            </>
          )}
        </QueryState>

        <section className="card card-pad col" style={{ gap: 'var(--sp-3)' }}>
          <h3>{t.settings.providersTitle}</h3>
          <QueryState
            isPending={providers.isPending}
            error={providers.error}
            data={providers.data}
            onRetry={() => void providers.refetch()}
          >
            {(list) => (
              <div className="col" style={{ gap: 'var(--sp-2)' }}>
                {list.map((provider) => (
                  <ProviderCard key={provider.id} provider={provider} />
                ))}
              </div>
            )}
          </QueryState>
        </section>
      </div>
    </div>
  );
}

/**
 * Витрати застосунку.
 *
 * Свідомо НЕ називається балансом: це наш власний облік викликів. В Anthropic
 * ендпоінта залишку немає взагалі — справжній залишок лише в консолі. OpenRouter
 * свої цифри віддає сам, і вони йдуть окремим блоком із підписом «за даними
 * провайдера»: включають і виклики тим самим ключем поза застосунком, тож
 * зливати їх із нашим обліком не можна. Зовнішні URL відкриває setWindowOpenHandler у main.
 */
function SpendSection() {
  const t = useT();
  const labels = useLabels();
  const spend = useSpend();

  const stageLabel = (stage: string): string => {
    const known = STAGES.find((s) => s === stage);
    return known ? labels.stage[known] : stage;
  };

  const columns: Array<Column<SpendByStage>> = [
    {
      key: 'stage',
      header: t.settings.spendColStage,
      width: '160px',
      render: (row) => stageLabel(row.stage),
      title: (row) => stageLabel(row.stage),
    },
    {
      key: 'model',
      header: t.settings.spendColModel,
      render: (row) => <span className="mono xsmall">{row.model}</span>,
      title: (row) => row.model,
    },
    {
      key: 'calls',
      header: t.settings.spendColCalls,
      width: '92px',
      align: 'right',
      render: (row) => <span className="tabnum">{formatNumber(row.calls)}</span>,
    },
    {
      key: 'input',
      header: t.settings.spendColInput,
      width: '88px',
      align: 'right',
      render: (row) => <span className="tabnum">{formatTokens(row.inputTokens)}</span>,
    },
    {
      key: 'cached',
      header: t.settings.spendColCached,
      width: '88px',
      align: 'right',
      render: (row) => <span className="tabnum">{formatTokens(row.cachedTokens)}</span>,
    },
    {
      key: 'output',
      header: t.settings.spendColOutput,
      width: '88px',
      align: 'right',
      render: (row) => <span className="tabnum">{formatTokens(row.outputTokens)}</span>,
    },
    {
      key: 'cost',
      header: t.settings.spendColCost,
      width: '92px',
      align: 'right',
      render: (row) => <span className="tabnum mono">{formatCost(row.costUsd)}</span>,
    },
  ];

  return (
    <section className="card card-pad col" style={{ gap: 'var(--sp-3)' }}>
      <div>
        <h3>{t.settings.spendTitle}</h3>
        <p className="muted small" style={{ marginTop: 4, marginBottom: 0 }}>
          {t.settings.spendSubtitle}
        </p>
      </div>

      <QueryState
        isPending={spend.isPending}
        error={spend.error}
        data={spend.data}
        onRetry={() => void spend.refetch()}
      >
        {(data) => (
          <>
            <span className="section-title">{t.settings.spendCounted}</span>
            <div className="spend-totals">
              <div className="spend-total">
                <span className="stat-label">{t.settings.spendToday}</span>
                <span className="spend-total-value">{formatCost(data.today)}</span>
              </div>
              <div className="spend-total">
                <span className="stat-label">{t.settings.spendMonth}</span>
                <span className="spend-total-value">{formatCost(data.month)}</span>
              </div>
              <div className="spend-total">
                <span className="stat-label">{t.settings.spendTotal}</span>
                <span className="spend-total-value">{formatCost(data.total)}</span>
              </div>
            </div>

            {data.byStage.length === 0 ? (
              <EmptyState
                icon="$"
                title={t.settings.spendEmptyTitle}
                description={t.settings.spendEmptyDesc}
              />
            ) : (
              <DataTable
                columns={columns}
                rows={data.byStage}
                rowKey={(row) => `${row.stage}-${row.model}`}
                ariaLabel={t.settings.spendTitle}
              />
            )}
          </>
        )}
      </QueryState>

      <ReportedSpend />

      <div className="callout">
        <div>{t.settings.spendBalanceNote}</div>
        <div className="row wrap" style={{ marginTop: 'var(--sp-2)' }}>
          <a href={ANTHROPIC_BILLING_URL} target="_blank" rel="noreferrer noopener" className="btn btn-sm">
            {t.settings.spendOpenConsole} ↗
          </a>
          <a href={OPENROUTER_CREDITS_URL} target="_blank" rel="noreferrer noopener" className="btn btn-sm">
            {t.settings.spendOpenOpenRouter} ↗
          </a>
        </div>
      </div>
    </section>
  );
}

function RoutingRow({
  stage,
  settings,
  providers,
  onChange,
}: {
  stage: Stage;
  settings: AppSettings;
  providers: ProviderStatus[];
  onChange: (routing: AppSettings['routing']) => void;
}) {
  const labels = useLabels();
  const entry = settings.routing[stage] ?? null;

  return (
    <div className="routing-row">
      <span className="routing-stage" title={labels.stageHint[stage]}>
        {labels.stage[stage]}
      </span>
      <ModelPicker
        value={entry}
        providers={providers}
        label={labels.stage[stage]}
        onChange={(next) => onChange({ ...settings.routing, [stage]: next })}
      />
      <div className="routing-hint">
        <ModelHint value={entry} providers={providers} />
      </div>
    </div>
  );
}

/** Скільки моделей показати в картці, коли кураторського списку немає. */
const CARD_MODELS_FALLBACK = 6;

/** Ключ лише відправляється: контракт не має каналу для читання його назад. */
function ProviderCard({ provider }: { provider: ProviderStatus }) {
  const t = useT();
  const [key, setKey] = useState('');
  const setApiKey = useSetApiKey();
  const clearApiKey = useClearApiKey();
  const test = useTestProvider();
  const refresh = useRefreshModels();
  const links = providerLinks(provider.id);

  // У каталозі OpenRouter ~450 моделей: показуємо куровані, решту — лічильником.
  const recommended = provider.modelInfo.filter((m) => m.recommended);
  const shown = recommended.length > 0 ? recommended : provider.modelInfo.slice(0, CARD_MODELS_FALLBACK);
  const total = provider.modelInfo.length;
  const more = total - shown.length;

  const privacyHint = !provider.cloud
    ? t.settings.localHint
    : provider.id === 'openrouter'
      ? t.settings.cloudHintOpenRouter
      : t.settings.cloudHintDirect(provider.label);

  return (
    <div className="provider-row">
      <div className="col" style={{ gap: 'var(--sp-2)' }}>
        <div className="row wrap">
          <strong>{provider.label}</strong>
          <span className="chip">{provider.cloud ? t.settings.chipCloud : t.settings.chipLocal}</span>
          <span className={provider.configured ? 'badge badge-verified' : 'badge badge-status'}>
            {provider.configured ? t.settings.keySaved : t.settings.keyMissing}
          </span>
          {/* Сирий текст помилки з main показуємо лише для налаштованого провайдера:
              без ключа стан уже сказано бейджем, а англомовне «key is not configured» — шум. */}
          {provider.configured && provider.error && (
            <span className="badge badge-s-critical" title={provider.error}>
              {provider.error}
            </span>
          )}
        </div>

        <div className="xsmall dim provider-models">
          {shown.length === 0
            ? t.settings.modelsUnknown
            : shown.map((m, i) => (
                <span key={m.id} title={m.id}>
                  {i > 0 ? ' · ' : ''}
                  {m.label || m.id}
                </span>
              ))}
          {more > 0 && <span className="nowrap"> · {t.settings.modelsMore(more)}</span>}
        </div>
        <div className="xsmall dim">
          {total > 0 && <>{t.settings.modelsCount(total)} · </>}
          {provider.catalogueUpdatedAt ? (
            <span title={formatDateTime(provider.catalogueUpdatedAt)}>
              {t.settings.catalogueUpdated(formatRelative(provider.catalogueUpdatedAt))}
            </span>
          ) : (
            t.settings.catalogueBuiltIn
          )}
        </div>

        <div className="row wrap">
          <input
            className="input"
            style={{ maxWidth: 300 }}
            type="password"
            autoComplete="off"
            aria-label={`${provider.label}: ${t.settings.keyPlaceholder}`}
            placeholder={provider.configured ? t.settings.newKeyPlaceholder : t.settings.keyPlaceholder}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button
            type="button"
            className="btn"
            disabled={key.trim() === '' || setApiKey.isPending}
            onClick={() =>
              setApiKey.mutate(
                { providerId: provider.id, apiKey: key.trim() },
                {
                  onSuccess: () => setKey(''),
                  onError: (error) => toast('error', error.message),
                },
              )
            }
          >
            {t.settings.saveKey}
          </button>
          {provider.configured && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => clearApiKey.mutate(provider.id, { onError: (e) => toast('error', e.message) })}
            >
              {t.settings.removeKey}
            </button>
          )}
        </div>

        {(links.keys || links.credits || links.billing) && (
          <div className="row wrap xsmall">
            {links.keys && (
              <a href={links.keys} target="_blank" rel="noreferrer noopener">
                {t.settings.linkGetKey} ↗
              </a>
            )}
            {links.credits && (
              <a href={links.credits} target="_blank" rel="noreferrer noopener">
                {t.settings.linkCredits} ↗
              </a>
            )}
            {links.billing && (
              <a href={links.billing} target="_blank" rel="noreferrer noopener">
                {t.settings.linkBilling} ↗
              </a>
            )}
          </div>
        )}

        <span className="field-hint">{t.settings.keyHint}</span>
        <span className="field-hint">{privacyHint}</span>

        {provider.supportsBalance && provider.configured && <BalancePanel provider={provider} />}
      </div>

      <div className="col" style={{ gap: 'var(--sp-2)', alignItems: 'flex-end' }}>
        <button
          type="button"
          className="btn"
          disabled={test.isPending}
          onClick={() =>
            test.mutate(provider.id, {
              onSuccess: (result) => toast(result.ok ? 'info' : 'warn', `${provider.label}: ${result.message}`),
              onError: (error) => toast('error', error.message),
            })
          }
        >
          {test.isPending ? t.settings.testing : t.settings.test}
        </button>
        {test.data && (
          <span className={test.data.ok ? 'badge badge-verified' : 'badge badge-s-major'}>
            {test.data.ok ? t.settings.testOk : t.settings.testFail}
          </span>
        )}
        <button
          type="button"
          className="btn"
          title={t.settings.refreshModelsHint}
          disabled={refresh.isPending}
          onClick={() =>
            refresh.mutate(provider.id, {
              onSuccess: (status) =>
                toast('info', t.settings.refreshModelsDone(status.label, status.modelInfo?.length ?? status.models.length)),
              onError: (error) => toast('error', error.message),
            })
          }
        >
          {refresh.isPending ? t.settings.refreshingModels : t.settings.refreshModels}
        </button>
      </div>
    </div>
  );
}
