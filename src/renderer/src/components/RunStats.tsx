import type { ReactNode } from 'react';

import { SEVERITIES, type DocumentRunStats, type Severity } from '@shared/domain';
import { RunStatusBadge } from '@renderer/components/Badges';
import { Labeled } from '@renderer/components/InfoTip';
import { useT } from '@renderer/i18n';
import { formatDateTime, formatPercent } from '@renderer/lib/format';
import { useLabels } from '@renderer/lib/labels';

/**
 * Невідповідності за рівнем критичності.
 *
 * `severityCounts` рахує лише partial / non_compliant — тому нуль тут означає
 * «претензій немає», а не «нічого не перевіряли»: за охоплення відповідає
 * окремий показник `relevant`.
 */
export function SeverityChips({ counts }: { counts: Record<Severity, number> }) {
  const t = useT();
  const labels = useLabels();
  const present = SEVERITIES.filter((s) => (counts[s] ?? 0) > 0);

  if (present.length === 0) {
    return <span className="badge badge-verified">{t.runStats.noIssues}</span>;
  }

  return (
    <span className="row" style={{ gap: 4 }}>
      {present.map((s) => {
        // «MAJ 3» читається лише тим, хто знає скорочення; повна назва — у title й для скрінрідера.
        const full = t.runStats.chipLabel(labels.severity[s], counts[s]);
        return (
          <span key={s} className={`badge badge-s-${s}`} title={full} aria-label={full}>
            {labels.severityShort[s]} {counts[s]}
          </span>
        );
      })}
    </span>
  );
}

/** Три головні числа прогону в розрізі документа. */
export function RunStatsFigures({ stats }: { stats: DocumentRunStats }) {
  const t = useT();
  return (
    <div className="runstats-figures">
      <div className="runstat">
        <Labeled className="runstat-label" label={t.runStats.relevant} hint={t.runStats.relevantHint} />
        <span className="runstat-value tabnum">
          {stats.relevant}
          <span className="runstat-of"> / {stats.assessed}</span>
        </span>
        <span className="runstat-sub">
          {t.runStats.relevantSub(formatPercent(stats.relevant, stats.assessed))}
        </span>
      </div>

      <div className="runstat">
        <Labeled className="runstat-label" label={t.runStats.issues} hint={t.runStats.issuesHint} />
        <span className="runstat-chips">
          <SeverityChips counts={stats.severityCounts} />
        </span>
      </div>

      <div className="runstat">
        <Labeled className="runstat-label" label={t.runStats.reviewed} hint={t.runStats.reviewedHint} />
        <span className="runstat-value tabnum">
          {stats.reviewed}
          <span className="runstat-of"> / {stats.assessed}</span>
        </span>
        <span className="runstat-sub">
          {t.runStats.reviewedSub(formatPercent(stats.reviewed, stats.assessed))}
        </span>
      </div>
    </div>
  );
}

/** Компактне зведення останнього прогону — для картки документа. */
export function LastRunSummary({ stats }: { stats: DocumentRunStats }) {
  const t = useT();
  return (
    <div className="lastrun">
      <div className="row wrap" style={{ gap: 'var(--sp-2)' }}>
        <span className="section-title">{t.runStats.lastRun}</span>
        <RunStatusBadge status={stats.status} />
        <span className="dim xsmall nowrap">{formatDateTime(stats.finishedAt ?? stats.startedAt)}</span>
        <span className="dim xsmall truncate">
          {t.runStats.against(stats.specName, stats.specVersionLabel)}
        </span>
        <span className="dim xsmall nowrap">v{stats.documentVersionLabel}</span>
      </div>
      <RunStatsFigures stats={stats} />
    </div>
  );
}

/** Документ ще не входив у жоден прогін — спокійний стан, а не діра в картці. */
export function NoRunsYet({ action }: { action?: ReactNode }) {
  const t = useT();
  return (
    <div className="lastrun lastrun-empty">
      <span className="dim">{t.runStats.never}</span>
      <span className="xsmall dim">{t.runStats.neverDesc}</span>
      {action}
    </div>
  );
}
