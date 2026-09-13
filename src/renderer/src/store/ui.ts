/** Локальний стан UI: тости, тема й мова. Нічого доменного тут не зберігаємо — це кеш react-query. */

import { create } from 'zustand';

import {
  isLocalePreference,
  resolveLocale,
  systemLocale,
  type Locale,
  type LocalePreference,
} from '@renderer/i18n/locale';

export type ToastLevel = 'info' | 'warn' | 'error';

export interface Toast {
  id: number;
  level: ToastLevel;
  message: string;
}

export type ThemePreference = 'system' | 'light' | 'dark';

const THEME_KEY = 'sa.theme';
const LOCALE_KEY = 'sa.locale';
const TOAST_TTL: Record<ToastLevel, number> = { info: 4000, warn: 7000, error: 12_000 };

function readStoredTheme(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    /* приватний режим / заборонене сховище — мовчки падаємо на 'system' */
  }
  return 'system';
}

function readStoredLocale(): LocalePreference {
  try {
    const raw = localStorage.getItem(LOCALE_KEY);
    if (isLocalePreference(raw)) return raw;
  } catch {
    /* те саме: без сховища живемо на системній локалі */
  }
  return 'system';
}

/** `system` знімає атрибут — далі вирішує @media (prefers-color-scheme). */
export function applyTheme(theme: ThemePreference): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

/** Тримає `lang` у синхроні з тим, чим насправді намальовано інтерфейс. */
export function applyLocale(locale: Locale): void {
  document.documentElement.lang = locale;
}

interface UiState {
  toasts: Toast[];
  theme: ThemePreference;
  localePreference: LocalePreference;
  /** Розв'язана локаль: преференція або мова ОС, коли преференція `system`. */
  locale: Locale;
  pushToast: (level: ToastLevel, message: string) => void;
  dismissToast: (id: number) => void;
  setTheme: (theme: ThemePreference) => void;
  setLocalePreference: (preference: LocalePreference) => void;
}

let nextToastId = 1;

const initialLocalePreference = readStoredLocale();

export const useUiStore = create<UiState>((set, get) => ({
  toasts: [],
  theme: readStoredTheme(),
  localePreference: initialLocalePreference,
  locale: resolveLocale(initialLocalePreference, systemLocale()),

  pushToast: (level, message) => {
    const id = nextToastId++;
    set((s) => ({ toasts: [...s.toasts, { id, level, message }].slice(-6) }));
    window.setTimeout(() => get().dismissToast(id), TOAST_TTL[level]);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setTheme: (theme) => {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* не критично */
    }
    set({ theme });
  },

  setLocalePreference: (preference) => {
    const locale = resolveLocale(preference, systemLocale());
    applyLocale(locale);
    try {
      localStorage.setItem(LOCALE_KEY, preference);
    } catch {
      /* не критично */
    }
    set({ localePreference: preference, locale });
  },
}));

/** Виклик поза React (наприклад із error-обробників react-query). */
export function toast(level: ToastLevel, message: string): void {
  useUiStore.getState().pushToast(level, message);
}
