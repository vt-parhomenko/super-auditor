import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { isEditableTarget } from '@renderer/hooks/useHotkeys';
import { useT } from '@renderer/i18n';
import {
  ONBOARDING_STEP_IDS,
  isStepDone,
  stepIndex as indexOfStep,
  tourTarget,
  type OnboardingProgress,
  type OnboardingSnapshot,
  type OnboardingStepId,
} from '@renderer/lib/onboarding';
import { useTourStore } from '@renderer/store/tour';
import {
  centerPlacement,
  maskPath,
  placePopover,
  sameBox,
  spotlightBox,
  type Box,
  type Size,
} from './placement';
import { stepText } from './stepText';

/** Скільки чекати на появу елемента, перш ніж показати картку «ще немає». */
const SEEK_TIMEOUT_MS = 2500;
/** Поки елемент зазвичай з'являється, підказку не показуємо — інакше вона стрибала б із центру. */
const REVEAL_DELAY_MS = 350;
const POLL_MS = 120;
const SPOT_PADDING = 6;
/** Узгоджено з --radius-lg: обведення вирізу і сам виріз мають однакові кути. */
const SPOT_RADIUS = 8;
/** Стартовий розмір підказки до першого вимірювання — близький до реального. */
const POPOVER_GUESS: Size = { width: 380, height: 280 };

type Phase = 'seeking' | 'found' | 'missing';

