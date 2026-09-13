import { Link, useRouteError } from 'react-router-dom';

import { EmptyState, ErrorState } from '@renderer/components/States';
import { useT } from '@renderer/i18n';

export function NotFoundPage() {
  const t = useT();
  return (
    <div className="page page-pad">
      <EmptyState
        icon="∅"
        title={t.notFound.title}
        description={t.notFound.desc}
        action={
          <Link className="btn btn-primary" to="/library">
            {t.notFound.toLibrary}
          </Link>
        }
      />
    </div>
  );
}

/** Останній рубіж: помилка рендера не має лишати білий екран. */
export function RouteErrorPage() {
  const t = useT();
  const error = useRouteError();
  return (
    <div className="page page-pad">
      <ErrorState error={error} onRetry={() => window.location.reload()} />
      <div className="row" style={{ justifyContent: 'center' }}>
        <Link className="btn" to="/library">
          {t.notFound.toLibrary}
        </Link>
      </div>
    </div>
  );
}
