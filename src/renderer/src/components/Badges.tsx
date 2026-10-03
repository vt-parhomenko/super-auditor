import type {
  ClauseReviewStatus,
  EvidenceSource,
  MarkerLegendItem,
  RunStatus,
  Severity,
  Verdict,
} from '@shared/domain';
import { useT } from '@renderer/i18n';
import { VERDICT_GLYPH, useLabels } from '@renderer/lib/labels';
import { markerTitle } from '@renderer/lib/markers';

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

/**
 * `potential` — критичність, яку модель ставить і вимогам «не розглянуто»
 * («наскільки погано, якби цього не було ніде»). Це не зауваження до документа,
 * тому бейдж приглушений, а title пояснює, чому.
 */
export function SeverityBadge({
  severity,
  short = false,
  potential = false,
}: {
  severity: Severity | null;
  short?: boolean;
  potential?: boolean;
}) {
  const t = useT();
  const labels = useLabels();
  if (!severity) return <span className="dim">—</span>;
  const badge = (
    <span
      className={`badge badge-s-${severity}`}
      title={potential ? t.findings.potentialSeverity(labels.severity[severity]) : labels.severity[severity]}
    >
      {short ? labels.severityShort[severity] : labels.severity[severity]}
    </span>
  );
  return potential ? <span className="severity-potential">{badge}</span> : badge;
}

/**
 * Позначки стандарту біля вимоги — лише ті, що стандарт справді надрукував
 * (P / R / O у Tesco, «Major Must» у GlobalG.A.P.). Немає позначок — нічого
 * не малюємо. Підказка — назва й пояснення з легенди самого стандарту.
 */
export function MarkerBadges({
  markers,
  legend,
}: {
  markers: readonly string[];
  legend: readonly MarkerLegendItem[] | null | undefined;
}) {
  if (markers.length === 0) return null;
  return (
    <span className="row marker-badges" style={{ gap: 2 }}>
      {markers.map((code) => {
        const title = markerTitle(code, legend);
        return (
          <span key={code} className="badge badge-marker" title={title} role="img" aria-label={title}>
            {code}
          </span>
        );
      })}
    </span>
  );
}

/** Джерело цитати: Citations API провайдера (вигадати неможливо) чи текст, написаний моделлю. */
export function EvidenceSourceTag({ source }: { source: EvidenceSource }) {
  const t = useT();
  const citations = source === 'citations_api';
  return (
    <span
      className="evidence-source"
      title={citations ? t.findingDetail.sourceCitationsHint : t.findingDetail.sourceModelHint}
    >
      {citations ? t.evidenceViewer.sourceCitations : t.evidenceViewer.sourceModel}
    </span>
  );
}

/**
 * Статус прогону. У title — не назва вдруге, а що він означає і що робити далі
 * («Призупинено — нічого не втрачено…»); `detail` — напр. текст помилки прогону.
 */
export function RunStatusBadge({ status, detail }: { status: RunStatus; detail?: string | null }) {
  const t = useT();
  const labels = useLabels();
  const hint = t.badges.runStatusHint[status];
  return (
    <span className={`badge badge-status st-${status}`} title={detail ? `${hint}\n${detail}` : hint}>
      {labels.runStatus[status]}
    </span>
  );
}

/** Крапка статусу вичитки: колір без підпису, тому назва — і в title, і для скрінрідера. */
export function ReviewStatusDot({ status }: { status: ClauseReviewStatus }) {
  const labels = useLabels();
  return (
    <span
      className={`rs-dot rs-${status}`}
      title={labels.clauseReview[status]}
      role="img"
      aria-label={labels.clauseReview[status]}
    />
  );
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
