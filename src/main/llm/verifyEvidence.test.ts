import { describe, expect, it } from 'vitest';
import {
  applyEvidenceRule,
  normalizeForMatch,
  verifyAndAdjust,
  verifyEvidence,
  verifyQuote,
} from './verifyEvidence';

const DOC = [
  '4. Pest management',
  '',
  'The site  has a contract with a licensed pest control contractor.',
  'Monitoring devices are inspected at least every four weeks and the',
  'results are recorded in the pest control logbook.',
].join('\n');

describe('verifyQuote', () => {
  it('точний збіг', () => {
    expect(verifyQuote('results are recorded in the pest control logbook.', DOC)).toBe(true);
  });

  it('збіг із іншими пробілами — переноси і подвійні пробіли згортаються', () => {
    expect(verifyQuote('The site has a contract with a licensed pest control contractor.', DOC)).toBe(true);
    expect(verifyQuote('inspected at least every four weeks and the results are recorded', DOC)).toBe(true);
    expect(verifyQuote('  Monitoring   devices\n\tare inspected  ', DOC)).toBe(true);
  });

  it('збіг в іншому регістрі', () => {
    expect(verifyQuote('MONITORING DEVICES ARE INSPECTED', DOC)).toBe(true);
  });

  it('збіг попри друкарські лапки й тире', () => {
    const source = 'The supplier’s policy — reviewed annually — is approved.';
    expect(verifyQuote("The supplier's policy - reviewed annually - is approved.", source)).toBe(true);
  });

  it('відсутність збігу — перефразування не проходить', () => {
    expect(verifyQuote('Devices are checked monthly by the manager.', DOC)).toBe(false);
  });

  it('порожня цитата ніколи не verified', () => {
    expect(verifyQuote('', DOC)).toBe(false);
    expect(verifyQuote('   \n  ', DOC)).toBe(false);
  });
});

describe('normalizeForMatch', () => {
  it('згортає регістр, пробіли і типографіку', () => {
    expect(normalizeForMatch('  A  B—C”D\n')).toBe('a b-c"d');
  });
});

describe('verifyEvidence', () => {
  it('позначає кожну цитату окремо, не мутуючи вхід', () => {
    const input = [
      { quote: 'results are recorded in the pest control logbook.' },
      { quote: 'daily inspections by an external auditor' },
    ];
    const out = verifyEvidence(input, DOC);
    expect(out.map((item) => item.verified)).toEqual([true, false]);
    expect(input[0]).not.toHaveProperty('verified');
  });

  it('зберігає решту полів доказу', () => {
    const out = verifyEvidence([{ quote: 'Pest management', page: 4 }], DOC);
    expect(out[0]).toMatchObject({ quote: 'Pest management', page: 4, verified: true });
  });
});

describe('applyEvidenceRule', () => {
  it('compliant без жодного доказу → needs_human_review', () => {
    const out = applyEvidenceRule('compliant', []);
    expect(out.verdict).toBe('needs_human_review');
    expect(out.downgraded).toBe(true);
    expect(out.reason).toContain('without any evidence');
  });

  it('compliant з доказами, але жоден не verified → needs_human_review', () => {
    const out = applyEvidenceRule('compliant', [{ verified: false }, { verified: false }]);
    expect(out.verdict).toBe('needs_human_review');
    expect(out.downgraded).toBe(true);
  });

  it('compliant хоча б з одним verified — лишається compliant', () => {
    const out = applyEvidenceRule('compliant', [{ verified: false }, { verified: true }]);
    expect(out).toEqual({ verdict: 'compliant', downgraded: false, reason: null });
  });

  it('правило не чіпає інші вердикти', () => {
    for (const verdict of ['partial', 'non_compliant', 'not_addressed', 'needs_human_review'] as const) {
      expect(applyEvidenceRule(verdict, [])).toEqual({ verdict, downgraded: false, reason: null });
    }
  });
});

describe('verifyAndAdjust', () => {
  it('вигадана цитата під compliant знижує вердикт', () => {
    const out = verifyAndAdjust(
      'compliant',
      [{ quote: 'Devices are checked monthly by the manager.', page: 4 }],
      DOC,
    );
    expect(out.verdict).toBe('needs_human_review');
    expect(out.downgraded).toBe(true);
    expect(out.evidence[0]?.verified).toBe(false);
  });

  it('справжня цитата під compliant вердикт зберігає', () => {
    const out = verifyAndAdjust(
      'compliant',
      [{ quote: 'Monitoring devices are inspected at least every four weeks', page: 4 }],
      DOC,
    );
    expect(out.verdict).toBe('compliant');
    expect(out.downgraded).toBe(false);
    expect(out.evidence[0]?.verified).toBe(true);
  });
});
