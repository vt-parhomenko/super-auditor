import type { UsageTotals } from '@shared/domain';
import { useT } from '@renderer/i18n';
import { formatCost, formatPercent, formatTokens } from '@renderer/lib/format';

export function ProgressBar({
  value,
  max,
  tone = 'accent',
  label,
  right,
  indeterminate = false,
}: {
  value: number;
  max: number;
  tone?: 'accent' | 'ok' | 'warn' | 'danger';
  label?: string;
  right?: string;
  indeterminate?: boolean;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div>
      <div
        className={`progress tone-${tone} ${indeterminate ? 'indeterminate' : ''}`}
        role="progressbar"
        aria-valuenow={indeterminate ? undefined : value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
      >
        <div className="progress-bar" style={indeterminate ? undefined : { width: `${pct}%` }} />
      </div>
      {(label || right) && (
        <div className="progress-meta">
          <span>{label}</span>
          <span className="tabnum">{right ?? (indeterminate ? '' : formatPercent(value, max))}</span>
        </div>
      )}
    </div>
  );
}

/** Вартість завжди на виду: прогін на 183 вимоги × 10 документів коштує реальних грошей. */
export function CostMeter({ usage, compact = false }: { usage: UsageTotals; compact?: boolean }) {
  const t = useT();
  const cacheShare =
    usage.inputTokens > 0 ? Math.round((usage.cachedTokens / usage.inputTokens) * 100) : 0;
  return (
    <span
      className="cost"
      title={t.meters.costTitle(
        formatTokens(usage.inputTokens),
        formatTokens(usage.cachedTokens),
        cacheShare,
        formatTokens(usage.outputTokens),
      )}
    >
      <span className="cost-value">{formatCost(usage.costUsd)}</span>
      {!compact && (
        <span className="cost-tokens">
          {formatTokens(usage.inputTokens)} {t.meters.inShort} · {t.meters.cacheShare(cacheShare)} ·{' '}
          {formatTokens(usage.outputTokens)} {t.meters.outShort}
        </span>
      )}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${tone ?? ''}`}>{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}
