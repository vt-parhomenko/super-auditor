import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FindingQuery, Verdict } from '@shared/domain';
import type { Db } from './index';
import { requireId, seed, type SeedResult } from './fixtures';

let s: SeedResult;
let db: Db;

/** clauseNo → id, коротко. */
function cid(no: string): number {
  return requireId(s.clauseIds, no);
}

/**
 * Реалістичний зріз прогону:
 *   10.1 — compliant у Pest, not_addressed у Damaged
 *   10.2 — partial (major) у Pest, not_addressed у Damaged
 *   10.3 — not_addressed в обох            → gap
 *   3.1  — non_compliant (critical) у Damaged
 *   14.1 — не застосовна (ISO 14001)       → не gap
 */
function fillFindings(): void {
  db.findings.upsert({
    runId: s.runId,
    clauseId: cid('10.1'),
    documentVersionId: s.pestVersionId,
    verdict: 'compliant',
    severity: null,
    confidence: 0.9,
    rationale: 'Програма контролю шкідників задокументована.',
    createdAt: '2026-08-30T10:00:00.000Z',
    evidence: [
      {
        documentVersionId: s.pestVersionId,
        quote: 'Pest management programme is documented',
        pageNo: 1,
        charStart: 0,
        charEnd: 38,
        source: 'citations_api',
        verified: true,
      },
      {
        documentVersionId: s.pestVersionId,
        quote: 'reviewed annually',
        pageNo: 1,
        source: 'model_quote',
        verified: false,
      },
    ],
  });

  db.findings.upsert({
    runId: s.runId,
    clauseId: cid('10.1'),
    documentVersionId: s.damagedVersionId,
    verdict: 'not_addressed',
    rationale: 'Документ не згадує контроль шкідників.',
  });

  db.findings.upsert({
    runId: s.runId,
    clauseId: cid('10.2'),
    documentVersionId: s.pestVersionId,
    verdict: 'partial',
    severity: 'major',
    rationale: 'Підрядник згаданий, компетентність не підтверджена.',
    gap: 'Немає доказів компетентності підрядника.',
    recommendation: 'Додати сертифікат підрядника.',
  });

  db.findings.upsert({
    runId: s.runId,
    clauseId: cid('10.2'),
    documentVersionId: s.damagedVersionId,
    verdict: 'not_addressed',
    rationale: 'Поза темою документа.',
  });

  db.findings.upsert({
    runId: s.runId,
    clauseId: cid('10.3'),
    documentVersionId: s.pestVersionId,
    verdict: 'not_addressed',
    severity: 'minor',
    rationale: 'Перелік мінімальних елементів відсутній.',
  });

  db.findings.upsert({
    runId: s.runId,
    clauseId: cid('10.3'),
    documentVersionId: s.damagedVersionId,
    verdict: 'not_addressed',
    severity: 'major',
    rationale: 'Поза темою документа.',
  });

  db.findings.upsert({
    runId: s.runId,
    clauseId: cid('3.1'),
    documentVersionId: s.damagedVersionId,
    verdict: 'non_compliant',
    severity: 'critical',
    rationale: 'Ethical audit прострочено.',
  });
}

beforeEach(() => {
  s = seed();
  db = s.db;
  fillFindings();
});

afterEach(() => {
  db.close();
});

