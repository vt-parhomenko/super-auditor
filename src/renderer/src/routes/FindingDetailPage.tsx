import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type { FindingDto, Severity, Verdict } from '@shared/domain';
import { SEVERITIES, VERDICTS } from '@shared/domain';
import { SeverityBadge, VerdictBadge, VerifiedBadge } from '@renderer/components/Badges';
import { ClausePages, PdfModal, type PdfTarget } from '@renderer/components/ClausePages';
import { EvidenceViewer } from '@renderer/components/EvidenceViewer';
import { KeyboardHint } from '@renderer/components/KeyboardHint';
import { ErrorState, LoadingState } from '@renderer/components/States';
import { useClause } from '@renderer/hooks/useClauses';
import { useClearReview, useFinding, useFindings, useReviewFinding } from '@renderer/hooks/useFindings';
import { useHotkeys } from '@renderer/hooks/useHotkeys';
import { useRunCoverage } from '@renderer/hooks/useRuns';
import { useRunSpecBlobHash } from '@renderer/hooks/useSpecs';
import { getMessages, useT } from '@renderer/i18n';
import { formatConfidence, formatDateTime } from '@renderer/lib/format';
import { useLabels } from '@renderer/lib/labels';
import { usePageContext } from '@renderer/store/topbar';
import { toast } from '@renderer/store/ui';

/**
 * Деталь finding — три панелі за §13:
 * дерево вимог (кольори вердиктів) | вимога + міркування | докази (+ місце під PDF).
 */
