import { describe, expect, it } from 'vitest';

import {
  MARKER_MAX_COUNT,
  MARKER_MAX_LENGTH,
  clauseSortKey,
  legendEntriesFor,
  markerKey,
  normalizeMarkers,
} from './domain';

describe('clauseSortKey', () => {
  it('числові номери — як і раніше: кожна частина доповнена до трьох цифр', () => {
    expect(clauseSortKey('10.3')).toBe('010.003');
    expect(clauseSortKey('1.12')).toBe('001.012');
    expect(clauseSortKey('4.2.1')).toBe('004.002.001');
    expect(clauseSortKey(' 7 ')).toBe('007');
  });

  it('буквено-цифрові номери інших стандартів', () => {
    expect(clauseSortKey('A.5.1')).toBe('A.005.001');
    expect(clauseSortKey('AF 1.2.3')).toBe('AF 001.002.003');
    expect(clauseSortKey('FV 5.1.2')).toBe('FV 005.001.002');
    expect(clauseSortKey('10.3a')).toBe('010.003a');
  });

  it('порядок: 10.2 < 10.10, AF 2 < AF 10, основна частина < додаток A', () => {
    const sorted = (numbers: string[]) =>
      [...numbers].sort((a, b) => (clauseSortKey(a) < clauseSortKey(b) ? -1 : 1));

    expect(sorted(['10.10', '2.1', '10.2'])).toEqual(['2.1', '10.2', '10.10']);
    expect(sorted(['AF 10.1.1', 'AF 2.1.1', 'AF 1.1.1'])).toEqual(['AF 1.1.1', 'AF 2.1.1', 'AF 10.1.1']);
    expect(sorted(['A.5.1', '10.2', '4.1', 'A.10.1', 'A.6.1'])).toEqual(['4.1', '10.2', 'A.5.1', 'A.6.1', 'A.10.1']);
    expect(sorted(['10.3a', '10.4', '10.3'])).toEqual(['10.3', '10.3a', '10.4']);
  });

  it('не падає на сміттєвих номерах', () => {
    expect(clauseSortKey('')).toBe('');
    expect(clauseSortKey('Requirements')).toBe('Requirements');
    expect(clauseSortKey('1..2')).toBe('001..002');
  });
});

describe('normalizeMarkers', () => {
  it('обрізає пробіли, прибирає порожні й дублі, зберігає порядок', () => {
    expect(normalizeMarkers([' P ', 'R', 'P', '', '  ', 'Major   Must'])).toEqual(['P', 'R', 'Major Must']);
  });

  it('відкидає не рядки і задовгі «позначки»', () => {
    expect(normalizeMarkers(['O', 42, null, 'x'.repeat(MARKER_MAX_LENGTH + 1), 'x'.repeat(MARKER_MAX_LENGTH)])).toEqual([
      'O',
      'x'.repeat(MARKER_MAX_LENGTH),
    ]);
  });

  it('не більше MARKER_MAX_COUNT', () => {
    const many = Array.from({ length: MARKER_MAX_COUNT + 3 }, (_, i) => `M${i}`);
    expect(normalizeMarkers(many)).toHaveLength(MARKER_MAX_COUNT);
  });
});

describe('legendEntriesFor', () => {
  const LEGEND = [
    { code: 'P', label: 'Policy / procedure', meaning: 'Documented procedure.' },
    { code: 'R', label: 'Records', meaning: 'Completed records.' },
    { code: 'Major Must', label: 'Major Must', meaning: null },
  ];

  it('лише пункти для позначок вимоги, у порядку її позначок', () => {
    expect(legendEntriesFor(['R', 'P'], LEGEND).map((item) => item.code)).toEqual(['R', 'P']);
    expect(legendEntriesFor(['P'], LEGEND)).toEqual([LEGEND[0]]);
  });

  it('регістр і пробіли не заважають; невідомі коди й дублікати пропускаються', () => {
    expect(legendEntriesFor(['major  must', 'X', 'p', 'P'], LEGEND).map((item) => item.code)).toEqual([
      'Major Must',
      'P',
    ]);
  });

  it('без легенди чи позначок — порожньо', () => {
    expect(legendEntriesFor(['P'], null)).toEqual([]);
    expect(legendEntriesFor(['P'], [])).toEqual([]);
    expect(legendEntriesFor([], LEGEND)).toEqual([]);
  });

  it('markerKey — без регістру й зайвих пробілів', () => {
    expect(markerKey('  MAJOR   Must ')).toBe('major must');
  });
});
