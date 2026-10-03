import { describe, expect, it } from 'vitest';

import { DOCUMENTS, FINDINGS, RUNS, SPECIFICATIONS, CLAUSES, PROSE_CLAUSES } from './fixtures';
import { applyMockDeletion, mockDeleteImpact, type MockLibraryState } from './mockLibraryDeletion';

/** Свіжий стан, як у `mockApi` на старті. */
function freshState(): MockLibraryState {
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  return {
    documents: clone(DOCUMENTS),
    specs: clone(SPECIFICATIONS),
    clauses: clone([...CLAUSES, ...PROSE_CLAUSES]),
    runs: clone(RUNS),
    findings: clone(FINDINGS),
  };
}

describe('mock: видалення специфікацій і документів', () => {
  it('версія Tesco v5.0: дві перевірки за нею, findings і людські рев’ю', () => {
    const state = freshState();
    const impact = mockDeleteImpact(state, { kind: 'specVersion', id: 1 });
    expect(impact).toMatchObject({
      title: 'Tesco Ornamental Plant Standard 2026 v5.0',
      deletesParent: false,
      versions: 1,
      clauses: CLAUSES.length,
    });
    expect(impact?.runs.map((r) => r.id)).toEqual([3, 2]);
    expect(impact?.findings).toBe(FINDINGS.filter((f) => f.runId === 3 || f.runId === 2).length);
    // Ціна нічого не змінює.
    expect(state.runs).toHaveLength(RUNS.length);
  });

  it('документ із перевіркою на три документи: перевірка зникає цілком, інші документи лишаються', () => {
    const state = freshState();
    const impact = applyMockDeletion(state, { kind: 'document', id: 2 });

    expect(impact?.runs.find((r) => r.id === 3)).toMatchObject({ documentCount: 3, otherDocuments: 2 });
    expect(state.documents.map((d) => d.id)).toEqual([1, 3]);
    expect(state.runs.map((r) => r.id)).toEqual([1]);
    expect(state.findings.some((f) => f.runId === 3)).toBe(false);
  });

  it('остання версія забирає й ціле; не остання — ні', () => {
    const state = freshState();
    expect(applyMockDeletion(state, { kind: 'documentVersion', id: 12 })?.deletesParent).toBe(false);
    expect(state.documents.find((d) => d.id === 1)?.versions.map((v) => v.id)).toEqual([11]);

    expect(applyMockDeletion(state, { kind: 'specVersion', id: 3 })?.deletesParent).toBe(true);
    expect(state.specs.some((s) => s.id === 2)).toBe(false);
  });

  it('неіснуюча ціль — null', () => {
    expect(mockDeleteImpact(freshState(), { kind: 'document', id: 404 })).toBeNull();
  });
});
