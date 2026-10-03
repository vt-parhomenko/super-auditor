import { useMemo, useState } from 'react';

import { VERDICTS, type CoverageMatrix, type Verdict } from '@shared/domain';
import { useT, type Messages } from '@renderer/i18n';
import {
  BAR_ORDER,
  barSegments,
  documentCoverage,
  summarizeCell,
  uncoveredSections,
  type CellSummary,
} from '@renderer/lib/coverage';
import { VERDICT_GLYPH, useLabels } from '@renderer/lib/labels';

export interface CoverageSelection {
  sectionNo: string;
  documentVersionId: number;
}

/**
 * Секції × документи (Stage 6). Клік по клітинці — фільтр для списку findings.
 *
 * Клітинка відповідає СЛОВАМИ на питання аудитора — «2 зауваження», «на
 * перевірку», «відповідає», «не охоплено» — а не гліфом найгіршого вердикту з
 * загальною кількістю findings: «◐ 9» користувач читав як «9 часткових», хоча
 * там було 2 зауваження і 7 вимог, про які документ узагалі не говорить.
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
  const labels = useLabels();
  const [hideUncovered, setHideUncovered] = useState(false);

  const cellIndex = useMemo(
    () => new Map(matrix.cells.map((c) => [`${c.sectionNo}::${c.documentVersionId}`, c] as const)),
    [matrix],
  );
  const uncovered = useMemo(() => uncoveredSections(matrix), [matrix]);
  const docStats = useMemo(
    () => new Map(documentCoverage(matrix).map((d) => [d.documentVersionId, d] as const)),
    [matrix],
  );
  const sections = hideUncovered ? matrix.sections.filter((s) => !uncovered.has(s.sectionNo)) : matrix.sections;

  return (
    <>
      <CoverageHowTo />

      {uncovered.size > 0 && (
        <label className="checkbox hm-toggle">
          <input type="checkbox" checked={hideUncovered} onChange={(e) => setHideUncovered(e.target.checked)} />
          <span>{t.heatmap.hideUncovered(uncovered.size)}</span>
        </label>
      )}

      <div className="heatmap-wrap">
        <table className="heatmap">
          <thead>
            <tr>
              <th className="hm-corner" scope="col">
                {t.heatmap.section}
              </th>
              {matrix.documents.map((d) => {
                const stats = docStats.get(d.documentVersionId);
                return (
                  <th key={d.documentVersionId} scope="col" title={`${d.title} · v${d.versionLabel}`}>
                    <div className="truncate hm-doc-title">{d.title}</div>
                    <div className="dim mono xsmall">v{d.versionLabel}</div>
                    {stats && (
                      <div className="hm-doc-sum">
                        <span>{t.heatmap.docCovered(stats.coveredSections, stats.totalSections)}</span>
                        <span className={stats.issues > 0 ? 'hm-doc-issues' : undefined}>
                          {t.heatmap.docIssues(stats.issues)}
                        </span>
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => {
              const sectionLabel = `${section.sectionNo} ${section.sectionTitle ?? ''}`.trim();
              return (
                <tr key={section.sectionNo}>
                  <th scope="row">
                    <span className="hm-sec-no">{section.sectionNo}</span>
                    <span>{section.sectionTitle ?? '—'}</span>
                    <span className="hm-sec-count">{t.heatmap.sectionClauses(section.clauseCount)}</span>
                  </th>
                  {matrix.documents.map((doc) => {
                    const cell = cellIndex.get(`${section.sectionNo}::${doc.documentVersionId}`);
                    const summary = summarizeCell(cell?.counts);
                    const isActive =
                      selected?.sectionNo === section.sectionNo &&
                      selected?.documentVersionId === doc.documentVersionId;
                    const title = cellTooltip(
                      t,
                      labels.verdict,
                      sectionLabel,
                      `${doc.title} v${doc.versionLabel}`,
                      cell?.counts,
                      summary,
                    );
                    const segments = barSegments(cell?.counts);
                    return (
                      <td key={doc.documentVersionId} className="hm-cell">
                        <button
                          type="button"
                          className={`hm-btn t-${summary.tone} ${summary.state === 'empty' ? 'is-empty' : ''} ${isActive ? 'is-active' : ''}`}
                          title={title}
                          aria-label={title}
                          aria-pressed={isActive}
                          disabled={summary.state === 'empty'}
                          onClick={() =>
                            onSelect?.(
                              isActive
                                ? null
                                : { sectionNo: section.sectionNo, documentVersionId: doc.documentVersionId },
                            )
                          }
                        >
                          <span className="hm-primary">{primaryLabel(t, summary)}</span>
                          {summary.state !== 'empty' && (
                            <span className="hm-secondary">{t.heatmap.addressed(summary.addressed, summary.total)}</span>
                          )}
                          {segments.length > 0 && (
                            <span className="hm-bar" aria-hidden="true">
                              {segments.map((s) => (
                                <span key={s.verdict} className={`hm-seg v-${s.verdict}`} style={{ width: `${s.share}%` }} />
                              ))}
                            </span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function primaryLabel(t: Messages, summary: CellSummary): string {
  switch (summary.state) {
    case 'issues':
      return t.heatmap.stateIssues(summary.issues);
    case 'review':
      return t.heatmap.stateReview(summary.review);
    case 'ok':
      return t.heatmap.stateOk;
    case 'notCovered':
      return t.heatmap.stateNotCovered;
    default:
      // Порожніх клітинок буває десятки (прогін ще йде) — повторений текст лише
      // шумить; пояснення лишається в підказці.
      return '—';
  }
}

/** Повна розбивка у підказці: що саме в клітинці і що буде після кліку. */
function cellTooltip(
  t: Messages,
  verdictLabels: Record<Verdict, string>,
  section: string,
  document: string,
  counts: Partial<Record<Verdict, number>> | undefined,
  summary: CellSummary,
): string {
  const lines = [t.heatmap.cellTitle(section, document)];
  for (const verdict of BAR_ORDER) {
    const count = counts?.[verdict] ?? 0;
    if (count > 0) lines.push(t.heatmap.breakdown(verdictLabels[verdict], count));
  }
  if (summary.state === 'notCovered') lines.push(t.heatmap.notCoveredHint);
  if (summary.state !== 'empty') lines.push(t.heatmap.openHint);
  else lines.push(t.heatmap.stateEmpty);
  return lines.join('\n');
}

