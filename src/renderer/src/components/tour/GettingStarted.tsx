import { ProgressBar } from '@renderer/components/Meters';
import { useT } from '@renderer/i18n';
import { useTourStore } from '@renderer/store/tour';
import { useOnboarding } from './useOnboarding';

/** Кільце прогресу 14×14: видно здалеку, скільки лишилось, без зайвого тексту. */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 5.5;
  const length = 2 * Math.PI * r;
  const share = total > 0 ? done / total : 0;
  return (
    <svg className="tour-ring" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle className="tour-ring-track" cx="7" cy="7" r={r} />
      <circle
        className="tour-ring-value"
        cx="7"
        cy="7"
        r={r}
        strokeDasharray={`${length * share} ${length}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  );
}

/** Пункт бічної панелі «Як почати» з лічильником обов'язкових кроків. */
export function GettingStartedButton() {
  const t = useT();
  const openChecklist = useTourStore((s) => s.openChecklist);
  const { progress } = useOnboarding();
  const { requiredDone: done, requiredTotal: total, complete } = progress;
  const title = complete ? t.tour.sidebarComplete : t.tour.sidebarTitle(done, total);

  return (
    <div className="sidebar-tour">
      <button
        type="button"
        className={`nav-link tour-entry${complete ? ' is-complete' : ''}`}
        data-tour="getting-started"
        aria-haspopup="dialog"
        title={title}
        onClick={openChecklist}
      >
        <span className="nav-icon" aria-hidden="true">
          {complete ? '✓' : <ProgressRing done={done} total={total} />}
        </span>
        <span>{t.tour.sidebar}</span>
        <span className="nav-badge" aria-hidden="true">
          {done}/{total}
        </span>
        <span className="sr-only">{title}</span>
      </button>
    </div>
  );
}

/** Картка в налаштуваннях: повторно пройти тур, коли щось забулось. */
export function TourSettingsCard() {
  const t = useT();
  const startTour = useTourStore((s) => s.startTour);
  const openChecklist = useTourStore((s) => s.openChecklist);
  const { progress } = useOnboarding();

  return (
    <section className="card card-pad col" style={{ gap: 'var(--sp-3)' }}>
      <h3>{t.tour.settingsTitle}</h3>
      <span className="field-hint">{t.tour.settingsHint}</span>
      <ProgressBar
        value={progress.requiredDone}
        max={progress.requiredTotal}
        tone={progress.complete ? 'ok' : 'accent'}
        label={t.tour.progress(progress.requiredDone, progress.requiredTotal)}
        right={`${progress.requiredDone}/${progress.requiredTotal}`}
      />
      <div className="row wrap">
        <button type="button" className="btn btn-primary" onClick={() => startTour()}>
          {t.tour.restartTour}
        </button>
        <button type="button" className="btn" onClick={openChecklist}>
          {t.tour.openChecklist}
        </button>
      </div>
    </section>
  );
}
