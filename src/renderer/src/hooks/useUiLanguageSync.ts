import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { qk } from '@renderer/hooks/keys';
import { SAVE_SETTINGS_KEY, useSettings } from '@renderer/hooks/useSettings';
import { needsUiLanguageSync, type Locale } from '@renderer/i18n';
import { api } from '@renderer/lib/api';
import { useUiStore } from '@renderer/store/ui';
import type { AppSettings } from '@shared/ipc';

/**
 * Повідомляє main, якою мовою зараз намальовано інтерфейс, — щоб тости й тексти
 * помилок із main ішли тією самою мовою.
 *
 * Джерело правди — renderer: преференція живе в localStorage (працює й без
 * бекенда), а в налаштування main пишемо лише розв'язану мову. Запис — тільки
 * коли вона розходиться зі збереженою: на старті один раз і після кожної зміни
 * мови, а не на кожен рендер.
 *
 * Помилки ковтаємо мовчки: бекенд може бути ще не готовий (BackendNotReadyError)
 * або це mock-режим, а мова інтерфейсу від цього не страждає.
 */
export function useUiLanguageSync(): void {
  const locale = useUiStore((s) => s.locale);
  const settings = useSettings();
  const qc = useQueryClient();
  const lastSent = useRef<Locale | null>(null);

  const loaded = settings.data != null;
  const stored: unknown = settings.data?.uiLanguage;

  useEffect(() => {
    if (!loaded) return;
    if (!needsUiLanguageSync(stored, locale, lastSent.current)) return;
    lastSent.current = locale;
    api['settings:set']({ uiLanguage: locale })
      .then((next) => {
        // Поки летить збереження з Налаштувань, його оптимістичний стан не затираємо
        // відповіддю, що його ще не містить, — лише позначаємо кеш застарілим.
        if (qc.isMutating({ mutationKey: SAVE_SETTINGS_KEY }) > 0) {
          void qc.invalidateQueries({ queryKey: qk.settings() });
        } else {
          qc.setQueryData<AppSettings>(qk.settings(), (current) => (current ? { ...current, uiLanguage: next.uiLanguage } : next));
        }
      })
      .catch(() => {
        /* див. коментар вище: мова інтерфейсу від цього не залежить */
      });
  }, [loaded, stored, locale, qc]);
}
