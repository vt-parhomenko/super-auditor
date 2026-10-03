import { describe, expect, it } from 'vitest';

import {
  POPOVER_GAP,
  VIEWPORT_MARGIN,
  maskPath,
  placePopover,
  sameBox,
  spotlightBox,
  type Box,
  type Placement,
  type Size,
} from './placement';

const VIEWPORT: Size = { width: 1280, height: 800 };
const POPOVER: Size = { width: 360, height: 220 };

function inside(p: Placement, popover: Size = POPOVER, viewport: Size = VIEWPORT): boolean {
  return (
    p.left >= VIEWPORT_MARGIN &&
    p.top >= VIEWPORT_MARGIN &&
    p.left + popover.width <= viewport.width - VIEWPORT_MARGIN &&
    p.top + popover.height <= viewport.height - VIEWPORT_MARGIN
  );
}

describe('placePopover', () => {
  it('без цілі — по центру', () => {
    const p = placePopover(null, POPOVER, VIEWPORT);
    expect(p.side).toBe('center');
    expect(p.left).toBe((1280 - 360) / 2);
    expect(p.top).toBe((800 - 220) / 2);
  });

  it('за замовчуванням — під ціллю, по її центру', () => {
    const target: Box = { top: 100, left: 500, width: 200, height: 30 };
    const p = placePopover(target, POPOVER, VIEWPORT);
    expect(p.side).toBe('bottom');
    expect(p.top).toBe(100 + 30 + POPOVER_GAP);
    expect(p.left).toBe(500 + 100 - 180);
  });

  it('ціль унизу екрана — перескакує наверх', () => {
    const target: Box = { top: 700, left: 500, width: 200, height: 30 };
    const p = placePopover(target, POPOVER, VIEWPORT);
    expect(p.side).toBe('top');
    expect(p.top + POPOVER.height + POPOVER_GAP).toBe(700);
    expect(inside(p)).toBe(true);
  });

  it('кнопка в правому верхньому куті — не вилазить за правий край', () => {
    const target: Box = { top: 60, left: 1180, width: 90, height: 28 };
    const p = placePopover(target, POPOVER, VIEWPORT);
    expect(p.side).toBe('bottom');
    expect(inside(p)).toBe(true);
    expect(p.left).toBe(1280 - 360 - VIEWPORT_MARGIN);
  });

  it('висока вузька ціль — збоку', () => {
    const target: Box = { top: 20, left: 40, width: 300, height: 760 };
    const p = placePopover(target, POPOVER, VIEWPORT);
    expect(p.side).toBe('right');
    expect(p.left).toBe(40 + 300 + POPOVER_GAP);
    expect(inside(p)).toBe(true);
  });

  it('ціль на весь екран — однаково всередині вікна', () => {
    const target: Box = { top: 0, left: 0, width: 1280, height: 800 };
    const p = placePopover(target, POPOVER, VIEWPORT);
    expect(inside(p)).toBe(true);
  });

  it('частково прокручена за верх ціль — підказка все одно у вікні', () => {
    const target: Box = { top: -300, left: 300, width: 600, height: 500 };
    const p = placePopover(target, POPOVER, VIEWPORT);
    expect(p.side).toBe('bottom');
    expect(inside(p)).toBe(true);
  });

  it('вікно вужче за підказку — лівий край лишається видимим', () => {
    const small: Size = { width: 300, height: 600 };
    const p = placePopover({ top: 50, left: 10, width: 50, height: 20 }, POPOVER, small);
    expect(p.left).toBe(VIEWPORT_MARGIN);
  });
});

describe('spotlightBox', () => {
  it('додає поле навколо цілі', () => {
    expect(spotlightBox({ top: 100, left: 100, width: 50, height: 20 }, VIEWPORT, 6)).toEqual({
      top: 94,
      left: 94,
      width: 62,
      height: 32,
    });
  });

  it('обрізається краями вікна', () => {
    expect(spotlightBox({ top: -50, left: 1250, width: 100, height: 900 }, VIEWPORT, 6)).toEqual({
      top: 0,
      left: 1244,
      width: 36,
      height: 800,
    });
  });
});

describe('maskPath', () => {
  it('без вирізу — суцільне затемнення', () => {
    expect(maskPath({ width: 100, height: 50 }, null, 8)).toBe('M0 0H100V50H0Z');
  });

  it('з вирізом — два контури (evenodd робить другий діркою)', () => {
    const d = maskPath({ width: 100, height: 50 }, { top: 10, left: 20, width: 30, height: 20 }, 4);
    expect(d.startsWith('M0 0H100V50H0Z')).toBe(true);
    expect(d.match(/M/g)?.length).toBe(2);
    expect(d).toContain('M24 10H46A4 4 0 0 1 50 14');
  });

  it('радіус не більший за половину вирізу', () => {
    const d = maskPath({ width: 100, height: 50 }, { top: 0, left: 0, width: 10, height: 6 }, 8);
    expect(d).toContain('A3 3');
  });

  it('порожній виріз — як без вирізу', () => {
    expect(maskPath({ width: 100, height: 50 }, { top: 0, left: 0, width: 0, height: 10 }, 8)).toBe('M0 0H100V50H0Z');
  });
});

describe('sameBox', () => {
  it('ігнорує субпіксельне тремтіння', () => {
    expect(sameBox({ top: 1, left: 1, width: 10, height: 10 }, { top: 1.2, left: 1, width: 10, height: 10 })).toBe(true);
    expect(sameBox({ top: 1, left: 1, width: 10, height: 10 }, { top: 3, left: 1, width: 10, height: 10 })).toBe(false);
    expect(sameBox(null, null)).toBe(true);
    expect(sameBox(null, { top: 0, left: 0, width: 0, height: 0 })).toBe(false);
  });
});
