import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import {
  SEVERITIES,
  VERDICTS,
  type FindingDto,
  type FindingQuery,
  type Severity,
  type Verdict,
} from '@shared/domain';
import { SeverityBadge, VerdictBadge } from '@renderer/components/Badges';
import { ClausePages, PdfModal, type PdfTarget } from '@renderer/components/ClausePages';
import { DataTable, Pager, type Column } from '@renderer/components/DataTable';
import { EmptyState, QueryState } from '@renderer/components/States';
import { useFindings } from '@renderer/hooks/useFindings';
import { useRunCoverage } from '@renderer/hooks/useRuns';
import { useRunSpecBlobHash } from '@renderer/hooks/useSpecs';
import { useT } from '@renderer/i18n';
import { formatConfidence, truncate } from '@renderer/lib/format';
import { VERDICT_GLYPH, isPotentialSeverity, useLabels } from '@renderer/lib/labels';

const PAGE_SIZE = 100;

/**
 * Вердикти, за якими документ справді щось каже про вимогу. `not_addressed` і
 * `not_applicable` — це «не про це» / «не стосується», а не зауваження.
 */
const SUBSTANTIVE_VERDICTS: readonly Verdict[] = VERDICTS.filter((v) => !isPotentialSeverity(v));

/** Щільна таблиця findings із фільтрами. Фільтри живуть в URL — посилання можна переслати. */
export function FindingsTab() {
  const t = useT();
  const labels = useLabels();
  const params = useParams();
  const runId = Number(params.runId);
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();

  const verdicts = parseList<Verdict>(search.get('verdict'), VERDICTS);
  const severities = parseList<Severity>(search.get('severity'), SEVERITIES);
  const sectionNo = search.get('section') ?? '';
  const documentVersionId = search.get('doc') ? Number(search.get('doc')) : null;
  const unreviewed = search.get('unreviewed') === '1';
  const text = search.get('q') ?? '';
  const offset = Number(search.get('offset') ?? '0') || 0;

  const coverage = useRunCoverage(Number.isFinite(runId) ? runId : null);
  const specBlobHash = useRunSpecBlobHash(Number.isFinite(runId) ? runId : null);
  const [pdfTarget, setPdfTarget] = useState<PdfTarget | null>(null);

  const query = useMemo<FindingQuery>(() => {
    const q: FindingQuery = { runId, limit: PAGE_SIZE, offset };
    if (verdicts.length > 0) q.verdicts = verdicts;
    if (severities.length > 0) q.severities = severities;
    if (sectionNo) q.sectionNo = sectionNo;
    if (documentVersionId != null) q.documentVersionId = documentVersionId;
    if (unreviewed) q.unreviewed = true;
    if (text.trim()) q.search = text.trim();
    return q;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, offset, search.toString()]);

  const findings = useFindings(query, Number.isFinite(runId));

  const patch = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(updates)) {
      if (value == null || value === '') next.delete(key);
      else next.set(key, value);
    }
    if (!('offset' in updates)) next.delete('offset');
    setSearch(next, { replace: true });
  };

  // Пошук набирається посимвольно — без дебаунсу кожна літера дає окремий IPC-виклик.
  const [searchDraft, setSearchDraft] = useState(text);
  const draftRef = useRef(text);
  useEffect(() => {
    if (draftRef.current === text) return;
    draftRef.current = text;
    setSearchDraft(text);
  }, [text]);
  useEffect(() => {
    if (searchDraft === text) return;
    const handle = window.setTimeout(() => {
      draftRef.current = searchDraft;
      patch({ q: searchDraft });
    }, 250);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  const toggleIn = (key: string, current: string[], value: string) => {
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    patch({ [key]: next.join(',') });
  };

  const docTitle = (id: number | null): string => {
    // null — зведений finding по всьому набору, а не «усі документи» з фільтра.
    if (id == null) return t.findings.aggregateDoc;
    const doc = coverage.data?.documents.find((d) => d.documentVersionId === id);
    return doc ? `${doc.title} v${doc.versionLabel}` : `#${id}`;
  };

  const columns: Array<Column<FindingDto>> = [
    {
      key: 'clause',
      header: t.findings.colClause,
      width: '76px',
      render: (f) => <span className="mono">{f.clause.clauseNo}</span>,
    },
    {
      key: 'topic',
      header: t.findings.colTopic,
      width: '210px',
      render: (f) => f.clause.topic ?? <span className="dim">—</span>,
      title: (f) => f.clause.topic ?? undefined,
    },
    {
      key: 'doc',
      header: t.findings.colDocument,
      hint: t.findings.colDocumentHint,
      width: '170px',
      render: (f) => (
        <span className={f.documentVersionId == null ? 'xsmall dim' : 'xsmall'}>
          {docTitle(f.documentVersionId)}
        </span>
      ),
      title: (f) => docTitle(f.documentVersionId),
    },
    {
      key: 'verdict',
      header: t.findings.colVerdict,
      hint: t.findings.colVerdictHint,
      width: '112px',
      render: (f) => <VerdictBadge verdict={f.verdict} short />,
    },
    {
      key: 'severity',
      header: t.findings.colSeverity,
      hint: t.findings.colSeverityHint,
      width: '96px',
      render: (f) => (
        <SeverityBadge
          severity={f.severity}
          short
          potential={isPotentialSeverity(f.review?.humanVerdict ?? f.verdict)}
        />
      ),
    },
    {
      key: 'conf',
      header: t.findings.colConfidence,
      hint: t.findings.colConfidenceHint,
      width: '88px',
      align: 'right',
      render: (f) => <span className="tabnum xsmall">{formatConfidence(f.confidence)}</span>,
    },
    {
      key: 'pages',
      header: t.findings.colPages,
      hint: t.findings.colPagesHint,
      width: '86px',
      render: (f) => (
        <ClausePages
          pageFrom={f.clause.pageFrom}
          pageTo={f.clause.pageTo}
          compact
          onOpen={
            specBlobHash
              ? (pageNo) =>
                  setPdfTarget({
                    blobHash: specBlobHash,
                    pageNo,
                    title: t.pdf.openTitle(f.clause.pageFrom ?? pageNo, f.clause.pageTo),
                  })
              : undefined
          }
        />
      ),
    },
    {
      key: 'ev',
      header: t.findings.colEvidence,
      hint: t.findings.colEvidenceHint,
      width: '84px',
      align: 'right',
      render: (f) => {
        const verified = f.evidence.filter((e) => e.verified).length;
        return (
          <span className="tabnum xsmall" title={t.findings.evidenceTitle(verified, f.evidence.length)}>
            {verified}/{f.evidence.length}
          </span>
        );
      },
    },
    {
      key: 'rationale',
      header: t.findings.colRationale,
      // Позначка «перевірити на аудиті» — у цій же колонці, а не окремою: вона
      // потрібна рідко, а таблиця і так щільна. Підпис словами, текст — у підказці.
      render: (f) => (
        <>
          {f.outsideEvidence && (
            <span className="chip chip-outside" title={t.findings.outsideEvidenceTitle(f.outsideEvidence)}>
              {t.findings.outsideEvidenceTag}
            </span>
          )}
          <span className="dim">{truncate(f.rationale, 140)}</span>
        </>
      ),
      title: (f) => f.rationale,
    },
    {
      key: 'review',
      header: t.findings.colReview,
      hint: t.findings.colReviewHint,
      width: '96px',
      render: (f) =>
        f.review ? (
          <span
            className="badge badge-verified"
            title={f.review.humanVerdict ? labels.verdict[f.review.humanVerdict] : t.review.agreedWithModel}
          >
            {f.review.humanVerdict ? labels.verdictShort[f.review.humanVerdict] : t.findings.reviewAgreed}
          </span>
        ) : (
          <span className="dim">—</span>
        ),
    },
  ];

  return (
    <div className="page-pad col" style={{ gap: 'var(--sp-2)', minHeight: 0 }}>
      <div className="filters" data-tour="findings-filters">
        <input
          className="input"
          style={{ maxWidth: 240 }}
          placeholder={t.findings.searchPlaceholder}
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
        />

        {/* Підпис групи + повна назва в title/aria: «◐ Част.», «MAJ» самі по собі — шифр. */}
        <span className="filter-group" role="group" aria-label={t.findings.filterVerdict}>
          <span className="filter-label" aria-hidden="true">
            {t.findings.filterVerdict}
          </span>
          {VERDICTS.map((v) => (
            <button
              key={v}
              type="button"
              className={`filter-chip ${verdicts.includes(v) ? 'on' : ''}`}
              title={`${labels.verdict[v]} — ${labels.verdictHint[v]}`}
              aria-label={labels.verdict[v]}
              aria-pressed={verdicts.includes(v)}
              onClick={() => toggleIn('verdict', verdicts, v)}
            >
              <span aria-hidden="true">{VERDICT_GLYPH[v]}</span>
              {labels.verdictShort[v]}
            </button>
          ))}
        </span>

        <span className="filter-group" role="group" aria-label={t.findings.filterSeverity}>
          <span className="filter-label" aria-hidden="true">
            {t.findings.filterSeverity}
          </span>
          {SEVERITIES.map((s) => (
            <button
              key={s}
              type="button"
              className={`filter-chip ${severities.includes(s) ? 'on' : ''}`}
              title={labels.severity[s]}
              aria-label={labels.severity[s]}
              aria-pressed={severities.includes(s)}
              onClick={() => toggleIn('severity', severities, s)}
            >
              {labels.severityShort[s]}
            </button>
          ))}
        </span>

        <select className="select" style={{ maxWidth: 130 }} value={sectionNo} onChange={(e) => patch({ section: e.target.value })}>
          <option value="">{t.findings.allSections}</option>
          {(coverage.data?.sections ?? []).map((s) => (
            <option key={s.sectionNo} value={s.sectionNo}>
              {s.sectionNo} · {s.sectionTitle ?? ''}
            </option>
          ))}
        </select>

        <select
          className="select"
          style={{ maxWidth: 180 }}
          value={documentVersionId ?? ''}
          onChange={(e) => patch({ doc: e.target.value })}
        >
          <option value="">{t.findings.allDocuments}</option>
          {(coverage.data?.documents ?? []).map((d) => (
            <option key={d.documentVersionId} value={d.documentVersionId}>
              {d.title} v{d.versionLabel}
            </option>
          ))}
        </select>

        <button
          type="button"
          className={`filter-chip ${unreviewed ? 'on' : ''}`}
          onClick={() => patch({ unreviewed: unreviewed ? null : '1' })}
        >
          {t.findings.unreviewedOnly}
        </button>

        {(verdicts.length > 0 || severities.length > 0 || sectionNo || documentVersionId != null || unreviewed || text) && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              draftRef.current = '';
              setSearchDraft('');
              setSearch(new URLSearchParams(), { replace: true });
            }}
          >
            {t.findings.reset}
          </button>
        )}
      </div>

      {/* Головна пастка читання: сотні «Не розглянуто» виглядають як сотні порушень.
          Пояснюємо й одним кліком лишаємо те, про що документи справді говорять. */}
      {verdicts.length === 0 && (
        <div className="read-hint">
          <span className="grow">{t.findings.noiseHint}</span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => patch({ verdict: SUBSTANTIVE_VERDICTS.join(',') })}
          >
            {t.findings.noiseAction}
          </button>
        </div>
      )}

      <QueryState
        isPending={findings.isPending}
        error={findings.error}
        data={findings.data}
        onRetry={() => void findings.refetch()}
        isEmpty={(d) => d.total === 0}
        empty={<EmptyState icon="⌕" title={t.findings.emptyTitle} description={t.findings.emptyDesc} />}
      >
        {(data) => (
          <>
            <DataTable
              columns={columns}
              rows={data.items}
              rowKey={(f) => f.id}
              onRowClick={(f) => navigate(`/runs/${runId}/findings/${f.id}`)}
              // Підказка над таблицею забирає ~60px — без поправки пейджер з'їжджав за край вікна.
              maxHeight={verdicts.length === 0 ? 'calc(100vh - 390px)' : 'calc(100vh - 320px)'}
              ariaLabel={t.findings.tableLabel}
            />
            <Pager
              offset={offset}
              limit={PAGE_SIZE}
              total={data.total}
              onChange={(next) => patch({ offset: String(next) })}
            />
          </>
        )}
      </QueryState>

      <PdfModal target={pdfTarget} onClose={() => setPdfTarget(null)} />
    </div>
  );
}

function parseList<T extends string>(raw: string | null, allowed: readonly T[]): T[] {
  if (!raw) return [];
  const set = new Set<string>(allowed);
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is T => set.has(s));
}
