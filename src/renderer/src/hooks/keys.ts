import type { DocumentKind, FindingQuery } from '@shared/domain';
import type { LibraryDeleteKind } from '@shared/ipc';

/** Ключі react-query в одному місці — щоб інвалідація не розповзалась по файлах. */
export const qk = {
  documents: (query?: { search?: string; kind?: DocumentKind }) => ['documents', query ?? {}] as const,
  document: (id: number) => ['document', id] as const,
  documentRuns: (id: number) => ['documentRuns', id] as const,
  /** Ціна видалення — завжди свіжа: рахується щоразу при відкритті вікна. */
  libraryDeleteImpact: (kind: LibraryDeleteKind, id: number) => ['libraryDeleteImpact', kind, id] as const,

  specs: () => ['specs'] as const,
  spec: (id: number) => ['spec', id] as const,
  specVersion: (id: number) => ['specVersion', id] as const,
  specSummary: (id: number) => ['specSummary', id] as const,

  clauses: (specVersionId: number) => ['clauses', specVersionId] as const,

  sites: () => ['sites'] as const,

  docProfile: (documentVersionId: number) => ['docProfile', documentVersionId] as const,
  extraction: (id: number) => ['extraction', id] as const,

  runs: () => ['runs'] as const,
  run: (id: number) => ['run', id] as const,
  runProgress: (id: number) => ['runProgress', id] as const,
  runSummary: (id: number) => ['runSummary', id] as const,
  runCoverage: (id: number) => ['runCoverage', id] as const,
  runGaps: (id: number) => ['runGaps', id] as const,

  findings: (query: FindingQuery) => ['findings', query] as const,
  finding: (id: number) => ['finding', id] as const,

  settings: () => ['settings'] as const,
  providers: () => ['providers'] as const,
  /** Без id — префікс для інвалідації балансу всіх провайдерів разом. */
  providerBalance: (providerId?: string) =>
    providerId == null ? (['providerBalance'] as const) : (['providerBalance', providerId] as const),
  spend: () => ['spend'] as const,
  recentSpend: (limit: number) => ['recentSpend', limit] as const,
} as const;
