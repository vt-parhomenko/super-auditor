import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { qk } from '@renderer/hooks/keys';
import { api } from '@renderer/lib/api';
import { normalizeProviderStatus } from '@renderer/lib/models';
import type { AppSettings, ProviderStatus } from '@shared/ipc';

export function useSettings() {
  return useQuery({ queryKey: qk.settings(), queryFn: () => api['settings:get']() });
}

/**
 * Оптимістично: кеш оновлюється до відповіді main. Інакше керовані `<select>`
 * на мить відскакують до старого значення, а дві швидкі правки маршрутизації
 * (обидві шлють увесь `routing`) затирали б одна одну застарілим станом.
 * Відповідь main — остаточна: якщо він поле не зберіг, UI чесно повернеться.
 */
export const SAVE_SETTINGS_KEY = ['settings', 'save'] as const;

/**
 * Кілька збережень можуть летіти одночасно (дві швидкі правки маршрутизації).
 * Тоді відповідь чи відкат СТАРШОГО з них не має права затерти оптимістичний
 * стан молодшого: остаточну правду кладе в кеш лише останнє збереження, а якщо
 * якесь упало посеред черги — просто перечитуємо налаштування з main.
 */
export function useSaveSettings() {
  const qc = useQueryClient();
  const isLast = () => qc.isMutating({ mutationKey: SAVE_SETTINGS_KEY }) <= 1;
  return useMutation({
    mutationKey: SAVE_SETTINGS_KEY,
    mutationFn: (patch: Partial<AppSettings>) => api['settings:set'](patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: qk.settings() });
      const previous = qc.getQueryData<AppSettings>(qk.settings());
      if (previous) qc.setQueryData<AppSettings>(qk.settings(), { ...previous, ...patch });
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (isLast()) {
        if (context?.previous) qc.setQueryData(qk.settings(), context.previous);
      } else {
        void qc.invalidateQueries({ queryKey: qk.settings() });
      }
    },
    onSuccess: (data) => {
      if (isLast()) qc.setQueryData(qk.settings(), data);
    },
  });
}

/** Нормалізуємо на читанні (`select`): так і `refreshModels`, що пише в кеш напряму, проходить ту саму обробку. */
export function useProviders() {
  return useQuery({
    queryKey: qk.providers(),
    queryFn: () => api['providers:list'](),
    select: selectProviders,
  });
}

/** Стабільне посилання: react-query тоді не перераховує select на кожен рендер. */
function selectProviders(list: ProviderStatus[]): ProviderStatus[] {
  return list.map(normalizeProviderStatus);
}

/**
 * Ключ провайдера змінився — змінились і `configured`, і баланс (інший ключ —
 * інші витрати), тож скидаємо обидва кеші.
 */
function invalidateProvider(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: qk.providers() });
  void qc.invalidateQueries({ queryKey: qk.providerBalance() });
}

/** Ключ тільки відправляється. Прочитати його назад контракт не дозволяє. */
export function useSetApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ providerId, apiKey }: { providerId: string; apiKey: string }) =>
      api['providers:setApiKey'](providerId, apiKey),
    onSuccess: () => invalidateProvider(qc),
  });
}

export function useClearApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (providerId: string) => api['providers:clearApiKey'](providerId),
    onSuccess: () => invalidateProvider(qc),
  });
}

export function useTestProvider() {
  return useMutation({ mutationFn: (providerId: string) => api['providers:test'](providerId) });
}

/**
 * Живий каталог моделей. Відповідь — свіжий статус провайдера: кладемо його
 * прямо в кеш списку, щоб не робити зайвий `providers:list`.
 */
export function useRefreshModels() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (providerId: string) => api['providers:refreshModels'](providerId),
    onSuccess: (status) =>
      qc.setQueryData<ProviderStatus[]>(qk.providers(), (old) =>
        old ? old.map((p) => (p.id === status.id ? status : p)) : [status],
      ),
  });
}

/** Як часто перепитувати баланс: гроші списуються лише під час прогонів, частіше — марно. */
const BALANCE_POLL_MS = 5 * 60_000;

/**
 * Баланс на боці провайдера. Опитується рідко; після завершення прогону його
 * інвалідує `BalanceIndicator` (подія `run:finished`), а не кожна подія прогресу.
 * Без ретраїв: офлайн чи відхилений ключ не виправиться за дві секунди, а
 * зайві запити до провайдера нічого не дають.
 */
export function useProviderBalance(providerId: string | null) {
  return useQuery({
    queryKey: qk.providerBalance(providerId ?? ''),
    queryFn: () => api['providers:balance'](providerId as string),
    enabled: providerId != null,
    refetchInterval: BALANCE_POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: 60_000,
    retry: false,
  });
}

/** Management-ключ лише відправляється — як і основний. */
export function useSetManagementKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ providerId, key }: { providerId: string; key: string }) =>
      api['providers:setManagementKey'](providerId, key),
    onSuccess: () => invalidateProvider(qc),
  });
}

export function useClearManagementKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (providerId: string) => api['providers:clearManagementKey'](providerId),
    onSuccess: () => invalidateProvider(qc),
  });
}

/**
 * Витрати застосунку. Це НЕ баланс рахунку, а власний облік викликів: в Anthropic
 * ендпоінта залишку коштів немає взагалі, а те, що повідомляє OpenRouter, живе
 * окремо (`useProviderBalance`) — змішувати «пораховано нами» і «каже провайдер» не можна.
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
