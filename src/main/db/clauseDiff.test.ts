import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clauseTextHash, normalizeClauseText, type Db } from './index';
import { seed, type SeedResult } from './fixtures';

let s: SeedResult;
let db: Db;
let v50: number;
let v51: number;

function addV51(clauses: Array<{ clauseNo: string; text: string; sectionNo?: string }>): number {
  const version = db.specs.addVersion({
    specificationId: s.specificationId,
    versionLabel: '5.1',
    blobHash: s.specBlob,
  });
  db.clauses.createMany(
    version.id,
    clauses.map((c) => ({
      clauseNo: c.clauseNo,
      sectionNo: c.sectionNo ?? c.clauseNo.split('.')[0] ?? null,
      requirementText: c.text,
    })),
  );
  return version.id;
}

/** Тексти вимог v5.0 з фікстури. */
const V50 = {
  '3.1': 'The site must hold a valid third-party ethical audit.',
  '10.1': 'A documented pest management programme must be in place.',
  '10.2': 'Pest control must be carried out by a competent contractor.',
  '10.3': 'The programme must specify the minimum elements listed below.',
  '14.1': 'The site should minimise water use and manage waste responsibly.',
} as const;

beforeEach(() => {
  s = seed({ withRun: false });
  db = s.db;
  v50 = s.specVersionId;
  v51 = 0;
});

afterEach(() => {
  db.close();
});

