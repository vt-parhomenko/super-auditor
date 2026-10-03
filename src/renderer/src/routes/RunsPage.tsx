import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import type { AuditRunDto, RunConfig } from '@shared/domain';
import type { AppSettings, ProviderStatus } from '@shared/ipc';
import { RunStatusBadge } from '@renderer/components/Badges';
import { DataTable, type Column } from '@renderer/components/DataTable';
import { Labeled } from '@renderer/components/InfoTip';
import {
  DeleteRunButton,
  DeleteRunDialog,
  type DeleteRunTarget,
} from '@renderer/components/DeleteRunDialog';
import { CostMeter, ProgressBar } from '@renderer/components/Meters';
import { Modal } from '@renderer/components/Modal';
import { ModelHint, ModelPicker, type ModelChoice } from '@renderer/components/ModelPicker';
import { EmptyState, QueryState } from '@renderer/components/States';
import { useDocuments } from '@renderer/hooks/useDocuments';
import { useAnyRunProgress, useEstimateRun, useRunControls, useRuns, useStartRun } from '@renderer/hooks/useRuns';
import { useProviders, useSettings } from '@renderer/hooks/useSettings';
import { useSites } from '@renderer/hooks/useSites';
import { SITE_PROFILES_ENABLED } from '@renderer/lib/features';
import { useSpecs } from '@renderer/hooks/useSpecs';
import { useT, type Messages } from '@renderer/i18n';
import { formatCost, formatDateTime, formatDuration, formatNumber, formatTokens } from '@renderer/lib/format';
import { useLabels } from '@renderer/lib/labels';
import {
  effectiveRouting,
  choiceWithModel,
  choiceWithProvider,
  findModel,
  toModelRef,
} from '@renderer/lib/models';
import { usePageContext } from '@renderer/store/topbar';
import { toast } from '@renderer/store/ui';

