/**
 * `library:deleteImpact` / `library:delete` для mock-режиму (`?mock=1`).
 *
 * Та сама семантика, що в main (`LibraryDeletionRepo`): перевірки, що спираються
 * на ціль, зникають цілком (навіть якщо охоплювали й інші документи), остання
 * версія забирає й ціле, спільний файл лишається. Ціну рахуємо зі стану моку,
 * а видалення справді прибирає сутності — інакше вікно не перевірити очима.
 */

import type {
  AuditRunDto,
  ClauseDto,
  DocumentDto,
  FindingDto,
  SpecificationDto,
} from '@shared/domain';
import type { LibraryDeleteImpact, LibraryDeleteTarget } from '@shared/ipc';
import { DOC_PROFILES } from './fixtures';

/** Частина мутабельного стану `mockApi`, яку зачіпає видалення. */
export interface MockLibraryState {
  documents: DocumentDto[];
  specs: SpecificationDto[];
  clauses: ClauseDto[];
  runs: AuditRunDto[];
  findings: FindingDto[];
}

/** Розміру файлу стандарту в `SpecVersionDto` немає; справжній Tesco v5.0 важить ~1.1 МБ. */
const SPEC_BLOB_BYTES = 1_153_434;

interface Scope {
  title: string;
  parentId: number;
  deletesParent: boolean;
  specVersionIds: number[];
  documentVersionIds: number[];
}

function scopeOf(state: MockLibraryState, target: LibraryDeleteTarget): Scope | null {
  switch (target.kind) {
    case 'specification': {
      const spec = state.specs.find((s) => s.id === target.id);
      if (!spec) return null;
      return {
        title: spec.name,
        parentId: spec.id,
        deletesParent: true,
        specVersionIds: spec.versions.map((v) => v.id),
        documentVersionIds: [],
      };
    }
    case 'specVersion': {
      const spec = state.specs.find((s) => s.versions.some((v) => v.id === target.id));
      const version = spec?.versions.find((v) => v.id === target.id);
      if (!spec || !version) return null;
      return {
        title: `${spec.name} v${version.versionLabel}`,
        parentId: spec.id,
        deletesParent: spec.versions.length === 1,
        specVersionIds: [version.id],
        documentVersionIds: [],
      };
    }
    case 'document': {
      const doc = state.documents.find((d) => d.id === target.id);
      if (!doc) return null;
      return {
        title: doc.docNumber ? `${doc.docNumber} ${doc.title}` : doc.title,
        parentId: doc.id,
        deletesParent: true,
        specVersionIds: [],
        documentVersionIds: doc.versions.map((v) => v.id),
      };
    }
    case 'documentVersion': {
      const doc = state.documents.find((d) => d.versions.some((v) => v.id === target.id));
      const version = doc?.versions.find((v) => v.id === target.id);
      if (!doc || !version) return null;
      const name = doc.docNumber ? `${doc.docNumber} ${doc.title}` : doc.title;
      return {
        title: `${name} v${version.versionLabel}`,
        parentId: doc.id,
        deletesParent: doc.versions.length === 1,
        specVersionIds: [],
        documentVersionIds: [version.id],
      };
    }
    default:
      return null;
  }
}

export function mockDeleteImpact(state: MockLibraryState, target: LibraryDeleteTarget): LibraryDeleteImpact | null {
  const scope = scopeOf(state, target);
  if (!scope) return null;
  const sv = new Set(scope.specVersionIds);
  const dv = new Set(scope.documentVersionIds);

  const runs = state.runs
    .filter((r) => sv.has(r.specVersionId) || r.documentVersionIds.some((id) => dv.has(id)))
    .sort((a, b) => b.id - a.id);
  const runIds = new Set(runs.map((r) => r.id));
  const findings = state.findings.filter((f) => runIds.has(f.runId));

  // Файли: хеш → розмір і чи посилається на нього хтось поза видаленим.
  const blobs = new Map<string, { bytes: number; shared: boolean }>();
  for (const spec of state.specs) {
    for (const v of spec.versions) {
      const entry = blobs.get(v.blobHash) ?? { bytes: SPEC_BLOB_BYTES, shared: false };
      if (!sv.has(v.id)) entry.shared = true;
      blobs.set(v.blobHash, entry);
    }
  }
  for (const doc of state.documents) {
    for (const v of doc.versions) {
      const entry = blobs.get(v.blobHash) ?? { bytes: v.byteSize, shared: false };
      if (!dv.has(v.id)) entry.shared = true;
      blobs.set(v.blobHash, entry);
    }
  }
  const touched = new Set<string>([
    ...state.specs.flatMap((s) => s.versions.filter((v) => sv.has(v.id)).map((v) => v.blobHash)),
    ...state.documents.flatMap((d) => d.versions.filter((v) => dv.has(v.id)).map((v) => v.blobHash)),
  ]);
  const orphaned = [...touched].filter((hash) => !blobs.get(hash)?.shared);

  // Вимоги: живі з реєстру моку, а для версій без них (Tesco 4.2) — статичний лічильник.
  const clauses = state.specs
    .flatMap((s) => s.versions)
    .filter((v) => sv.has(v.id))
    .reduce((sum, v) => {
      const live = state.clauses.filter((c) => c.specVersionId === v.id).length;
      return sum + (live > 0 ? live : v.clauseCount);
    }, 0);

  const isDocument = target.kind === 'document' || target.kind === 'documentVersion';
  const versionIds = isDocument ? scope.documentVersionIds : scope.specVersionIds;

  return {
    target: { kind: target.kind, id: target.id },
    title: scope.title,
    parentId: scope.parentId,
    deletesParent: scope.deletesParent,
    versionIds,
    versions: versionIds.length,
    clauses,
    documentProfiles: DOC_PROFILES.filter((p) => dv.has(p.documentVersionId)).length,
    runs: runs.map((r) => ({
      id: r.id,
      label: r.label,
      status: r.status,
      documentCount: r.documentVersionIds.length,
      otherDocuments: r.documentVersionIds.filter((id) => !dv.has(id)).length,
    })),
    findings: findings.length,
    reviewedFindings: findings.filter((f) => f.review != null).length,
    filesToRemove: orphaned.length,
    bytesToFree: orphaned.reduce((sum, hash) => sum + (blobs.get(hash)?.bytes ?? 0), 0),
    sharedFilesKept: touched.size - orphaned.length,
  };
}

/** Видаляє ціль зі стану моку. Повертає те саме, що показала б ціна. */
export function applyMockDeletion(state: MockLibraryState, target: LibraryDeleteTarget): LibraryDeleteImpact | null {
  const impact = mockDeleteImpact(state, target);
  if (!impact) return null;
  const runIds = new Set(impact.runs.map((r) => r.id));
  const versionIds = new Set(impact.versionIds);

  state.runs = state.runs.filter((r) => !runIds.has(r.id));
  state.findings = state.findings.filter((f) => !runIds.has(f.runId));

  if (target.kind === 'specification' || target.kind === 'specVersion') {
    state.clauses = state.clauses.filter((c) => !versionIds.has(c.specVersionId));
    state.specs = state.specs
      .map((s) => ({ ...s, versions: s.versions.filter((v) => !versionIds.has(v.id)) }))
      .filter((s) => !(impact.deletesParent && s.id === impact.parentId));
  } else {
    state.documents = state.documents
      .map((d) => ({ ...d, versions: d.versions.filter((v) => !versionIds.has(v.id)) }))
      .filter((d) => !(impact.deletesParent && d.id === impact.parentId));
  }
  return impact;
}