export function FindingDetailPage() {
  const t = useT();
  const labels = useLabels();
  const params = useParams();
  const runId = Number(params.runId);
  const findingId = Number(params.findingId);
  const navigate = useNavigate();

  const finding = useFinding(Number.isFinite(findingId) ? findingId : null);
  const clause = useClause(finding.data?.clauseId ?? null);
  const coverage = useRunCoverage(Number.isFinite(runId) ? runId : null);
  const siblings = useFindings({ runId, limit: 2000, offset: 0 }, Number.isFinite(runId));

  const [activeEvidenceId, setActiveEvidenceId] = useState<number | null>(null);
  const [pdfTarget, setPdfTarget] = useState<PdfTarget | null>(null);
  const specBlobHash = useRunSpecBlobHash(Number.isFinite(runId) ? runId : null);

  usePageContext([
    { label: t.nav.runs, to: '/runs' },
    { label: t.runs.runTitle(runId), to: `/runs/${runId}/findings` },
    {
      label: finding.data
        ? t.findingDetail.crumbClause(finding.data.clause.clauseNo)
        : t.findingDetail.crumb,
    },
  ]);

  const items = siblings.data?.items ?? [];
  const index = items.findIndex((f) => f.id === findingId);

  const go = (delta: number) => {
    if (items.length === 0) return;
    const next = Math.min(items.length - 1, Math.max(0, (index < 0 ? 0 : index) + delta));
    const target = items[next];
    if (target && target.id !== findingId) navigate(`/runs/${runId}/findings/${target.id}`);
  };

  useHotkeys({ j: () => go(1), k: () => go(-1), escape: () => navigate(`/runs/${runId}/findings`) });

  if (finding.error) return <ErrorState error={finding.error} onRetry={() => void finding.refetch()} />;
  if (finding.isPending) return <LoadingState />;
  if (!finding.data) return <ErrorState error={new Error(t.findingDetail.notFound(findingId))} />;

  const data = finding.data;
  const activeEvidence =
    data.evidence.find((e) => e.id === activeEvidenceId) ?? data.evidence[0] ?? null;
  const docTitle = (id: number | null) => {
    if (id == null) return t.findingDetail.aggregate;
    const doc = coverage.data?.documents.find((d) => d.documentVersionId === id);
    return doc ? `${doc.title} v${doc.versionLabel}` : `#${id}`;
  };

  return (
    <div className="finding-3">
      <ClauseTreePane runId={runId} items={items} activeId={findingId} />

      <div className="pane">
        <div className="pane-head">
          <span className="mono" style={{ fontWeight: 700 }}>
            {data.clause.clauseNo}
          </span>
          <span className="truncate grow">{data.clause.topic ?? ''}</span>
          <VerdictBadge verdict={data.verdict} />
          <SeverityBadge severity={data.severity} />
        </div>

        <div className="pane-body">
          <div className="block">
            <div className="block-label">{t.findingDetail.requirement}</div>
            {clause.isPending ? (
              <LoadingState rows={3} />
            ) : (
              <div className="requirement">
                {clause.data?.requirementText ?? t.findingDetail.requirementUnavailable}
              </div>
            )}
            <div className="row wrap xsmall dim" style={{ marginTop: 6 }}>
              <span>
                {t.findingDetail.section(data.clause.sectionNo ?? '—', data.clause.sectionTitle ?? '')}
              </span>
              {data.clause.obligation && <span className="chip">{data.clause.obligation}</span>}
              <ClausePages
                pageFrom={data.clause.pageFrom}
                pageTo={data.clause.pageTo}
                onOpen={
                  specBlobHash
                    ? (pageNo) =>
                        setPdfTarget({
                          blobHash: specBlobHash,
                          pageNo,
                          title: `${data.clause.clauseNo} · ${data.clause.topic ?? ''}`.trim(),
                        })
                    : undefined
                }
              />
              <span>{t.findingDetail.document(docTitle(data.documentVersionId))}</span>
              <span>{t.findingDetail.confidence(formatConfidence(data.confidence))}</span>
            </div>
          </div>

          <div className="block">
            <div className="block-label">{t.findingDetail.rationale}</div>
            <p className="pre-wrap">{data.rationale}</p>
          </div>

          {data.gap && (
            <div className="block">
              <div className="block-label">{t.findingDetail.gap}</div>
              <p className="pre-wrap">{data.gap}</p>
            </div>
          )}

          {data.recommendation && (
            <div className="block">
              <div className="block-label">{t.findingDetail.recommendation}</div>
              <p className="pre-wrap">{data.recommendation}</p>
            </div>
          )}

          <ReviewPanel finding={data} />
        </div>

        <div className="pane-foot row wrap">
          <button type="button" className="btn btn-sm" onClick={() => go(-1)} disabled={index <= 0}>
            {t.findingDetail.prev}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => go(1)}
            disabled={index < 0 || index >= items.length - 1}
          >
            {t.findingDetail.next}
          </button>
          <span className="dim xsmall tabnum">
            {t.findingDetail.position(index >= 0 ? String(index + 1) : '—', items.length)}
          </span>
          <span className="spacer" />
          <Link className="btn btn-sm" to={`/runs/${runId}/review`}>
            {t.runDetail.reviewMode}
          </Link>
        </div>
      </div>

      <div className="pane">
        <div className="pane-head">
          <span className="section-title grow">{t.findingDetail.evidence}</span>
          <span className="dim xsmall tabnum">
            {t.findingDetail.verifiedCount(
              data.evidence.filter((e) => e.verified).length,
              data.evidence.length,
            )}
          </span>
        </div>
        <div className="pane-body">
          {data.evidence.length === 0 ? (
            <div className="callout callout-warn">
              {t.findingDetail.noEvidenceLead}
              <strong>{labels.verdict[data.verdict]}</strong>
              {t.findingDetail.noEvidenceTail}
            </div>
          ) : (
            data.evidence.map((e) => (
              <div key={e.id} className={`evidence ${activeEvidence?.id === e.id ? 'is-active' : ''}`}>
                <div className="evidence-head">
                  <span className="dim">
                    {t.findingDetail.pageShort} {e.pageNo ?? '—'}
                  </span>
                  <span className="dim truncate grow">{docTitle(e.documentVersionId)}</span>
                  <VerifiedBadge verified={e.verified} />
                </div>
                <button type="button" className="evidence-quote" onClick={() => setActiveEvidenceId(e.id)}>
                  «{e.quote}»
                </button>
              </div>
            ))
          )}

          <div style={{ marginTop: 'var(--sp-3)' }}>
            <EvidenceViewer
              evidence={activeEvidence}
              documentTitle={activeEvidence ? docTitle(activeEvidence.documentVersionId) : undefined}
            />
          </div>
        </div>
        <div className="pane-foot">
          <KeyboardHint
            hints={[
              { keys: ['J', 'K'], label: t.findingDetail.hintBetween },
              { keys: ['Esc'], label: t.findingDetail.hintBack },
            ]}
          />
        </div>
      </div>

      <PdfModal target={pdfTarget} onClose={() => setPdfTarget(null)} />
    </div>
  );
}

// ─── Ліва панель: дерево вимог ─────────────────────────────────────────────

