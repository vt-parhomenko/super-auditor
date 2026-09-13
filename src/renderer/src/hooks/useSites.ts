import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { qk } from '@renderer/hooks/keys';
import { api } from '@renderer/lib/api';
import type { SiteProfileDto } from '@shared/domain';

export function useSites() {
  return useQuery({ queryKey: qk.sites(), queryFn: () => api['sites:list']() });
}

export function useSaveSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (profile: Omit<SiteProfileDto, 'id'> & { id?: number }) => api['sites:save'](profile),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.sites() }),
  });
}

export function useDeleteSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (siteProfileId: number) => api['sites:delete'](siteProfileId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.sites() }),
  });
}

/** Stage 3 — детермінований перерахунок. Результат: «застосовно 147 зі 183». */
export function useRecomputeApplicability() {
  return useMutation({
    mutationFn: ({ siteProfileId, specVersionId }: { siteProfileId: number; specVersionId: number }) =>
      api['sites:recomputeApplicability'](siteProfileId, specVersionId),
  });
}

export function useSetApplicabilityOverride() {
  return useMutation({
    mutationFn: (input: {
      siteProfileId: number;
      clauseId: number;
      applicable: boolean;
      reason: string;
    }) =>
      api['sites:setApplicabilityOverride'](
        input.siteProfileId,
        input.clauseId,
        input.applicable,
        input.reason,
      ),
  });
}
