import type { ClauseReviewStatus, Module, RunStatus, Severity, Verdict } from '@shared/domain';
import { useT } from '@renderer/i18n';
import { VERDICT_GLYPH, useLabels } from '@renderer/lib/labels';

/**
 * Вердикт: колір + гліф + текст. Гліф обов'язковий — матриця покриття має
 * читатись при дальтонізмі й у чорно-білому друці.
 */
export function VerdictBadge({
  verdict,
  short = false,
  glyphOnly = false,
}: {
  verdict: Verdict;
  short?: boolean;
  glyphOnly?: boolean;
}) {
  const labels = useLabels();
  return (
    <span
      className={`badge badge-v-${verdict}`}
      title={`${labels.verdict[verdict]} — ${labels.verdictHint[verdict]}`}
    >
      <span className="badge-glyph" aria-hidden="true">
        {VERDICT_GLYPH[verdict]}
      </span>
      {!glyphOnly && <span>{short ? labels.verdictShort[verdict] : labels.verdict[verdict]}</span>}
      {glyphOnly && <span className="sr-only">{labels.verdict[verdict]}</span>}
    </span>
  );
}

export function SeverityBadge({ severity, short = false }: { severity: Severity | null; short?: boolean }) {
  const labels = useLabels();
  if (!severity) return <span className="dim">—</span>;
  return (
    <span className={`badge badge-s-${severity}`} title={labels.severity[severity]}>
      {short ? labels.severityShort[severity] : labels.severity[severity]}
    </span>
  );
}

/** Три позиції P/R/O завжди на місці: увімкнені яскраві, вимкнені приглушені. */
export function ModuleBadges({ modules }: { modules: Module[] }) {
  const t = useT();
  const all: Module[] = ['P', 'R', 'O'];
  return (
    <span className="row" style={{ gap: 2 }}>
      {all.map((m) => {
        const on = modules.includes(m);
        return (
          <span
            key={m}
            className={`badge badge-module ${on ? `on on-${m}` : ''}`}
            title={`${m} — ${t.labels.module[m]}${on ? '' : t.badges.outOfScopeSuffix}`}
          >
            {m}
          </span>
        );
      })}
    </span>
  );
}

export function ModuleBadge({ module, on = true }: { module: Module; on?: boolean }) {
  const labels = useLabels();
  return (
    <span className={`badge badge-module ${on ? `on on-${module}` : ''}`} title={labels.module[module]}>
      {module}
    </span>
  );
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const labels = useLabels();
  return <span className={`badge badge-status st-${status}`}>{labels.runStatus[status]}</span>;
}

export function ReviewStatusDot({ status }: { status: ClauseReviewStatus }) {
  const labels = useLabels();
  return <span className={`rs-dot rs-${status}`} title={labels.clauseReview[status]} />;
}

export function VerifiedBadge({ verified }: { verified: boolean }) {
  const t = useT();
  return (
    <span
      className={`badge ${verified ? 'badge-verified' : 'badge-unverified'}`}
      title={verified ? t.badges.verifiedHint : t.badges.unverifiedHint}
    >
      {verified ? t.badges.verified : t.badges.unverified}
    </span>
  );
}
