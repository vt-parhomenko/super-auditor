import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import {
  MODULES,
  OBLIGATIONS,
  type ClauseDto,
  type ClausePatch,
  type Module,
  type Obligation,
} from '@shared/domain';
import { ModuleBadges, ReviewStatusDot } from '@renderer/components/Badges';
import { ClausePages, PdfModal, type PdfTarget } from '@renderer/components/ClausePages';
import { KeyboardHint } from '@renderer/components/KeyboardHint';
import { ProgressBar } from '@renderer/components/Meters';
import { Modal } from '@renderer/components/Modal';
import { EmptyState, ErrorState, LoadingState } from '@renderer/components/States';
import {
  useClauses,
  useExtractClauses,
  useMarkClausesReviewed,
  usePatchClause,
} from '@renderer/hooks/useClauses';
import { useHotkeys } from '@renderer/hooks/useHotkeys';
import { useIpcEvent } from '@renderer/hooks/useIpcEvent';
import { useSpecSummary, useSpecVersion } from '@renderer/hooks/useSpecs';
import { useT } from '@renderer/i18n';
import { useLabels } from '@renderer/lib/labels';
import { usePageContext } from '@renderer/store/topbar';
import { toast } from '@renderer/store/ui';

type ReviewFilter = 'all' | 'pending' | 'flagged';

interface ExtractProgress {
  page: number;
  pageCount: number;
  clausesFound: number;
  done: boolean;
  error?: string;
}

/**
 * Stage 1 review. Обов'язковий етап: поки реєстр не вичитаний, прогін заблокований.
 * Якщо реєстр кривий, помилку неможливо помітити на етапі findings — тому весь
 * екран побудований навколо швидкої клавіатурної вичитки.
 */
