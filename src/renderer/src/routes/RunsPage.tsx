import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { AuditRunDto, RunConfig } from '@shared/domain';
import { RunStatusBadge } from '@renderer/components/Badges';
import { DataTable, type Column } from '@renderer/components/DataTable';
import {
  DeleteRunButton,
  DeleteRunDialog,
  type DeleteRunTarget,
} from '@renderer/components/DeleteRunDialog';
import { CostMeter, ProgressBar } from '@renderer/components/Meters';
import { Modal } from '@renderer/components/Modal';
import { EmptyState, QueryState } from '@renderer/components/States';
import { useDocuments } from '@renderer/hooks/useDocuments';
import { useAnyRunProgress, useEstimateRun, useRunControls, useRuns, useStartRun } from '@renderer/hooks/useRuns';
import { useSites } from '@renderer/hooks/useSites';
import { useSpecs } from '@renderer/hooks/useSpecs';
import { useT } from '@renderer/i18n';
import { formatCost, formatDateTime, formatDuration, formatNumber, formatTokens } from '@renderer/lib/format';
import { useLabels } from '@renderer/lib/labels';
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
    { key: 'status', header: t.runs.colStatus, width: '120px', render: (r) => <RunStatusBadge status={r.status} /> },
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
      width: '104px',
      align: 'right',
      render: (r) => <span className="tabnum xsmall">{formatDuration(r.startedAt, r.finishedAt)}</span>,
    },
    {
      key: 'delete',
      header: '',
      width: '40px',
      render: (r) => (
        <DeleteRunButton runId={r.id} onClick={() => setDeleting({ runId: r.id, status: r.status })} />
      ),
    },
    {
      key: 'cost',
      header: t.runs.colCost,
      width: '92px',
      align: 'right',
      render: (r) => <span className="tabnum">{formatCost(r.usage.costUsd)}</span>,
      title: (r) => `${formatTokens(r.usage.inputTokens)} in / ${formatTokens(r.usage.outputTokens)} out`,
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
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
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

      {creating && <CreateRunModal onClose={() => setCreating(false)} />}
      {deleting && <DeleteRunDialog target={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

// ─── Діалог створення ────────────────────────────────────────────────────────

function CreateRunModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const specs = useSpecs();
  const sites = useSites();
  const documents = useDocuments();
  const estimate = useEstimateRun();
  const start = useStartRun();

  const [label, setLabel] = useState('');
  const [specVersionId, setSpecVersionId] = useState<number | null>(null);
  const [siteProfileId, setSiteProfileId] = useState<number | null>(null);
  const [selectedDocs, setSelectedDocs] = useState<Set<number>>(new Set());
  const [skipCritic, setSkipCritic] = useState(false);

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

  const chosenSpec = specVersions.find((v) => v.id === specVersionId);
  const versionRows = (documents.data ?? []).flatMap((d) =>
    d.versions.map((v) => ({ id: v.id, title: d.title, docNumber: d.docNumber, versionLabel: v.versionLabel })),
  );

  const config: RunConfig | null =
    specVersionId == null || selectedDocs.size === 0
      ? null
      : {
          ...(label.trim() ? { label: label.trim() } : {}),
          specVersionId,
          siteProfileId,
          documentVersionIds: [...selectedDocs],
          skipCritic,
        };

  const blocked = chosenSpec != null && !chosenSpec.ready;

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
              estimate.mutate(config, { onError: (error) => toast('error', error.message) })
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
          </label>

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
                <span className="mono xsmall dim">v{row.versionLabel}</span>
              </label>
            ))}
          </div>
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

        {estimate.data && (
          <div className="estimate-box">
            <div className="col">
              <span className="stat-label">{t.runs.estimateTasks}</span>
              <span className="stat-value" style={{ fontSize: 'var(--fs-xl)' }}>
                {formatNumber(estimate.data.tasks)}
              </span>
            </div>
            <div className="col">
              <span className="stat-label">{t.runs.estimateInput}</span>
              <span className="stat-value" style={{ fontSize: 'var(--fs-xl)' }}>
                {formatTokens(estimate.data.inputTokens)}
              </span>
            </div>
            <div className="col">
              <span className="stat-label">{t.runs.estimateCost}</span>
              <span className="stat-value" style={{ fontSize: 'var(--fs-xl)' }}>
                {formatCost(estimate.data.costUsd)}
              </span>
              <span className="stat-sub">{t.runs.estimateCostSub}</span>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