export function RunsPage() {
  const t = useT();
  const labels = useLabels();
  usePageContext([{ label: t.nav.runs }]);

  const navigate = useNavigate();
  const runs = useRuns();
  const progress = useAnyRunProgress();
  const controls = useRunControls(progress?.runId ?? null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<DeleteRunTarget | null>(null);
  /** Документ, з картки якого прийшли: діалог одразу відмічає його найновішу версію. */
  const [preselectDocumentId, setPreselectDocumentId] = useState<number | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // `/runs?new=1&document=7` — «Створити перевірку» з картки документа. Відкриваємо
  // діалог і одразу прибираємо параметри з адреси: інакше «Назад» чи оновлення
  // сторінки відкривали б його знову.
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    const documentId = Number(searchParams.get('document'));
    setPreselectDocumentId(Number.isInteger(documentId) && documentId > 0 ? documentId : null);
    setCreating(true);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const columns: Array<Column<AuditRunDto>> = [
    {
      key: 'id',
      header: '#',
      width: '52px',
      align: 'right',
      render: (r) => <span className="mono">{r.id}</span>,
    },
    {
      key: 'label',
      header: t.runs.colLabel,
      render: (r) => r.label ?? <span className="dim">{t.runs.unnamed}</span>,
      title: (r) => r.label ?? undefined,
    },
    {
      key: 'status',
      header: t.runs.colStatus,
      width: '120px',
      render: (r) => <RunStatusBadge status={r.status} detail={r.error} />,
    },
    {
      key: 'docs',
      header: t.runs.colDocs,
      width: '96px',
      align: 'right',
      render: (r) => <span className="tabnum">{r.documentVersionIds.length}</span>,
    },
    {
      key: 'model',
      header: t.runs.colModel,
      hint: t.runs.colModelHint,
      width: '160px',
      render: (r) => <span className="mono xsmall">{r.modelJudge}</span>,
      title: (r) => t.runs.modelTitle(r.modelJudge, r.modelCritic),
    },
    {
      key: 'started',
      header: t.runs.colStarted,
      width: '134px',
      render: (r) => <span className="tabnum xsmall">{formatDateTime(r.startedAt)}</span>,
    },
    {
      key: 'duration',
      header: t.runs.colDuration,
      hint: t.runs.colDurationHint,
      width: '124px',
      align: 'right',
      render: (r) => <span className="tabnum xsmall">{formatDuration(r.startedAt, r.finishedAt)}</span>,
    },
    {
      key: 'cost',
      header: t.runs.colCost,
      hint: t.runs.colCostHint,
      width: '110px',
      align: 'right',
      render: (r) => <span className="tabnum">{formatCost(r.usage.costUsd)}</span>,
      title: (r) => t.runs.costTitle(formatTokens(r.usage.inputTokens), formatTokens(r.usage.outputTokens)),
    },
    // Дія — останньою колонкою: посеред цифр вона розривала «тривалість → вартість»,
    // а у вузькій колонці кнопка обрізалась до «✕ ..».
    {
      key: 'delete',
      header: <span className="sr-only">{t.runs.colActions}</span>,
      width: '44px',
      cellClassName: 'dt-actions',
      render: (r) => (
        <DeleteRunButton runId={r.id} onClick={() => setDeleting({ runId: r.id, status: r.status })} />
      ),
    },
  ];

  return (
    <div className="page page-pad">
      <div className="page-head">
        <div>
          <h1>{t.runs.title}</h1>
          <p className="muted small">{t.runs.subtitle}</p>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)} data-tour="runs-new">
            {t.runs.newRun}
          </button>
        </div>
      </div>

      {progress && (progress.status === 'running' || progress.status === 'paused') && (
        <div className="run-active" style={{ marginBottom: 'var(--sp-4)' }}>
          <div className="row-between">
            <strong>
              {t.runs.runTitle(progress.runId)} ·{' '}
              {progress.stage ? labels.stage[progress.stage] : t.runs.preparing}
            </strong>
            <CostMeter usage={progress.usage} />
          </div>
          <ProgressBar
            value={progress.tasksDone}
            max={progress.tasksTotal}
            tone={progress.status === 'paused' ? 'warn' : 'accent'}
            label={progress.currentLabel ?? t.runs.running}
            right={t.runs.progressRight(progress.tasksDone, progress.tasksTotal, progress.tasksFailed)}
          />
          <div className="row">
            {progress.status === 'running' ? (
              <button type="button" className="btn btn-sm" onClick={() => controls.pause.mutate(progress.runId)}>
                {t.runs.pause}
              </button>
            ) : (
              <button type="button" className="btn btn-sm" onClick={() => controls.resume.mutate(progress.runId)}>
                {t.runs.resume}
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => controls.cancel.mutate(progress.runId)}
            >
              {t.runs.cancel}
            </button>
            <span className="spacer" />
            <button type="button" className="btn btn-sm" onClick={() => navigate(`/runs/${progress.runId}`)}>
              {t.runs.openDetails}
            </button>
          </div>
        </div>
      )}

      <QueryState
        isPending={runs.isPending}
        error={runs.error}
        data={runs.data}
        onRetry={() => void runs.refetch()}
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState
            icon="▶"
            title={t.runs.emptyTitle}
            description={t.runs.emptyDesc}
            action={
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                {t.runs.emptyAction}
              </button>
            }
          />
        }
      >
        {(list) => (
          <DataTable
            columns={columns}
            rows={list}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/runs/${r.id}`)}
            ariaLabel={t.runs.tableLabel}
          />
        )}
      </QueryState>

      {creating && (
        <CreateRunModal
          preselectDocumentId={preselectDocumentId}
          onClose={() => {
            setCreating(false);
            setPreselectDocumentId(null);
          }}
        />
      )}
      {deleting && <DeleteRunDialog target={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

// ─── Діалог створення ────────────────────────────────────────────────────────

/** Людська назва моделі з каталогу будь-якого провайдера; невідома — сирий id. */
function modelName(modelId: string, providers: readonly ProviderStatus[]): string {
  for (const provider of providers) {
    const info = findModel(provider, modelId);
    if (info?.label && info.label !== modelId) return `${info.label} (${modelId})`;
  }
  return modelId;
}

/** «Claude Opus 5.5 (OpenRouter)» для підказки «як у налаштуваннях». */
function describeChoice(
  t: Messages,
  stage: 'judge' | 'critic',
  entry: AppSettings['routing'][keyof AppSettings['routing']],
  providers: readonly ProviderStatus[],
): string {
  // Те саме, що обере main: збережений вибір або вбудована маршрутизація.
  const effective = effectiveRouting(stage, entry ?? null);
  if (!effective.model) return t.runs.modelOverrideDefault;
  const provider = providers.find((p) => p.id === effective.provider);
  const name = findModel(provider, effective.model)?.label || effective.model;
  return provider ? `${name} (${provider.label})` : name;
}

function CreateRunModal({
  onClose,
  preselectDocumentId = null,
}: {
  onClose: () => void;
  /** Документ, який відмітити одразу (його найновішу версію). */
  preselectDocumentId?: number | null;
}) {
  const t = useT();
  const navigate = useNavigate();
  const specs = useSpecs();
  const sites = useSites();
  const documents = useDocuments();
  const estimate = useEstimateRun();
  const start = useStartRun();

  const settings = useSettings();
  const providers = useProviders();
  const providerList = providers.data ?? [];

  const [label, setLabel] = useState('');
  const [specVersionId, setSpecVersionId] = useState<number | null>(null);
  const [siteProfileId, setSiteProfileId] = useState<number | null>(null);
  const [selectedDocs, setSelectedDocs] = useState<Set<number>>(new Set());
  const [skipCritic, setSkipCritic] = useState(false);
  /** null — «як у налаштуваннях»: маршрутизацію прогону не перевизначаємо. */
  const [override, setOverride] = useState<ModelChoice | null>(null);
  /** Для якої конфігурації пораховано оцінку: стара оцінка після зміни моделі бреше. */
  const [estimatedKey, setEstimatedKey] = useState<string | null>(null);

  /** Перемикання на власну модель стартує з тієї, що вже стоїть для судження. */
  const startOverride = () => {
    // Стартуємо з моделі, якою судження пішло б і без перевизначення.
    const judge = effectiveRouting('judge', settings.data?.routing.judge ?? null);
    const judgeProvider = providerList.find((p) => p.id === judge.provider);
    if (judge.model && judgeProvider) {
      // Через choiceWithModel: збережений effort, якого модель не приймає, відкидається.
      setOverride(choiceWithModel(judge, judgeProvider, judge.model));
      return;
    }
    const preferred = providerList.find((p) => p.configured) ?? providerList[0];
    if (preferred) setOverride(choiceWithProvider(null, providerList, preferred.id));
  };

  const specVersions = useMemo(
    () =>
      (specs.data ?? []).flatMap((s) =>
        s.versions.map((v) => ({
          id: v.id,
          label: `${s.name} · v${v.versionLabel}`,
          ready: v.clausesStatus === 'reviewed',
          clauseCount: v.clauseCount,
          reviewed: v.reviewedClauseCount,
        })),
      ),
    [specs.data],
  );

  useEffect(() => {
    if (specVersionId != null) return;
    const ready = specVersions.find((v) => v.ready) ?? specVersions[0];
    if (ready) setSpecVersionId(ready.id);
  }, [specVersions, specVersionId]);

  // Прийшли з картки документа — відмічаємо його найновішу версію (versions[0]),
  // щойно бібліотека завантажилась. Лише раз: далі вибір за користувачем.
  const preselectApplied = useRef(false);
  useEffect(() => {
    if (preselectApplied.current || preselectDocumentId == null || !documents.data) return;
    preselectApplied.current = true;
    const latest = documents.data.find((d) => d.id === preselectDocumentId)?.versions[0];
    if (latest) setSelectedDocs(new Set([latest.id]));
  }, [documents.data, preselectDocumentId]);

  const chosenSpec = specVersions.find((v) => v.id === specVersionId);
  // versions[0] — найновіша (так їх віддає бібліотека); позначаємо її, бо два рядки
  // з тим самим номером і назвою інакше виглядають як дублікат.
  const versionRows = (documents.data ?? []).flatMap((d) =>
    d.versions.map((v, i) => ({
      id: v.id,
      title: d.title,
      docNumber: d.docNumber,
      versionLabel: v.versionLabel,
      latest: i === 0 && d.versions.length > 1,
    })),
  );

  // Одна модель на судження й критика: людина обирає «чим аналізувати», а не
  // маршрутизацію по етапах — для неї є налаштування.
  const overrideRef = override?.model ? toModelRef(override) : null;
  const overrideIncomplete = override != null && overrideRef == null;

  const config: RunConfig | null =
    specVersionId == null || selectedDocs.size === 0 || overrideIncomplete
      ? null
      : {
          ...(label.trim() ? { label: label.trim() } : {}),
          specVersionId,
          siteProfileId,
          documentVersionIds: [...selectedDocs],
          skipCritic,
          ...(overrideRef ? { routing: { judge: overrideRef, critic: overrideRef } } : {}),
        };
  // Назва прогону на оцінку не впливає — не ховаємо оцінку, поки людина її дописує.
  const configKey = config ? JSON.stringify({ ...config, label: undefined }) : null;
  const estimateData = estimate.data && estimatedKey === configKey ? estimate.data : null;
  const estimateModel = estimateData?.model ?? null;

  const blocked = chosenSpec != null && !chosenSpec.ready;
  const routing = settings.data?.routing;

  return (
    <Modal
      title={t.runs.modalTitle}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!config || estimate.isPending}
            onClick={() =>
              config &&
              estimate.mutate(config, {
                onSuccess: () => setEstimatedKey(configKey),
                onError: (error) => toast('error', error.message),
              })
            }
          >
            {estimate.isPending ? t.runs.estimating : t.runs.estimate}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!config || blocked || start.isPending}
            title={blocked ? t.runs.blockedTitle : undefined}
            onClick={() =>
              config &&
              start.mutate(config, {
                onSuccess: (runId) => {
                  onClose();
                  navigate(`/runs/${runId}`);
                },
                onError: (error) => toast('error', error.message),
              })
            }
          >
            {start.isPending ? t.runs.starting : t.runs.start}
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 'var(--sp-4)' }}>
        <label className="field">
          <span className="label">{t.runs.fieldLabel}</span>
          <input
            className="input"
            value={label}
            placeholder={t.runs.labelPlaceholder}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>

        <div className="editor-grid">
          <label className="field">
            <span className="label">{t.runs.fieldSpecVersion}</span>
            <select
              className="select"
              value={specVersionId ?? ''}
              onChange={(e) => setSpecVersionId(Number(e.target.value) || null)}
            >
              {specVersions.length === 0 && <option value="">{t.runs.noSpecs}</option>}
              {specVersions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} {v.ready ? '✔' : t.runs.specReviewed(v.reviewed, v.clauseCount)}
                </option>
              ))}
            </select>
            {/* Розшифровка «✔» під полем: у самому option довгий текст обрізався. */}
            <span className="field-hint">{t.runs.specReadyHint}</span>
          </label>

          {/* Профілі виробництва тимчасово приховано (див. lib/features.ts): поле не
              показуємо, і перевірка йде без профілю — по всіх вимогах стандарту. */}
          {SITE_PROFILES_ENABLED && (
            <label className="field">
              <span className="label">{t.runs.fieldSite}</span>
              <select
                className="select"
                value={siteProfileId ?? ''}
                onChange={(e) => setSiteProfileId(Number(e.target.value) || null)}
              >
                <option value="">{t.runs.noSite}</option>
                {(sites.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {blocked && <div className="callout callout-warn">{t.runs.blockedCallout}</div>}

        <div className="field">
          <span className="label">{t.runs.fieldDocuments(selectedDocs.size)}</span>
          <div className="picker-list">
            {versionRows.length === 0 && <div className="picker-row dim">{t.runs.libraryEmpty}</div>}
            {versionRows.map((row) => (
              <label key={row.id} className="picker-row">
                <input
                  type="checkbox"
                  checked={selectedDocs.has(row.id)}
                  onChange={(e) =>
                    setSelectedDocs((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(row.id);
                      else next.delete(row.id);
                      return next;
                    })
                  }
                />
                <span className="grow truncate">
                  {row.docNumber && <span className="mono dim">{row.docNumber} · </span>}
                  {row.title}
                </span>
                {row.latest && <span className="chip">{t.runs.latestTag}</span>}
                <span className="mono xsmall dim">v{row.versionLabel}</span>
              </label>
            ))}
          </div>
          <span className="field-hint">{t.runs.documentsHint}</span>
          <div className="row" style={{ marginTop: 4 }}>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setSelectedDocs(new Set(versionRows.map((r) => r.id)))}
            >
              {t.runs.selectAll}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelectedDocs(new Set())}>
              {t.runs.clearSelection}
            </button>
          </div>
        </div>

        <label className="checkbox">
          <input type="checkbox" checked={skipCritic} onChange={(e) => setSkipCritic(e.target.checked)} />
          <span>
            <span style={{ fontWeight: 600 }}>{t.runs.skipCritic}</span>
            <span className="col xsmall dim">{t.runs.skipCriticHint}</span>
          </span>
        </label>

        <div className="field">
          <span className="label">{t.runs.modelOverrideTitle}</span>
          <div className="seg" role="group" aria-label={t.runs.modelOverrideGroup} style={{ alignSelf: 'flex-start' }}>
            <button
              type="button"
              aria-pressed={override == null}
              className={override == null ? 'active' : ''}
              onClick={() => setOverride(null)}
            >
              {t.runs.modelOverrideSettings}
            </button>
            <button
              type="button"
              aria-pressed={override != null}
              className={override != null ? 'active' : ''}
              disabled={providerList.length === 0}
              onClick={() => override == null && startOverride()}
            >
              {t.runs.modelOverrideCustom}
            </button>
          </div>
          {override == null ? (
            <span className="field-hint">
              {t.runs.modelOverrideCurrent(
                describeChoice(t, 'judge', routing?.judge, providerList),
                describeChoice(t, 'critic', routing?.critic, providerList),
              )}
            </span>
          ) : (
            <div className="model-override">
              <div className="model-override-grid">
                <ModelPicker
                  value={override}
                  providers={providerList}
                  onChange={setOverride}
                  label={t.runs.modelOverrideTitle}
                  allowDefault={false}
                />
              </div>
              <ModelHint value={override} providers={providerList} />
              <span className="field-hint">{t.runs.modelOverrideHint}</span>
            </div>
          )}
        </div>

        {estimateData && (
          <div className="estimate-box">
            <div className="col">
              <Labeled className="stat-label" label={t.runs.estimateTasks} hint={t.runs.estimateTasksHint} />
              <span className="stat-value" style={{ fontSize: 'var(--fs-xl)' }}>
                {formatNumber(estimateData.tasks)}
              </span>
            </div>
            <div className="col">
              <Labeled className="stat-label" label={t.runs.estimateInput} hint={t.runs.estimateInputHint} />
              <span className="stat-value" style={{ fontSize: 'var(--fs-xl)' }}>
                {formatTokens(estimateData.inputTokens)}
              </span>
            </div>
            <div className="col">
              <span className="stat-label">{t.runs.estimateCost}</span>
              <span className="stat-value" style={{ fontSize: 'var(--fs-xl)' }}>
                {estimateData.costUsd == null ? t.runs.estimatePriceUnknown : formatCost(estimateData.costUsd)}
              </span>
              <span className="stat-sub">
                {estimateData.costUsd == null ? t.runs.estimatePriceUnknownSub : t.runs.estimateCostSub}
              </span>
            </div>
            {estimateModel && (
              <div className="estimate-model" title={estimateModel}>
                {t.runs.estimateModel(modelName(estimateModel, providerList))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
