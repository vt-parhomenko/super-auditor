import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type { DocumentRunStats } from '@shared/domain';
import { RunStatusBadge } from '@renderer/components/Badges';
import { DataTable, type Column } from '@renderer/components/DataTable';
import {
  DeleteRunButton,
  DeleteRunDialog,
  type DeleteRunTarget,
} from '@renderer/components/DeleteRunDialog';
import { SeverityChips } from '@renderer/components/RunStats';
import { EmptyState, QueryState } from '@renderer/components/States';
import { useDocument, useDocumentRuns } from '@renderer/hooks/useDocuments';
import { useT } from '@renderer/i18n';
import { formatDateTime, formatPercent } from '@renderer/lib/format';
import { usePageContext } from '@renderer/store/topbar';

/**
 * Прогони одного документа.
 *
 * Перехід звідси веде не в загальну деталь прогону, а одразу у findings,
 * відфільтровані по цій версії документа: інакше користувач, який прийшов
 * із картки конкретного файлу, потрапляв би у список із усіх документів.
 */
export function DocumentRunsPage() {
  const params = useParams();
  const documentId = Number(params.documentId);
  const valid = Number.isFinite(documentId);
  const navigate = useNavigate();
  const t = useT();

  const doc = useDocument(valid ? documentId : null);
  const runs = useDocumentRuns(valid ? documentId : null);
  const [deleting, setDeleting] = useState<DeleteRunTarget | null>(null);

  const docTitle = doc.data?.title ?? '…';
  usePageContext([
    { label: t.nav.library, to: '/library' },
    { label: docTitle, to: '/library' },
    { label: t.docRuns.crumb },
  ]);

  const openFindings = (stats: DocumentRunStats) => {
    const search = new URLSearchParams({ doc: String(stats.documentVersionId) });
    navigate(`/runs/${stats.runId}/findings?${search.toString()}`);
  };

  const columns: Array<Column<DocumentRunStats>> = [
    {
      key: 'run',
      header: t.docRuns.colRun,
      width: '190px',
      render: (r) => (
        <span className="row" style={{ gap: 'var(--sp-2)' }}>
          <span className="mono dim">#{r.runId}</span>
          <span className="truncate">{r.label ?? <span className="dim">{t.docRuns.unnamed}</span>}</span>
        </span>
      ),
      title: (r) => r.label ?? undefined,
    },
    {
      key: 'status',
      header: t.runs.colStatus,
      width: '112px',
      render: (r) => <RunStatusBadge status={r.status} />,
    },
    {
      key: 'spec',
      header: t.docRuns.colSpec,
      render: (r) => t.runStats.against(r.specName, r.specVersionLabel),
      title: (r) => t.runStats.against(r.specName, r.specVersionLabel),
    },
    {
      key: 'version',
      header: t.docRuns.colVersion,
      width: '76px',
      render: (r) => <span className="mono">v{r.documentVersionLabel}</span>,
    },
    {
      key: 'finished',
      header: t.docRuns.colFinished,
      width: '138px',
      render: (r) => (
        <span className="tabnum xsmall">{formatDateTime(r.finishedAt ?? r.startedAt)}</span>
      ),
    },
    {
      key: 'relevant',
      header: t.docRuns.colRelevant,
      width: '110px',
      align: 'right',
      render: (r) => (
        <span className="tabnum" title={t.runStats.relevantHint}>
          {r.relevant}
          <span className="dim"> / {r.assessed}</span>
        </span>
      ),
    },
    {
      key: 'issues',
      header: t.docRuns.colIssues,
      width: '210px',
      render: (r) => <SeverityChips counts={r.severityCounts} />,
    },
    {
      key: 'delete',
      header: '',
      width: '40px',
      render: (r) => (
        <DeleteRunButton runId={r.runId} onClick={() => setDeleting({ runId: r.runId, status: r.status })} />
      ),
    },
    {
      key: 'reviewed',
      header: t.docRuns.colReviewed,
      width: '108px',
      align: 'right',
      render: (r) => (
        <span className="tabnum">
          {formatPercent(r.reviewed, r.assessed)}
          <span className="dim"> ({r.reviewed})</span>
        </span>
      ),
    },
  ];

  return (
    <div className="page page-pad">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="truncate">{t.docRuns.title(docTitle)}</h1>
          <p className="muted small">{t.docRuns.subtitle}</p>
        </div>
        <div className="page-head-actions">
          <Link className="btn" to="/library">
            {t.docRuns.toLibrary}
          </Link>
        </div>
      </div>

      <QueryState
        isPending={runs.isPending}
        error={runs.error}
        data={runs.data}
        onRetry={() => void runs.refetch()}
        isEmpty={(list) => list.length === 0}
        empty={
          <EmptyState
            icon="▶"
            title={t.docRuns.emptyTitle}
            description={t.docRuns.emptyDesc}
            action={
              <Link className="btn btn-primary" to="/runs">
                {t.docRuns.startRun}
              </Link>
            }
          />
        }
      >
        {(list) => (
          <DataTable
            columns={columns}
            rows={list}
            rowKey={(r) => `${r.runId}-${r.documentVersionId}`}
            onRowClick={openFindings}
            ariaLabel={t.docRuns.crumb}
          />
        )}
      </QueryState>

      {deleting && <DeleteRunDialog target={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}