describe('findings — запис і читання', () => {
  it('круговий рейс із доказами й рев’ю', () => {
    const list = db.findings.list({ runId: s.runId, verdicts: ['compliant'] });
    const finding = list.items[0];
    expect(finding).toBeDefined();
    if (!finding) return;

    expect(finding).toMatchObject({
      runId: s.runId,
      clauseId: cid('10.1'),
      documentVersionId: s.pestVersionId,
      verdict: 'compliant',
      severity: null,
      confidence: 0.9,
      gap: null,
      recommendation: null,
      outsideEvidence: null,
      createdAt: '2026-08-30T10:00:00.000Z',
      review: null,
    });
    expect(finding.clause).toEqual({
      clauseNo: '10.1',
      sectionNo: '10',
      sectionTitle: 'Pest management',
      topic: 'Pest management programme',
      obligation: 'must',
      // Сторінки оригіналу — основа переходу з finding до тексту стандарту.
      pageFrom: 41,
      pageTo: 41,
    });
    expect(finding.evidence).toHaveLength(2);
    expect(finding.evidence[0]).toMatchObject({
      quote: 'Pest management programme is documented',
      pageNo: 1,
      charStart: 0,
      charEnd: 38,
      source: 'citations_api',
      verified: true,
    });
    expect(finding.evidence[1]?.verified).toBe(false);

    expect(db.findings.get(finding.id)).toEqual(finding);
  });

  it('upsert ідемпотентний і перезаписує докази', () => {
    const before = db.findings.list({ runId: s.runId }).total;
    const updated = db.findings.upsert({
      runId: s.runId,
      clauseId: cid('10.1'),
      documentVersionId: s.pestVersionId,
      verdict: 'partial',
      rationale: 'перегляд',
      evidence: [{ documentVersionId: s.pestVersionId, quote: 'нова цитата', source: 'model_quote' }],
    });
    expect(db.findings.list({ runId: s.runId }).total).toBe(before);
    expect(updated.verdict).toBe('partial');
    expect(updated.evidence).toHaveLength(1);
  });

  it('«перевірити поза документом»: круговий рейс, перезапис, upsertMany і пошук', () => {
    const base = {
      runId: s.runId,
      clauseId: cid('10.1'),
      documentVersionId: s.pestVersionId,
      verdict: 'compliant' as const,
      rationale: 'Процедура описана повністю.',
    };
    const saved = db.findings.upsert({
      ...base,
      outsideEvidence: 'Inspect the signed pest-control visit reports for the last 12 months.',
    });
    expect(saved.outsideEvidence).toBe('Inspect the signed pest-control visit reports for the last 12 months.');
    expect(db.findings.get(saved.id)?.outsideEvidence).toBe(saved.outsideEvidence);
    // Пошук бачить і це поле: «де мені дивитись записи» — природний запит аудитора.
    expect(db.findings.list({ runId: s.runId, search: 'visit reports' }).items.map((f) => f.id)).toEqual([saved.id]);

    // Повторний upsert без поля — нічого перевіряти поза документом (як у judge.v1).
    expect(db.findings.upsert(base).outsideEvidence).toBeNull();

    const [many] = db.findings.upsertMany([{ ...base, outsideEvidence: 'Observe bait stations on site.' }]);
    expect(many?.id).toBe(saved.id);
    expect(db.findings.listByRun(s.runId).find((f) => f.id === saved.id)?.outsideEvidence).toBe(
      'Observe bait stations on site.',
    );
  });

  it('UNIQUE (run_id, clause_id, document_version_id)', () => {
    expect(() =>
      db.raw
        .prepare(
          `INSERT INTO finding (run_id, clause_id, document_version_id, verdict, rationale, created_at)
           VALUES (?, ?, ?, 'compliant', 'дубль', '2026-01-01')`,
        )
        .run(s.runId, cid('10.1'), s.pestVersionId),
    ).toThrow(/UNIQUE/i);
  });

  it('зведений finding (documentVersionId = null) живе окремо', () => {
    const summary = db.findings.upsert({
      runId: s.runId,
      clauseId: cid('10.3'),
      documentVersionId: null,
      verdict: 'not_addressed',
      rationale: 'Жоден документ не покриває.',
    });
    expect(summary.documentVersionId).toBeNull();
    expect(db.findings.findId(s.runId, cid('10.3'), null)).toBe(summary.id);

    // upsert знаходить його попри NULL != NULL у SQLite
    const again = db.findings.upsert({
      runId: s.runId,
      clauseId: cid('10.3'),
      documentVersionId: null,
      verdict: 'partial',
      rationale: 'оновлено',
    });
    expect(again.id).toBe(summary.id);
  });

  it('видалення finding каскадно чистить докази й рев’ю', () => {
    const finding = db.findings.list({ runId: s.runId, verdicts: ['compliant'] }).items[0];
    expect(finding).toBeDefined();
    if (!finding) return;
    db.findings.saveReview(finding.id, { humanVerdict: 'partial', humanSeverity: 'minor', note: 'ні' });

    db.findings.delete(finding.id);
    expect(db.findings.listEvidence(finding.id)).toEqual([]);
    expect(db.findings.getReview(finding.id)).toBeNull();
  });

  it('верифікація цитат', () => {
    const finding = db.findings.list({ runId: s.runId, verdicts: ['compliant'] }).items[0];
    expect(finding).toBeDefined();
    if (!finding) return;
    expect(db.findings.hasVerifiedEvidence(finding.id)).toBe(true);

    for (const ev of finding.evidence) db.findings.setEvidenceVerified(ev.id, false);
    expect(db.findings.hasVerifiedEvidence(finding.id)).toBe(false);
  });
});

