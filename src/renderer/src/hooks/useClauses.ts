import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { qk } from '@renderer/hooks/keys';
import { api } from '@renderer/lib/api';
import type { ClauseDto, ClausePatch } from '@shared/domain';

export function useClauses(specVersionId: number | null) {
  return useQuery({
    queryKey: qk.clauses(specVersionId ?? -1),
    queryFn: () => api['clauses:list'](specVersionId as number),
    enabled: specVersionId != null,
    staleTime: 30_000,
  });
}

export function useClause(clauseId: number | null) {
  return useQuery({
    queryKey: ['clause', clauseId ?? -1] as const,
    queryFn: () => api['clauses:get'](clauseId as number),
    enabled: clauseId != null,
  });
}

/**
 * Правка вимоги з оптимістичним оновленням: вичитка 183 вимог — це сотні
 * натискань, чекати на round-trip після кожного неприйнятно.
 */
export function usePatchClause(specVersionId: number | null) {
  const qc = useQueryClient();
  const key = qk.clauses(specVersionId ?? -1);

  return useMutation({
    mutationFn: ({ clauseId, patch }: { clauseId: number; patch: ClausePatch }) =>
      api['clauses:patch'](clauseId, patch),
    onMutate: async ({ clauseId, patch }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ClauseDto[]>(key);
      if (previous) {
        qc.setQueryData<ClauseDto[]>(
          key,
          previous.map((c) => (c.id === clauseId ? { ...c, ...patch } : c)),
        );
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) qc.setQueryData(key, context.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ['specVersion'] });
      void qc.invalidateQueries({ queryKey: qk.specs() });
    },
  });
}

export function useCreateClause(specVersionId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clause: Omit<ClausePatch, 'reviewStatus'> & { clauseNo: string; requirementText: string }) =>
      api['clauses:create'](specVersionId as number, clause),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.clauses(specVersionId ?? -1) }),
  });
}

export function useDeleteClause(specVersionId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clauseId: number) => api['clauses:delete'](clauseId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.clauses(specVersionId ?? -1) }),
  });
}

export function useExtractClauses() {
  return useMutation({
    mutationFn: (specVersionId: number) => api['clauses:extract'](specVersionId),
  });
}

export function useMarkClausesReviewed(specVersionId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api['clauses:markReviewed'](specVersionId as number),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.specVersion(specVersionId ?? -1) });
      void qc.invalidateQueries({ queryKey: qk.specs() });
    },
  });
}
