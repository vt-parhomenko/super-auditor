import { describe, expect, it } from 'vitest';

import type { MarkerLegendItem } from '@shared/domain';
import {
  formatMarkerInput,
  legendItemText,
  markerEditorMode,
  markerHints,
  markerTitle,
  parseMarkerInput,
  registryMarkerView,
  sameMarkers,
  toggleMarker,
  usedMarkers,
} from './markers';

const TESCO: MarkerLegendItem[] = [
  { code: 'P', label: 'Policy / procedure', meaning: 'The site must have a documented policy/procedure.' },
  { code: 'R', label: 'Records', meaning: 'The site must have accurately completed records.' },
  { code: 'O', label: 'Observation', meaning: null },
];

const clauses = (...markers: string[][]) => markers.map((m) => ({ markers: m }));

describe('registryMarkerView', () => {
  it('є легенда — рядок легенди; позначки поза легендою окремо', () => {
    expect(registryMarkerView(TESCO, clauses(['P', 'R'], ['X'], []))).toEqual({
      kind: 'legend',
      items: TESCO,
      unexplained: ['X'],
    });
  });

  it('регістр і пробіли не роблять позначку «непоясненою»', () => {
    const view = registryMarkerView(TESCO, clauses(['p']));
    expect(view.kind === 'legend' && view.unexplained).toEqual([]);
  });

  it('позначки є, легенди немає — коди з приміткою', () => {
    expect(registryMarkerView(null, clauses(['Major Must'], ['Minor Must', 'Major Must']))).toEqual({
      kind: 'unexplained',
      codes: ['Major Must', 'Minor Must'],
    });
    expect(registryMarkerView([], clauses(['F'])).kind).toBe('unexplained');
  });

  it('позначок немає — нічого (а не порожні P R O)', () => {
    expect(registryMarkerView(null, clauses([], []))).toEqual({ kind: 'none' });
    expect(registryMarkerView(undefined, [])).toEqual({ kind: 'none' });
  });
});

describe('підписи й підказки', () => {
  it('«P — Policy / procedure», а без назви — лише код', () => {
    expect(legendItemText(TESCO[0]!)).toBe('P — Policy / procedure');
    expect(legendItemText({ code: 'F', label: 'F', meaning: null })).toBe('F');
  });

  it('підказка значка — назва і пояснення стандарту', () => {
    expect(markerTitle('P', TESCO)).toBe('P — Policy / procedure: The site must have a documented policy/procedure.');
    expect(markerTitle('O', TESCO)).toBe('O — Observation');
    // Без легенди значення не вигадується.
    expect(markerTitle('Major Must', null)).toBe('Major Must');
    expect(markerTitle('X', TESCO)).toBe('X');
  });

  it('usedMarkers — у порядку першої появи', () => {
    expect(usedMarkers(clauses(['R'], ['P', 'R'], ['O']))).toEqual(['R', 'P', 'O']);
  });

  it('markerHints — пояснення позначок вимоги; непояснені — без тексту', () => {
    expect(markerHints(['P', 'r', 'X', 'F'], [...TESCO, { code: 'F', label: 'F', meaning: null }])).toEqual([
      { code: 'P', text: 'P — Policy / procedure: The site must have a documented policy/procedure.' },
      // Регістр не робить позначку непоясненою.
      { code: 'r', text: 'R — Records: The site must have accurately completed records.' },
      // Легенда не знає коду — значення не вигадується.
      { code: 'X', text: null },
      // Легенда лише повторює код — пояснення теж немає.
      { code: 'F', text: null },
    ]);
    // Назва без пояснення — це вже щось.
    expect(markerHints(['O'], TESCO)).toEqual([{ code: 'O', text: 'O — Observation' }]);
    expect(markerHints(['P'], null)).toEqual([{ code: 'P', text: null }]);
  });
});

describe('markerEditorMode', () => {
  it('з легендою — прапорці на коди легенди плюс власні коди вимоги', () => {
    const mode = markerEditorMode(TESCO, clauses(['P']), ['P', 'X']);
    expect(mode).toEqual({
      kind: 'checkboxes',
      options: [
        { code: 'P', label: 'Policy / procedure', meaning: 'The site must have a documented policy/procedure.' },
        { code: 'R', label: 'Records', meaning: 'The site must have accurately completed records.' },
        { code: 'O', label: 'Observation', meaning: null },
        { code: 'X', label: 'X', meaning: null },
      ],
    });
  });

  it('без легенди — поле вводу, лише якщо версія має позначки', () => {
    expect(markerEditorMode(null, clauses([], ['Major Must']), [])).toEqual({ kind: 'text' });
    expect(markerEditorMode(null, clauses([]), ['Fundamental'])).toEqual({ kind: 'text' });
    expect(markerEditorMode(null, clauses([], []), [])).toEqual({ kind: 'none' });
  });
});

describe('редагування', () => {
  const options = [{ code: 'P' }, { code: 'R' }, { code: 'O' }].map((o) => ({ ...o, label: o.code, meaning: null }));

  it('toggleMarker тримає порядок легенди, а не порядок кліків', () => {
    expect(toggleMarker(['O'], 'P', options)).toEqual(['P', 'O']);
    expect(toggleMarker(['P', 'O'], 'P', options)).toEqual(['O']);
    expect(toggleMarker(['P'], 'X', options)).toEqual(['P', 'X']);
  });

  it('поле вводу: через кому, нормалізація як у main', () => {
    expect(parseMarkerInput(' Major Must , Recommendation,, Major Must ')).toEqual(['Major Must', 'Recommendation']);
    expect(parseMarkerInput('')).toEqual([]);
    expect(formatMarkerInput(['Major Must', 'Recommendation'])).toBe('Major Must, Recommendation');
  });

  it('sameMarkers враховує порядок і склад', () => {
    expect(sameMarkers(['P', 'R'], ['P', 'R'])).toBe(true);
    expect(sameMarkers(['P', 'R'], ['R', 'P'])).toBe(false);
    expect(sameMarkers(['P'], ['P', 'R'])).toBe(false);
  });
});