describe('findings.list — фільтри', () => {
  const q = (extra: Partial<FindingQuery> = {}): FindingQuery => ({ runId: s.runId, ...extra });

  it('без фільтрів: усе, відсортоване за sortKey вимоги', () => {
    const page = db.findings.list(q());
    expect(page.total).toBe(7);
    expect(page.items).toHaveLength(7);
    expect(page.items.map((f) => f.clause.clauseNo)).toEqual([
      '3.1',
      '10.1',
      '10.1',
      '10.2',
      '10.2',
      '10.3',
      '10.3',
    ]);
  });

  it('фільтр verdicts (кілька значень)', () => {
    expect(db.findings.list(q({ verdicts: ['not_addressed'] })).total).toBe(4);
    const two = db.findings.list(q({ verdicts: ['compliant', 'non_compliant'] }));
    expect(two.total).toBe(2);
    expect(two.items.map((f) => f.verdict).sort()).toEqual(['compliant', 'non_compliant']);
    expect(db.findings.list(q({ verdicts: ['not_applicable'] })).total).toBe(0);
  });

  it('фільтр severities', () => {
    expect(db.findings.list(q({ severities: ['critical'] })).total).toBe(1);
    expect(db.findings.list(q({ severities: ['major', 'minor'] })).total).toBe(3);
  });

  it('фільтр sectionNo', () => {
    expect(db.findings.list(q({ sectionNo: '10' })).total).toBe(6);
    expect(db.findings.list(q({ sectionNo: '3' })).total).toBe(1);
    expect(db.findings.list(q({ sectionNo: '14' })).total).toBe(0);
  });

  it('фільтр documentVersionId', () => {
    expect(db.findings.list(q({ documentVersionId: s.pestVersionId })).total).toBe(3);
    expect(db.findings.list(q({ documentVersionId: s.damagedVersionId })).total).toBe(4);
  });

  it('фільтр unreviewed в обидва боки', () => {
    const first = db.findings.list(q({ verdicts: ['compliant'] })).items[0];
    expect(first).toBeDefined();
    if (!first) return;
    db.findings.saveReview(first.id, { humanVerdict: 'partial', humanSeverity: 'minor', note: 'не згоден' });

    expect(db.findings.list(q({ unreviewed: true })).total).toBe(6);
    const reviewed = db.findings.list(q({ unreviewed: false }));
    expect(reviewed.total).toBe(1);
    expect(reviewed.items[0]?.review).toMatchObject({
      humanVerdict: 'partial',
      humanSeverity: 'minor',
      note: 'не згоден',
    });

    db.findings.clearReview(first.id);
    expect(db.findings.list(q({ unreviewed: true })).total).toBe(7);
  });

  it('пошук по rationale, gap, recommendation і полях вимоги', () => {
    expect(db.findings.list(q({ search: 'підрядник' })).total).toBe(1);
    expect(db.findings.list(q({ search: 'компетентності' })).total).toBe(1);
    expect(db.findings.list(q({ search: 'сертифікат' })).total).toBe(1);
    // requirement_text вимоги 10.2 — обидва findings по ній
    expect(db.findings.list(q({ search: 'contractor' })).total).toBe(2);
    expect(db.findings.list(q({ search: '10.3' })).total).toBe(2); // clause_no
    expect(db.findings.list(q({ search: '%' })).total).toBe(0); // спецсимвол LIKE екранується
  });

  it('комбінація всіх фільтрів разом', () => {
    const page = db.findings.list(
      q({
        verdicts: ['partial'],
        severities: ['major'],
        sectionNo: '10',
        documentVersionId: s.pestVersionId,
        unreviewed: true,
        search: 'підрядник',
      }),
    );
    expect(page.total).toBe(1);
    expect(page.items[0]?.clause.clauseNo).toBe('10.2');
  });

  it('комбінація, що не має збігів', () => {
    const page = db.findings.list(q({ verdicts: ['compliant'], sectionNo: '3' }));
    expect(page).toEqual({ items: [], total: 0 });
  });

  it('пагінація: total не залежить від limit/offset', () => {
    const first = db.findings.list(q({ limit: 3, offset: 0 }));
    expect(first.total).toBe(7);
    expect(first.items).toHaveLength(3);

    const second = db.findings.list(q({ limit: 3, offset: 3 }));
    expect(second.total).toBe(7);
    expect(second.items).toHaveLength(3);

    const third = db.findings.list(q({ limit: 3, offset: 6 }));
    expect(third.items).toHaveLength(1);

    const ids = new Set([...first.items, ...second.items, ...third.items].map((f) => f.id));
    expect(ids.size).toBe(7);

    expect(db.findings.list(q({ limit: 10, offset: 100 })).items).toEqual([]);
  });

  it('докази й рев’ю підвантажуються пакетно для всієї сторінки', () => {
    const withEvidence = db.findings.list(q({ verdicts: ['compliant'] })).items[0];
    expect(withEvidence?.evidence).toHaveLength(2);
    const withoutEvidence = db.findings.list(q({ verdicts: ['non_compliant'] })).items[0];
    expect(withoutEvidence?.evidence).toEqual([]);
  });

  it('фільтр по вердикту дивиться на вердикт МОДЕЛІ (ADR-6)', () => {
    const first = db.findings.list(q({ verdicts: ['compliant'] })).items[0];
    expect(first).toBeDefined();
    if (!first) return;
    db.findings.saveReview(first.id, { humanVerdict: 'non_compliant', humanSeverity: 'major', note: null });

    // сирий вердикт лишився compliant
    expect(db.findings.list(q({ verdicts: ['compliant'] })).total).toBe(1);
    expect(db.findings.get(first.id)?.verdict).toBe('compliant');
    expect(db.findings.get(first.id)?.review?.humanVerdict).toBe('non_compliant');
  });

  it('disagreements віддає кейси для eval', () => {
    const first = db.findings.list(q({ verdicts: ['compliant'] })).items[0];
    expect(first).toBeDefined();
    if (!first) return;
    db.findings.saveReview(first.id, { humanVerdict: 'partial', humanSeverity: null, note: null });
    const second = db.findings.list(q({ verdicts: ['partial'] })).items[0];
    if (second) db.findings.saveReview(second.id, { humanVerdict: 'partial', humanSeverity: null, note: 'згоден' });

    const cases = db.findings.disagreements(s.runId);
    expect(cases.map((f) => f.id)).toEqual([first.id]);
  });
});

