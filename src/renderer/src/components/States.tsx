import type { ReactNode } from 'react';

import { useT } from '@renderer/i18n';
import { isBackendNotReady } from '@renderer/lib/api';

export function EmptyState({
  icon = '∅',
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="state">
      <div className="state-icon" aria-hidden="true">
        {icon}
      </div>
      <div className="state-title">{title}</div>
      {description && <div className="state-desc">{description}</div>}
      {action && <div className="state-actions">{action}</div>}
    </div>
  );
}

/**
 * Головний запобіжник цього етапу: поки хендлери в main не написані, кожен
 * виклик падає з BackendNotReadyError. Показуємо плейсхолдер, а не білий екран.
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();

  if (isBackendNotReady(error)) {
    return (
      <div className="state state-backend">
        <div className="state-icon" aria-hidden="true">
          ⚙
        </div>
        <div className="state-title">{t.states.backendTitle}</div>
        <div className="state-desc">{t.states.backendDesc}</div>
        <div className="state-desc dim">
          {t.states.mockHintLead}
          <code>?mock=1</code>
          {t.states.mockHintMid}
          <code>VITE_MOCK=1</code>
          {t.states.mockHintTail}
        </div>
        {error instanceof Error && <div className="state-detail">{error.message}</div>}
      </div>
    );
  }

  const message = error instanceof Error ? error.message : String(error ?? t.states.unknownError);
  return (
    <div className="state">
      <div className="state-icon" aria-hidden="true">
        ⚠
      </div>
      <div className="state-title">{t.states.loadFailed}</div>
      <div className="state-detail">{message}</div>
      {onRetry && (
        <div className="state-actions">
          <button type="button" className="btn" onClick={onRetry}>
            {t.common.retry}
          </button>
        </div>
      )}
    </div>
  );
}

export function LoadingState({ rows = 6 }: { rows?: number }) {
  return (
    <div className="skeleton-list" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${100 - (i % 4) * 12}%` }} />
      ))}
    </div>
  );
}

interface QueryStateProps<T> {
  isPending: boolean;
  error: unknown;
  data: T | undefined;
  onRetry?: () => void;
  empty?: ReactNode;
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}

/** Один шлях для loading → error → empty → data у всіх екранах. */
export function QueryState<T>({
  isPending,
  error,
  data,
  onRetry,
  empty,
  isEmpty,
  children,
}: QueryStateProps<T>) {
  const t = useT();
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (isPending || data === undefined) return <LoadingState />;
  if (isEmpty?.(data)) return <>{empty ?? <EmptyState title={t.common.empty} />}</>;
  return <>{children(data)}</>;
}
