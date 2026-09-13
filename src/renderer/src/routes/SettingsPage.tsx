import { useState } from 'react';

import { STAGES, type SpendByStage, type Stage } from '@shared/domain';
import type { AppSettings, ProviderStatus } from '@shared/ipc';
import { DataTable, type Column } from '@renderer/components/DataTable';
import { EmptyState, QueryState } from '@renderer/components/States';
import {
  useClearApiKey,
  useProviders,
  useSaveSettings,
  useSetApiKey,
  useSettings,
  useSpend,
  useTestProvider,
} from '@renderer/hooks/useSettings';
import { useLocale, useT, type LocalePreference } from '@renderer/i18n';
import { formatCost, formatNumber, formatTokens } from '@renderer/lib/format';
import { useLabels } from '@renderer/lib/labels';
import { usePageContext } from '@renderer/store/topbar';
import { useUiStore, type ThemePreference } from '@renderer/store/ui';
import { toast } from '@renderer/store/ui';

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export function SettingsPage() {
  const t = useT();
  usePageContext([{ label: t.nav.settings }]);

  const settings = useSettings();
  const providers = useProviders();
  const save = useSaveSettings();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const { preference: localePreference, setPreference: setLocalePreference } = useLocale();

  const patch = (updates: Partial<AppSettings>) =>
    save.mutate(updates, { onError: (error) => toast('error', error.message) });

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
          {/* Назви мов лишаються самоназвами — так їх знайде той, хто не читає поточну. */}
          <div className="seg" role="group" aria-label={t.settings.languageGroup}>
            {(
              [
                ['system', t.settings.languageSystem],
                ['en', 'English'],
                ['uk', 'Українська'],
              ] as Array<[LocalePreference, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
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
                <h3>{t.settings.routingTitle}</h3>
                <p className="small muted">{t.settings.routingHint}</p>
                <div className="routing-row" style={{ fontWeight: 700, fontSize: 'var(--fs-xs)', color: 'var(--text-3)', textTransform: 'uppercase' }}>
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
                      value={current.resultsLanguage}
                      onChange={(e) => patch({ resultsLanguage: e.target.value })}
                    >
                      <option value="">{t.settings.resultsLanguageSpec}</option>
                      {RESULTS_LANGUAGES.map((lang) => (
                        <option key={lang.code} value={lang.code}>
                          {lang.label}
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
 * Мови результатів. Самоназви — щоб їх упізнав і той, хто не читає поточну мову
 * інтерфейсу. Порожній код означає «мовою стандарту».
 */
const RESULTS_LANGUAGES: Array<{ code: string; label: string }> = [
  { code: 'uk', label: 'Українська' },
  { code: 'en', label: 'English' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'pl', label: 'Polski' },
  { code: 'it', label: 'Italiano' },
];

const ANTHROPIC_BILLING = 'https://console.anthropic.com/settings/billing';

/**
 * Витрати застосунку.
 *
 * Свідомо НЕ називається балансом: у Anthropic немає ендпоінта залишку коштів,
 * тож це лише наш власний облік викликів. Справжній залишок — у консолі, куди
 * веде посилання нижче (зовнішні URL відкриває setWindowOpenHandler у main).
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

      <div className="callout">
        <div>{t.settings.spendBalanceNote}</div>
        <a
          href={ANTHROPIC_BILLING}
          target="_blank"
          rel="noreferrer noopener"
          className="btn btn-sm"
          style={{ marginTop: 'var(--sp-2)' }}
        >
          {t.settings.spendOpenConsole} ↗
        </a>
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
  const t = useT();
  const labels = useLabels();
  const entry = settings.routing[stage];
  const providerId = entry?.provider ?? providers[0]?.id ?? '';
  const provider = providers.find((p) => p.id === providerId);
  const models = provider?.models ?? [];

  const update = (patch: Partial<{ provider: string; model: string; effort: string }>) => {
    const next: AppSettings['routing'] = {
      ...settings.routing,
      [stage]: {
        provider: patch.provider ?? providerId,
        model: patch.model ?? entry?.model ?? models[0] ?? '',
        ...(patch.effort !== undefined
          ? patch.effort
            ? { effort: patch.effort }
            : {}
          : entry?.effort
            ? { effort: entry.effort }
            : {}),
      },
    };
    onChange(next);
  };

  return (
    <div className="routing-row">
      <span title={labels.stageHint[stage]}>
        <span style={{ fontWeight: 600 }}>{labels.stage[stage]}</span>
      </span>
      <select className="select" value={providerId} onChange={(e) => update({ provider: e.target.value, model: '' })}>
        {providers.length === 0 && <option value="">{t.settings.providerNone}</option>}
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
            {p.cloud ? t.settings.providerCloud : t.settings.providerLocal}
          </option>
        ))}
      </select>
      <select className="select mono" value={entry?.model ?? ''} onChange={(e) => update({ model: e.target.value })}>
        <option value="">{t.settings.modelDefault}</option>
        {models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      <select className="select" value={entry?.effort ?? ''} onChange={(e) => update({ effort: e.target.value })}>
        <option value="">—</option>
        {EFFORTS.map((e) => (
          <option key={e} value={e}>
            {e}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Ключ лише відправляється: контракт не має каналу для читання його назад. */
function ProviderCard({ provider }: { provider: ProviderStatus }) {
  const t = useT();
  const [key, setKey] = useState('');
  const setApiKey = useSetApiKey();
  const clearApiKey = useClearApiKey();
  const test = useTestProvider();

  return (
    <div className="provider-row">
      <div className="col" style={{ gap: 'var(--sp-2)' }}>
        <div className="row wrap">
          <strong>{provider.label}</strong>
          <span className="chip">{provider.cloud ? t.settings.chipCloud : t.settings.chipLocal}</span>
          <span className={provider.configured ? 'badge badge-verified' : 'badge badge-status'}>
            {provider.configured ? t.settings.keySaved : t.settings.keyMissing}
          </span>
          {provider.error && <span className="badge badge-s-critical">{provider.error}</span>}
        </div>
        <div className="xsmall dim mono truncate">
          {provider.models.join(' · ') || t.settings.modelsUnknown}
        </div>
        <div className="row wrap">
          <input
            className="input"
            style={{ maxWidth: 300 }}
            type="password"
            autoComplete="off"
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
        <span className="field-hint">{t.settings.keyHint}</span>
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
      </div>
    </div>
  );
}