describe('runs.coverage', () => {
  it('секції × документи з найгіршим вердиктом у клітинці', () => {
    const matrix = db.runs.coverage(s.runId);

    expect(matrix.runId).toBe(s.runId);
    expect(matrix.sections).toEqual([
      { sectionNo: '3', sectionTitle: 'Responsible sourcing', clauseCount: 1 },
      { sectionNo: '10', sectionTitle: 'Pest management', clauseCount: 3 },
      { sectionNo: '14', sectionTitle: 'Environment', clauseCount: 1 },
    ]);
    expect(matrix.documents).toEqual([
      { documentVersionId: s.pestVersionId, title: 'Pest Management', versionLabel: '002' },
      { documentVersionId: s.damagedVersionId, title: 'Damaged Products', versionLabel: '002' },
    ]);

    const cell = (sectionNo: string, dv: number) =>
      matrix.cells.find((c) => c.sectionNo === sectionNo && c.documentVersionId === dv);

    // Секція 10 × Pest: compliant + partial + not_addressed → найгірший partial
    expect(cell('10', s.pestVersionId)).toEqual({
      sectionNo: '10',
      documentVersionId: s.pestVersionId,
      worstVerdict: 'partial',
      counts: {
        compliant: 1,
        partial: 1,
        non_compliant: 0,
        not_applicable: 0,
        not_addressed: 1,
        needs_human_review: 0,
      },
    });

    // Секція 10 × Damaged: три not_addressed
    expect(cell('10', s.damagedVersionId)?.worstVerdict).toBe('not_addressed');
    expect(cell('10', s.damagedVersionId)?.counts.not_addressed).toBe(3);

    // Секція 3 × Damaged: non_compliant
    expect(cell('3', s.damagedVersionId)?.worstVerdict).toBe('non_compliant');

    // Клітинок без findings немає взагалі
    expect(cell('3', s.pestVersionId)).toBeUndefined();
    expect(cell('14', s.pestVersionId)).toBeUndefined();

    expect(matrix.cells).toHaveLength(3);
  });

  it('людське рев’ю змінює колір клітинки', () => {
    const compliant = db.findings.list({ runId: s.runId, verdicts: ['compliant'] }).items[0];
    expect(compliant).toBeDefined();
    if (!compliant) return;

    db.findings.saveReview(compliant.id, {
      humanVerdict: 'non_compliant',
      humanSeverity: 'critical',
      note: 'насправді ні',
    });

    const cell = db.runs
      .coverage(s.runId)
      .cells.find((c) => c.sectionNo === '10' && c.documentVersionId === s.pestVersionId);
    expect(cell?.worstVerdict).toBe('non_compliant');
    expect(cell?.counts.compliant).toBe(0);
    expect(cell?.counts.non_compliant).toBe(1);
  });

  it('зведені findings (без документа) не потрапляють у клітинки', () => {
    db.findings.upsert({
      runId: s.runId,
      clauseId: cid('14.1'),
      documentVersionId: null,
      verdict: 'not_applicable',
      rationale: 'ISO 14001',
    });
    const matrix = db.runs.coverage(s.runId);
    expect(matrix.cells).toHaveLength(3);
  });

  it('порожній прогін дає порожню матрицю', () => {
    expect(db.runs.coverage(9999)).toEqual({ runId: 9999, sections: [], documents: [], cells: [] });
  });
});

