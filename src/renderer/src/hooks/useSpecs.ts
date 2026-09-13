import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { qk } from '@renderer/hooks/keys';
import { api } from '@renderer/lib/api';
import { useRun } from '@renderer/hooks/useRuns';

export function useSpecs() {
  return useQuery({ queryKey: qk.specs(), queryFn: () => api['specs:list']() });
}

export function useSpecVersion(specVersionId: number | null) {
  return useQuery({
    queryKey: qk.specVersion(specVersionId ?? -1),
    queryFn: () => api['specs:version'](specVersionId as number),
    enabled: specVersionId != null,
  });
}

export function useSpecSummary(specVersionId: number | null) {
  return useQuery({
    queryKey: qk.specSummary(specVersionId ?? -1),
    queryFn: () => api['specs:summary'](specVersionId as number),
    enabled: specVersionId != null,
  });
}

export function useSetCloudAllowed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ specificationId, allowed }: { specificationId: number; allowed: boolean }) =>
      api['specs:setCloudAllowed'](specificationId, allowed),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.specs() }),
  });
}

/**
 * Хеш блоба стандарту для прогону: runs:get → specVersionId → specs:version → blobHash.
 * Потрібен, щоб відкрити PDF саме тієї версії стандарту, за якою йшов аудит.
 */
export function useRunSpecBlobHash(runId: number | null): string | null {
  const run = useRun(runId);
  const version = useSpecVersion(run.data?.specVersionId ?? null);
  return version.data?.blobHash ?? null;
}
