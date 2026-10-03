import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Navigate, RouterProvider, createHashRouter } from 'react-router-dom';

import { I18nProvider } from '@renderer/i18n';
import { Layout } from '@renderer/components/Layout';
import { isBackendNotReady } from '@renderer/lib/api';
import { ClauseRegistryPage } from '@renderer/routes/ClauseRegistryPage';
import { DocumentRunsPage } from '@renderer/routes/DocumentRunsPage';
import { FindingDetailPage } from '@renderer/routes/FindingDetailPage';
import { LibraryPage } from '@renderer/routes/LibraryPage';
import { NotFoundPage, RouteErrorPage } from '@renderer/routes/NotFoundPage';
import { ReviewPage } from '@renderer/routes/ReviewPage';
import { RunsPage } from '@renderer/routes/RunsPage';
import { SettingsPage } from '@renderer/routes/SettingsPage';
import { SitesPage } from '@renderer/routes/SitesPage';
import { SpecsPage } from '@renderer/routes/SpecsPage';
import { CoverageTab } from '@renderer/routes/run/CoverageTab';
import { FindingsTab } from '@renderer/routes/run/FindingsTab';
import { GapsTab } from '@renderer/routes/run/GapsTab';
import { RunDetailPage } from '@renderer/routes/run/RunDetailPage';
import { SummaryTab } from '@renderer/routes/run/SummaryTab';

/**
 * Хеш-роутер — обов'язково: у продакшн-збірці сторінка вантажиться з file://,
 * де history API не працює.
 */
const router = createHashRouter([
  {
    path: '/',
    element: <Layout />,
    errorElement: <RouteErrorPage />,
    children: [
      // Стартова сторінка — перший пункт меню: робота починається зі стандарту.
      { index: true, element: <Navigate to="/specs" replace /> },

      { path: 'library', element: <LibraryPage /> },
      { path: 'library/:documentId/runs', element: <DocumentRunsPage /> },

      { path: 'specs', element: <SpecsPage /> },
      { path: 'specs/:specVersionId/clauses', element: <ClauseRegistryPage /> },

      { path: 'sites', element: <SitesPage /> },

      { path: 'runs', element: <RunsPage /> },
      {
        path: 'runs/:runId',
        element: <RunDetailPage />,
        children: [
          { index: true, element: <Navigate to="coverage" replace /> },
          { path: 'coverage', element: <CoverageTab /> },
          { path: 'findings', element: <FindingsTab /> },
          { path: 'gaps', element: <GapsTab /> },
          { path: 'summary', element: <SummaryTab /> },
        ],
      },
      { path: 'runs/:runId/findings/:findingId', element: <FindingDetailPage /> },
      { path: 'runs/:runId/review', element: <ReviewPage /> },

      { path: 'settings', element: <SettingsPage /> },

      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

/**
 * Повторювати запит, якщо хендлера просто немає, — марно: він не з'явиться
 * до перезапуску main. Тому BackendNotReadyError не ретраїмо.
 */
const queryClient = new QueryClient({
  queryCache: new QueryCache(),
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => !isBackendNotReady(error) && failureCount < 2,
      retryDelay: (attempt) => Math.min(2000 * 2 ** attempt, 8000),
      staleTime: 15_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>
    </QueryClientProvider>
  );
}
