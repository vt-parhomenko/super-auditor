import { VERDICTS, type CoverageMatrix, type Verdict } from '@shared/domain';
import { useT } from '@renderer/i18n';
import { VERDICT_GLYPH, useLabels } from '@renderer/lib/labels';

export interface CoverageSelection {
  sectionNo: string;
  documentVersionId: number;
}

/**
 * Секції × документи, колір за найгіршим вердиктом (Stage 6).
 * Клік по клітинці — це фільтр для списку findings, а не декорація.
 */
export function CoverageHeatmap({
  matrix,
  selected,
  onSelect,
}: {
  matrix: CoverageMatrix;
  selected?: CoverageSelection | null;
  onSelect?: (selection: CoverageSelection | null) => void;
}) {
  const t = useT();
  const cellIndex = new Map(
    matrix.cells.map((c) => [`${c.sectionNo}::${c.documentVersionId}`, c] as const),
  );

  return (
    <>
      <div className="heatmap-wrap">
        <table className="heatmap">
          <thead>
            <tr>
              <th className="hm-corner" scope="col">
                {t.heatmap.section}
              </th>
              {matrix.documents.map((d) => (
                <th key={d.documentVersionId} scope="col" title={`${d.title} · v${d.versionLabel}`}>
                  <div className="truncate" style={{ maxWidth: 120 }}>
                    {d.title}
                  </div>
                  <div className="dim mono xsmall">v{d.versionLabel}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.sections.map((section) => (
              <tr key={section.sectionNo}>
                <th scope="row">
                  <span className="hm-sec-no">{section.sectionNo}</span>
                  <span>{section.sectionTitle ?? '—'}</span>
                  <span className="dim xsmall"> · {section.clauseCount}</span>
                </th>
                {matrix.documents.map((doc) => {
                  const cell = cellIndex.get(`${section.sectionNo}::${doc.documentVersionId}`);
                  const isActive =
                    selected?.sectionNo === section.sectionNo &&
                    selected?.documentVersionId === doc.documentVersionId;
                  const verdict: Verdict | null = cell?.worstVerdict ?? null;
                  const total = cell ? Object.values(cell.counts).reduce((a, b) => a + b, 0) : 0;
                  const label = verdict
                    ? t.heatmap.cell(section.sectionNo, doc.title, t.labels.verdict[verdict], total)
                    : t.heatmap.cellEmpty(section.sectionNo, doc.title);
                  return (
                    <td key={doc.documentVersionId} className="hm-cell">
                      <button
                        type="button"
                        className={`hm-btn ${verdict ? `v-${verdict}` : 'is-empty'} ${isActive ? 'is-active' : ''}`}
                        title={label}
                        aria-label={label}
                        aria-pressed={isActive}
                        onClick={() =>
                          onSelect?.(
                            isActive
                              ? null
                              : { sectionNo: section.sectionNo, documentVersionId: doc.documentVersionId },
                          )
                        }
                      >
                        {verdict ? (
                          <>
                            <span className="hm-glyph" aria-hidden="true">
                              {VERDICT_GLYPH[verdict]}
                            </span>
                            <span>{total}</span>
                          </>
                        ) : (
                          <span aria-hidden="true">·</span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <HeatmapLegend />
    </>
  );
}

export function HeatmapLegend() {
  const labels = useLabels();
  return (
    <div className="heatmap-legend">
      {VERDICTS.map((v) => (
        <span key={v} className="kb-hint">
          <span className={`tree-swatch v-${v}`} aria-hidden="true" />
          <span aria-hidden="true">{VERDICT_GLYPH[v]}</span>
          <span>{labels.verdict[v]}</span>
        </span>
      ))}
    </div>
  );
}
