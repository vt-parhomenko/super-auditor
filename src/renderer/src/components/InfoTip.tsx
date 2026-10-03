import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { useT } from '@renderer/i18n';

/** Відступ від краю вікна: поповер не має прилипати до рамки чи вилазити за неї. */
const EDGE = 8;
const GAP = 6;

/**
 * «ⓘ» — коротке пояснення «як це читати» поруч зі щільним елементом: заголовком
 * колонки, плиткою, бейджем, числом без підпису.
 *
 * Кнопка, а не голий `title`: `title` не видно з клавіатури, він з'являється із
 * затримкою, і людина, яка не знає терміна, просто не здогадається навести мишу.
 * Тут видно сам значок, підказка відкривається наведенням, фокусом (Tab) і кліком,
 * закривається Esc або кліком поза нею.
 *
 * Поповер рендериться в портал із `position: fixed`: майже всюди, де він потрібен
 * (липка шапка DataTable, панелі з `overflow: auto`), звичайний absolute обрізався б.
 * Для скрінрідера текст завжди лежить у прихованому вузлі, на який посилається
 * `aria-describedby`, — він доступний ще до відкриття поповера.
 *
 * Не можна класти всередину `<label>` (кнопка стала б керованим елементом мітки
 * замість поля) і всередину інших кнопок.
 */
export function InfoTip({
  children,
  about,
  className,
}: {
  /** Сам текст пояснення. */
  children: ReactNode;
  /** Що пояснюємо — іде в aria-label: «Що означає „Впевн.“?». */
  about?: string;
  className?: string;
}) {
  const t = useT();
  const id = useId();
  const descId = `${id}-desc`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });

  const open = hovered || focused || pinned;

  const close = useCallback(() => {
    setHovered(false);
    setPinned(false);
  }, []);

  // Позиція: під кнопкою, вирівняно по її лівому краю; не влазить знизу — над нею.
  useLayoutEffect(() => {
    if (!open) {
      setStyle({ visibility: 'hidden' });
      return;
    }
    const button = buttonRef.current;
    const pop = popRef.current;
    if (!button || !pop) return;
    const anchor = button.getBoundingClientRect();
    const { width, height } = pop.getBoundingClientRect();
    const maxLeft = window.innerWidth - width - EDGE;
    const left = Math.max(EDGE, Math.min(anchor.left - 4, maxLeft));
    const below = anchor.bottom + GAP;
    const top =
      below + height + EDGE > window.innerHeight
        ? Math.max(EDGE, anchor.top - GAP - height)
        : below;
    setStyle({ top, left });
  }, [open]);

  // Скрол чи зміна розміру зсувають якір — простіше закрити, ніж ганятися за ним.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && (buttonRef.current?.contains(target) || popRef.current?.contains(target))) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Esc закриває підказку, а не весь екран (рев'ю, модалку) під нею.
      e.stopPropagation();
      close();
      setFocused(false);
    };
    const onScroll = () => {
      close();
      setFocused(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, close]);

  // Обгортка з position: relative — обов'язкова. Без неї прихований .sr-only
  // (position: absolute) позиціонується відносно кореня документа: значок десь
  // унизу прокручуваної .page розтягував documentElement на сотні пікселів, і
  // будь-який scrollIntoView зсував увесь застосунок разом із сайдбаром.
  return (
    <span className="info-tip-wrap">
      <button
        ref={buttonRef}
        type="button"
        className={`info-tip ${open ? 'is-open' : ''} ${className ?? ''}`}
        aria-label={about ? t.help.about(about) : t.help.more}
        aria-describedby={descId}
        aria-expanded={open}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setPinned(false);
        }}
        onClick={(e) => {
          // Клік не має відкривати рядок таблиці чи картку, у якій стоїть значок.
          e.stopPropagation();
          setPinned((p) => !p);
        }}
        onKeyDown={(e) => {
          // Enter/Space на значку — це «відкрити підказку», а не глобальний хоткей
          // екрана (підтвердити вимогу, наступний неопрацьований). Решту клавіш не чіпаємо.
          if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
        }}
      >
        <span aria-hidden="true">i</span>
      </button>
      <span id={descId} className="sr-only">
        {children}
      </span>
      {open &&
        createPortal(
          <div
            ref={popRef}
            className="info-pop"
            role="tooltip"
            aria-hidden="true"
            style={style}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
          >
            {children}
          </div>,
          document.body,
        )}
    </span>
  );
}

/**
 * Підпис + «ⓘ» в один рядок — для заголовків плиток, секцій і колонок, де пояснення
 * має стояти впритул до назви, а не губитися окремим рядком нижче.
 */
export function Labeled({
  label,
  hint,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <span className={`labeled ${className ?? ''}`}>
      {label}
      {hint != null && <InfoTip about={typeof label === 'string' ? label : undefined}>{hint}</InfoTip>}
    </span>
  );
}
