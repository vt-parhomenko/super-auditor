import { useIpcEvent } from '@renderer/hooks/useIpcEvent';
import { useT } from '@renderer/i18n';
import { useUiStore } from '@renderer/store/ui';

const ICON = { info: 'ⓘ', warn: '⚠', error: '✕' } as const;

/** Область тостів + підписка на подію `toast` з main. */
export function Toasts() {
  const t = useT();
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);
  const push = useUiStore((s) => s.pushToast);

  useIpcEvent('toast', (payload) => push(payload.level, payload.message));

  if (toasts.length === 0) return null;

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.level}`}>
          <span aria-hidden="true">{ICON[toast.level]}</span>
          <span className="toast-msg">{toast.message}</span>
          <button
            type="button"
            className="toast-close"
            aria-label={t.common.close}
            onClick={() => dismiss(toast.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
