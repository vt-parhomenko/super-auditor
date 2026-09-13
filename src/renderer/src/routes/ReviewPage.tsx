import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { SEVERITIES, VERDICTS, type FindingDto, type Severity, type Verdict } from '@shared/domain';
import { SeverityBadge, VerdictBadge, VerifiedBadge } from '@renderer/components/Badges';
import { KeyboardHint, Kbd } from '@renderer/components/KeyboardHint';
import { ProgressBar } from '@renderer/components/Meters';
import { EmptyState, ErrorState, LoadingState } from '@renderer/components/States';
import { useClause } from '@renderer/hooks/useClauses';
import { useFindings, useReviewFinding } from '@renderer/hooks/useFindings';
import { useHotkeys } from '@renderer/hooks/useHotkeys';
import { getMessages, useT } from '@renderer/i18n';
import { formatConfidence } from '@renderer/lib/format';
import { useLabels } from '@renderer/lib/labels';
import { usePageContext } from '@renderer/store/topbar';
import { toast } from '@renderer/store/ui';

/**
 * Клавіатурний режим рев'ю (вимога §13: «людина обробляє сотні findings; миша вб'є UX»).
 *
 * A accept · R reject · E edit · J/K навігація · Space наступний неопрацьований.
 * Хоткеї не спрацьовують у полях вводу — див. useHotkeys.
 *
 * «Reject» не вгадує правильний вердикт за людину: він відкриває швидкий вибір
 * (клавіші 1…6), бо саме різниця AI ↔ людина стає eval-кейсом і має бути точною.
 */
export function ReviewPage() {
  const t = useT();
  const labels = useLabels();
  const params = useParams();
  const runId = Number(params.runId);
  const navigate = useNavigate();

  const findings = useFindings({ runId, limit: 2000, offset: 0 }, Number.isFinite(runId));
  const review = useReviewFinding();

  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<'view' | 'reject' | 'edit'>('view');
  const noteRef = useRef<HTMLTextAreaElement>(null);

  usePageContext([
    { label: t.nav.runs, to: '/runs' },
    { label: t.runs.runTitle(runId), to: `/runs/${runId}/findings` },
    { label: t.review.crumb },
  ]);

  const items = useMemo(() => findings.data?.items ?? [], [findings.data]);
  const current = items[Math.min(cursor, Math.max(0, items.length - 1))];
  const reviewedCount = items.filter((f) => f.review).length;

  useEffect(() => {
    setMode('view');
  }, [current?.id]);

  const move = (delta: number) => {
    if (items.length === 0) return;
    setCursor((c) => Math.min(items.length - 1, Math.max(0, c + delta)));
  };

  const nextUnreviewed = () => {
    if (items.length === 0) return;
    for (let i = cursor + 1; i < items.length; i += 1) {
      if (!items[i]?.review) {
        setCursor(i);
        return;
      }
    }
    for (let i = 0; i <= cursor; i += 1) {
      if (!items[i]?.review) {
        setCursor(i);
        return;
      }
    }
    toast('info', getMessages().review.allReviewed);
  };

  const save = (verdict: Verdict | null, severity: Severity | null, note: string | null, advance = true) => {
    if (!current) return;
    review.mutate(
      { findingId: current.id, humanVerdict: verdict, humanSeverity: severity, note },
      {
        onSuccess: () => {
          setMode('view');
          if (advance) nextUnreviewed();
        },
        onError: (error) => toast('error', error.message),
      },
    );
  };

  const accept = () => current && save(current.verdict, current.severity, null);

  useHotkeys(
    {
      j: () => move(1),
      k: () => move(-1),
      space: nextUnreviewed,
      a: accept,
      r: () => setMode((m) => (m === 'reject' ? 'view' : 'reject')),
      e: () => {
        setMode('edit');
        window.setTimeout(() => noteRef.current?.focus(), 0);
      },
      escape: () => (mode === 'view' ? navigate(`/runs/${runId}/findings`) : setMode('view')),
      ...(mode === 'reject'
        ? Object.fromEntries(
            VERDICTS.map((v, i) => [
              String(i + 1),
              () => current && save(v, current.severity, t.review.rejectNote),
            ]),
          )
        : {}),
    },
    true,
  );

  if (findings.error) return <ErrorState error={findings.error} onRetry={() => void findings.refetch()} />;
  if (findings.isPending) return <LoadingState />;
  if (items.length === 0) {
    return (
      <EmptyState icon="✔" title={t.review.emptyTitle} description={t.review.emptyDesc} />
    );
  }
  if (!current) return <EmptyState title={t.common.empty} />;

  return (
    <div className="review-shell">
      <div className="review-bar">
        <span className="mono" style={{ fontWeight: 700 }}>
          {current.clause.clauseNo}
        </span>
        <span className="truncate" style={{ maxWidth: '32ch' }}>
          {current.clause.topic ?? ''}
        </span>
        <VerdictBadge verdict={current.verdict} />
        <SeverityBadge severity={current.severity} />
        <span className="dim xsmall">{t.review.confidence(formatConfidence(current.confidence))}</span>
        <span className="spacer" />
        <div style={{ minWidth: 200 }}>
          <ProgressBar
            value={reviewedCount}
            max={items.length}
            tone="ok"
            label={t.review.progressLabel(reviewedCount, items.length)}
            right={`${cursor + 1} / ${items.length}`}
          />
        </div>
      </div>

      <div className="review-body">
        <ReviewCard finding={current} />

        {mode === 'reject' && (
          <div className="card card-pad" style={{ marginTop: 'var(--sp-3)', borderColor: 'var(--danger)' }}>
            <div className="section-title" style={{ marginBottom: 'var(--sp-2)' }}>
              {t.review.whichVerdict}
            </div>
            <div className="row wrap">
              {VERDICTS.map((v, i) => (
                <button
                  key={v}
                  type="button"
                  className="btn"
                  onClick={() => save(v, current.severity, t.review.rejectNote)}
                >
                  <Kbd>{i + 1}</Kbd>
                  {labels.verdict[v]}
                </button>
              ))}
              <button type="button" className="btn btn-ghost" onClick={() => setMode('view')}>
                {t.review.cancelEsc}
              </button>
            </div>
          </div>
        )}

        {mode === 'edit' && (
          <EditPanel
            finding={current}
            noteRef={noteRef}
            busy={review.isPending}
            onCancel={() => setMode('view')}
            onSave={(verdict, severity, note) => save(verdict, severity, note)}
          />
        )}
      </div>

      <div className="review-foot row wrap">
        <button type="button" className="btn btn-primary" onClick={accept} disabled={review.isPending}>
          <Kbd>A</Kbd> {t.review.accept}
        </button>
        <button type="button" className="btn btn-danger" onClick={() => setMode('reject')}>
          <Kbd>R</Kbd> {t.review.reject}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setMode('edit');
            window.setTimeout(() => noteRef.current?.focus(), 0);
          }}
        >
          <Kbd>E</Kbd> {t.review.edit}
        </button>
        <span className="spacer" />
        <KeyboardHint
          hints={[
            { keys: ['J', 'K'], label: t.review.hintNav },
            { keys: ['Space'], label: t.review.hintNextUnreviewed },
            { keys: ['Esc'], label: t.review.hintExit },
          ]}
        />
      </div>
    </div>
  );
}