function ClauseTreePane({
  runId,
  items,
  activeId,
}: {
  runId: number;
  items: FindingDto[];
  activeId: number;
}) {
  const t = useT();
  const labels = useLabels();
  const navigate = useNavigate();

  const grouped = useMemo(() => {
    const map = new Map<string, FindingDto[]>();
    for (const f of items) {
      const key = f.clause.sectionNo ?? '—';
      const list = map.get(key);
      if (list) list.push(f);
      else map.set(key, [f]);
    }
    return [...map.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
  }, [items]);

  return (
    <div className="pane">
      <div className="pane-head">
        <span className="section-title">{t.findingDetail.treeTitle}</span>
        <span className="spacer" />
        <span className="dim xsmall tabnum">{items.length}</span>
      </div>
      <div className="pane-body" style={{ padding: 0 }}>
        <div className="clause-tree">
          {grouped.map(([sectionNo, list]) => (
            <div key={sectionNo}>
              <div className="tree-section">
                {sectionNo} · {list[0]?.clause.sectionTitle ?? ''}
              </div>
              {list.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`tree-item ${f.id === activeId ? 'is-active' : ''}`}
                  onClick={() => navigate(`/runs/${runId}/findings/${f.id}`)}
                  title={`${f.clause.clauseNo} — ${labels.verdict[f.verdict]}`}
                >
                  <span className={`tree-swatch v-${f.verdict}`} aria-hidden="true" />
                  <span className="mono xsmall" style={{ width: 46 }}>
                    {f.clause.clauseNo}
                  </span>
                  <span className="truncate grow xsmall">{f.clause.topic ?? ''}</span>
                  {f.review && <span className="rs-dot rs-confirmed" title={t.findingDetail.reviewedDot} />}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Панель людського рішення ────────────────────────────────────────────────

function ReviewPanel({ finding }: { finding: FindingDto }) {
  const t = useT();
  const labels = useLabels();
  const review = useReviewFinding();
  const clear = useClearReview();
  const [verdict, setVerdict] = useState<Verdict | ''>(finding.review?.humanVerdict ?? '');
  const [severity, setSeverity] = useState<Severity | ''>(finding.review?.humanSeverity ?? '');
  const [note, setNote] = useState(finding.review?.note ?? '');

  return (
    <div className="block card card-pad" style={{ marginTop: 'var(--sp-4)' }}>
      <div className="row-between" style={{ marginBottom: 'var(--sp-2)' }}>
        <span className="section-title">{t.findingDetail.decisionTitle}</span>
        {finding.review && (
          <span className="dim xsmall">
            {t.findingDetail.decisionUpdated(formatDateTime(finding.review.reviewedAt))}
          </span>
        )}
      </div>
      <p className="xsmall dim">{t.findingDetail.decisionNote}</p>
      <div className="editor-grid">
        <label className="field">
          <span className="label">{t.findingDetail.fieldHumanVerdict}</span>
          <select className="select" value={verdict} onChange={(e) => setVerdict(e.target.value as Verdict | '')}>
            <option value="">{t.findingDetail.agreeWithModel}</option>
            {VERDICTS.map((v) => (
              <option key={v} value={v}>
                {labels.verdict[v]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">{t.findingDetail.fieldSeverity}</span>
          <select className="select" value={severity} onChange={(e) => setSeverity(e.target.value as Severity | '')}>
            <option value="">{t.findingDetail.asModel}</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {labels.severity[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="field span-2">
          <span className="label">{t.findingDetail.fieldNote}</span>
          <textarea
            className="textarea"
            style={{ minHeight: 60 }}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>
      <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={review.isPending}
          onClick={() =>
            review.mutate(
              {
                findingId: finding.id,
                humanVerdict: verdict === '' ? null : verdict,
                humanSeverity: severity === '' ? null : severity,
                note: note.trim() || null,
              },
              {
                onSuccess: () => toast('info', getMessages().findingDetail.decisionSaved),
                onError: (error) => toast('error', error.message),
              },
            )
          }
        >
          {t.findingDetail.saveDecision}
        </button>
        {finding.review && (
          <button
            type="button"
            className="btn"
            disabled={clear.isPending}
            onClick={() => clear.mutate(finding.id, { onError: (e) => toast('error', e.message) })}
          >
            {t.findingDetail.clearDecision}
          </button>
        )}
      </div>
    </div>
  );
}
