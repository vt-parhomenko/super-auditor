import { useState } from 'react';
import { Link } from 'react-router-dom';

import type { SpecVersionDto, SpecificationDto } from '@shared/domain';
import type { LibraryDeleteTarget } from '@shared/ipc';
import { DeleteLibraryButton, DeleteLibraryDialog } from '@renderer/components/DeleteLibraryDialog';
import { InfoTip } from '@renderer/components/InfoTip';
import { ProgressBar } from '@renderer/components/Meters';
import { EmptyState, QueryState } from '@renderer/components/States';
import { DropZone } from '@renderer/routes/LibraryPage';
import { useImportFiles, usePickFiles } from '@renderer/hooks/useDocuments';
import { useSetCloudAllowed, useSpecs } from '@renderer/hooks/useSpecs';
import { useT } from '@renderer/i18n';
import { formatDate } from '@renderer/lib/format';
import { useLabels } from '@renderer/lib/labels';
import { usePageContext } from '@renderer/store/topbar';
import { toast } from '@renderer/store/ui';

/**
 * Специфікації (стандарти замовників). Ключове тут — стан реєстру вимог:
 * поки він не вичитаний, прогін аудиту заблокований (див. Stage 1).
 */
export function SpecsPage() {
  const t = useT();
  usePageContext([{ label: t.nav.specs }]);

  const specs = useSpecs();
  const pick = usePickFiles();
  const importFiles = useImportFiles();
  const [deleting, setDeleting] = useState<LibraryDeleteTarget | null>(null);

  const runImport = (paths: string[]) => {
    if (paths.length === 0) return;
    importFiles.mutate(
      { paths, target: { kind: 'specification' } },
      {
        onSuccess: (result) => toast('info', t.specs.importedVersions(result.imported.length)),
        onError: (error) => toast('error', error.message),
      },
    );
  };

  return (
    <div className="page page-pad">
      <div className="page-head">
        <div>
          <h1>{t.specs.title}</h1>
          <p className="muted small">{t.specs.subtitle}</p>
        </div>
        <div className="page-head-actions">
          <button
            type="button"
            className="btn btn-primary"
            data-tour="specs-import"
            disabled={pick.isPending}
            onClick={() =>
              pick.mutate('specification', {
                onSuccess: runImport,
                onError: (error) => toast('error', error.message),
              })
            }
          >
            {t.specs.import}
          </button>
        </div>
      </div>

      <DropZone
        label={t.specs.dropLabel}
        hint={t.specs.dropHint}
        busy={importFiles.isPending}
        onPaths={runImport}
      />

      <div style={{ height: 'var(--sp-4)' }} />

      <QueryState
        isPending={specs.isPending}
        error={specs.error}
        data={specs.data}
        onRetry={() => void specs.refetch()}
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState icon="§" title={t.specs.emptyTitle} description={t.specs.emptyDesc} />
        }
      >
        {(list) => (
          <div className="doc-list">
            {list.map((spec) => (
              <SpecCard key={spec.id} spec={spec} onDelete={setDeleting} />
            ))}
          </div>
        )}
      </QueryState>

      {deleting && <DeleteLibraryDialog target={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

function SpecCard({
  spec,
  onDelete,
}: {
  spec: SpecificationDto;
  onDelete: (target: LibraryDeleteTarget) => void;
}) {
  const t = useT();
  const setCloud = useSetCloudAllowed();

  return (
    <div className="doc-card">
      <div className="doc-head" style={{ alignItems: 'flex-start' }}>
        <span className="col grow" style={{ gap: 2 }}>
          <span className="doc-title">
            {spec.code && <span className="mono dim">{spec.code} · </span>}
            {spec.name}
          </span>
          <span className="doc-meta">
            <span>{spec.issuer ?? t.specs.issuerUnknown}</span>
            <span>{t.specs.versionsCount(spec.versions.length)}</span>
          </span>
        </span>
        <DeleteLibraryButton
          title={t.deleteLibrary.actionTitle.specification(spec.name)}
          onClick={() => onDelete({ kind: 'specification', id: spec.id })}
        />
      </div>

      <div style={{ padding: 'var(--sp-3)', borderTop: '1px solid var(--border-subtle)' }}>
        <label className="checkbox" data-tour="spec-cloud">
          <input
            type="checkbox"
            checked={spec.cloudAllowed}
            disabled={setCloud.isPending}
            onChange={(e) =>
              setCloud.mutate(
                { specificationId: spec.id, allowed: e.target.checked },
                { onError: (error) => toast('error', error.message) },
              )
            }
          />
          <span>
            <span style={{ fontWeight: 600 }}>{t.specs.cloudAllowed}</span>
            <span className="col xsmall dim" style={{ marginTop: 2 }}>
              <span>{spec.cloudAllowed ? t.specs.cloudAllowedOn : t.specs.cloudAllowedOff}</span>
            </span>
          </span>
        </label>
      </div>

      <div className="doc-versions">
        {spec.versions.length === 0 ? (
          <div className="ver-row dim">{t.specs.noVersions}</div>
        ) : (
          spec.versions.map((v) => (
            <SpecVersionRow
              key={v.id}
              version={v}
              deleteTitle={t.deleteLibrary.actionTitle.specVersion(`${spec.name} v${v.versionLabel}`)}
              onDelete={() => onDelete({ kind: 'specVersion', id: v.id })}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SpecVersionRow({
  version,
  deleteTitle,
  onDelete,
}: {
  version: SpecVersionDto;
  deleteTitle: string;
  onDelete: () => void;
}) {
  const t = useT();
  const labels = useLabels();
  const ready = version.clausesStatus === 'reviewed';

  return (
    <div className="ver-row" style={{ gridTemplateColumns: '70px 150px 1fr 190px auto auto' }}>
      <span className="ver-label">v{version.versionLabel}</span>
      <span className="dim xsmall nowrap">{t.specs.effectiveFrom(formatDate(version.effectiveFrom))}</span>
      {/* Статус каже «що є», а підказка — «що робити далі»: без вичитки аудит заблоковано. */}
      <span className="small labeled">
        <span className={ready ? 'badge badge-verified' : 'badge badge-status'}>
          {labels.clausesStatus[version.clausesStatus]}
        </span>
        <InfoTip about={labels.clausesStatus[version.clausesStatus]}>
          {t.specs.statusHint[version.clausesStatus]}
        </InfoTip>
      </span>
      <span style={{ minWidth: 150 }}>
        {version.clauseCount > 0 ? (
          <ProgressBar
            value={version.reviewedClauseCount}
            max={version.clauseCount}
            tone={ready ? 'ok' : 'warn'}
            label={t.specs.reviewedLabel}
            right={t.specs.reviewedRight(version.reviewedClauseCount, version.clauseCount)}
          />
        ) : (
          <span className="dim xsmall">{t.specs.registryEmpty}</span>
        )}
      </span>
      <Link className="btn btn-sm" to={`/specs/${version.id}/clauses`}>
        {t.specs.openRegistry}
      </Link>
      <DeleteLibraryButton title={deleteTitle} onClick={onDelete} />
    </div>
  );
}
