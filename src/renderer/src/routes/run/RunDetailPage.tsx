import { useState } from 'react';
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';

import { RunStatusBadge } from '@renderer/components/Badges';
import {
  DeleteRunDialog,
  type DeleteRunTarget,
} from '@renderer/components/DeleteRunDialog';
import { CostMeter, ProgressBar } from '@renderer/components/Meters';
import { ErrorState, LoadingState } from '@renderer/components/States';
import { useExportRun, useRun, useRunControls, useRunProgress } from '@renderer/hooks/useRuns';
import { useT } from '@renderer/i18n';
import { formatDateTime, formatDuration } from '@renderer/lib/format';
import { useLabels } from '@renderer/lib/labels';
import { usePageContext } from '@renderer/store/topbar';
import { toast } from '@renderer/store/ui';

export function RunDetailPage() {
  const t = useT();
  const labels = useLabels();
  const params = useParams();
  const runId = Number(params.runId);
  const valid = Number.isFinite(runId);

  const run = useRun(valid ? runId : null);
  const progress = useRunProgress(valid ? runId : null);
  const controls = useRunControls(valid ? runId : null);
  const exportRun = useExportRun();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState<DeleteRunTarget | null>(null);

  const tabs = [
    { to: 'coverage', label: t.runDetail.tabCoverage },
    { to: 'findings', label: t.runDetail.tabFindings },
    { to: 'gaps', label: t.runDetail.tabGaps },
    { to: 'summary', label: t.runDetail.tabSummary },
  ];

  usePageContext([
    { label: t.nav.runs, to: '/runs' },
    { label: run.data?.label ?? t.runs.runTitle(runId) },
  ]);

  if (run.error) return <ErrorState error={run.error} onRetry={() => void run.refetch()} />;
  if (run.isPending) return <LoadingState />;
  if (!run.data) return <ErrorState error={new Error(t.runDetail.notFound(runId))} />;

  const data = run.data;
  const live = progress?.status === 'running' || progress?.status === 'paused';

  return (
    <div className="page" style={{ overflow: 'hidden' }}>
      <div style={{ padding: 'var(--sp-3) var(--sp-5)', borderBottom: '1px solid var(--border)' }}>
        <div className="row wrap" style={{ gap: 'var(--sp-3)' }}>
          <h2 className="truncate" style={{ maxWidth: '46ch' }}>
            {data.label ?? t.runs.runTitle(data.id)}
          </h2>
          <RunStatusBadge status={data.status} />
          <span className="dim xsmall nowrap">
            {formatDateTime(data.startedAt)} · {formatDuration(data.startedAt, data.finishedAt)}
          </span>
          <span className="spacer" />
          <CostMeter usage={progress?.usage ?? data.usage} />
          {data.status === 'running' && (
            <button type="button" className="btn btn-sm" onClick={() => controls.pause.mutate(data.id)}>
              {t.runs.pause}
            </button>
          )}
          {data.status === 'paused' && (
            <button type="button" className="btn btn-sm" onClick={() => controls.resume.mutate(data.id)}>
              {t.runs.resume}
            </button>
          )}
          {(data.status === 'running' || data.status === 'paused' || data.status === 'queued') && (
            <button type="button" className="btn btn-sm btn-danger" onClick={() => controls.cancel.mutate(data.id)}>
              {t.runs.cancel}
            </button>
          )}
          <NavLink to="review" className="btn btn-sm">
            {t.runDetail.reviewMode}
          </NavLink>
          <select
            className="select"
            style={{ width: 130, height: 22, minHeight: 22, fontSize: 'var(--fs-sm)' }}
            defaultValue=""
            onChange={(e) => {
              const format = e.target.value;
              e.currentTarget.value = '';
              if (!format) return;
              exportRun.mutate(
                { runId: data.id, format: format as 'xlsx' | 'markdown' | 'pdf' | 'json' },
                {
                  onSuccess: (result) => toast('info', t.runDetail.exportSaved(result.path)),
                  onError: (error) => toast('error', error.message),
                },
              );
            }}
          >
            <option value="">{t.runDetail.exportPlaceholder}</option>
            <option value="xlsx">XLSX (CAP)</option>
            <option value="markdown">Markdown</option>
            <option value="pdf">PDF</option>
            <option value="json">JSON</option>
          </select>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={() => setDeleting({ runId: data.id, status: data.status })}
          >
            {t.deleteRun.action}
          </button>
        </div>

        {data.error && (
          <div className="callout callout-danger" style={{ marginTop: 'var(--sp-2)' }}>
            {data.error}
          </div>
        )}

        {live && progress && (
          <div style={{ marginTop: 'var(--sp-2)' }}>
            <ProgressBar
              value={progress.tasksDone}
              max={progress.tasksTotal}
              tone={progress.status === 'paused' ? 'warn' : 'accent'}
              label={`${progress.stage ? labels.stage[progress.stage] : t.runs.preparing} · ${progress.currentLabel ?? ''}`}
              right={t.runs.progressRight(progress.tasksDone, progress.tasksTotal, progress.tasksFailed)}
            />
          </div>
        )}
      </div>

      <nav className="tabs">
        {tabs.map((tab) => (
          <NavLink key={tab.to} to={tab.to} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <div className="grow" style={{ overflow: 'auto', minHeight: 0 }}>
        <Outlet />
      </div>

      {deleting && (
        <DeleteRunDialog
          target={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => navigate('/runs', { replace: true })}
        />
      )}
    </div>
  );
}