describe('runs.gaps', () => {
  it('лише застосовні вимоги без жодного покриття', () => {
    const gaps = db.runs.gaps(s.runId);
    expect(gaps.map((g) => g.clauseNo)).toEqual(['10.3']);

    expect(gaps[0]).toEqual({
      clauseId: cid('10.3'),
      clauseNo: '10.3',
      sectionNo: '10',
      sectionTitle: 'Pest management',
      topic: 'Pest management programme specification',
      obligation: 'must',
      requirementText: 'The programme must specify the minimum elements listed below.',
      // найважча severity серед not_addressed-findings вимоги
      severityIfMissing: 'major',
      // Прогалина без сторінки оригіналу неперевірювана: аудитор має побачити
      // формулювання вимоги в самому стандарті.
      pageFrom: 41,
      pageTo: 41,
    });
  });

  it('вимога без жодного finding теж є gap', () => {
    db.clauses.create(s.specVersionId, {
      clauseNo: '10.4',
      sectionNo: '10',
      sectionTitle: 'Pest management',
      requirementText: 'Ніхто цього не перевіряв.',
    });
    const gaps = db.runs.gaps(s.runId);
    expect(gaps.map((g) => g.clauseNo)).toEqual(['10.3', '10.4']);
    expect(gaps.find((g) => g.clauseNo === '10.4')?.severityIfMissing).toBeNull();
  });

  it('незастосовна вимога не є gap (ADR-4)', () => {
    expect(db.runs.gaps(s.runId).some((g) => g.clauseNo === '14.1')).toBe(false);

    // знімаємо N/A — і вимога одразу стає gap
    db.siteProfiles.setOverride(s.siteProfileId, cid('14.1'), true, 'аудитор наполіг');
    expect(db.runs.gaps(s.runId).some((g) => g.clauseNo === '14.1')).toBe(true);
  });

  it('хоча б один не-not_addressed вердикт знімає gap', () => {
    db.findings.upsert({
      runId: s.runId,
      clauseId: cid('10.3'),
      documentVersionId: s.pestVersionId,
      verdict: 'partial',
      rationale: 'частково покрито',
    });
    expect(db.runs.gaps(s.runId)).toEqual([]);
  });

  it('людське рев’ю знімає gap', () => {
    const na = db.findings.list({ runId: s.runId, sectionNo: '10', verdicts: ['not_addressed'] }).items;
    const target = na.find((f) => f.clauseId === cid('10.3'));
    expect(target).toBeDefined();
    if (!target) return;

    db.findings.saveReview(target.id, { humanVerdict: 'compliant', humanSeverity: null, note: 'є в іншому SOP' });
    expect(db.runs.gaps(s.runId)).toEqual([]);
  });

  it('прогін без профілю виробництва рахує всі вимоги застосовними', () => {
    const run = db.runs.create({
      specVersionId: s.specVersionId,
      siteProfileId: null,
      documentVersionIds: [s.pestVersionId],
      modelJudge: 'claude-opus-5',
      promptVersion: 'judge.v1',
    });
    expect(db.runs.gaps(run.id).map((g) => g.clauseNo)).toEqual(['3.1', '10.1', '10.2', '10.3', '14.1']);
  });
});

