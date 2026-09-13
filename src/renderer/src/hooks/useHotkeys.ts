import { useEffect, useRef } from 'react';

export type HotkeyMap = Record<string, (event: KeyboardEvent) => void>;

/** Поле вводу — хоткеї там не спрацьовують, інакше не можна набрати «a» в нотатці. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

function normalize(event: KeyboardEvent): string {
  if (event.key === ' ' || event.code === 'Space') return 'space';
  return event.key.toLowerCase();
}

/**
 * Глобальні односимвольні хоткеї.
 * Ключі мапи — у нижньому регістрі: 'a', 'j', 'k', 'enter', 'space', 'escape'.
 * Комбінації з Ctrl/Meta/Alt свідомо ігноруються — вони належать системі й меню.
 */
export function useHotkeys(map: HotkeyMap, enabled = true): void {
  const ref = useRef(map);
  ref.current = map;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      const handler = ref.current[normalize(event)];
      if (!handler) return;
      event.preventDefault();
      handler(event);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
