import { createContext, useContext, type ReactNode } from 'react';

import { useUiStore } from '@renderer/store/ui';
import { CATALOGS } from './catalogs';
import type { Messages } from './en';
import type { Locale, LocalePreference } from './locale';

const I18nContext = createContext<Messages>(CATALOGS.en);

/**
 * Мова живе в сторі (як і тема), а контекст лише роздає каталог:
 * зміна преференції перемальовує всіх споживачів `useT` без перезапуску.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useUiStore((s) => s.locale);
  return <I18nContext.Provider value={CATALOGS[locale]}>{children}</I18nContext.Provider>;
}

export function useT(): Messages {
  return useContext(I18nContext);
}

export interface LocaleControls {
  /** Розв'язана локаль — те, чим зараз намальовано інтерфейс. */
  locale: Locale;
  preference: LocalePreference;
  setPreference: (preference: LocalePreference) => void;
}

export function useLocale(): LocaleControls {
  const locale = useUiStore((s) => s.locale);
  const preference = useUiStore((s) => s.localePreference);
  const setPreference = useUiStore((s) => s.setLocalePreference);
  return { locale, preference, setPreference };
}
