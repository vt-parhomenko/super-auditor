import { useNavigate, useParams } from 'react-router-dom';

import { CoverageHeatmap } from '@renderer/components/CoverageHeatmap';
import { EmptyState, QueryState } from '@renderer/components/States';
import { useRunCoverage } from '@renderer/hooks/useRuns';
import { useT } from '@renderer/i18n';

/** Стартовий вигляд аудиту: документи × секції, колір за найгіршим вердиктом. */
export function CoverageTab() {
  const t = useT();
  const params = useParams();
  const runId = Number(params.runId);
  const navigate = useNavigate();
  const coverage = useRunCoverage(Number.isFinite(runId) ? runId : null);

  return (
    <div className="page-pad">
      <QueryState
        isPending={coverage.isPending}
        error={coverage.error}
        data={coverage.data}
        onRetry={() => void coverage.refetch()}
        isEmpty={(m) => m.cells.length === 0}
        empty={
          <EmptyState icon="▦" title={t.coverage.emptyTitle} description={t.coverage.emptyDesc} />
        }
      >
        {(matrix) => (
          <>
            <p className="muted small" style={{ marginBottom: 'var(--sp-3)' }}>
              {t.coverage.hint}
            </p>
            <CoverageHeatmap
              matrix={matrix}
              onSelect={(selection) => {
                if (!selection) return;
                const search = new URLSearchParams({
                  section: selection.sectionNo,
                  doc: String(selection.documentVersionId),
                });
                navigate(`/runs/${runId}/findings?${search.toString()}`);
              }}
            />
          </>
        )}
      </QueryState>
    </div>
  );
}