function readViewport(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function toBox(rect: DOMRect): Box {
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

/** Елемент є в DOM, але схований (`display: none`, згорнута панель) — для туру його немає. */
function findAnchor(anchor: string): HTMLElement | null {
  const element = document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 ? element : null;
}

/** Найближчий предок, який справді прокручується (`.page`, вкладка прогону). */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/**
 * Прокручуємо лише тоді, коли елемент справді не видно цілком: зайвий скрол дезорієнтує.
 *
 * Не `scrollIntoView`: він крутить УСІХ предків, зокрема сам документ. Каркас
 * застосунку розрахований на нерухомий документ (`body { overflow: hidden }`),
 * але будь-який абсолютно позиціонований вузол може зробити його на кілька сотень
 * пікселів «довшим» — і тоді scrollIntoView зсував би вгору весь інтерфейс разом
 * із бічною панеллю. Тому крутимо тільки найближчий контейнер прокрутки.
 */
function revealElement(element: HTMLElement): void {
  const rect = element.getBoundingClientRect();
  const viewport = readViewport();
  const visible = rect.top >= 0 && rect.left >= 0 && rect.bottom <= viewport.height && rect.right <= viewport.width;
  if (visible) return;
  const container = scrollParent(element);
  if (!container) return;
  const box = container.getBoundingClientRect();
  // Висока картка (провайдери) по центру обрізалась би згори — показуємо її початок.
  const delta =
    rect.height > box.height * 0.6
      ? rect.top - box.top - SPOT_PADDING * 2
      : rect.top + rect.height / 2 - (box.top + box.height / 2);
  container.scrollBy({ top: delta, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

interface TourOverlayProps {
  stepIndex: number;
  snapshot: OnboardingSnapshot;
  progress: OnboardingProgress;
}

/**
 * Тур інтерфейсом. Неблокувальний за змістом: кроки, що вимагають дії людини,
 * не тримають «Далі» — тур пояснює, а чек-лист відстежує реальний стан.
 *
 * Шар туру стоїть НИЖЧЕ модалок (z-index): якщо людина натисне підсвічену
 * кнопку «Новий прогін», діалог відкриється поверх туру і буде повністю робочим,
 * а після закриття тур чекатиме на тому ж кроці.
 */
export function TourOverlay({ stepIndex, snapshot, progress }: TourOverlayProps) {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const next = useTourStore((s) => s.next);
  const back = useTourStore((s) => s.back);
  const goTo = useTourStore((s) => s.goTo);
  const closeTour = useTourStore((s) => s.closeTour);
  const openChecklist = useTourStore((s) => s.openChecklist);
  const setAcknowledged = useTourStore((s) => s.setAcknowledged);

  const total = ONBOARDING_STEP_IDS.length;
  const stepId: OnboardingStepId = ONBOARDING_STEP_IDS[stepIndex] ?? 'language';
  const isLast = stepIndex === total - 1;
  const status = progress.steps[stepIndex];
  const text = stepText(t, stepId);
  const target = useMemo(() => tourTarget(stepId, snapshot), [stepId, snapshot]);

  const titleId = useId();
  const bodyId = useId();
  const popRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const [phase, setPhase] = useState<Phase>('seeking');
  const [revealed, setRevealed] = useState(false);
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [viewport, setViewport] = useState<Size>(readViewport);
  const [popSize, setPopSize] = useState<Size>(POPOVER_GUESS);
  /** Повторний пошук без навігації: React перемонтував підсвічений вузол. */
  const [seekToken, setSeekToken] = useState(0);
  /** «Показати знову»: людина пішла з екрана кроку — повертаємо її туди і шукаємо заново. */
  const [retryToken, setRetryToken] = useState(0);

  // ── 1. Маршрут кроку ──────────────────────────────────────────────────────
  // Лише при зміні кроку, цільового маршруту (дані довантажились) чи на прохання
  // людини, а не при кожній навігації: якщо вона пішла деінде, тур не тягне її
  // назад силоміць.
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  useEffect(() => {
    if (pathRef.current !== target.path) navigate(target.path);
  }, [stepId, target.path, retryToken, navigate]);

  // ── 2. Пошук елемента ─────────────────────────────────────────────────────
  useEffect(() => {
    setPhase('seeking');
    setRevealed(false);
    setElement(null);
    setBox(null);

    let settled = false;
    const finish = () => {
      settled = true;
      observer.disconnect();
      window.clearInterval(poll);
      window.clearTimeout(timeout);
    };
    const check = () => {
      if (settled) return;
      const found = findAnchor(target.anchor);
      if (!found) return;
      finish();
      revealElement(found);
      setElement(found);
      // Одразу, а не з першого кадру стеження: інакше підказка на мить стала б по центру.
      setBox(toBox(found.getBoundingClientRect()));
      setPhase('found');
    };

    // MutationObserver ловить появу елемента одразу після рендера маршруту,
    // опитування — зміни видимості без зміни дерева (розгорнута панель, стилі).
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    const poll = window.setInterval(check, POLL_MS);
    const timeout = window.setTimeout(() => {
      if (settled) return;
      finish();
      setPhase('missing');
    }, SEEK_TIMEOUT_MS);
    const reveal = window.setTimeout(() => setRevealed(true), REVEAL_DELAY_MS);
    check();

    return () => {
      finish();
      window.clearTimeout(reveal);
    };
  }, [target.anchor, target.path, stepId, seekToken, retryToken]);

  // ── 3. Стеження за елементом ──────────────────────────────────────────────
  // rAF, а не scroll/resize-слухачі: елемент зсувається і від довантаження даних,
  // і від прокрутки вкладених контейнерів (.page), про що window не дізнається.
  useEffect(() => {
    if (!element) return;
    let frame = 0;
    let last: Box | null = null;
    let lastViewport = readViewport();
    const tick = () => {
      if (!element.isConnected) {
        // React замінив вузол (перемкнулась гілка QueryState) — шукаємо заново.
        setSeekToken((n) => n + 1);
        return;
      }
      const current = toBox(element.getBoundingClientRect());
      if (!sameBox(current, last)) {
        last = current;
        setBox(current);
      }
      const vp = readViewport();
      if (vp.width !== lastViewport.width || vp.height !== lastViewport.height) {
        lastViewport = vp;
        setViewport(vp);
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [element]);

  // Вікно змінює розмір і без цілі (картка «ще немає» по центру).
  useEffect(() => {
    const onResize = () => setViewport(readViewport());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── 4. Розмір підказки ────────────────────────────────────────────────────
  // offsetWidth/Height, а не getBoundingClientRect: анімація появи масштабує
  // підказку, і виміряний «стиснутий» розмір зсунув би позицію.
  useLayoutEffect(() => {
    const node = popRef.current;
    if (!node) return;
    const measure = () =>
      setPopSize((prev) =>
        Math.abs(prev.width - node.offsetWidth) < 0.5 && Math.abs(prev.height - node.offsetHeight) < 0.5
          ? prev
          : { width: node.offsetWidth, height: node.offsetHeight },
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // ── 5. Фокус ──────────────────────────────────────────────────────────────
  // Входимо у підказку на старті і повертаємо фокус туди, звідки прийшли.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    nextRef.current?.focus({ preventScroll: true });
    return () => {
      // Чек-лист відкривається замість туру — фокусом розпоряджається він.
      if (useTourStore.getState().checklistOpen) return;
      const fallback = document.querySelector<HTMLElement>('[data-tour="getting-started"]');
      const back = previous && previous.isConnected && previous !== document.body ? previous : fallback;
      back?.focus({ preventScroll: true });
    };
  }, []);

  // Кнопка, на якій був фокус, могла зникнути зі зміною кроку («Перейти до кроку»).
  useEffect(() => {
    const pop = popRef.current;
    if (pop && !pop.contains(document.activeElement)) nextRef.current?.focus({ preventScroll: true });
  }, [stepIndex]);

  const finishTour = () => closeTour();
  const goNext = () => (isLast ? finishTour() : next());

  // ── 6. Клавіатура ─────────────────────────────────────────────────────────
  // Фаза capture: Esc і стрілки мають дійти до туру раніше за хоткеї сторінки.
  const keyRef = useRef({ goNext, back, closeTour });
  keyRef.current = { goNext, back, closeTour };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Відкрита модалка (діалог «Новий прогін») сама розпоряджається клавіатурою.
      if (document.querySelector('.modal-backdrop')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        keyRef.current.closeTour();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // У полі вводу стрілки рухають курсор — тур їх не перехоплює.
      if (isEditableTarget(event.target)) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
        keyRef.current.goNext();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        event.stopPropagation();
        keyRef.current.back();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // ── Геометрія ─────────────────────────────────────────────────────────────
  const rawSpot = phase === 'found' && box ? spotlightBox(box, viewport, SPOT_PADDING) : null;
  // Ціль прокрутили за межі вікна — прожектора немає, підказка по центру.
  const spot = rawSpot && rawSpot.width > 0 && rawSpot.height > 0 ? rawSpot : null;
  const placement = spot && box ? placePopover(box, popSize, viewport) : centerPlacement(popSize, viewport);
  const arrowStyle = arrowPosition(placement.side, box, placement, popSize);

  const blockedBy = status?.state === 'done' ? null : (status?.blockedBy ?? null);
  const done = status?.state === 'done';
  const optional = status?.optional ?? false;
  const acknowledged = snapshot.acknowledged.includes(stepId);
  // «Позначити зробленим» має сенс лише там, де стан не видно з даних.
  const doneByData = optional && isStepDone(stepId, { ...snapshot, acknowledged: [] });
  const hidden = phase === 'seeking' && !revealed;

  const toggleAcknowledged = () => {
    if (acknowledged) {
      setAcknowledged(stepId, false);
    } else {
      setAcknowledged(stepId, true);
      goNext();
    }
  };

  return (
    <div className="tour-layer">
      {/* Затемнення з вирізом. Зафарбована частина ловить кліки (повз ціль нічого
          не відбувається), а виріз — ні: у ціль можна одразу вставити ключ чи натиснути кнопку. */}
      <svg
        className="tour-mask"
        width={viewport.width}
        height={viewport.height}
        viewBox={`0 0 ${viewport.width} ${viewport.height}`}
        aria-hidden="true"
      >
        <path d={maskPath(viewport, spot, SPOT_RADIUS)} fillRule="evenodd" />
      </svg>
      {spot && (
        <div
          className="tour-spot"
          style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
        />
      )}

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {t.tour.announce(stepIndex + 1, total, text.title)}
      </div>

      <div
        ref={popRef}
        className={`tour-pop${hidden ? ' is-hidden' : ''}`}
        data-side={placement.side}
        style={{ top: placement.top, left: placement.left }}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        // Клавіші з підказки не мають дійти до хоткеїв сторінки: Enter на «Далі»
        // у реєстрі вимог інакше заодно підтвердив би вимогу.
        onKeyDown={(event) => event.stopPropagation()}
      >
        {arrowStyle && <span className="tour-arrow" style={arrowStyle} aria-hidden="true" />}

        <div className="tour-pop-head">
          <span className="tour-counter">{t.tour.stepCounter(stepIndex + 1, total)}</span>
          {optional && <span className="chip">{t.tour.optional}</span>}
          {done && <span className="badge badge-verified">✓ {t.tour.stateDone}</span>}
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon tour-x"
            aria-label={t.tour.close}
            title={t.tour.close}
            onClick={closeTour}
          >
            ✕
          </button>
        </div>

        <ol className="tour-ticks" aria-hidden="true">
          {progress.steps.map((step, i) => (
            <li
              key={step.id}
              className={`tour-tick is-${step.state}${i === stepIndex ? ' is-here' : ''}${step.optional ? ' is-optional' : ''}`}
            />
          ))}
        </ol>

        <h2 id={titleId} className="tour-title">
          {text.title}
        </h2>

        <div id={bodyId} className="tour-body">
          <p className="tour-why">{text.why}</p>
          {phase !== 'missing' && <p className="tour-action">{text.action}</p>}
          <div className="tour-look">
            <span className="tour-look-label">{t.tour.lookFor}</span>
            <span className="tour-look-chip">{text.lookFor}</span>
          </div>
        </div>

        {phase === 'seeking' && revealed && <div className="tour-note dim">{t.tour.seeking}</div>}

        {phase === 'missing' && (
          <div className="callout callout-warn tour-callout">
            <strong>{t.tour.missingTitle}</strong>
            <span>{blockedBy ? t.tour.firstDo(t.tour.steps[blockedBy].title) : t.tour.missingBody}</span>
            <span className="row wrap">
              {blockedBy && (
                <button type="button" className="btn btn-sm" onClick={() => goTo(indexOfStep(blockedBy))}>
                  {t.tour.goToStep}
                </button>
              )}
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRetryToken((n) => n + 1)}>
                {t.tour.retry}
              </button>
            </span>
          </div>
        )}

        {phase !== 'missing' && blockedBy && (
          <div className="callout callout-warn tour-callout">
            <span>{t.tour.firstDo(t.tour.steps[blockedBy].title)}</span>
            <span className="row wrap">
              <button type="button" className="btn btn-sm" onClick={() => goTo(indexOfStep(blockedBy))}>
                {t.tour.goToStep}
              </button>
            </span>
          </div>
        )}

        {done && !doneByData && !acknowledged && <div className="tour-note dim">{t.tour.doneNote}</div>}

        <div className="tour-pop-foot">
          <button type="button" className="btn btn-sm btn-ghost" onClick={closeTour}>
            {t.tour.skip}
          </button>
          <span className="spacer" />
          {optional && !doneByData && (
            <button type="button" className="btn btn-sm" aria-pressed={acknowledged} onClick={toggleAcknowledged}>
              {acknowledged ? t.tour.markUndone : t.tour.markDone}
            </button>
          )}
          <button type="button" className="btn btn-sm" disabled={stepIndex === 0} onClick={back}>
            {t.tour.back}
          </button>
          <button ref={nextRef} type="button" className="btn btn-sm btn-primary" onClick={goNext}>
            {isLast ? t.tour.finish : t.tour.next}
          </button>
        </div>

        <div className="tour-pop-meta">
          <button type="button" className="tour-link" onClick={openChecklist}>
            {t.tour.openChecklist}
          </button>
          <span aria-hidden="true">{t.tour.keysHint}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Стрілка підказки дивиться в центр цілі, але не ближче 16px до кута —
 * інакше вона «відривалась» би від заокруглення.
 */
function arrowPosition(
  side: string,
  target: Box | null,
  placement: { top: number; left: number },
  popover: Size,
): CSSProperties | null {
  if (!target) return null;
  const inset = 16;
  if (side === 'bottom' || side === 'top') {
    const x = target.left + target.width / 2 - placement.left;
    return { left: Math.max(inset, Math.min(popover.width - inset, x)) };
  }
  if (side === 'left' || side === 'right') {
    const y = target.top + target.height / 2 - placement.top;
    return { top: Math.max(inset, Math.min(popover.height - inset, y)) };
  }
  return null;
}
