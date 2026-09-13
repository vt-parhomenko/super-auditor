import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { qk } from '@renderer/hooks/keys';
import { api } from '@renderer/lib/api';
import type { FindingQuery, HumanReviewDto, Severity, Verdict } from '@shared/domain';

export function useFindings(query: FindingQuery, enabled = true) {
  return useQuery({
    queryKey: qk.findings(query),
    queryFn: () => api['findings:list'](query),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useFinding(findingId: number | null) {
  return useQuery({
    queryKey: qk.finding(findingId ?? -1),
    queryFn: () => api['findings:get'](findingId as number),
    enabled: findingId != null,
  });
}

export interface ReviewInput {
  findingId: number;
  humanVerdict: Verdict | null;
  humanSeverity: Severity | null;
  note: string | null;
}

/**
 * Запис людського рішення. `ai_verdict` не перезаписується (ADR-6) —
 * саме різниця між ними стає eval-кейсом.
 */
export function useReviewFinding() {
  const qc = useQueryClient();
  return useMutation<HumanReviewDto, Error, ReviewInput>({
    mutationFn: ({ findingId, humanVerdict, humanSeverity, note }) =>
      api['findings:review'](findingId, { humanVerdict, humanSeverity, note }),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ['findings'] });
      void qc.invalidateQueries({ queryKey: qk.finding(variables.findingId) });
      void qc.invalidateQueries({ queryKey: ['runSummary'] });
    },
  });
}

export function useClearReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (findingId: number) => api['findings:clearReview'](findingId),
    onSuccess: (_data, findingId) => {
      void qc.invalidateQueries({ queryKey: ['findings'] });
      void qc.invalidateQueries({ queryKey: qk.finding(findingId) });
    },
  });
}