function ReviewCard({ finding }: { finding: FindingDto }) {
  const t = useT();
  const labels = useLabels();
  const clause = useClause(finding.clauseId);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 400px)', gap: 'var(--sp-4)' }}>
      <div>
        <div className="block">
          <div className="block-label">{t.review.requirement}</div>
          <div className="requirement">{clause.data?.requirementText ?? t.common.loading}</div>
        </div>
        <div className="block">
          <div className="block-label">{t.review.modelRationale}</div>
          <p className="pre-wrap">{finding.rationale}</p>
        </div>
        {finding.gap && (
          <div className="block">
            <div className="block-label">{t.review.gap}</div>
            <p className="pre-wrap">{finding.gap}</p>
          </div>
        )}
        {finding.recommendation && (
          <div className="block">
            <div className="block-label">{t.review.recommendation}</div>
            <p className="pre-wrap">{finding.recommendation}</p>
          </div>
        )}
        {finding.review && (
          <div className="callout callout-info">
            {t.review.alreadyReviewed}
            {finding.review.humanVerdict
              ? labels.verdict[finding.review.humanVerdict]
              : t.review.agreedWithModel}
            {finding.review.note ? ` — ${finding.review.note}` : ''}
          </div>
        )}
      </div>

      <div>
        <div className="block-label">{t.review.evidence}</div>
        {finding.evidence.length === 0 ? (
          <div className="callout callout-warn">{t.review.noEvidence}</div>
        ) : (
          finding.evidence.map((e) => (
            <div key={e.id} className="evidence">
              <div className="evidence-head">
                <span className="dim">
                  {t.review.pageShort} {e.pageNo ?? '—'}
                </span>
                <span className="spacer" />
                <VerifiedBadge verified={e.verified} />
              </div>
              <div className="evidence-quote" style={{ cursor: 'default' }}>
                «{e.quote}»
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function EditPanel({
  finding,
  noteRef,
  busy,
  onCancel,
  onSave,
}: {
  finding: FindingDto;
  noteRef: RefObject<HTMLTextAreaElement | null>;
  busy: boolean;
  onCancel: () => void;
  onSave: (verdict: Verdict | null, severity: Severity | null, note: string | null) => void;
}) {
  const t = useT();
  const labels = useLabels();
  const [verdict, setVerdict] = useState<Verdict | ''>(finding.review?.humanVerdict ?? finding.verdict);
  const [severity, setSeverity] = useState<Severity | ''>(finding.review?.humanSeverity ?? finding.severity ?? '');
  const [note, setNote] = useState(finding.review?.note ?? '');

  return (
    <div className="card card-pad" style={{ marginTop: 'var(--sp-3)' }}>
      <div className="editor-grid">
        <label className="field">
          <span className="label">{t.review.fieldVerdict}</span>
          <select className="select" value={verdict} onChange={(e) => setVerdict(e.target.value as Verdict | '')}>
            <option value="">{t.review.agreeWithModel}</option>
            {VERDICTS.map((v) => (
              <option key={v} value={v}>
                {labels.verdict[v]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">{t.review.fieldSeverity}</span>
          <select className="select" value={severity} onChange={(e) => setSeverity(e.target.value as Severity | '')}>
            <option value="">{t.review.asModel}</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {labels.severity[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="field span-2">
          <span className="label">{t.review.fieldNote}</span>
          <textarea
            ref={noteRef}
            className="textarea"
            style={{ minHeight: 70 }}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>
      <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => onSave(verdict === '' ? null : verdict, severity === '' ? null : severity, note.trim() || null)}
        >
          {t.review.saveAndNext}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {t.common.cancel}
        </button>
      </div>
    </div>
  );
}
