import { useParams } from 'react-router-dom';

import { SEVERITIES, VERDICTS } from '@shared/domain';
import { HeatmapLegend } from '@renderer/components/CoverageHeatmap';
import { Labeled } from '@renderer/components/InfoTip';
import { ProgressBar, Stat } from '@renderer/components/Meters';
import { QueryState } from '@renderer/components/States';
import { useRun, useRunSummary } from '@renderer/hooks/useRuns';
import { useT } from '@renderer/i18n';
import { formatCost, formatNumber, formatPercent, formatTokens } from '@renderer/lib/format';
import { useLabels } from '@renderer/lib/labels';

export function SummaryTab() {
  const t = useT();
  const labels = useLabels();
  const params = useParams();
  const runId = Number(params.runId);
  const summary = useRunSummary(Number.isFinite(runId) ? runId : null);
  // Той самий запит, що й шапка прогону, — з кешу, без зайвого IPC.
  const run = useRun(Number.isFinite(runId) ? runId : null);

  return (
    <div className="page-pad col" style={{ gap: 'var(--sp-4)' }}>
      <QueryState
        isPending={summary.isPending}
        error={summary.error}
        data={summary.data}
        onRetry={() => void summary.refetch()}
      >
        {(s) => {
          const cacheShare =
            s.usage.inputTokens > 0 ? Math.round((s.usage.cachedTokens / s.usage.inputTokens) * 100) : 0;
          return (
            <>
              <section className="col" style={{ gap: 'var(--sp-2)' }}>
                <span className="section-title">{t.summary.coverage}</span>
                <div className="stat-grid">
                  <Stat
                    label={t.summary.clausesApplicable}
                    value={formatNumber(s.clausesApplicable)}
                    sub={t.summary.clausesApplicableSub}
                    hint={t.summary.clausesApplicableHint}
                  />
                  <Stat
                    label={t.summary.assessed}
                    value={formatNumber(s.clausesAssessed)}
                    sub={t.summary.assessedSub(formatPercent(s.clausesAssessed, s.clausesApplicable))}
                    hint={t.summary.assessedHint}
                  />
                  <Stat
                    label={t.summary.gaps}
                    value={formatNumber(s.gaps)}
                    sub={t.summary.gapsSub}
                    tone="v-not_addressed"
                    hint={t.summary.gapsHint}
                  />
                  <Stat
                    label={t.summary.grade}
                    value={s.grade ? s.grade.value : '—'}
                    sub={s.grade?.label ?? t.summary.gradeSub}
                    tone={s.grade && s.grade.value >= 4 ? 'v-compliant' : s.grade && s.grade.value <= 1 ? 'v-non_compliant' : 'v-partial'}
                    hint={t.summary.gradeHint}
                  />
                </div>
              </section>

              <section className="col" style={{ gap: 'var(--sp-2)' }}>
                <Labeled className="section-title" label={t.summary.verdicts} hint={t.summary.verdictsHint} />
                <div className="stat-grid">
                  {VERDICTS.map((v) => (
                    <Stat
                      key={v}
                      label={labels.verdict[v]}
                      value={formatNumber(s.counts[v])}
                      tone={`v-${v}`}
                      // «Не розглянуто» — найчастіше джерело хибної тривоги: пояснюємо, що це не порушення.
                      hint={
                        v === 'not_addressed'
                          ? `${labels.verdictHint[v]} ${t.summary.notAddressedNote}`
                          : labels.verdictHint[v]
                      }
                    />
                  ))}
                </div>
                <HeatmapLegend />
              </section>

              <section className="col" style={{ gap: 'var(--sp-2)' }}>
                <Labeled className="section-title" label={t.summary.severity} hint={t.summary.severityHint} />
                <div className="stat-grid">
                  {SEVERITIES.map((sev) => (
                    <Stat key={sev} label={labels.severity[sev]} value={formatNumber(s.severityCounts[sev])} />
                  ))}
                </div>
              </section>

              <section className="col" style={{ gap: 'var(--sp-2)', maxWidth: 520 }}>
                <span className="section-title">{t.summary.spend}</span>
                <div className="card card-pad col" style={{ gap: 'var(--sp-3)' }}>
                  <div className="row-between">
                    <span>{t.summary.runCost}</span>
                    <strong className="tabnum mono">{formatCost(s.usage.costUsd)}</strong>
                  </div>
                  <ProgressBar
                    value={s.usage.cachedTokens}
                    max={Math.max(1, s.usage.inputTokens)}
                    tone="ok"
                    label={t.summary.cacheLabel}
                    right={`${cacheShare}%`}
                  />
                  <dl className="kv small">
                    <dt>{t.summary.input}</dt>
                    <dd className="tabnum">{formatTokens(s.usage.inputTokens)}</dd>
                    <dt>{t.summary.cached}</dt>
                    <dd className="tabnum">{formatTokens(s.usage.cachedTokens)}</dd>
                    <dt>{t.summary.output}</dt>
                    <dd className="tabnum">{formatTokens(s.usage.outputTokens)}</dd>
                  </dl>
                  <p className="xsmall dim" style={{ margin: 0 }}>
                    {t.summary.cacheNote}
                  </p>
                </div>
              </section>

              {run.data && (
                <section className="col" style={{ gap: 'var(--sp-2)', maxWidth: 520 }}>
                  <span className="section-title">{t.summary.models}</span>
                  <dl className="kv small card card-pad" style={{ margin: 0 }}>
                    <dt>{t.summary.modelJudge}</dt>
                    <dd className="mono">{run.data.modelJudge}</dd>
                    <dt>{t.summary.modelCritic}</dt>
                    <dd className={run.data.modelCritic ? 'mono' : 'dim'}>
                      {run.data.modelCritic ?? t.summary.noCritic}
                    </dd>
                  </dl>
                </section>
              )}
            </>
          );
        }}
      </QueryState>
    </div>
  );
}
