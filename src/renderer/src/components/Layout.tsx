import { Fragment } from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';

import { BalanceIndicator } from '@renderer/components/Balance';
import { Toasts } from '@renderer/components/Toasts';
import { CostMeter } from '@renderer/components/Meters';
import { useAnyRunProgress } from '@renderer/hooks/useRuns';
import { useUiLanguageSync } from '@renderer/hooks/useUiLanguageSync';
import { useT } from '@renderer/i18n';
import { IS_MOCK } from '@renderer/lib/api';
import { useTopbarStore } from '@renderer/store/topbar';
import { useUiStore, type ThemePreference } from '@renderer/store/ui';

export function Layout() {
  const t = useT();
  const crumbs = useTopbarStore((s) => s.crumbs);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const progress = useAnyRunProgress();
  // Layout змонтований завжди — звідси синхронізуємо мову інтерфейсу з main.
  useUiLanguageSync();

  const nav = [
    { to: '/library', icon: '▤', label: t.nav.library },
    { to: '/specs', icon: '§', label: t.nav.specs },
    { to: '/sites', icon: '⌂', label: t.nav.sites },
    { to: '/runs', icon: '▶', label: t.nav.runs },
    { to: '/settings', icon: '⚙', label: t.nav.settings },
  ];

  const themeOptions: Array<{ value: ThemePreference; label: string; title: string }> = [
    { value: 'light', label: '☀', title: t.nav.themeLight },
    { value: 'system', label: '◐', title: t.nav.themeSystem },
    { value: 'dark', label: '☾', title: t.nav.themeDark },
  ];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-mark" aria-hidden="true">
            SA
          </span>
          <span className="sidebar-title">Super Auditor</span>
        </div>
        <nav className="sidebar-nav" aria-label={t.nav.mainNav}>
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <span className="nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          {progress && progress.status === 'running' && (
            <Link to={`/runs/${progress.runId}`} className="xsmall">
              {t.nav.runProgress(progress.runId, progress.tasksDone, progress.tasksTotal)}
            </Link>
          )}
          <div className="row-between">
            <span className="xsmall dim">{t.nav.theme}</span>
            <div className="seg" role="group" aria-label={t.nav.themeGroup}>
              {themeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  title={option.title}
                  aria-pressed={theme === option.value}
                  className={theme === option.value ? 'active' : ''}
                  onClick={() => setTheme(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="crumbs truncate">
            {crumbs.length === 0 ? (
              <span className="dim">Super Auditor</span>
            ) : (
              crumbs.map((crumb, i) => (
                <Fragment key={`${crumb.label}-${i}`}>
                  {i > 0 && (
                    <span className="crumb-sep" aria-hidden="true">
                      ›
                    </span>
                  )}
                  {crumb.to && i < crumbs.length - 1 ? (
                    <Link to={crumb.to} className="truncate">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className={i === crumbs.length - 1 ? 'crumb-current truncate' : 'truncate'}>
                      {crumb.label}
                    </span>
                  )}
                </Fragment>
              ))
            )}
          </div>
          <div className="topbar-actions">
            <BalanceIndicator />
            {progress && progress.status === 'running' && <CostMeter usage={progress.usage} compact />}
            {IS_MOCK && <span className="mock-flag" title={t.nav.mockTitle}>MOCK</span>}
          </div>
        </header>

        <Outlet />
      </div>

      <Toasts />
    </div>
  );
}
