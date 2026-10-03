import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { qk } from '@renderer/hooks/keys';
import { api } from '@renderer/lib/api';
import type { DocumentKind, ImportRequest } from '@shared/domain';

export function useDocuments(query?: { search?: string; kind?: DocumentKind }) {
  return useQuery({
    queryKey: qk.documents(query),
    queryFn: () => api['documents:list'](query),
  });
}

export function useDocument(documentId: number | null) {
  return useQuery({
    queryKey: qk.document(documentId ?? -1),
    queryFn: () => api['documents:get'](documentId as number),
    enabled: documentId != null,
  });
}

type DocumentPatch = {
  title?: string;
  docNumber?: string | null;
  processOwner?: string | null;
  kind?: DocumentKind | null;
};

export function useUpdateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ documentId, patch }: { documentId: number; patch: DocumentPatch }) =>
      api['documents:update'](documentId, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['documents'] });
      void qc.invalidateQueries({ queryKey: ['document'] });
    },
  });
}

export function usePickFiles() {
  return useMutation({
    mutationFn: (kind: 'document' | 'specification') => api['import:pick'](kind),
  });
}

export function useImportFiles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (request: ImportRequest) => api['import:run'](request),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['documents'] });
      void qc.invalidateQueries({ queryKey: qk.specs() });
    },
  });
}

export function useExtraction(extractionId: number | null) {
  return useQuery({
    queryKey: qk.extraction(extractionId ?? -1),
    queryFn: () => api['extraction:get'](extractionId as number),
    enabled: extractionId != null,
  });
}

export function useDocProfile(documentVersionId: number | null) {
  return useQuery({
    queryKey: qk.docProfile(documentVersionId ?? -1),
    queryFn: () => api['docProfiles:get'](documentVersionId as number),
    enabled: documentVersionId != null,
  });
}

/**
 * Хеш блоба версії документа — для перегляду самого документа (панель доказів).
 * Беремо зі списку бібліотеки: окремого каналу «версія за id» контракт не має.
 */
export function useDocumentVersionBlob(documentVersionId: number | null) {
  const documents = useDocuments();
  if (documentVersionId == null) return { blobHash: null, title: null };
  for (const doc of documents.data ?? []) {
    for (const version of doc.versions) {
      if (version.id === documentVersionId) {
        return { blobHash: version.blobHash, title: `${doc.title} · v${version.versionLabel}` };
      }
    }
  }
  return { blobHash: null, title: null };
}

/** Усі прогони, що торкались документа, від найновішого. */
export function useDocumentRuns(documentId: number | null) {
  return useQuery({
    queryKey: qk.documentRuns(documentId ?? -1),
    queryFn: () => api['documents:runs'](documentId as number),
    enabled: documentId != null,
  });
}
