import { describe, expect, it } from 'vitest';
import type { ClauseDto, Module, SiteProfileDto } from '@shared/domain';
import {
  CERTIFICATION_EXEMPTIONS,
  certificationExemptionRule,
  computeApplicability,
  decideApplicability,
  moduleScopeRule,
} from './applicability';

let nextId = 1;

function clause(overrides: Partial<ClauseDto> = {}): ClauseDto {
  const id = nextId++;
  return {
    id,
    specVersionId: 1,
    clauseNo: `1.${id}`,
    sortKey: `001.${String(id).padStart(3, '0')}`,
    sectionNo: '1',
    sectionTitle: 'Leadership Accountability',
    topic: 'Management review',
    requirementText: 'Site management must regularly review all activities…',
    modules: [],
    markers: [],
    obligation: 'must',
    pageFrom: 12,
    pageTo: 12,
    textHash: `hash-${id}`,
    reviewStatus: 'confirmed',
    ...overrides,
  };
}

function site(overrides: Partial<SiteProfileDto> = {}): SiteProfileDto {
  return {
    id: 1,
    name: 'Flowerbulb packer',
    modules: ['P', 'R', 'O'] as Module[],
    certifications: [],
    products: ['ornamental plants'],
    processes: ['packing'],
    notes: null,
    ...overrides,
  };
}

describe('moduleScopeRule', () => {
  it('не має думки про Core-вимоги без модулів', () => {
    expect(moduleScopeRule.evaluate(clause({ modules: [] }), site({ modules: [] }))).toBeNull();
  });

  it('пропускає вимогу, якщо хоч один модуль у scope', () => {
    const c = clause({ modules: ['P', 'R'] });
    expect(moduleScopeRule.evaluate(c, site({ modules: ['R'] }))).toBeNull();
  });

  it('виключає вимогу, коли жоден модуль не у scope', () => {
    const c = clause({ modules: ['P'] });
    const decision = moduleScopeRule.evaluate(c, site({ modules: ['O'] }));

    expect(decision).not.toBeNull();
    expect(decision?.applicable).toBe(false);
    expect(decision?.ruleId).toBe('module-scope');
    expect(decision?.reason).toContain('Product Assurance');
  });

  it('порожній scope виробництва виключає всі вимоги з модулями, але не Core', () => {
    const empty = site({ modules: [] });
    expect(moduleScopeRule.evaluate(clause({ modules: ['P'] }), empty)?.applicable).toBe(false);
    expect(moduleScopeRule.evaluate(clause({ modules: [] }), empty)).toBeNull();
  });
});

describe('certificationExemptionRule', () => {
  const rule = certificationExemptionRule();

  it('ISO 14001 знімає секцію про довкілля', () => {
    const c = clause({ sectionTitle: 'Environment, water and waste management' });
    const decision = rule.evaluate(c, site({ certifications: ['ISO14001'] }));

    expect(decision?.applicable).toBe(false);
    expect(decision?.ruleId).toBe('certification-exemption:iso14001-environment');
  });

  it('розпізнає сертифікат незалежно від пробілів, крапок і регістру', () => {
    const c = clause({ sectionTitle: 'Environment, water and waste management' });
    for (const cert of ['ISO 14001', 'iso-14001', 'Iso.14001', 'ISO14001']) {
      expect(rule.evaluate(c, site({ certifications: [cert] }))?.applicable).toBe(false);
    }
  });

  it('SMETA і SIZA знімають Responsible Sourcing', () => {
    const c = clause({ sectionTitle: 'Responsible Sourcing' });
    expect(rule.evaluate(c, site({ certifications: ['SMETA'] }))?.applicable).toBe(false);
    expect(rule.evaluate(c, site({ certifications: ['SIZA'] }))?.applicable).toBe(false);
  });

  it('без сертифіката секція лишається застосовною', () => {
    const c = clause({ sectionTitle: 'Responsible Sourcing' });
    expect(rule.evaluate(c, site({ certifications: [] }))).toBeNull();
  });

  it('сертифікат не знімає сторонню секцію', () => {
    const c = clause({ sectionTitle: 'Pest management' });
    expect(rule.evaluate(c, site({ certifications: ['ISO14001', 'SMETA'] }))).toBeNull();
  });

  it('не падає на вимозі без назви секції', () => {
    const c = clause({ sectionTitle: null });
    expect(rule.evaluate(c, site({ certifications: ['ISO14001'] }))).toBeNull();
  });

  it('матчить секцію за назвою, а не за номером — номери різні між стандартами', () => {
    const a = clause({ sectionNo: '14', sectionTitle: 'Environment, water and waste management' });
    const b = clause({ sectionNo: '21', sectionTitle: 'Water and waste' });
    const s = site({ certifications: ['ISO14001'] });

    expect(rule.evaluate(a, s)?.applicable).toBe(false);
    expect(rule.evaluate(b, s)?.applicable).toBe(false);
  });
});

describe('decideApplicability', () => {
  it('за замовчуванням вимога застосовна', () => {
    const decision = decideApplicability(clause(), site());
    expect(decision.applicable).toBe(true);
    expect(decision.ruleId).toBeNull();
  });

  it('перше правило, що висловилось, вирішує', () => {
    // Вимога і поза модулями, і покрита сертифікатом — має спрацювати перше.
    const c = clause({ modules: ['P'], sectionTitle: 'Responsible Sourcing' });
    const s = site({ modules: ['O'], certifications: ['SMETA'] });

    expect(decideApplicability(c, s).ruleId).toBe('module-scope');
  });

  it('порожній набір правил робить усе застосовним', () => {
    const c = clause({ modules: ['P'] });
    expect(decideApplicability(c, site({ modules: [] }), []).applicable).toBe(true);
  });
});

describe('computeApplicability', () => {
  it('рахує підсумки і розкладку по правилах', () => {
    const clauses: ClauseDto[] = [
      clause({ modules: [] }), // застосовна
      clause({ modules: ['P'] }), // застосовна: P у scope
      clause({ modules: ['R'] }), // виключена: R поза scope
      clause({ sectionTitle: 'Environment, water and waste management' }), // виключена сертифікатом
      clause({ sectionTitle: 'Pest management' }), // застосовна
    ];
    const s = site({ modules: ['P', 'O'], certifications: ['ISO14001'] });

    const report = computeApplicability(clauses, s);

    expect(report.applicable).toBe(3);
    expect(report.notApplicable).toBe(2);
    expect(report.decisions.size).toBe(5);
    expect(report.byRule['module-scope']).toBe(1);
    expect(report.byRule['certification-exemption:iso14001-environment']).toBe(1);
  });

  it('кожна вимога отримує рішення', () => {
    const clauses = [clause(), clause({ modules: ['R'] })];
    const report = computeApplicability(clauses, site({ modules: ['P'] }));

    for (const c of clauses) {
      expect(report.decisions.has(c.id)).toBe(true);
    }
  });

  it('порожній список вимог не ламає звіт', () => {
    const report = computeApplicability([], site());
    expect(report).toMatchObject({ applicable: 0, notApplicable: 0, byRule: {} });
  });
});

describe('конфігурація звільнень', () => {
  it('кожне звільнення має унікальний id', () => {
    const ids = CERTIFICATION_EXEMPTIONS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('патерни регістронезалежні', () => {
    for (const exemption of CERTIFICATION_EXEMPTIONS) {
      expect(exemption.sectionPattern.flags).toContain('i');
    }
  });
});
