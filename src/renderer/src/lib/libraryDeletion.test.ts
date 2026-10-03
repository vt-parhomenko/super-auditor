import { describe, expect, it } from 'vitest';

import type { LibraryDeleteImpact } from '@shared/ipc';
import { CATALOGS } from '../i18n/catalogs';
import { LOCALES } from '../i18n/locale';
import {
  confirmLabel,
  documentDisplayName,
  impactLines,
  impactRuns,
  needsAcknowledgement,
  routeAfterDeletion,
} from './libraryDeletion';

const uk = CATALOGS.uk.deleteLibrary;
const en = CATALOGS.en.deleteLibrary;
const bytes = (value: number) => `${(value / 1024 / 1024).toFixed(1)} МБ`;

/** Версія Tesco v5.0 з трьома перевірками — приклад із постановки задачі. */
function specVersionImpact(overrides: Partial<LibraryDeleteImpact> = {}): LibraryDeleteImpact {
  return {
    target: { kind: 'specVersion', id: 1 },
    title: 'Tesco Ornamental Plant Standard v5.0',
    parentId: 1,
    deletesParent: false,
    versionIds: [1],
    versions: 1,
    clauses: 183,
    documentProfiles: 0,
    runs: [
      { id: 3, label: 'Tesco v5.0 × 3 SOP', status: 'done', documentCount: 3, otherDocuments: 3 },
      { id: 2, label: null, status: 'running', documentCount: 1, otherDocuments: 1 },
      { id: 1, label: 'Пробна', status: 'failed', documentCount: 2, otherDocuments: 2 },
    ],
    findings: 168,
    reviewedFindings: 12,
    filesToRemove: 2,
    bytesToFree: 1_258_291,
    sharedFilesKept: 0,
    ...overrides,
  };
}

function documentImpact(overrides: Partial<LibraryDeleteImpact> = {}): LibraryDeleteImpact {
  return {
    target: { kind: 'document', id: 2 },
    title: '0068 Pest Management',
    parentId: 2,
    deletesParent: true,
    versionIds: [21, 22],
    versions: 2,
    clauses: 0,
    documentProfiles: 1,
    runs: [{ id: 3, label: null, status: 'done', documentCount: 3, otherDocuments: 2 }],
    findings: 72,
    reviewedFindings: 0,
    filesToRemove: 1,
    bytesToFree: 156_004,
    sharedFilesKept: 1,
    ...overrides,
  };
}

describe('impactLines', () => {
  it('зведення для версії специфікації — українською, з правильними формами множини', () => {
    expect(impactLines(specVersionImpact(), uk, bytes)).toEqual([
      { key: 'target', text: 'версію специфікації «Tesco Ornamental Plant Standard v5.0» (183 вимоги у реєстрі)', tone: 'item' },
      { key: 'runs', text: '3 перевірки документів (168 findings)', tone: 'item' },
      { key: 'reviewed', text: 'з них 12 опрацьовано вручну — це найцінніше, і воно зникне', tone: 'danger' },
      { key: 'files', text: '2 файли з диска (1.2 МБ)', tone: 'item' },
    ]);
  });

  it('лише ненульові рядки; якщо нічого більше не зачеплено — так і каже', () => {
    const lines = impactLines(
      specVersionImpact({ clauses: 0, runs: [], findings: 0, reviewedFindings: 0, filesToRemove: 0, bytesToFree: 0 }),
      uk,
      bytes,
    );
    expect(lines).toEqual([
      { key: 'target', text: 'версію специфікації «Tesco Ornamental Plant Standard v5.0»', tone: 'item' },
      { key: 'nothingElse', text: uk.nothingElse, tone: 'note' },
    ]);
  });

  it('остання версія попереджає, що зникне й ціле', () => {
    const keys = impactLines(specVersionImpact({ deletesParent: true }), uk, bytes).map((l) => l.key);
    expect(keys).toContain('lastVersion');
    // Для цілої специфікації це очевидно — окремого рядка немає.
    const whole = impactLines(
      specVersionImpact({ target: { kind: 'specification', id: 1 }, deletesParent: true, versions: 2 }),
      uk,
      bytes,
    );
    expect(whole.map((l) => l.key)).not.toContain('lastVersion');
    expect(whole[0]?.text).toBe(
      'специфікацію «Tesco Ornamental Plant Standard v5.0» з усіма версіями (2 версії, 183 вимоги у реєстрі)',
    );
  });

  it('документ: версії, профілі, спільний файл, що лишається', () => {
    const lines = impactLines(documentImpact(), uk, bytes);
    expect(lines[0]?.text).toBe('документ «0068 Pest Management» з усіма версіями (2 версії, 1 профіль документа)');
    expect(lines.find((l) => l.key === 'runs')?.text).toBe('1 перевірку документів (72 findings)');
    expect(lines.find((l) => l.key === 'sharedKept')).toEqual({
      key: 'sharedKept',
      text: '1 файл лишається на диску: його використовує інший документ чи специфікація.',
      tone: 'note',
    });
    expect(lines.map((l) => l.key)).not.toContain('reviewed');
  });

  it('англійською — ті самі рядки', () => {
    expect(impactLines(specVersionImpact(), en, bytes).map((l) => l.text)).toEqual([
      'the specification version “Tesco Ornamental Plant Standard v5.0” (183 clauses in the registry)',
      '3 document checks (168 findings)',
      '12 of those findings were reviewed by hand — the most valuable part, and it will be lost',
      '2 files from disk (1.2 МБ)',
    ]);
  });

  it('усі мови дають однаковий набір рядків', () => {
    const reference = impactLines(documentImpact(), en, bytes).map((l) => l.key);
    for (const locale of LOCALES) {
      expect(impactLines(documentImpact(), CATALOGS[locale].deleteLibrary, bytes).map((l) => l.key)).toEqual(reference);
    }
  });
});

