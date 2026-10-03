import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { qk } from '@renderer/hooks/keys';
import { api } from '@renderer/lib/api';
import type { LibraryDeleteImpact, LibraryDeleteTarget } from '@shared/ipc';

/**
 * Ціна видалення для вікна підтвердження. Без кешу: між двома відкриттями
 * вікна могла завершитись перевірка чи з'явитись людське рев'ю, і показати
 * людині застарілу ціну гірше, ніж секунду почекати.
 */
export function useLibraryDeleteImpact(target: LibraryDeleteTarget | null) {
  return useQuery({
    queryKey: qk.libraryDeleteImpact(target?.kind ?? 'document', target?.id ?? -1),
    queryFn: () => api['library:deleteImpact'](target as LibraryDeleteTarget),
    enabled: target != null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/**
 * Видалення специфікації / документа або версії разом із перевірками, що на
 * них спираються. Інвалідуємо все, що могло показувати видалене: списки,
 * картки (остання перевірка), реєстри, перевірки. Журнал витрат не змінюється.
 */
export function useLibraryDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (target: LibraryDeleteTarget) => api['library:delete'](target),
    onSuccess: (impact: LibraryDeleteImpact) => {
      // Видалене прибираємо з кешу зовсім: інакше неактивний запит віддав би
      // «живу» перевірку чи версію при наступному відкритті сторінки.
      for (const run of impact.runs) {
        qc.removeQueries({ queryKey: qk.run(run.id) });
        qc.removeQueries({ queryKey: qk.runProgress(run.id) });
        qc.removeQueries({ queryKey: qk.runSummary(run.id) });
        qc.removeQueries({ queryKey: qk.runCoverage(run.id) });
        qc.removeQueries({ queryKey: qk.runGaps(run.id) });
      }
      const isSpec = impact.target.kind === 'specification' || impact.target.kind === 'specVersion';
      for (const versionId of impact.versionIds) {
        if (isSpec) {
          qc.removeQueries({ queryKey: qk.specVersion(versionId) });
          qc.removeQueries({ queryKey: qk.specSummary(versionId) });
          qc.removeQueries({ queryKey: qk.clauses(versionId) });
        } else {
          qc.removeQueries({ queryKey: qk.docProfile(versionId) });
        }
      }
      if (impact.deletesParent) {
        qc.removeQueries({ queryKey: isSpec ? qk.spec(impact.parentId) : qk.document(impact.parentId) });
        if (!isSpec) qc.removeQueries({ queryKey: qk.documentRuns(impact.parentId) });
      }

      void qc.invalidateQueries({ queryKey: qk.specs() });
      void qc.invalidateQueries({ queryKey: ['spec'] });
      void qc.invalidateQueries({ queryKey: ['documents'] });
      void qc.invalidateQueries({ queryKey: ['document'] });
      void qc.invalidateQueries({ queryKey: ['documentRuns'] });
      void qc.invalidateQueries({ queryKey: qk.runs() });
      void qc.invalidateQueries({ queryKey: ['findings'] });
    },
  });
}
