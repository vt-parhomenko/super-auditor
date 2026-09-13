import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { qk } from '@renderer/hooks/keys';
import { useFindings } from '@renderer/hooks/useFindings';
import { useIpcEvent } from '@renderer/hooks/useIpcEvent';
import { api } from '@renderer/lib/api';
import type { RunConfig, RunProgress } from '@shared/domain';

export function useRuns() {
  return useQuery({ queryKey: qk.runs(), queryFn: () => api['runs:list']() });
}

export function useRun(runId: number | null) {
  return useQuery({
    queryKey: qk.run(runId ?? -1),
    queryFn: () => api['runs:get'](runId as number),
    enabled: runId != null,
  });
}

export function useRunSummary(runId: number | null) {
  return useQuery({
    queryKey: qk.runSummary(runId ?? -1),
    queryFn: () => api['runs:summary'](runId as number),
    enabled: runId != null,
  });
}

export function useRunCoverage(runId: number | null) {
  return useQuery({
    queryKey: qk.runCoverage(runId ?? -1),
    queryFn: () => api['runs:coverage'](runId as number),
    enabled: runId != null,
  });
}

export function useRunGaps(runId: number | null) {
  return useQuery({
    queryKey: qk.runGaps(runId ?? -1),
    queryFn: () => api['runs:gaps'](runId as number),
    enabled: runId != null,
  });
}

/**
 * Прогрес прогону: початкове значення тягнемо запитом, далі живемо на події
 * `run:progress`. Поллінга свідомо немає — events дешевші й точніші.
 */
export function useRunProgress(runId: number | null): RunProgress | null {
  const qc = useQueryClient();
  const [live, setLive] = useState<RunProgress | null>(null);

  const initial = useQuery({
    queryKey: qk.runProgress(runId ?? -1),
    queryFn: () => api['runs:progress'](runId as number),
    enabled: runId != null,
  });

  useIpcEvent(
    'run:progress',
    (payload) => {
      if (runId == null || payload.runId !== runId) return;
      setLive(payload);
    },
    runId != null,
  );

  useIpcEvent(
    'run:finished',
    (payload) => {
      if (runId == null || payload.runId !== runId) return;
      void qc.invalidateQueries({ queryKey: qk.run(runId) });
      void qc.invalidateQueries({ queryKey: qk.runs() });
      void qc.invalidateQueries({ queryKey: qk.runSummary(runId) });
      void qc.invalidateQueries({ queryKey: qk.runCoverage(runId) });
    },
    runId != null,
  );

  return live ?? initial.data ?? null;
}

/** Живий прогрес будь-якого прогону — для банера в списку прогонів. */
export function useAnyRunProgress(): RunProgress | null {
  const qc = useQueryClient();
  const [live, setLive] = useState<RunProgress | null>(null);

  useIpcEvent('run:progress', (payload) => setLive(payload));
  useIpcEvent('run:finished', () => {
    setLive(null);
    void qc.invalidateQueries({ queryKey: qk.runs() });
  });

  return live;
}

export function useEstimateRun() {
  return useMutation({ mutationFn: (config: RunConfig) => api['runs:estimate'](config) });
}

export function useStartRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: RunConfig) => api['runs:start'](config),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.runs() }),
  });
}

export function useRunControls(runId: number | null) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.runs() });
    if (runId != null) void qc.invalidateQueries({ queryKey: qk.run(runId) });
  };

  const pause = useMutation({ mutationFn: (id: number) => api['runs:pause'](id), onSuccess: invalidate });
  const resume = useMutation({ mutationFn: (id: number) => api['runs:resume'](id), onSuccess: invalidate });
  const cancel = useMutation({ mutationFn: (id: number) => api['runs:cancel'](id), onSuccess: invalidate });

  return { pause, resume, cancel };
}

export function useExportRun() {
  return useMutation({
    mutationFn: ({ runId, format }: { runId: number; format: 'xlsx' | 'markdown' | 'pdf' | 'json' }) =>
      api['export:run'](runId, format),
  });
}

/**
 * Видалення прогону. Незворотне: findings, докази й людські рев'ю йдуть каскадом.
 * Журнал витрат лишається — гроші витрачені незалежно від долі результату.
 */
export function useDeleteRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: number) => api['runs:delete'](runId),
    onSuccess: (_data, runId) => {
      void qc.invalidateQueries({ queryKey: qk.runs() });
      void qc.removeQueries({ queryKey: qk.run(runId) });
      // Прогін міг бути останнім для документа — картки бібліотеки залежать від нього.
      void qc.invalidateQueries({ queryKey: ['documents'] });
      void qc.invalidateQueries({ queryKey: ['document'] });
      void qc.invalidateQueries({ queryKey: ['documentRuns'] });
      void qc.invalidateQueries({ queryKey: qk.spend() });
    },
  });
}

/**
 * Що саме буде втрачено разом із прогоном.
 *
 * Рахуємо по всьому прогону, а не по поточному фільтру: видалення завжди
 * забирає весь прогін, і на сторінці одного документа це особливо легко
 * сплутати з «видалити лише цю частину».
 */
export function useRunDeletionFacts(runId: number | null) {
  const all = useFindings({ runId: runId ?? -1, limit: 1, offset: 0 }, runId != null);
  const reviewed = useFindings(
    { runId: runId ?? -1, limit: 1, offset: 0, unreviewed: false },
    runId != null,
  );
  return {
    isPending: all.isPending || reviewed.isPending,
    findings: all.data?.total ?? 0,
    reviewed: reviewed.data?.total ?? 0,
  };
}
