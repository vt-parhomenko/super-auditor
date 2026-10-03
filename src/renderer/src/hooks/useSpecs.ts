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

/** Версія стандарту, за якою йшов прогін: runs:get → specVersionId → specs:version. */
export function useRunSpecVersion(runId: number | null) {
  const run = useRun(runId);
  return useSpecVersion(run.data?.specVersionId ?? null);
}

/**
 * Хеш блоба стандарту для прогону — щоб відкрити PDF саме тієї версії
 * стандарту, за якою йшов аудит.
 */
export function useRunSpecBlobHash(runId: number | null): string | null {
  return useRunSpecVersion(runId).data?.blobHash ?? null;
}
