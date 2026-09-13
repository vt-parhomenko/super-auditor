import { useState } from 'react';
import { useParams } from 'react-router-dom';

import type { GapItem } from '@shared/domain';
import { SeverityBadge } from '@renderer/components/Badges';
import { ClausePages, PdfModal, type PdfTarget } from '@renderer/components/ClausePages';
import { DataTable, type Column } from '@renderer/components/DataTable';
import { EmptyState, QueryState } from '@renderer/components/States';
import { useRunGaps } from '@renderer/hooks/useRuns';
import { useRunSpecBlobHash } from '@renderer/hooks/useSpecs';
import { useT } from '@renderer/i18n';
import { truncate } from '@renderer/lib/format';
import { useLabels } from '@renderer/lib/labels';

/**
 * Головний вихід продукту: застосовні вимоги, які не покрив жоден документ.
 * Це те, чого людина не помітить у списку findings — тому окрема вкладка.
 */
export function GapsTab() {
  const t = useT();
  const labels = useLabels();
  const params = useParams();
  const runId = Number(params.runId);
  const gaps = useRunGaps(Number.isFinite(runId) ? runId : null);
  const specBlobHash = useRunSpecBlobHash(Number.isFinite(runId) ? runId : null);
  const [pdfTarget, setPdfTarget] = useState<PdfTarget | null>(null);

  const columns: Array<Column<GapItem>> = [
    { key: 'no', header: t.gaps.colClause, width: '82px', render: (g) => <span className="mono">{g.clauseNo}</span> },
    {
      key: 'section',
      header: t.gaps.colSection,
      width: '190px',
      render: (g) => (
        <span className="xsmall">
          <span className="mono dim">{g.sectionNo ?? '—'}</span> {g.sectionTitle ?? ''}
        </span>
      ),
      title: (g) => `${g.sectionNo ?? ''} ${g.sectionTitle ?? ''}`,
    },
    { key: 'topic', header: t.gaps.colTopic, width: '210px', render: (g) => g.topic ?? <span className="dim">—</span> },
    {
      key: 'obligation',
      header: t.gaps.colObligation,
      width: '76px',
      render: (g) =>
        g.obligation ? (
          <span className="chip" title={labels.obligation[g.obligation]}>
            {g.obligation}
          </span>
        ) : (
          <span className="dim">—</span>
        ),
    },
    {
      key: 'pages',
      header: t.gaps.colPages,
      width: '92px',
      render: (g) => (
        <ClausePages
          pageFrom={g.pageFrom}
          pageTo={g.pageTo}
          compact
          onOpen={
            specBlobHash
              ? (pageNo) =>
                  setPdfTarget({
                    blobHash: specBlobHash,
                    pageNo,
                    title: `${g.clauseNo} · ${g.topic ?? ''}`.trim(),
                  })
              : undefined
          }
        />
      ),
    },
    {
      key: 'severity',
      header: t.gaps.colSeverity,
      width: '116px',
      render: (g) => <SeverityBadge severity={g.severityIfMissing} short />,
    },
    {
      key: 'req',
      header: t.gaps.colRequirement,
      render: (g) => <span className="dim">{truncate(g.requirementText.replace(/\s+/g, ' '), 200)}</span>,
      title: (g) => g.requirementText,
    },
  ];

  return (
    <div className="page-pad col" style={{ gap: 'var(--sp-2)', minHeight: 0 }}>
      <QueryState
        isPending={gaps.isPending}
        error={gaps.error}
        data={gaps.data}
        onRetry={() => void gaps.refetch()}
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState icon="✔" title={t.gaps.emptyTitle} description={t.gaps.emptyDesc} />
        }
      >
        {(list) => (
          <>
            <p className="muted small">
              {t.gaps.summaryLead}
              <strong className="tabnum">{list.length}</strong>
              {t.gaps.summaryTail}
            </p>
            <DataTable
              columns={columns}
              rows={list}
              rowKey={(g) => g.clauseId}
              maxHeight="calc(100vh - 300px)"
              ariaLabel={t.gaps.tableLabel}
            />
            <PdfModal target={pdfTarget} onClose={() => setPdfTarget(null)} />
          </>
        )}
      </QueryState>
    </div>
  );
}
