/** Точка входу i18n: каталоги, контекст і доступ до підписів поза React. */

import { useUiStore } from '@renderer/store/ui';
import { CATALOGS } from './catalogs';
import type { Messages } from './en';
import type { Locale } from './locale';

export { I18nProvider, useLocale, useT, type LocaleControls } from './context';
export type { Messages } from './en';
export {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_NAMES,
  isLocale,
  isLocalePreference,
  needsUiLanguageSync,
  resolveLocale,
  systemLocale,
  type Locale,
  type LocalePreference,
} from './locale';

/** Для коду поза компонентами: тости з хуків, повідомлення помилок IPC. */
export function getMessages(): Messages {
  return CATALOGS[useUiStore.getState().locale];
}

export function getLocale(): Locale {
  return useUiStore.getState().locale;
}
