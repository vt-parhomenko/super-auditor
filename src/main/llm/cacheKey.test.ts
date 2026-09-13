import { describe, expect, it } from 'vitest';
import { buildCacheKey, canonicalJson, sha256Hex } from './cacheKey';

const base = {
  stage: 'judge',
  promptVersion: 'judge.v1',
  model: 'claude-opus-5',
};

describe('canonicalJson', () => {
  it('сортує ключі рекурсивно', () => {
    const a = { b: 1, a: { z: [1, 2], y: 'x' } };
    const b = { a: { y: 'x', z: [1, 2] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"a":{"y":"x","z":[1,2]},"b":1}');
  });

  it('зберігає порядок елементів масиву — він змістовний', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('викидає undefined і функції, нормалізує NaN/Infinity', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson({ a: NaN, b: Infinity })).toBe('{"a":null,"b":null}');
  });

  it('серіалізує Date як ISO, Set як відсортований масив', () => {
    expect(canonicalJson(new Date('2026-01-02T03:04:05.000Z'))).toBe('"2026-01-02T03:04:05.000Z"');
    expect(canonicalJson(new Set(['b', 'a']))).toBe(canonicalJson(new Set(['a', 'b'])));
  });
});

describe('buildCacheKey', () => {
  it('стабільний при перестановці ключів у вхідному об\'єкті', () => {
    const first = buildCacheKey({
      ...base,
      input: { doc: { text: 'x', title: 't' }, clauses: [{ no: '10.1', topic: 'a' }] },
    });
    const second = buildCacheKey({
      ...base,
      input: { clauses: [{ topic: 'a', no: '10.1' }], doc: { title: 't', text: 'x' } },
    });
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('змінюється при зміні promptVersion', () => {
    const input = { doc: 'x' };
    expect(buildCacheKey({ ...base, input })).not.toBe(
      buildCacheKey({ ...base, promptVersion: 'judge.v2', input }),
    );
  });

  it('змінюється при зміні моделі', () => {
    const input = { doc: 'x' };
    expect(buildCacheKey({ ...base, input })).not.toBe(
      buildCacheKey({ ...base, model: 'claude-sonnet-5', input }),
    );
  });

  it('змінюється при зміні етапу і при зміні вмісту', () => {
    const input = { doc: 'x' };
    expect(buildCacheKey({ ...base, input })).not.toBe(
      buildCacheKey({ ...base, stage: 'critic', input }),
    );
    expect(buildCacheKey({ ...base, input })).not.toBe(
      buildCacheKey({ ...base, input: { doc: 'y' } }),
    );
  });

  it('дорівнює документованій формулі з architecture.md §9', () => {
    const input = { a: 1 };
    const expected = sha256Hex(
      ['judge', 'judge.v1', 'claude-opus-5', sha256Hex(canonicalJson(input))].join('|'),
    );
    expect(buildCacheKey({ ...base, input })).toBe(expected);
  });
});
