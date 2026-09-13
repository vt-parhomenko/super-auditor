import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { qk } from '@renderer/hooks/keys';
import { api } from '@renderer/lib/api';
import type { AppSettings } from '@shared/ipc';

export function useSettings() {
  return useQuery({ queryKey: qk.settings(), queryFn: () => api['settings:get']() });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<AppSettings>) => api['settings:set'](patch),
    onSuccess: (data) => qc.setQueryData(qk.settings(), data),
  });
}

export function useProviders() {
  return useQuery({ queryKey: qk.providers(), queryFn: () => api['providers:list']() });
}

/** Ключ тільки відправляється. Прочитати його назад контракт не дозволяє. */
export function useSetApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ providerId, apiKey }: { providerId: string; apiKey: string }) =>
      api['providers:setApiKey'](providerId, apiKey),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.providers() }),
  });
}

export function useClearApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (providerId: string) => api['providers:clearApiKey'](providerId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.providers() }),
  });
}

export function useTestProvider() {
  return useMutation({ mutationFn: (providerId: string) => api['providers:test'](providerId) });
}

/**
 * Витрати застосунку. Це НЕ баланс рахунку: у провайдера немає ендпоінта
 * залишку коштів, тому рахуємо лише те, що витратив сам застосунок.
 */
export function useSpend() {
  return useQuery({ queryKey: qk.spend(), queryFn: () => api['usage:spend']() });
}

export function useRecentSpend(limit = 50) {
  return useQuery({
    queryKey: qk.recentSpend(limit),
    queryFn: () => api['usage:recent'](limit),
  });
}