describe('clauseTextHash', () => {
  it('нормалізує пробіли й юнікод перед хешуванням', () => {
    expect(normalizeClauseText('  a\n\n b\tc ')).toBe('a b c');
    expect(clauseTextHash('a b c')).toBe(clauseTextHash(' a\nb\t c '));
    expect(clauseTextHash('a b c')).not.toBe(clauseTextHash('a b d'));
    expect(clauseTextHash('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('clauses.diff', () => {
  it('ідентичні версії — усе unchanged', () => {
    v51 = addV51(Object.entries(V50).map(([clauseNo, text]) => ({ clauseNo, text })));
    const diff = db.clauses.diff(v50, v51);

    expect(diff).toMatchObject({
      fromSpecVersionId: v50,
      toSpecVersionId: v51,
      added: [],
      removed: [],
      modified: [],
      renumbered: [],
      unchanged: 5,
    });
    expect(diff.entries).toEqual([]);
  });

  it('added — нова вимога в новій версії', () => {
    v51 = addV51([
      ...Object.entries(V50).map(([clauseNo, text]) => ({ clauseNo, text })),
      { clauseNo: '10.4', text: 'A new requirement about monitoring devices.' },
    ]);
    const diff = db.clauses.diff(v50, v51);

    expect(diff.added.map((c) => c.clauseNo)).toEqual(['10.4']);
    expect(diff.removed).toEqual([]);
    expect(diff.unchanged).toBe(5);
    expect(diff.entries).toContainEqual({ kind: 'added', clause: diff.added[0] });
  });

  it('removed — вимога зникла', () => {
    v51 = addV51(
      Object.entries(V50)
        .filter(([clauseNo]) => clauseNo !== '14.1')
        .map(([clauseNo, text]) => ({ clauseNo, text })),
    );
    const diff = db.clauses.diff(v50, v51);

    expect(diff.removed.map((c) => c.clauseNo)).toEqual(['14.1']);
    expect(diff.added).toEqual([]);
    expect(diff.unchanged).toBe(4);
  });

  it('modified — той самий номер, інший текст', () => {
    v51 = addV51([
      ...Object.entries(V50)
        .filter(([clauseNo]) => clauseNo !== '10.2')
        .map(([clauseNo, text]) => ({ clauseNo, text })),
      { clauseNo: '10.2', text: 'Pest control must be carried out by a BPCA-certified contractor.' },
    ]);
    const diff = db.clauses.diff(v50, v51);

    expect(diff.modified).toHaveLength(1);
    expect(diff.modified[0]?.from.clauseNo).toBe('10.2');
    expect(diff.modified[0]?.to.clauseNo).toBe('10.2');
    expect(diff.modified[0]?.from.textHash).not.toBe(diff.modified[0]?.to.textHash);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.unchanged).toBe(4);
  });

  it('renumbered — інший номер, той самий текст', () => {
    v51 = addV51([
      ...Object.entries(V50)
        .filter(([clauseNo]) => clauseNo !== '10.3')
        .map(([clauseNo, text]) => ({ clauseNo, text })),
      { clauseNo: '11.7', text: V50['10.3'], sectionNo: '11' },
    ]);
    const diff = db.clauses.diff(v50, v51);

    expect(diff.renumbered).toHaveLength(1);
    expect(diff.renumbered[0]?.from.clauseNo).toBe('10.3');
    expect(diff.renumbered[0]?.to.clauseNo).toBe('11.7');
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.unchanged).toBe(4);
  });

  it('переформатування тексту не рахується змінами', () => {
    v51 = addV51(
      Object.entries(V50).map(([clauseNo, text]) => ({
        clauseNo,
        text: `\n  ${text.replace(/ /g, '   ')}  \n`,
      })),
    );
    const diff = db.clauses.diff(v50, v51);
    expect(diff.modified).toEqual([]);
    expect(diff.unchanged).toBe(5);
  });

  it('усі чотири види разом', () => {
    v51 = addV51([
      { clauseNo: '3.1', text: V50['3.1'] }, // unchanged
      { clauseNo: '10.1', text: 'A documented and approved pest management programme must be in place.' }, // modified
      { clauseNo: '10.2', text: V50['10.2'] }, // unchanged
      { clauseNo: '11.7', text: V50['10.3'], sectionNo: '11' }, // renumbered з 10.3
      { clauseNo: '15.1', text: 'Brand-new requirement.', sectionNo: '15' }, // added
      // 14.1 відсутня → removed
    ]);
    const diff = db.clauses.diff(v50, v51);

    expect(diff.unchanged).toBe(2);
    expect(diff.modified.map((m) => m.to.clauseNo)).toEqual(['10.1']);
    expect(diff.renumbered.map((m) => `${m.from.clauseNo}→${m.to.clauseNo}`)).toEqual(['10.3→11.7']);
    expect(diff.added.map((c) => c.clauseNo)).toEqual(['15.1']);
    expect(diff.removed.map((c) => c.clauseNo)).toEqual(['14.1']);
    expect(diff.entries).toHaveLength(4);
  });

  it('дублікати text_hash зіставляються детерміновано, а не як added+removed', () => {
    const shared = 'Records must be retained for two years.';
    const base = db.specs.addVersion({
      specificationId: s.specificationId,
      versionLabel: '4.0',
      blobHash: s.specBlob,
    });
    db.clauses.createMany(base.id, [
      { clauseNo: '1.1', requirementText: shared },
      { clauseNo: '1.2', requirementText: shared },
    ]);

    const next = db.specs.addVersion({
      specificationId: s.specificationId,
      versionLabel: '4.1',
      blobHash: s.specBlob,
    });
    db.clauses.createMany(next.id, [
      { clauseNo: '2.1', requirementText: shared },
      { clauseNo: '2.2', requirementText: shared },
    ]);

    const diff = db.clauses.diff(base.id, next.id);
    expect(diff.renumbered.map((m) => `${m.from.clauseNo}→${m.to.clauseNo}`)).toEqual([
      '1.1→2.1',
      '1.2→2.2',
    ]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it('діф із порожньою версією', () => {
    const empty = db.specs.addVersion({
      specificationId: s.specificationId,
      versionLabel: '6.0',
      blobHash: s.specBlob,
    });
    expect(db.clauses.diff(v50, empty.id).removed).toHaveLength(5);
    expect(db.clauses.diff(empty.id, v50).added).toHaveLength(5);
  });
});
