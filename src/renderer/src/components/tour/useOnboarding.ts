import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { qk } from '@renderer/hooks/keys';
import { useDocuments } from '@renderer/hooks/useDocuments';
import { useIpcEvent } from '@renderer/hooks/useIpcEvent';
import { useRuns } from '@renderer/hooks/useRuns';
import { useProviders, useSettings } from '@renderer/hooks/useSettings';
import { useSites } from '@renderer/hooks/useSites';
import { useSpecs } from '@renderer/hooks/useSpecs';
import {
  computeOnboarding,
  type OnboardingProgress,
  type OnboardingSnapshot,
} from '@renderer/lib/onboarding';
import { useTourStore } from '@renderer/store/tour';
import { useUiStore } from '@renderer/store/ui';

export interface OnboardingState {
  snapshot: OnboardingSnapshot;
  progress: OnboardingProgress;
}

/**
 * Стан «Першого аналізу» з тих самих кешів react-query, що й екрани:
 * окремих запитів тур не робить, тож галочки міняються разом з даними.
 */
export function useOnboarding(): OnboardingState {
  const providers = useProviders();
  const settings = useSettings();
  const specs = useSpecs();
  const documents = useDocuments();
  const sites = useSites();
  const runs = useRuns();
  const localePreference = useUiStore((s) => s.localePreference);
  const acknowledged = useTourStore((s) => s.acknowledged);

  const snapshot = useMemo<OnboardingSnapshot>(
    () => ({
      providers: providers.data,
      settings: settings.data,
      localeChosen: localePreference !== 'system',
      specs: specs.data,
      documentCount: documents.data?.length,
      siteCount: sites.data?.length,
      runs: runs.data,
      acknowledged,
    }),
    [providers.data, settings.data, localePreference, specs.data, documents.data, sites.data, runs.data, acknowledged],
  );

  const progress = useMemo(() => computeOnboarding(snapshot), [snapshot]);
  return { snapshot, progress };
}

/**
 * Події, після яких змінюються галочки, але екрани самі кеш списку не скидають:
 * кінець витягу вимог міняє `clauseCount` у списку стандартів, а імпорт із
 * перетягування може статись, поки відкрито інший екран.
 * Підписуємось один раз — у корені туру.
 */
export function useOnboardingSync(): void {
  const qc = useQueryClient();
  useIpcEvent('clauses:extractProgress', (payload) => {
    if (payload.done) void qc.invalidateQueries({ queryKey: qk.specs() });
  });
  useIpcEvent('library:changed', (payload) => {
    void qc.invalidateQueries({ queryKey: payload.kind === 'documents' ? ['documents'] : qk.specs() });
  });
}
