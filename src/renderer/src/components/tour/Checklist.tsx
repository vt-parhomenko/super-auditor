import { useEffect, useRef, type Ref } from 'react';

import { ProgressBar } from '@renderer/components/Meters';
import { Modal } from '@renderer/components/Modal';
import { useT } from '@renderer/i18n';
import {
  isStepDone,
  stepIndex,
  type OnboardingGroup,
  type OnboardingProgress,
  type OnboardingSnapshot,
  type OnboardingStepStatus,
} from '@renderer/lib/onboarding';
import { useTourStore } from '@renderer/store/tour';
import { stepText } from './stepText';

/**
 * Чек-лист «Перший аналіз». Стан кожного кроку — з реальних даних, тож
 * список одночасно і інструкція, і діагностика: «чому прогін не стартує?» —
 * видно, який крок ще не зроблено.
 */
export function Checklist({ progress, snapshot }: { progress: OnboardingProgress; snapshot: OnboardingSnapshot }) {
  const t = useT();
  const open = useTourStore((s) => s.checklistOpen);
  const close = useTourStore((s) => s.closeChecklist);
  const startTour = useTourStore((s) => s.startTour);
  const focusRef = useRef<HTMLButtonElement>(null);

  // Modal фокусом не керує — заводимо його всередину самі, на поточний крок.
  useEffect(() => {
    if (open) focusRef.current?.focus({ preventScroll: true });
  }, [open]);

  if (!open) return null;

  const groups: Array<{ id: OnboardingGroup; title: string }> = [
    { id: 'setup', title: t.tour.groupSetup },
    { id: 'perDocument', title: t.tour.groupPerDocument },
  ];
  // Фокус — на «Показати» поточного кроку, а коли все зроблено — на «Почати тур».
  const focusId = progress.currentId;

  return (
    <Modal
      title={t.tour.checklistTitle}
      onClose={close}
      width={700}
      footer={
        <>
          <button type="button" className="btn" onClick={close}>
            {t.common.close}
          </button>
          <button
            ref={focusId == null ? focusRef : undefined}
            type="button"
            className="btn btn-primary"
            onClick={() => startTour()}
          >
            {progress.requiredDone > 0 ? t.tour.restartTour : t.tour.startTour}
          </button>
        </>
      }
    >
      <div className="col tour-checklist">
        <p className="small muted">{t.tour.checklistIntro}</p>
        <ProgressBar
          value={progress.requiredDone}
          max={progress.requiredTotal}
          tone={progress.complete ? 'ok' : 'accent'}
          label={t.tour.progress(progress.requiredDone, progress.requiredTotal)}
          right={`${progress.requiredDone}/${progress.requiredTotal}`}
        />
        {progress.complete && <div className="callout tour-complete">✓ {t.tour.allDone}</div>}

        {groups.map((group) => (
          <section key={group.id} className="col tour-group" aria-label={group.title}>
            <h4 className="section-title">{group.title}</h4>
            <ol className="tour-list">
              {progress.steps
                .filter((step) => step.group === group.id)
                .map((step) => (
                  <ChecklistRow
                    key={step.id}
                    step={step}
                    snapshot={snapshot}
                    showMeRef={step.id === focusId ? focusRef : undefined}
                  />
                ))}
            </ol>
          </section>
        ))}
      </div>
    </Modal>
  );
}

function ChecklistRow({
  step,
  snapshot,
  showMeRef,
}: {
  step: OnboardingStepStatus;
  snapshot: OnboardingSnapshot;
  showMeRef: Ref<HTMLButtonElement> | undefined;
}) {
  const t = useT();
  const startTour = useTourStore((s) => s.startTour);
  const setAcknowledged = useTourStore((s) => s.setAcknowledged);
  const text = stepText(t, step.id);
  const number = stepIndex(step.id) + 1;
  const acknowledged = snapshot.acknowledged.includes(step.id);
  const doneByData = step.optional && isStepDone(step.id, { ...snapshot, acknowledged: [] });

  const stateLabel =
    step.state === 'done' ? t.tour.stateDone : step.state === 'current' ? t.tour.stateCurrent : t.tour.statePending;

  return (
    <li className={`tour-item is-${step.state}${step.optional ? ' is-optional' : ''}`}>
      <span className="tour-mark" aria-hidden="true">
        {step.state === 'done' ? '✓' : number}
      </span>
      <div className="tour-item-body">
        <div className="tour-item-head">
          <span className="tour-item-title">{text.title}</span>
          {step.optional && <span className="chip">{t.tour.optional}</span>}
          {step.state === 'current' && <span className="badge tour-badge-current">{t.tour.stateCurrent}</span>}
          {/* Стан словами — для скрінрідера: позначка ✓/номер лише візуальна. */}
          <span className="sr-only">
            {number}. {stateLabel}
          </span>
        </div>
        <p className="tour-item-why">{text.why}</p>
        {step.blockedBy && (
          <span className="tour-item-blocked">{t.tour.firstDo(t.tour.steps[step.blockedBy].title)}</span>
        )}
      </div>
      <div className="tour-item-actions">
        {step.optional && !doneByData && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            aria-pressed={acknowledged}
            onClick={() => setAcknowledged(step.id, !acknowledged)}
          >
            {acknowledged ? t.tour.markUndone : t.tour.markDone}
          </button>
        )}
        <button
          ref={showMeRef}
          type="button"
          className={`btn btn-sm${step.state === 'current' ? ' btn-primary' : ''}`}
          aria-label={`${t.tour.showMe}: ${text.title}`}
          onClick={() => startTour(step.id)}
        >
          {t.tour.showMe}
        </button>
      </div>
    </li>
  );
}
