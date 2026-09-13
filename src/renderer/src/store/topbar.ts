import { useEffect } from 'react';
import { create } from 'zustand';

export interface Crumb {
  label: string;
  to?: string;
}

interface TopbarState {
  crumbs: Crumb[];
  setCrumbs: (crumbs: Crumb[]) => void;
}

export const useTopbarStore = create<TopbarState>((set) => ({
  crumbs: [],
  setCrumbs: (crumbs) => set({ crumbs }),
}));

/**
 * Оголошує поточний контекст у верхньому рядку.
 * Приймає прості дані (не ReactNode), тому порівняння за JSON дешеве
 * і не викликає нескінченних оновлень.
 */
export function usePageContext(crumbs: Crumb[]): void {
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    useTopbarStore.getState().setCrumbs(JSON.parse(key) as Crumb[]);
  }, [key]);
}
