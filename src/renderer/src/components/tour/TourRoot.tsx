import { useId } from 'react';

import { useT } from '@renderer/i18n';
import { shouldOfferTour, type OnboardingSnapshot } from '@renderer/lib/onboarding';
import { useTourStore } from '@renderer/store/tour';
import { Checklist } from './Checklist';
import { TourOverlay } from './TourOverlay';
import { useOnboarding, useOnboardingSync } from './useOnboarding';

export { GettingStartedButton, TourSettingsCard } from './GettingStarted';

/**
 * Корінь туру: чек-лист, сам тур і пропозиція на першому запуску.
 * Монтується в Layout — усередині роутера, бо тур водить між екранами.
 */
export function TourRoot() {
  useOnboardingSync();
  const { snapshot, progress } = useOnboarding();
  const stepIndex = useTourStore((s) => s.stepIndex);

  return (
    <>
      <Checklist progress={progress} snapshot={snapshot} />
      {stepIndex != null && <TourOverlay stepIndex={stepIndex} snapshot={snapshot} progress={progress} />}
      <FirstRunOffer snapshot={snapshot} />
    </>
  );
}

/**
 * Ненав'язлива картка «Уперше тут?». Фокус не забирає і нічого не блокує:
 * людина могла відкрити застосунок, щоб просто подивитись.
 */
function FirstRunOffer({ snapshot }: { snapshot: OnboardingSnapshot }) {
  const t = useT();
  const titleId = useId();
  const dismissed = useTourStore((s) => s.offerDismissed);
  const busy = useTourStore((s) => s.stepIndex != null || s.checklistOpen);
  const startTour = useTourStore((s) => s.startTour);
  const dismissOffer = useTourStore((s) => s.dismissOffer);

  if (!shouldOfferTour(snapshot, { dismissed, busy })) return null;

  return (
    <aside className="tour-offer" aria-labelledby={titleId}>
      <span className="tour-offer-icon" aria-hidden="true">
        ✦
      </span>
      <div className="col" style={{ gap: 'var(--sp-2)' }}>
        <h3 id={titleId}>{t.tour.offerTitle}</h3>
        <p className="small muted" style={{ margin: 0 }}>
          {t.tour.offerBody}
        </p>
        <div className="row wrap">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => startTour()}>
            {t.tour.offerStart}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={dismissOffer}>
            {t.tour.offerLater}
          </button>
        </div>
      </div>
    </aside>
  );
}