const HOWTO_KEY = 'sa.coverage.howto';

function readHowToOpen(): boolean {
  try {
    return localStorage.getItem(HOWTO_KEY) !== 'closed';
  } catch {
    return true;
  }
}

/**
 * Пояснення над матрицею. Відкрите за замовчуванням: без нього матрицю
 * неправильно читають саме ті, хто бачить її вперше; згорнуте — пам'ятаємо.
 */
function CoverageHowTo() {
  const t = useT();
  const labels = useLabels();
  const [open, setOpen] = useState(readHowToOpen);

  return (
    <details
      className="hm-howto"
      open={open}
      onToggle={(e) => {
        const next = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(next);
        try {
          localStorage.setItem(HOWTO_KEY, next ? 'open' : 'closed');
        } catch {
          /* не критично */
        }
      }}
    >
      <summary>{t.heatmap.howToTitle}</summary>
      <ul>
        <li>{t.heatmap.howToRows}</li>
        <li>{t.heatmap.howToStates}</li>
        <li>{t.heatmap.howToNotCovered}</li>
        <li>{t.heatmap.howToSecond}</li>
      </ul>
      <div className="hm-legend">
        <span className="dim">{t.heatmap.legendTitle}</span>
        {BAR_ORDER.map((v) => (
          <span key={v} className="hm-legend-item">
            <span className={`hm-seg-swatch v-${v}`} aria-hidden="true" />
            {labels.verdict[v]}
          </span>
        ))}
      </div>
    </details>
  );
}

/** Легенда вердиктів (колір + гліф + назва) — для підсумку прогону. */
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