describe('impactRuns', () => {
  it('для документа позначає перевірки, що охоплюють і інші документи', () => {
    expect(impactRuns(documentImpact(), uk)).toEqual([
      { id: 3, name: uk.runUnnamed, status: 'done', notes: ['також містить ще 2 документи — буде видалена повністю'] },
    ]);
  });

  it('для специфікації «інші документи» — шум і не показуються; жива перевірка — показується', () => {
    expect(impactRuns(specVersionImpact(), uk)).toEqual([
      { id: 3, name: 'Tesco v5.0 × 3 SOP', status: 'done', notes: [] },
      { id: 2, name: 'без назви', status: 'running', notes: ['ще виконується — спершу буде зупинена'] },
      { id: 1, name: 'Пробна', status: 'failed', notes: [] },
    ]);
  });
});

describe('кнопка й згода', () => {
  it('кнопка називає, що саме зникне', () => {
    expect(confirmLabel(specVersionImpact(), uk)).toBe('Видалити версію і 3 перевірки');
    expect(confirmLabel(documentImpact(), uk)).toBe('Видалити документ і 1 перевірку');
    expect(confirmLabel(documentImpact({ runs: [] }), uk)).toBe('Видалити документ');
    expect(confirmLabel(specVersionImpact({ runs: [] }), CATALOGS.nl.deleteLibrary)).toBe('Versie verwijderen');
    expect(confirmLabel(specVersionImpact(), en)).toBe('Delete the version and 3 checks');
  });

  it('окрема згода — лише коли зникнуть людські вердикти', () => {
    expect(needsAcknowledgement(specVersionImpact())).toBe(true);
    expect(needsAcknowledgement(documentImpact())).toBe(false);
  });
});

describe('routeAfterDeletion', () => {
  it('з реєстру видаленої версії — до специфікацій', () => {
    expect(routeAfterDeletion('/specs/1/clauses', specVersionImpact())).toBe('/specs');
    expect(routeAfterDeletion('/specs/7/clauses', specVersionImpact())).toBeNull();
  });

  it('зі сторінки видаленого документа — до бібліотеки, але не якщо документ лишився', () => {
    expect(routeAfterDeletion('/library/2/runs', documentImpact())).toBe('/library');
    expect(
      routeAfterDeletion(
        '/library/2/runs',
        documentImpact({ target: { kind: 'documentVersion', id: 21 }, deletesParent: false, versionIds: [21] }),
      ),
    ).toBeNull();
  });

  it('зі сторінки видаленої перевірки — до списку перевірок', () => {
    expect(routeAfterDeletion('/runs/3/findings', documentImpact())).toBe('/runs');
    expect(routeAfterDeletion('/runs/3', documentImpact())).toBe('/runs');
    expect(routeAfterDeletion('/runs/31/coverage', documentImpact())).toBeNull();
    expect(routeAfterDeletion('/library', documentImpact())).toBeNull();
  });
});

it('назва документа — з номером, як у main', () => {
  expect(documentDisplayName('Pest Management', '0068')).toBe('0068 Pest Management');
  expect(documentDisplayName('Pest Management', null)).toBe('Pest Management');
});