describe('runs.summary', () => {
  it('лічильники вердиктів, severity, gaps і usage', () => {
    db.runs.addUsage(s.runId, {
      inputTokens: 42_000,
      cachedTokens: 38_000,
      outputTokens: 1_200,
      costUsd: 0.42,
    });

    const summary = db.runs.summary(s.runId);

    expect(summary.runId).toBe(s.runId);
    expect(summary.clausesApplicable).toBe(4); // 14.1 — N/A
    expect(summary.clausesAssessed).toBe(4);
    expect(summary.counts).toEqual({
      compliant: 1,
      partial: 1,
      non_compliant: 1,
      not_applicable: 0,
      not_addressed: 4,
      needs_human_review: 0,
    });
    // Severity рахується ТІЛЬКИ по справжніх невідповідностях (partial / non_compliant).
    // У насінні `major` стоїть і на `partial`, і на `not_addressed`, а `minor` —
    // лише на `not_addressed`. Якби severity бралася з усіх вердиктів, документ,
    // якого тема просто не стосується, автоматично провалював би аудит за
    // шкалою стандарту (1 critical АБО 4+ major → Unsatisfactory).
    expect(summary.severityCounts).toEqual({ critical: 1, major: 1, minor: 0, recommendation: 0 });
    expect(summary.gaps).toBe(1);
    expect(summary.grade).toBeNull();
    expect(summary.usage).toEqual({
      inputTokens: 42_000,
      cachedTokens: 38_000,
      outputTokens: 1_200,
      costUsd: 0.42,
    });
  });

  it('людське рев’ю враховується в лічильниках', () => {
    const compliant = db.findings.list({ runId: s.runId, verdicts: ['compliant'] }).items[0];
    expect(compliant).toBeDefined();
    if (!compliant) return;
    db.findings.saveReview(compliant.id, {
      humanVerdict: 'needs_human_review',
      humanSeverity: 'minor',
      note: null,
    });

    const summary = db.runs.summary(s.runId);
    expect(summary.counts.compliant).toBe(0);
    expect(summary.counts.needs_human_review).toBe(1);
    // `needs_human_review` — ще не ухвалена невідповідність, тож у severity не йде.
    expect(summary.severityCounts.minor).toBe(0);
  });

  it('людське рішення «невідповідність» потрапляє в severity', () => {
    const target = db.findings.list({ runId: s.runId, verdicts: ['not_addressed'] }).items[0];
    expect(target).toBeDefined();
    if (!target) return;

    db.findings.saveReview(target.id, {
      humanVerdict: 'non_compliant',
      humanSeverity: 'critical',
      note: 'аудитор підтвердив',
    });

    // Було 1 critical (з non_compliant у насінні) → стало 2.
    expect(db.runs.summary(s.runId).severityCounts.critical).toBe(2);
  });

  it('неіснуючий прогін дає нулі, а не помилку', () => {
    const summary = db.runs.summary(9999);
    expect(summary.clausesApplicable).toBe(0);
    expect(summary.gaps).toBe(0);
    const zero: Record<Verdict, number> = {
      compliant: 0,
      partial: 0,
      non_compliant: 0,
      not_applicable: 0,
      not_addressed: 0,
      needs_human_review: 0,
    };
    expect(summary.counts).toEqual(zero);
  });

  it('countsByVerdict збігається зі зведенням', () => {
    const counts = db.findings.countsByVerdict(s.runId);
    const total = counts.reduce((sum, c) => sum + c.count, 0);
    expect(total).toBe(7);
  });
});
