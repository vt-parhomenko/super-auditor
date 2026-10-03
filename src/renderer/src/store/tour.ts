/**
 * Стан туру й чек-листа «Перший аналіз». Доменного тут нічого: що зроблено,
 * рахується з даних react-query (`lib/onboarding.ts`), а стор пам'ятає лише
 * інтерфейсне — який крок туру відкрито, чи відкрито чек-лист, чи людина вже
 * відмовилась від пропозиції туру і які необов'язкові кроки відмітила сама.
 */

import { create } from 'zustand';

import {
  ONBOARDING_STEP_IDS,
  isOnboardingStepId,
  stepIndex,
  type OnboardingStepId,
} from '@renderer/lib/onboarding';

const OFFER_KEY = 'sa.tour.offerDismissed';
const ACK_KEY = 'sa.onboarding.acknowledged';

const LAST_STEP = ONBOARDING_STEP_IDS.length - 1;

function readOfferDismissed(): boolean {
  try {
    return localStorage.getItem(OFFER_KEY) === '1';
  } catch {
    /* сховище недоступне — пропозиція з'явиться знову, це не критично */
    return false;
  }
}

function readAcknowledged(): OnboardingStepId[] {
  try {
    const raw = localStorage.getItem(ACK_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // Старі чи биті значення відкидаємо поштучно, а не все разом.
    return Array.isArray(parsed) ? parsed.filter(isOnboardingStepId) : [];
  } catch {
    return [];
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* не критично: у гіршому разі пропозиція чи позначка не переживе перезапуск */
  }
}

interface TourState {
  /** Індекс поточного кроку туру; null — тур закритий. */
  stepIndex: number | null;
  checklistOpen: boolean;
  offerDismissed: boolean;
  acknowledged: OnboardingStepId[];

  startTour: (from?: OnboardingStepId) => void;
  goTo: (index: number) => void;
  next: () => void;
  back: () => void;
  closeTour: () => void;
  openChecklist: () => void;
  closeChecklist: () => void;
  dismissOffer: () => void;
  setAcknowledged: (id: OnboardingStepId, done: boolean) => void;
}

export const useTourStore = create<TourState>((set, get) => ({
  stepIndex: null,
  checklistOpen: false,
  offerDismissed: readOfferDismissed(),
  acknowledged: readAcknowledged(),

  startTour: (from) => {
    // Хто вже запустив тур, тому картка «Уперше тут?» більше не потрібна.
    persist(OFFER_KEY, '1');
    set({ stepIndex: from ? stepIndex(from) : 0, checklistOpen: false, offerDismissed: true });
  },

  goTo: (index) => set({ stepIndex: Math.max(0, Math.min(LAST_STEP, index)) }),

  next: () => {
    const current = get().stepIndex;
    if (current == null) return;
    set({ stepIndex: Math.min(LAST_STEP, current + 1) });
  },

  back: () => {
    const current = get().stepIndex;
    if (current == null) return;
    set({ stepIndex: Math.max(0, current - 1) });
  },

  closeTour: () => set({ stepIndex: null }),

  openChecklist: () => set({ checklistOpen: true, stepIndex: null }),

  closeChecklist: () => set({ checklistOpen: false }),

  dismissOffer: () => {
    persist(OFFER_KEY, '1');
    set({ offerDismissed: true });
  },

  setAcknowledged: (id, done) => {
    const rest = get().acknowledged.filter((x) => x !== id);
    const acknowledged = done ? [...rest, id] : rest;
    persist(ACK_KEY, JSON.stringify(acknowledged));
    set({ acknowledged });
  },
}));
