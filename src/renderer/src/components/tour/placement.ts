/**
 * Геометрія туру: де стоїть підказка відносно підсвіченого елемента.
 *
 * Чиста функція без DOM — тестується юніт-тестом. Правило одне: підказка
 * ніколи не вилазить за вікно. Спершу пробуємо сторону, де вона вміщається
 * повністю (знизу → зверху → праворуч → ліворуч); якщо ціль величезна й не
 * лишає місця ніде — ставимо з того боку, де місця найбільше, і притискаємо
 * до краю вікна (перекрити частину цілі краще, ніж сховати кнопки «Далі»).
 */

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export type Side = 'bottom' | 'top' | 'right' | 'left';

export interface Placement {
  /** `center` — цілі немає (крок без елемента на екрані). */
  side: Side | 'center';
  top: number;
  left: number;
}

/** Відступ підказки від цілі і мінімальний відступ від країв вікна. */
export const POPOVER_GAP = 12;
export const VIEWPORT_MARGIN = 8;

const ORDER: readonly Side[] = ['bottom', 'top', 'right', 'left'];

function clamp(value: number, min: number, max: number): number {
  // max < min буває, коли підказка ширша за вікно: тоді лишаємо лівий/верхній край видимим.
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

/** Вільне місце з кожного боку цілі, вже за вирахуванням відступів. */
function space(target: Box, viewport: Size): Record<Side, number> {
  return {
    bottom: viewport.height - (target.top + target.height) - POPOVER_GAP - VIEWPORT_MARGIN,
    top: target.top - POPOVER_GAP - VIEWPORT_MARGIN,
    right: viewport.width - (target.left + target.width) - POPOVER_GAP - VIEWPORT_MARGIN,
    left: target.left - POPOVER_GAP - VIEWPORT_MARGIN,
  };
}

function fits(side: Side, room: Record<Side, number>, popover: Size, viewport: Size): boolean {
  const vertical = side === 'bottom' || side === 'top';
  const along = vertical ? popover.height : popover.width;
  const across = vertical ? popover.width : popover.height;
  const acrossRoom = (vertical ? viewport.width : viewport.height) - 2 * VIEWPORT_MARGIN;
  return room[side] >= along && acrossRoom >= across;
}

function placeOn(side: Side, target: Box, popover: Size, viewport: Size): Placement {
  const maxLeft = viewport.width - popover.width - VIEWPORT_MARGIN;
  const maxTop = viewport.height - popover.height - VIEWPORT_MARGIN;
  const centerX = target.left + target.width / 2 - popover.width / 2;
  const centerY = target.top + target.height / 2 - popover.height / 2;

  switch (side) {
    case 'bottom':
      return {
        side,
        top: clamp(target.top + target.height + POPOVER_GAP, VIEWPORT_MARGIN, maxTop),
        left: clamp(centerX, VIEWPORT_MARGIN, maxLeft),
      };
    case 'top':
      return {
        side,
        top: clamp(target.top - POPOVER_GAP - popover.height, VIEWPORT_MARGIN, maxTop),
        left: clamp(centerX, VIEWPORT_MARGIN, maxLeft),
      };
    case 'right':
      return {
        side,
        top: clamp(centerY, VIEWPORT_MARGIN, maxTop),
        left: clamp(target.left + target.width + POPOVER_GAP, VIEWPORT_MARGIN, maxLeft),
      };
    case 'left':
      return {
        side,
        top: clamp(centerY, VIEWPORT_MARGIN, maxTop),
        left: clamp(target.left - POPOVER_GAP - popover.width, VIEWPORT_MARGIN, maxLeft),
      };
  }
}

export function centerPlacement(popover: Size, viewport: Size): Placement {
  return {
    side: 'center',
    top: clamp((viewport.height - popover.height) / 2, VIEWPORT_MARGIN, viewport.height - popover.height - VIEWPORT_MARGIN),
    left: clamp((viewport.width - popover.width) / 2, VIEWPORT_MARGIN, viewport.width - popover.width - VIEWPORT_MARGIN),
  };
}

export function placePopover(target: Box | null, popover: Size, viewport: Size): Placement {
  if (!target) return centerPlacement(popover, viewport);
  const room = space(target, viewport);
  const side =
    ORDER.find((s) => fits(s, room, popover, viewport)) ??
    // Ніде не вміщається — беремо найпросторішу сторону і притискаємо до краю.
    [...ORDER].sort((a, b) => room[b] - room[a])[0] ??
    'bottom';
  return placeOn(side, target, popover, viewport);
}

/**
 * Вікно «прожектора» навколо цілі: з полем, обрізане краями вікна.
 * Висока ціль (картка провайдерів) інакше дала б виріз за межами екрана.
 */
export function spotlightBox(target: Box, viewport: Size, padding: number): Box {
  const top = Math.max(0, target.top - padding);
  const left = Math.max(0, target.left - padding);
  const bottom = Math.min(viewport.height, target.top + target.height + padding);
  const right = Math.min(viewport.width, target.left + target.width + padding);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * Контур затемнення для SVG із `fill-rule: evenodd`: увесь екран мінус
 * заокруглений виріз. Чому SVG, а не `box-shadow: 0 0 0 9999px`: Chromium
 * відкидає настільки велику тінь (затемнення просто не з'являлось), а ще
 * незафарбований виріз пропускає кліки до цілі без окремих «стін» навколо.
 */
export function maskPath(viewport: Size, hole: Box | null, radius: number): string {
  const outer = `M0 0H${viewport.width}V${viewport.height}H0Z`;
  if (!hole || hole.width <= 0 || hole.height <= 0) return outer;
  const r = Math.max(0, Math.min(radius, hole.width / 2, hole.height / 2));
  const x = hole.left;
  const y = hole.top;
  const right = x + hole.width;
  const bottom = y + hole.height;
  const inner =
    `M${x + r} ${y}H${right - r}A${r} ${r} 0 0 1 ${right} ${y + r}` +
    `V${bottom - r}A${r} ${r} 0 0 1 ${right - r} ${bottom}` +
    `H${x + r}A${r} ${r} 0 0 1 ${x} ${bottom - r}` +
    `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
  return `${outer}${inner}`;
}

/** Чи помітно змінився прямокутник — щоб не перемальовувати тур щокадру без потреби. */
export function sameBox(a: Box | null, b: Box | null, epsilon = 0.5): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.top - b.top) < epsilon &&
    Math.abs(a.left - b.left) < epsilon &&
    Math.abs(a.width - b.width) < epsilon &&
    Math.abs(a.height - b.height) < epsilon
  );
}
