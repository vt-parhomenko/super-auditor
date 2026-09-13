import { useEffect, useState } from 'react';

import { MODULES, type Module, type SiteProfileDto } from '@shared/domain';
import { TagInput } from '@renderer/components/TagInput';
import { EmptyState, QueryState } from '@renderer/components/States';
import { useDeleteSite, useRecomputeApplicability, useSaveSite, useSites } from '@renderer/hooks/useSites';
import { useSpecs } from '@renderer/hooks/useSpecs';
import { useT } from '@renderer/i18n';
import { useLabels } from '@renderer/lib/labels';
import { usePageContext } from '@renderer/store/topbar';
import { toast } from '@renderer/store/ui';

type Draft = Omit<SiteProfileDto, 'id'> & { id?: number };

const EMPTY: Draft = {
  name: '',
  modules: ['P', 'O'],
  certifications: [],
  products: [],
  processes: [],
  notes: null,
};

/**
 * Профіль виробництва живить Stage 3 — детермінований фільтр застосовності.
 * N/A ніколи не вирішує модель, тому все, що впливає на нього, редагується тут вручну.
 */
export function SitesPage() {
  const t = useT();
  usePageContext([{ label: t.nav.sites }]);

  const sites = useSites();
  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null);

  useEffect(() => {
    if (selectedId != null) return;
    const first = sites.data?.[0];
    if (first) setSelectedId(first.id);
  }, [sites.data, selectedId]);

  const selected =
    selectedId === 'new' ? EMPTY : (sites.data?.find((s) => s.id === selectedId) ?? null);

  return (
    <div className="page page-pad">
      <div className="page-head">
        <div>
          <h1>{t.sites.title}</h1>
          <p className="muted small">{t.sites.subtitle}</p>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-primary" onClick={() => setSelectedId('new')}>
            {t.sites.newProfile}
          </button>
        </div>
      </div>

      <QueryState
        isPending={sites.isPending}
        error={sites.error}
        data={sites.data}
        onRetry={() => void sites.refetch()}
      >
        {(list) => (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) 1fr', gap: 'var(--sp-4)' }}>
            <div className="card" style={{ overflow: 'hidden', alignSelf: 'start' }}>
              {list.length === 0 ? (
                <EmptyState icon="⌂" title={t.sites.emptyTitle} description={t.sites.emptyDesc} />
              ) : (
                list.map((site) => (
                  <button
                    key={site.id}
                    type="button"
                    className={`tree-item ${selectedId === site.id ? 'is-active' : ''}`}
                    onClick={() => setSelectedId(site.id)}
                  >
                    <span className="col grow" style={{ gap: 0 }}>
                      <span style={{ fontWeight: 600 }} className="truncate">
                        {site.name}
                      </span>
                      <span className="xsmall dim truncate">
                        {site.modules.join(' / ')} · {t.sites.certificationsCount(site.certifications.length)}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>

            <div>
              {selected ? (
                <SiteEditor
                  key={selectedId === 'new' ? 'new' : selected.id}
                  draft={selected}
                  onSaved={(id) => setSelectedId(id)}
                  onDeleted={() => setSelectedId(null)}
                />
              ) : (
                <EmptyState title={t.sites.pickProfile} />
              )}
            </div>
          </div>
        )}
      </QueryState>
    </div>
  );
}

function SiteEditor({
  draft: initial,
  onSaved,
  onDeleted,
}: {
  draft: Draft;
  onSaved: (id: number) => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const labels = useLabels();
  const [draft, setDraft] = useState<Draft>(initial);
  const save = useSaveSite();
  const remove = useDeleteSite();
  const recompute = useRecomputeApplicability();
  const specs = useSpecs();

  const specVersions = (specs.data ?? []).flatMap((s) =>
    s.versions.map((v) => ({ id: v.id, label: `${s.name} · v${v.versionLabel}`, clauseCount: v.clauseCount })),
  );
  const [specVersionId, setSpecVersionId] = useState<number | null>(null);
  useEffect(() => {
    if (specVersionId == null && specVersions[0]) setSpecVersionId(specVersions[0].id);
  }, [specVersions, specVersionId]);

  const toggleModule = (m: Module) =>
    setDraft((d) => ({
      ...d,
      modules: d.modules.includes(m)
        ? d.modules.filter((x) => x !== m)
        : MODULES.filter((x) => x === m || d.modules.includes(x)),
    }));

  const result = recompute.data;

  return (
    <div className="card card-pad col" style={{ gap: 'var(--sp-4)' }}>
      <div className="editor-grid">
        <label className="field span-2">
          <span className="label">{t.sites.fieldName}</span>
          <input
            className="input"
            value={draft.name}
            placeholder={t.sites.namePlaceholder}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>

        <div className="field">
          <span className="label">{t.sites.fieldModules}</span>
          <div className="module-toggle">
            {MODULES.map((m) => {
              const on = draft.modules.includes(m);
              return (
                <label key={m} className={on ? 'on' : ''} title={labels.module[m]}>
                  <input type="checkbox" checked={on} onChange={() => toggleModule(m)} />
                  <span>
                    <span className="mono">{m}</span> {labels.module[m]}
                  </span>
                </label>
              );
            })}
          </div>
          <span className="field-hint">{t.sites.modulesHint}</span>
        </div>

        <div className="field">
          <span className="label">{t.sites.fieldCertifications}</span>
          <TagInput
            values={draft.certifications}
            onChange={(certifications) => setDraft({ ...draft, certifications })}
            placeholder={t.sites.certificationsPlaceholder}
          />
          <span className="field-hint">{t.sites.certificationsHint}</span>
        </div>

        <div className="field">
          <span className="label">{t.sites.fieldProducts}</span>
          <TagInput
            values={draft.products}
            onChange={(products) => setDraft({ ...draft, products })}
            placeholder={t.sites.productsPlaceholder}
          />
        </div>

        <div className="field">
          <span className="label">{t.sites.fieldProcesses}</span>
          <TagInput
            values={draft.processes}
            onChange={(processes) => setDraft({ ...draft, processes })}
            placeholder={t.sites.processesPlaceholder}
          />
        </div>

        <label className="field span-2">
          <span className="label">{t.sites.fieldNotes}</span>
          <textarea
            className="textarea"
            value={draft.notes ?? ''}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value || null })}
          />
        </label>
      </div>

      <div className="row wrap">
        <button
          type="button"
          className="btn btn-primary"
          disabled={save.isPending || draft.name.trim() === ''}
          onClick={() =>
            save.mutate(draft, {
              onSuccess: (saved) => onSaved(saved.id),
              onError: (error) => toast('error', error.message),
            })
          }
        >
          {save.isPending ? t.common.saving : t.sites.saveProfile}
        </button>
        {draft.id != null && (
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              if (!window.confirm(t.sites.confirmDelete(draft.name))) return;
              remove.mutate(draft.id as number, {
                onSuccess: onDeleted,
                onError: (error) => toast('error', error.message),
              });
            }}
          >
            {t.common.delete}
          </button>
        )}
      </div>

      <hr className="divider" />

      <div className="col" style={{ gap: 'var(--sp-2)' }}>
        <span className="section-title">{t.sites.recomputeTitle}</span>
        <div className="row wrap">
          <select
            className="select"
            style={{ maxWidth: 340 }}
            value={specVersionId ?? ''}
            onChange={(e) => setSpecVersionId(Number(e.target.value) || null)}
          >
            {specVersions.length === 0 && <option value="">{t.sites.noSpecs}</option>}
            {specVersions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} ({t.sites.clausesCount(v.clauseCount)})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            disabled={draft.id == null || specVersionId == null || recompute.isPending}
            title={draft.id == null ? t.sites.saveFirst : undefined}
            onClick={() =>
              recompute.mutate(
                { siteProfileId: draft.id as number, specVersionId: specVersionId as number },
                { onError: (error) => toast('error', error.message) },
              )
            }
          >
            {recompute.isPending ? t.sites.recomputing : t.sites.recompute}
          </button>

          {result && (
            <span className="chip" style={{ height: 26, fontSize: 'var(--fs-md)' }}>
              {t.sites.resultApplicable} <strong className="tabnum">{result.applicable}</strong>{' '}
              {t.sites.resultOf}{' '}
              <strong className="tabnum">{result.applicable + result.notApplicable}</strong>
              <span className="dim">{t.sites.resultOutOfScope(result.notApplicable)}</span>
            </span>
          )}
        </div>
        <span className="field-hint">{t.sites.recomputeHint}</span>
      </div>
    </div>
  );
}
