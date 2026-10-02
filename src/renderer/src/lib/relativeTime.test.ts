import { describe, expect, it } from 'vitest';

import { relativeParts } from './relativeTime';

describe('relativeParts', () => {
  it('обирає одиницю за величиною різниці', () => {
    expect(relativeParts(-5)).toEqual({ value: -5, unit: 'second' });
    expect(relativeParts(-125)).toEqual({ value: -2, unit: 'minute' });
    expect(relativeParts(-3 * 3600)).toEqual({ value: -3, unit: 'hour' });
    expect(relativeParts(-2 * 86_400)).toEqual({ value: -2, unit: 'day' });
    expect(relativeParts(-65 * 86_400)).toEqual({ value: -2, unit: 'month' });
    expect(relativeParts(-800 * 86_400)).toEqual({ value: -2, unit: 'year' });
  });

  it('майбутнє — додатні значення', () => {
    expect(relativeParts(120)).toEqual({ value: 2, unit: 'minute' });
  });

  it('нуль без знака — щоб Intl сказав «зараз»', () => {
    expect(Object.is(relativeParts(-0.2).value, 0)).toBe(true);
  });
});