export function ClauseRegistryPage() {
  const t = useT();
  const labels = useLabels();
  const params = useParams();
  const specVersionId = Number(params.specVersionId);

  const version = useSpecVersion(Number.isFinite(specVersionId) ? specVersionId : null);
  const clauses = useClauses(Number.isFinite(specVersionId) ? specVersionId : null);
  const patch = usePatchClause(specVersionId);
  const extract = useExtractClauses();
  const markReviewed = useMarkClausesReviewed(specVersionId);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const [activeId, setActiveId] = useState<number | null>(null);
  const [extractProgress, setExtractProgress] = useState<ExtractProgress | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [pdfTarget, setPdfTarget] = useState<PdfTarget | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  usePageContext([
    { label: t.nav.specs, to: '/specs' },
    { label: t.clauseRegistry.crumb(version.data?.versionLabel ?? '…') },
  ]);

  useIpcEvent('clauses:extractProgress', (payload) => {
    if (payload.specVersionId !== specVersionId) return;
    setExtractProgress({
      page: payload.page,
      pageCount: payload.pageCount,
      clausesFound: payload.clausesFound,
      done: payload.done,
      ...(payload.error ? { error: payload.error } : {}),
    });
    if (payload.done) void clauses.refetch();
  });

  const all = clauses.data ?? [];

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return all.filter((c) => {
      if (filter === 'pending' && c.reviewStatus !== 'auto') return false;
      if (filter === 'flagged' && c.reviewStatus !== 'flagged') return false;
      if (!needle) return true;
      return (
        c.clauseNo.toLowerCase().includes(needle) ||
        (c.topic ?? '').toLowerCase().includes(needle) ||
        (c.sectionTitle ?? '').toLowerCase().includes(needle) ||
        c.requirementText.toLowerCase().includes(needle)
      );
    });
  }, [all, search, filter]);

  // Перше відкриття або зникнення активної вимоги з фільтра
  useEffect(() => {
    if (visible.length === 0) return;
    if (activeId != null && visible.some((c) => c.id === activeId)) return;
    setActiveId(visible[0]?.id ?? null);
  }, [visible, activeId]);

  useEffect(() => {
    if (activeId == null) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-clause-id="${activeId}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  const activeIndex = visible.findIndex((c) => c.id === activeId);
  const active = activeIndex >= 0 ? visible[activeIndex] : undefined;

  const move = (delta: number) => {
    if (visible.length === 0) return;
    const next = Math.min(visible.length - 1, Math.max(0, (activeIndex < 0 ? 0 : activeIndex) + delta));
    setActiveId(visible[next]?.id ?? null);
  };

  const applyStatus = (clause: ClauseDto, reviewStatus: ClausePatch['reviewStatus']) => {
    patch.mutate(
      { clauseId: clause.id, patch: { reviewStatus } },
      { onError: (error) => toast('error', error.message) },
    );
  };

  useHotkeys(
    {
      j: () => move(1),
      k: () => move(-1),
      arrowdown: () => move(1),
      arrowup: () => move(-1),
      enter: () => {
        if (!active) return;
        applyStatus(active, 'confirmed');
        move(1);
      },
      f: () => active && applyStatus(active, 'flagged'),
    },
    Boolean(active),
  );

  const reviewed = all.filter((c) => c.reviewStatus === 'confirmed' || c.reviewStatus === 'edited').length;
  const flagged = all.filter((c) => c.reviewStatus === 'flagged').length;
  const pending = all.filter((c) => c.reviewStatus === 'auto').length;
  const blocked = pending > 0 || flagged > 0;

  if (clauses.error) return <ErrorState error={clauses.error} onRetry={() => void clauses.refetch()} />;

  return (
    <div className="page" style={{ overflow: 'hidden' }}>
      <div className="review-bar">
        <div className="col" style={{ gap: 2, minWidth: 200 }}>
          <span className="section-title">{t.clauseRegistry.reviewTitle}</span>
          <span className="small">
            {version.data ? labels.clausesStatus[version.data.clausesStatus] : t.common.loading}
          </span>
        </div>

        <div className="review-counter" style={{ minWidth: 260, flex: 1, maxWidth: 420 }}>
          <ProgressBar
            value={reviewed}
            max={all.length}
            tone={blocked ? 'warn' : 'ok'}
            label={t.clauseRegistry.progressLabel(reviewed, all.length)}
            right={t.clauseRegistry.progressRight(pending, flagged)}
          />
        </div>

        <span className="spacer" />

        <button type="button" className="btn" onClick={() => setShowSummary(true)}>
          {t.clauseRegistry.summaryBtn}
        </button>
        <button
          type="button"
          className="btn"
          disabled={extract.isPending}
          onClick={() =>
            extract.mutate(specVersionId, {
              onSuccess: () => setExtractProgress({ page: 0, pageCount: 1, clausesFound: 0, done: false }),
              onError: (error) => toast('error', error.message),
            })
          }
        >
          {t.clauseRegistry.extractBtn}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={blocked || all.length === 0 || markReviewed.isPending}
          title={
            blocked
              ? t.clauseRegistry.blockedTitle(pending, flagged)
              : t.clauseRegistry.unlockTitle
          }
          onClick={() =>
            markReviewed.mutate(undefined, {
              onSuccess: () => toast('info', t.clauseRegistry.markedReviewed),
              onError: (error) => toast('error', error.message),
            })
          }
        >
          {t.clauseRegistry.markReviewed}
        </button>
      </div>

      {extractProgress && !extractProgress.done && (
        <div style={{ padding: 'var(--sp-2) var(--sp-4)', borderBottom: '1px solid var(--border)' }}>
          <ProgressBar
            value={extractProgress.page}
            max={extractProgress.pageCount}
            label={t.clauseRegistry.extractProgress(extractProgress.page, extractProgress.pageCount)}
            right={t.clauseRegistry.extractFound(extractProgress.clausesFound)}
          />
        </div>
      )}
      {extractProgress?.error && (
        <div className="callout callout-danger" style={{ margin: 'var(--sp-2) var(--sp-4)' }}>
          {t.clauseRegistry.extractFailed(extractProgress.error)}
        </div>
      )}

      <div className="registry">
        <div className="registry-list">
          <div className="registry-toolbar">
            <input
              className="input"
              placeholder={t.clauseRegistry.searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="row" style={{ gap: 'var(--sp-1)' }}>
              {(
                [
                  ['all', t.clauseRegistry.filterAll(all.length)],
                  ['pending', t.clauseRegistry.filterPending(pending)],
                  ['flagged', t.clauseRegistry.filterFlagged(flagged)],
                ] as Array<[ReviewFilter, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`filter-chip ${filter === value ? 'on' : ''}`}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {clauses.isPending ? (
            <LoadingState rows={12} />
          ) : visible.length === 0 ? (
            <EmptyState
              icon="§"
              title={all.length === 0 ? t.clauseRegistry.emptyRegistry : t.clauseRegistry.emptySearch}
              description={
                all.length === 0
                  ? t.clauseRegistry.emptyRegistryDesc
                  : t.clauseRegistry.emptySearchDesc
              }
            />
          ) : (
            <div className="clause-items" ref={listRef} role="listbox" aria-label={t.clauseRegistry.listLabel}>
              {visible.map((clause) => (
                <div
                  key={clause.id}
                  data-clause-id={clause.id}
                  className={`clause-item ${clause.id === activeId ? 'is-active' : ''}`}
                  onClick={() => setActiveId(clause.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setActiveId(clause.id);
                  }}
                  role="option"
                  tabIndex={-1}
                  aria-selected={clause.id === activeId}
                >
                  <span className="clause-no">{clause.clauseNo}</span>
                  <span className="col" style={{ gap: 0 }}>
                    <span className="clause-topic">{clause.topic ?? clause.requirementText.slice(0, 60)}</span>
                    <span className="xsmall dim truncate">
                      {clause.sectionNo} · {clause.sectionTitle ?? '—'}
                    </span>
                  </span>
                  <span className="clause-flags">
                    <ModuleBadges modules={clause.modules} />
                    <ReviewStatusDot status={clause.reviewStatus} />
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="pane-foot">
            <KeyboardHint
              hints={[
                { keys: ['J', 'K'], label: t.clauseRegistry.hintNav },
                { keys: ['Enter'], label: t.clauseRegistry.hintConfirm },
                { keys: ['F'], label: t.clauseRegistry.hintFlag },
              ]}
            />
          </div>
        </div>

        <div className="registry-editor">
          {active ? (
            <ClauseEditor
              key={active.id}
              clause={active}
              busy={patch.isPending}
              onOpenPdf={
                version.data?.blobHash
                  ? (pageNo) =>
                      setPdfTarget({
                        blobHash: version.data?.blobHash as string,
                        pageNo,
                        title: `${active.clauseNo} · ${active.topic ?? ''}`.trim(),
                      })
                  : undefined
              }
              onPatch={(p) =>
                patch.mutate({ clauseId: active.id, patch: p }, { onError: (e) => toast('error', e.message) })
              }
              onNext={() => move(1)}
            />
          ) : (
            <EmptyState
              title={t.clauseRegistry.pickClause}
              description={t.clauseRegistry.pickClauseDesc}
            />
          )}
        </div>
      </div>

      {showSummary && <SpecSummaryModal specVersionId={specVersionId} onClose={() => setShowSummary(false)} />}
      <PdfModal target={pdfTarget} onClose={() => setPdfTarget(null)} />
    </div>
  );
}

/**
 * Правила градації (розділ «Auditing of Standard») підставляються в промпт судження —
 * без них severity відірвана від шкали реального аудитора.
 */
function SpecSummaryModal({ specVersionId, onClose }: { specVersionId: number; onClose: () => void }) {
  const t = useT();
  const summary = useSpecSummary(specVersionId);

  return (
    <Modal title={t.clauseRegistry.summaryModalTitle} onClose={onClose}>
      {summary.isPending ? (
        <LoadingState rows={5} />
      ) : summary.error ? (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      ) : !summary.data ? (
        <EmptyState
          icon="§"
          title={t.clauseRegistry.summaryEmptyTitle}
          description={t.clauseRegistry.summaryEmptyDesc}
        />
      ) : (
        <div className="col" style={{ gap: 'var(--sp-4)' }}>
          <div className="block">
            <div className="block-label">{t.clauseRegistry.summaryDescription}</div>
            <p className="pre-wrap">{summary.data.summary}</p>
          </div>
          {summary.data.scope && (
            <div className="block">
              <div className="block-label">{t.clauseRegistry.summaryScope}</div>
              <p className="pre-wrap">{summary.data.scope}</p>
            </div>
          )}
          {summary.data.gradingRules && (
            <div className="block">
              <div className="block-label">{t.clauseRegistry.summaryGrading}</div>
              <div className="requirement">{summary.data.gradingRules}</div>
            </div>
          )}
          <div className="xsmall dim">
            {summary.data.model ?? t.clauseRegistry.summaryModelUnknown} ·{' '}
            {summary.data.promptVersion ?? '—'}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── Редактор ────────────────────────────────────────────────────────────────

function ClauseEditor({
  clause,
  busy,
  onPatch,
  onNext,
  onOpenPdf,
}: {
  clause: ClauseDto;
  busy: boolean;
  onPatch: (patch: ClausePatch) => void;
  onNext: () => void;
  onOpenPdf?: ((pageNo: number) => void) | undefined;
}) {
  const t = useT();
  const labels = useLabels();
  const [draft, setDraft] = useState<ClausePatch>({
    clauseNo: clause.clauseNo,
    sectionNo: clause.sectionNo,
    sectionTitle: clause.sectionTitle,
    topic: clause.topic,
    requirementText: clause.requirementText,
    modules: clause.modules,
    obligation: clause.obligation,
  });

  const dirty =
    draft.clauseNo !== clause.clauseNo ||
    (draft.sectionNo ?? null) !== clause.sectionNo ||
    (draft.sectionTitle ?? null) !== clause.sectionTitle ||
    (draft.topic ?? null) !== clause.topic ||
    draft.requirementText !== clause.requirementText ||
    (draft.obligation ?? null) !== clause.obligation ||
    (draft.modules ?? []).join('') !== clause.modules.join('');

  const toggleModule = (m: Module) => {
    const current = draft.modules ?? [];
    const next = current.includes(m) ? current.filter((x) => x !== m) : [...current, m];
    setDraft({ ...draft, modules: MODULES.filter((x) => next.includes(x)) });
  };

  return (
    <div className="col" style={{ minHeight: 0 }}>
      <div className="pane-head">
        <span className="mono" style={{ fontWeight: 700 }}>
          {clause.clauseNo}
        </span>
        <span className="dim truncate grow">{clause.sectionTitle ?? ''}</span>
        <span className="chip">{labels.clauseReview[clause.reviewStatus]}</span>
      </div>

      <div className="pane-body">
        <div className="editor-grid">
          <label className="field">
            <span className="label">{t.clauseRegistry.fieldClauseNo}</span>
            <input
              className="input mono"
              value={draft.clauseNo ?? ''}
              onChange={(e) => setDraft({ ...draft, clauseNo: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="label">{t.clauseRegistry.fieldTopic}</span>
            <input
              className="input"
              value={draft.topic ?? ''}
              onChange={(e) => setDraft({ ...draft, topic: e.target.value || null })}
            />
          </label>
          <label className="field">
            <span className="label">{t.clauseRegistry.fieldSection}</span>
            <input
              className="input mono"
              value={draft.sectionNo ?? ''}
              onChange={(e) => setDraft({ ...draft, sectionNo: e.target.value || null })}
            />
          </label>
          <label className="field">
            <span className="label">{t.clauseRegistry.fieldSectionTitle}</span>
            <input
              className="input"
              value={draft.sectionTitle ?? ''}
              onChange={(e) => setDraft({ ...draft, sectionTitle: e.target.value || null })}
            />
          </label>

          <div className="field">
            <span className="label">{t.clauseRegistry.fieldModules}</span>
            <div className="module-toggle">
              {MODULES.map((m) => {
                const on = (draft.modules ?? []).includes(m);
                return (
                  <label key={m} className={on ? 'on' : ''}>
                    <input type="checkbox" checked={on} onChange={() => toggleModule(m)} />
                    <span className="mono">{m}</span>
                  </label>
                );
              })}
            </div>
            <span className="field-hint">{t.clauseRegistry.modulesHint}</span>
          </div>

          <label className="field">
            <span className="label">{t.clauseRegistry.fieldObligation}</span>
            <select
              className="select"
              value={draft.obligation ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, obligation: (e.target.value || null) as Obligation | null })
              }
            >
              <option value="">{t.clauseRegistry.obligationUnset}</option>
              {OBLIGATIONS.map((o) => (
                <option key={o} value={o}>
                  {labels.obligation[o]}
                </option>
              ))}
            </select>
          </label>

          <label className="field span-2">
            <span className="label">{t.clauseRegistry.fieldRequirement}</span>
            <textarea
              className="textarea"
              style={{ minHeight: 220 }}
              value={draft.requirementText ?? ''}
              onChange={(e) => setDraft({ ...draft, requirementText: e.target.value })}
            />
            <span className="field-hint">{t.clauseRegistry.requirementHint}</span>
          </label>
        </div>

        <dl className="kv" style={{ marginTop: 'var(--sp-4)' }}>
          <dt>{t.clauseRegistry.pages}</dt>
          <dd>
            <ClausePages pageFrom={clause.pageFrom} pageTo={clause.pageTo} onOpen={onOpenPdf} />
          </dd>
          <dt>sortKey</dt>
          <dd className="mono xsmall">{clause.sortKey}</dd>
          <dt>textHash</dt>
          <dd className="mono xsmall truncate">{clause.textHash}</dd>
        </dl>
      </div>

      <div className="pane-foot row wrap">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => {
            onPatch({ reviewStatus: 'confirmed' });
            onNext();
          }}
        >
          {t.clauseRegistry.confirm}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || !dirty}
          title={dirty ? t.clauseRegistry.saveEditsTitle : t.clauseRegistry.noChanges}
          onClick={() => onPatch({ ...draft, reviewStatus: 'edited' })}
        >
          {t.clauseRegistry.saveEdits}
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy}
          onClick={() => onPatch({ reviewStatus: 'flagged' })}
        >
          {t.clauseRegistry.flag}
        </button>
        <span className="spacer" />
        {dirty && (
          <span className="xsmall" style={{ color: 'var(--warn)' }}>
            {t.clauseRegistry.unsaved}
          </span>
        )}
      </div>
    </div>
  );
}
