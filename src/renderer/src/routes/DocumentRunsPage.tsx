import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type { DocumentRunStats } from '@shared/domain';
import { RunStatusBadge } from '@renderer/components/Badges';
import { DeleteLibraryButton, DeleteLibraryDialog } from '@renderer/components/DeleteLibraryDialog';
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
import { documentDisplayName } from '@renderer/lib/libraryDeletion';
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
  // Видалення самого документа: вікно саме поверне в бібліотеку, коли сторінки не стане.
  const [deletingDocument, setDeletingDocument] = useState(false);

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
      hint: t.runStats.relevantHint,
      width: '118px',
      align: 'right',
      render: (r) => (
        <span className="tabnum">
          {r.relevant}
          <span className="dim"> / {r.assessed}</span>
        </span>
      ),
      title: (r) => t.runStats.relevantSub(formatPercent(r.relevant, r.assessed)),
    },
    {
      key: 'issues',
      header: t.docRuns.colIssues,
      hint: t.runStats.issuesHint,
      width: '220px',
      render: (r) => <SeverityChips counts={r.severityCounts} />,
    },
    // Та сама форма «N / з оцінених», що й «Покриває»: «10% (3)» читалося як загадка.
    {
      key: 'reviewed',
      header: t.docRuns.colReviewed,
      hint: t.runStats.reviewedHint,
      width: '128px',
      align: 'right',
      render: (r) => (
        <span className="tabnum">
          {r.reviewed}
          <span className="dim"> / {r.assessed}</span>
        </span>
      ),
      title: (r) => t.runStats.reviewedSub(formatPercent(r.reviewed, r.assessed)),
    },
    // Дія — останньою: посеред цифр вона розривала таблицю й обрізалась до «✕ ..».
    {
      key: 'delete',
      header: <span className="sr-only">{t.runs.colActions}</span>,
      width: '44px',
      cellClassName: 'dt-actions',
      render: (r) => (
        <DeleteRunButton runId={r.runId} onClick={() => setDeleting({ runId: r.runId, status: r.status })} />
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
          {doc.data && (
            <DeleteLibraryButton
              title={t.deleteLibrary.actionTitle.document(documentDisplayName(doc.data.title, doc.data.docNumber))}
              onClick={() => setDeletingDocument(true)}
            />
          )}
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
              <Link className="btn btn-primary" to={`/runs?new=1&document=${documentId}`}>
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
      {deletingDocument && valid && (
        <DeleteLibraryDialog
          target={{ kind: 'document', id: documentId }}
          onClose={() => setDeletingDocument(false)}
        />
      )}
    </div>
  );
}
