import { useMemo, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { DOCUMENT_KINDS, type DocumentDto, type DocumentKind } from '@shared/domain';
import { Modal } from '@renderer/components/Modal';
import { LastRunSummary, NoRunsYet } from '@renderer/components/RunStats';
import { EmptyState, QueryState } from '@renderer/components/States';
import {
  useDeleteDocument,
  useDocuments,
  useImportFiles,
  usePickFiles,
  useUpdateDocument,
} from '@renderer/hooks/useDocuments';
import { useIpcEvent } from '@renderer/hooks/useIpcEvent';
import { getMessages, useT } from '@renderer/i18n';
import { baseName, formatBytes, formatDate, formatDateTime } from '@renderer/lib/format';
import { useLabels } from '@renderer/lib/labels';
import { usePageContext } from '@renderer/store/topbar';
import { toast } from '@renderer/store/ui';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Бібліотека документів: імпорт, версії, метадані.
 * Метадані (номер, власник процесу, тип) правляться вручну — витяг із шапки
 * нідерландських SOP не буває надійним на 100%.
 */
export function LibraryPage() {
  const t = useT();
  const labels = useLabels();
  usePageContext([{ label: t.nav.library }]);

  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<DocumentKind | ''>('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<DocumentDto | null>(null);

  const query = useMemo(
    () => ({ ...(search.trim() ? { search: search.trim() } : {}), ...(kind ? { kind } : {}) }),
    [search, kind],
  );
  const documents = useDocuments(query);
  const pick = usePickFiles();
  const importFiles = useImportFiles();

  useIpcEvent('library:changed', (payload) => {
    if (payload.kind === 'documents') void qc.invalidateQueries({ queryKey: ['documents'] });
  });

  const runImport = (paths: string[]) => {
    if (paths.length === 0) return;
    importFiles.mutate(
      { paths, target: { kind: 'document' } },
      {
        onSuccess: (result) => {
          const dup = result.imported.filter((i) => i.duplicate).length;
          toast(
            result.failed.length > 0 ? 'warn' : 'info',
            t.library.importResult(result.imported.length - dup, dup, result.failed.length),
          );
        },
        onError: (error) => toast('error', error.message),
      },
    );
  };

  const onPick = () => {
    pick.mutate('document', {
      onSuccess: runImport,
      onError: (error) => toast('error', error.message),
    });
  };

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="page page-pad">
      <div className="page-head">
        <div>
          <h1>{t.library.title}</h1>
          <p className="muted small">{t.library.subtitle}</p>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-primary" onClick={onPick} disabled={pick.isPending}>
            {pick.isPending ? t.library.picking : t.library.import}
          </button>
        </div>
      </div>

      <DropZone
        label={t.library.dropLabel}
        hint={t.library.dropHint}
        busy={importFiles.isPending}
        onPaths={runImport}
      />

      <div className="filters">
        <input
          className="input"
          style={{ maxWidth: 280 }}
          placeholder={t.library.searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="select"
          style={{ maxWidth: 170 }}
          value={kind}
          onChange={(e) => setKind(e.target.value as DocumentKind | '')}
        >
          <option value="">{t.library.allKinds}</option>
          {DOCUMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {labels.documentKind[k]}
            </option>
          ))}
        </select>
        {documents.data && (
          <span className="dim small">{t.library.documentsCount(documents.data.length)}</span>
        )}
      </div>

      <QueryState
        isPending={documents.isPending}
        error={documents.error}
        data={documents.data}
        onRetry={() => void documents.refetch()}
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState
            icon="▤"
            title={t.library.emptyTitle}
            description={t.library.emptyDesc}
            action={
              <button type="button" className="btn btn-primary" onClick={onPick}>
                {t.library.emptyAction}
              </button>
            }
          />
        }
      >
        {(docs) => (
          <div className="doc-list">
            {docs.map((doc) => (
              <DocumentCard
                key={doc.id}
                doc={doc}
                onOpenRuns={() => navigate(`/library/${doc.id}/runs`)}
                open={expanded.has(doc.id)}
                onToggle={() => toggle(doc.id)}
                onEdit={() => setEditing(doc)}
              />
            ))}
          </div>
        )}
      </QueryState>

      {editing && <MetadataModal doc={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ─── Зона перетягування ──────────────────────────────────────────────────────

/**
 * Зона перетягування.
 *
 * `import:run` працює з абсолютними шляхами, а `File.path` в Electron прибрано —
 * єдине джерело шляху з drop це міст `window.files.getPathForFile`.
 *
 * Мосту може не бути (mock-режим у браузері, старий preload) або він може
 * повернути `null` для конкретного файла (напр. перетягнули з браузера, а не з диска).
 * У обох випадках не падаємо, а пропонуємо кнопку імпорту як запасний шлях.
 */
export function DropZone({
  label,
  hint,
  busy,
  onPaths,
}: {
  label: string;
  hint: string;
  busy?: boolean;
  onPaths: (paths: string[]) => void;
}) {
  const t = useT();
  const [over, setOver] = useState(false);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    const files = Array.from(e.dataTransfer.files);
    const bridge = window.files;
    const paths = bridge
      ? files
          .map((file) => bridge.getPathForFile(file))
          .filter((path): path is string => typeof path === 'string' && path.length > 0)
      : [];

    const messages = getMessages().library;
    if (paths.length === 0) {
      toast(
        'warn',
        files.length > 0
          ? messages.dropPathUnavailable(baseName(files[0]?.name ?? ''))
          : messages.dropUnreadable,
      );
      return;
    }

    // Частковий успіх: імпортуємо те, що вдалось, але кажемо про пропущене.
    if (paths.length < files.length) {
      toast('warn', messages.dropSkipped(files.length - paths.length));
    }

    onPaths(paths);
  };

  return (
    <div
      className={`dropzone ${over ? 'is-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <div className="dropzone-title">{busy ? t.library.importing : label}</div>
      <div className="small">{hint}</div>
    </div>
  );
}

// ─── Картка документа ────────────────────────────────────────────────────────

function DocumentCard({
  doc,
  open,
  onToggle,
  onEdit,
  onOpenRuns,
}: {
  doc: DocumentDto;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onOpenRuns: () => void;
}) {
  const t = useT();
  const labels = useLabels();
  const latest = doc.versions[0];
  return (
    <div className="doc-card">
      <div className="doc-head">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={t.library.toggleVersions}
          style={{ padding: '0 4px' }}
        >
          <span className="doc-caret" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
        </button>
        <button type="button" className="doc-open grow" onClick={onOpenRuns}>
          <span className="col grow" style={{ gap: 1 }}>
            <span className="doc-title truncate">
              {doc.docNumber && <span className="mono dim">{doc.docNumber} · </span>}
              {doc.title}
            </span>
            <span className="doc-meta">
              <span>{doc.kind ? labels.documentKind[doc.kind] : t.library.kindNotSet}</span>
              <span>
                {doc.processOwner ? t.library.owner(doc.processOwner) : t.library.ownerNotSet}
              </span>
              <span>
                {t.library.versionsCount(doc.versions.length)}
                {latest ? t.library.latestVersion(latest.versionLabel) : ''}
              </span>
            </span>
          </span>
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onOpenRuns}>
          {t.runStats.openRuns}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onEdit}>
          {t.library.metadata}
        </button>
      </div>

      {doc.lastRun ? <LastRunSummary stats={doc.lastRun} /> : <NoRunsYet />}

      {open && (
        <div className="doc-versions">
          {doc.versions.length === 0 ? (
            <div className="ver-row dim">{t.library.noVersions}</div>
          ) : (
            doc.versions.map((v) => (
              <div key={v.id} className="ver-row">
                <span className="ver-label">v{v.versionLabel}</span>
                <span className="dim truncate mono xsmall" title={v.blobHash}>
                  {v.blobHash.slice(0, 16)}…
                </span>
                <span className="dim xsmall nowrap">
                  {v.lang ? v.lang.toUpperCase() : '—'} · {v.pageCount ?? '—'} {t.library.pagesSuffix} ·{' '}
                  {formatBytes(v.byteSize)}
                </span>
                <span
                  className="dim xsmall nowrap"
                  title={t.library.importedAt(formatDateTime(v.importedAt))}
                >
                  {t.library.effectiveFrom(formatDate(v.effectiveFrom))}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Редагування метаданих ───────────────────────────────────────────────────

function MetadataModal({ doc, onClose }: { doc: DocumentDto; onClose: () => void }) {
  const t = useT();
  const labels = useLabels();
  const [title, setTitle] = useState(doc.title);
  const [docNumber, setDocNumber] = useState(doc.docNumber ?? '');
  const [processOwner, setProcessOwner] = useState(doc.processOwner ?? '');
  const [kind, setKind] = useState<DocumentKind | ''>(doc.kind ?? '');
  const update = useUpdateDocument();
  const remove = useDeleteDocument();

  const save = () => {
    update.mutate(
      {
        documentId: doc.id,
        patch: {
          title: title.trim() || doc.title,
          docNumber: docNumber.trim() || null,
          processOwner: processOwner.trim() || null,
          kind: kind === '' ? null : kind,
        },
      },
      {
        onSuccess: onClose,
        onError: (error) => toast('error', error.message),
      },
    );
  };

  return (
    <Modal
      title={t.library.modalTitle}
      onClose={onClose}
      width={560}
      footer={
        <>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              if (!window.confirm(t.library.confirmDelete(doc.title))) return;
              remove.mutate(doc.id, { onSuccess: onClose, onError: (e) => toast('error', e.message) });
            }}
          >
            {t.common.delete}
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={update.isPending}>
            {update.isPending ? t.common.saving : t.common.save}
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 'var(--sp-3)' }}>
        <label className="field">
          <span className="label">{t.library.fieldTitle}</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="editor-grid">
          <label className="field">
            <span className="label">{t.library.fieldDocNumber}</span>
            <input
              className="input mono"
              value={docNumber}
              placeholder="0068"
              onChange={(e) => setDocNumber(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="label">{t.library.fieldOwner}</span>
            <input
              className="input"
              value={processOwner}
              placeholder={t.library.ownerPlaceholder}
              onChange={(e) => setProcessOwner(e.target.value)}
            />
          </label>
        </div>
        <label className="field">
          <span className="label">{t.library.fieldKind}</span>
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as DocumentKind | '')}>
            <option value="">{t.library.kindUnset}</option>
            {DOCUMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {labels.documentKind[k]}
              </option>
            ))}
          </select>
        </label>
        <div className="callout">{t.library.versionsCallout}</div>
      </div>
    </Modal>
  );
}
