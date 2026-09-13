import { useEffect, useRef } from 'react';

import { api } from '@renderer/lib/api';
import type { IpcEventChannel, IpcEvents } from '@shared/ipc';

/**
 * Підписка на подію main → renderer із коректним відписуванням.
 *
 * Handler тримаємо в ref, тому підписка не перестворюється на кожен рендер —
 * інакше швидкий потік `run:progress` призводив би до постійного re-subscribe.
 */
export function useIpcEvent<E extends IpcEventChannel>(
  event: E,
  handler: (payload: IpcEvents[E]) => void,
  enabled = true,
): void {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const off = api.on(event, (payload) => {
      ref.current(payload);
    });
    return off;
  }, [event, enabled]);
}
