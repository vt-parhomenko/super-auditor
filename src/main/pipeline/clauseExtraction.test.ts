import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, type Db } from '@main/db';
import { setStorageRoot } from '@main/paths';
import { TESCO_SPEC } from '@main/ingest/fixtures';
import { LlmError, type ClauseExtractV2Item, type MarkerLegendOutputItem } from '@main/llm';
import type { CompleteRequest, CompleteResult, LlmProvider } from '@main/llm';
import type { MarkerLegendItem } from '@shared/domain';
import { importFiles } from './import';
import {
  LEGEND_FALLBACK_PAGES,
  LEGEND_INTRO_MAX_CHARS,
  distinctMarkers,
  extractClausesForSpec,
  legendCovers,
  legendSource,
  looksLikeClausePage,
  mergeContinuations,
  reconcileLegend,
  sectionOf,
  selectClausePages,
  validateClauses,
  type ExtractedClause,
} from './clauseExtraction';

// ─── Заглушка провайдера ─────────────────────────────────────────────────────

interface FakeOptions {
  /** Що повернути для конкретної сторінки. Ключ — номер сторінки. */
  byPage?: Record<number, ClauseExtractV2Item[]>;
  /** Сторінки, на яких провайдер має впасти. */
  failOn?: number[];
  /** Чим падати на `failOn`; за замовчуванням — звичайний Error. */
  failWith?: () => unknown;
  fallback?: ClauseExtractV2Item[];
  /** Відповідь на виклик легенди позначок; за замовчуванням — «нічого не пояснено». */
  legend?: MarkerLegendOutputItem[] | (() => never);
}

function fakeProvider(
  options: FakeOptions = {},
): LlmProvider & { calls: number; legendRequests: Array<CompleteRequest<unknown>> } {
  const provider = {
    id: 'fake',
    label: 'Fake',
    models: ['fake-model'],
    calls: 0,
    legendRequests: [] as Array<CompleteRequest<unknown>>,
    caps: {
      contextWindow: 200_000,
      promptCaching: false,
      structuredOutput: 'schema' as const,
      citations: false,
      documentInput: [] as Array<'pdf' | 'text'>,
      maxOutputTokens: 8000,
      cloud: false,
    },
    isConfigured: () => true,
    async complete<T>(req: CompleteRequest<T>): Promise<CompleteResult<T>> {
      provider.calls += 1;
      if (req.promptVersion === 'marker_legend.v1') {
        provider.legendRequests.push(req as CompleteRequest<unknown>);
        const legend = options.legend;
        const items = typeof legend === 'function' ? legend() : (legend ?? []);
        return {
          data: { items } as T,
          citations: [],
          usage: { input: 500, cachedInput: 0, cacheWrite: 0, output: 50 },
          costUsd: 0.005,
          modelId: 'fake-model',
          providerId: 'fake',
          latencyMs: 1,
          raw: null,
          fromCache: false,
        };
      }
      const pageNo = Number(/page\s+(\d+)/i.exec(req.messages[0]?.content ?? '')?.[1] ?? 0);

      if (options.failOn?.includes(pageNo)) {
        throw options.failWith?.() ?? new Error(`сторінка ${pageNo}: провайдер недоступний`);
      }

      const clauses = options.byPage?.[pageNo] ?? options.fallback ?? [];
      return {
        data: { clauses } as T,
        citations: [],
        usage: { input: 1000, cachedInput: 200, cacheWrite: 0, output: 300 },
        costUsd: 0.01,
        modelId: 'fake-model',
        providerId: 'fake',
        latencyMs: 1,
        raw: null,
        fromCache: false,
      };
    },
  };
  return provider;
}

function item(overrides: Partial<ClauseExtractV2Item> = {}): ClauseExtractV2Item {
  return {
    clauseNo: '1.1',
    sectionNo: '1',
    sectionTitle: 'Leadership',
    topic: 'Management review',
    requirementText: 'Site management must regularly review all activities.',
    markers: ['P', 'R'],
    obligation: 'must',
    truncated: false,
    ...overrides,
  };
}

const TESCO_LEGEND_ANSWER: MarkerLegendOutputItem[] = [
  { code: 'P', label: 'Policy / procedure', meaning: 'The site must have a documented policy/procedure.' },
  { code: 'R', label: 'Records', meaning: 'The site must have accurately completed records.' },
];

// ─── Реальна специфікація ────────────────────────────────────────────────────

let root: string;
let db: Db;
let specVersionId: number;
let specPages: string[];

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'sa-clauses-'));
  setStorageRoot(root);
  db = createTestDb();

  const result = await importFiles(db, {
    paths: [TESCO_SPEC.path],
    target: { kind: 'specification' },
  });
  specVersionId = result.imported[0]!.specVersionId!;

  const version = db.specs.getVersion(specVersionId)!;
  const extraction = db.extractions.get(version.extractionId!)!;
  specPages = extraction.pages.map((p) => extraction.text.slice(p.charStart, p.charEnd));
}, 60_000);

afterAll(() => {
  db.close();
  setStorageRoot(null);
  rmSync(root, { recursive: true, force: true });
});

describe('looksLikeClausePage на реальному стандарті', () => {
  it('розпізнає сторінки з таблицею вимог', () => {
    expect(looksLikeClausePage(specPages[12]!)).toBe(true); // стор. 13, вимоги 1.3-1.6
    expect(looksLikeClausePage(specPages[40]!)).toBe(true); // стор. 41, вимоги 10.3-10.4
  });

  it('відкидає обкладинку і зміст', () => {
    expect(looksLikeClausePage(specPages[0]!)).toBe(false); // обкладинка
    expect(looksLikeClausePage(specPages[2]!)).toBe(false); // Contents
  });

  it('відбирає суттєву частину, але не весь документ', () => {
    const selected = selectClausePages(specPages);

    // Зміст, вступ, правила аудиту й глосарій до реєстру не входять.
    expect(selected.length).toBeGreaterThan(50);
    expect(selected.length).toBeLessThan(specPages.length);
  });

  it('розпізнає нумеровані вимоги без шапки таблиці', () => {
    const text = '2.1 The site shall keep records.\n2.2 Records must be retained for 2 years.';
    expect(looksLikeClausePage(text)).toBe(true);
  });

  it('не вважає вимогами простий текст із числами', () => {
    expect(looksLikeClausePage('Revision 1.0 issued on 3.4 of the calendar.')).toBe(false);
  });
});

describe('looksLikeClausePage на інших стандартах', () => {
  it('ISO: сторінка прози з одним пунктом теж сторінка вимог', () => {
    const text = [
      '8.5.1 Control of production and service provision',
      'The organization shall implement production and service provision under controlled conditions.',
      'a) the availability of documented information;',
    ].join('\n');
    expect(looksLikeClausePage(text)).toBe(true);
  });

  it('додаток ISO 27001: номери A.5.1', () => {
    const text = [
      'A.5 Organizational controls',
      'A.5.1 Policies for information security',
      'Information security policy and topic-specific policies shall be defined.',
    ].join('\n');
    expect(looksLikeClausePage(text)).toBe(true);
  });

  it('GlobalG.A.P.: номери AF 1.2.3 і рівень «Major Must»', () => {
    const text = [
      'AF 1.1.1 Is there a reference system for each field? Major Must',
      'AF 1.1.2 Is there a recording system? Minor Must',
    ].join('\n');
    expect(looksLikeClausePage(text)).toBe(true);
  });

  it('стандарт нідерландською: «moet»', () => {
    expect(looksLikeClausePage('4.2 Documentatie\nDe organisatie moet een procedure hebben.')).toBe(true);
  });

  it('зміст без дієслів обов’язку — не сторінка вимог', () => {
    const toc = ['4.1 Understanding the organization ........ 5', '4.2 Interested parties ........ 6'].join('\n');
    expect(looksLikeClausePage(toc)).toBe(false);
  });

  it('номер сторінки чи пункт списку без крапки не вважається номером вимоги', () => {
    expect(looksLikeClausePage('12\nThe site must keep records.')).toBe(false);
    expect(looksLikeClausePage('1 The site must keep records.')).toBe(false);
  });
});

describe('sectionOf', () => {
  it.each([
    ['10.3', '10'],
    ['4.2.1', '4'],
    ['A.5.1', 'A.5'],
    ['A.5', 'A'],
    ['AF 1.2.3', 'AF 1'],
    ['FV 5.1.2', 'FV 5'],
    ['100.1', '100'],
  ])('%s → %s', (clauseNo, section) => {
    expect(sectionOf(clauseNo)).toBe(section);
  });

  it('номер без крапки секції не має', () => {
    expect(sectionOf('Requirements')).toBeNull();
    expect(sectionOf('7')).toBeNull();
  });
});

describe('selectClausePages', () => {
  const pages = ['AAA', 'Clause number BBB', 'Clause number CCC', 'DDD'];

  it('додає хвіст попередньої і голову наступної сторінки', () => {
    const selected = selectClausePages(pages);

    expect(selected.map((p) => p.pageNo)).toEqual([2, 3]);
    expect(selected[0]?.prevTail).toBe('AAA');
    expect(selected[0]?.nextHead).toBe('Clause number CCC');
    expect(selected[1]?.nextHead).toBe('DDD');
  });

  it('прапорець all вимикає фільтрацію', () => {
    expect(selectClausePages(pages, { all: true })).toHaveLength(4);
  });

  it('поважає діапазон сторінок', () => {
    expect(selectClausePages(pages, { all: true, from: 2, to: 3 }).map((p) => p.pageNo)).toEqual([
      2, 3,
    ]);
  });

  it('на першій сторінці немає prevTail', () => {
    expect(selectClausePages(pages, { all: true })[0]?.prevTail).toBeUndefined();
  });
});

describe('mergeContinuations', () => {
  it('зшиває вимогу, розірвану між сторінками, і розширює діапазон', () => {
    const merged = mergeContinuations([
      { pageNo: 12, clauses: [item({ clauseNo: '1.5', requirementText: 'The site must plan:' })] },
      { pageNo: 13, clauses: [item({ clauseNo: '1.5', requirementText: '• meeting peak demand' })] },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.requirementText).toBe('The site must plan:\n• meeting peak demand');
    expect(merged[0]?.pageFrom).toBe(12);
    expect(merged[0]?.pageTo).toBe(13);
  });

  it('не дублює текст, якщо модель повторила той самий фрагмент', () => {
    const merged = mergeContinuations([
      { pageNo: 1, clauses: [item({ clauseNo: '2.1', requirementText: 'Records must be kept.' })] },
      { pageNo: 2, clauses: [item({ clauseNo: '2.1', requirementText: 'Records must be kept.' })] },
    ]);

    expect(merged[0]?.requirementText).toBe('Records must be kept.');
  });

  it('дублікат на тій самій сторінці не зшивається', () => {
    const merged = mergeContinuations([
      {
        pageNo: 1,
        clauses: [
          item({ clauseNo: '3.1', requirementText: 'First.' }),
          item({ clauseNo: '3.1', requirementText: 'Second.' }),
        ],
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.requirementText).toBe('First.');
  });

  it('зберігає порядок появи вимог', () => {
    const merged = mergeContinuations([
      {
        pageNo: 1,
        clauses: [item({ clauseNo: '1.1' }), item({ clauseNo: '1.2' }), item({ clauseNo: '1.3' })],
      },
    ]);

    expect(merged.map((c) => c.clauseNo)).toEqual(['1.1', '1.2', '1.3']);
  });

  it('добирає порожні поля з продовження', () => {
    const merged = mergeContinuations([
      { pageNo: 1, clauses: [item({ clauseNo: '4.1', topic: null, markers: [] })] },
      { pageNo: 2, clauses: [item({ clauseNo: '4.1', topic: 'Training', markers: ['O'] })] },
    ]);

    expect(merged[0]?.topic).toBe('Training');
    expect(merged[0]?.markers).toEqual(['O']);
  });

  it('позначки з рядка, де вимога почалась, продовження не перезаписує', () => {
    const merged = mergeContinuations([
      { pageNo: 1, clauses: [item({ clauseNo: '4.2', markers: ['Major Must'] })] },
      { pageNo: 2, clauses: [item({ clauseNo: '4.2', markers: ['Minor Must'] })] },
    ]);

    expect(merged[0]?.markers).toEqual(['Major Must']);
  });
});

describe('validateClauses', () => {
  const extracted = (overrides: Partial<ExtractedClause>): ExtractedClause =>
    ({ ...item(), pageFrom: 1, pageTo: 1, ...overrides }) as ExtractedClause;

  it('чистий реєстр не має зауважень', () => {
    const report = validateClauses([
      extracted({ clauseNo: '1.1' }),
      extracted({ clauseNo: '1.2' }),
      extracted({ clauseNo: '1.3' }),
    ]);

    expect(report.issues).toEqual([]);
    expect(report.flagged.size).toBe(0);
  });

  it('ловить пропуск у нумерації всередині секції', () => {
    const report = validateClauses([
      extracted({ clauseNo: '10.1' }),
      extracted({ clauseNo: '10.4' }),
    ]);

    const gap = report.issues.find((i) => i.kind === 'numbering_gap');
    expect(gap?.message).toContain('10.2');
    expect(gap?.message).toContain('10.3');
    expect(report.flagged.has('10.4')).toBe(true);
  });

  it('не вважає пропуском перехід між секціями', () => {
    const report = validateClauses([
      extracted({ clauseNo: '1.7' }),
      extracted({ clauseNo: '2.1' }),
    ]);

    expect(report.issues.filter((i) => i.kind === 'numbering_gap')).toEqual([]);
  });

  it('ловить дублікат', () => {
    const report = validateClauses([
      extracted({ clauseNo: '1.1' }),
      extracted({ clauseNo: '1.1' }),
    ]);

    expect(report.issues.some((i) => i.kind === 'duplicate')).toBe(true);
  });

  it('ловить порожню вимогу', () => {
    const report = validateClauses([extracted({ clauseNo: '1.1', requirementText: '   ' })]);
    expect(report.issues.some((i) => i.kind === 'empty_requirement')).toBe(true);
  });

  it('ловить злиття колонок — вимога не довша за topic', () => {
    const report = validateClauses([
      extracted({ clauseNo: '1.1', topic: 'Management review', requirementText: 'Management' }),
    ]);

    expect(report.issues.some((i) => i.kind === 'requirement_shorter_than_topic')).toBe(true);
  });

  it('ловить зіпсований номер', () => {
    const report = validateClauses([extracted({ clauseNo: 'Requirements' })]);
    expect(report.issues.some((i) => i.kind === 'malformed_number')).toBe(true);
  });

  it('буквено-цифрові номери інших стандартів — не «зіпсовані»', () => {
    const report = validateClauses(
      ['A.5.1', 'A.5.2', 'AF 1.1.1', 'AF 1.1.2', 'FV 5.1.2', '4.2.1', '10.3a', '7'].map((clauseNo) =>
        extracted({ clauseNo }),
      ),
    );
    expect(report.issues.filter((i) => i.kind === 'malformed_number')).toEqual([]);
  });

  it('ловить пропуск у нумерації додатка й GlobalG.A.P.', () => {
    const report = validateClauses([
      extracted({ clauseNo: 'A.5.1' }),
      extracted({ clauseNo: 'A.5.3' }),
      extracted({ clauseNo: 'AF 1.1.1' }),
      extracted({ clauseNo: 'AF 1.1.4' }),
    ]);

    const gaps = report.issues.filter((i) => i.kind === 'numbering_gap');
    expect(gaps.map((g) => g.clauseNo).sort()).toEqual(['A.5.3', 'AF 1.1.4']);
    expect(gaps.find((g) => g.clauseNo === 'A.5.3')?.message).toContain('A.5.2');
    expect(gaps.find((g) => g.clauseNo === 'AF 1.1.4')?.message).toContain('AF 1.1.2, AF 1.1.3');
  });

  it('заголовок без власного тексту (7.1.5 → 7.1.5.1) — не пропуск', () => {
    const report = validateClauses(
      ['7.1.4', '7.1.5.1', '7.1.5.2', '7.1.6'].map((clauseNo) => extracted({ clauseNo })),
    );
    expect(report.issues).toEqual([]);
  });

  it('пропуск на глибшому рівні позначає вимогу після пропуску', () => {
    const report = validateClauses(
      ['7.1.4', '7.1.6.1'].map((clauseNo) => extracted({ clauseNo })),
    );
    const gap = report.issues.find((i) => i.kind === 'numbering_gap');
    expect(gap?.clauseNo).toBe('7.1.6.1');
    expect(gap?.message).toContain('7.1.5');
  });

  it('великий пропуск не роздуває повідомлення', () => {
    const report = validateClauses([extracted({ clauseNo: '3.1' }), extracted({ clauseNo: '3.500' })]);
    const gap = report.issues.find((i) => i.kind === 'numbering_gap');
    expect(gap?.message).toContain('3.2, 3.3, 3.4, 3.5, 3.6… (498)');
  });

  it('літерні підпункти й секції без номера не ламають перевірку', () => {
    const report = validateClauses(
      ['10.3', '10.3a', '10.4', 'AF 1', 'A'].map((clauseNo) => extracted({ clauseNo })),
    );
    expect(report.issues.filter((i) => i.kind === 'numbering_gap')).toEqual([]);
  });
});

// ─── Легенда позначок ────────────────────────────────────────────────────────

describe('distinctMarkers', () => {
  it('різні позначки в порядку першої появи', () => {
    expect(
      distinctMarkers([{ markers: ['R', 'O'] }, { markers: [] }, { markers: ['P', 'R'] }]),
    ).toEqual(['R', 'O', 'P']);
  });
});

describe('legendSource', () => {
  const pages = Array.from({ length: 20 }, (_, i) => `text of page ${i + 1}`);

  it('сторінки до першої сторінки з вимогами', () => {
    const source = legendSource(pages, 12);
    expect(source).toMatchObject({ pageFrom: 1, pageTo: 11 });
    expect(source?.text).toContain('--- page 11 ---\ntext of page 11');
    expect(source?.text).not.toContain('page 12');
  });

  it('вимоги з першої сторінки — перші LEGEND_FALLBACK_PAGES сторінок', () => {
    expect(legendSource(pages, 1)).toMatchObject({ pageFrom: 1, pageTo: LEGEND_FALLBACK_PAGES });
    expect(legendSource(pages.slice(0, 3), 1)?.pageTo).toBe(3);
  });

  it('обрізається з явною позначкою', () => {
    const long = Array.from({ length: 30 }, () => 'x'.repeat(5_000));
    const source = legendSource(long, 30);
    expect(source?.text.length).toBeLessThan(LEGEND_INTRO_MAX_CHARS + 200);
    expect(source?.text).toContain('truncated');
  });
});

describe('reconcileLegend', () => {
  it('код — у написанні реєстру, вигадані позначки відкинуто, непояснені — в кінці', () => {
    const legend = reconcileLegend(
      ['Major Must', 'Minor Must', 'Recommendation'],
      [
        { code: 'MINOR MUST', label: 'Minor Must', meaning: '95% of applicable Minor Musts must be complied with.' },
        { code: 'Major  Must', label: 'Major Must', meaning: '100% compliance is required.' },
        { code: 'Critical', label: 'Critical', meaning: 'Invented by the model.' },
      ],
    );
    expect(legend).toEqual([
      { code: 'Minor Must', label: 'Minor Must', meaning: '95% of applicable Minor Musts must be complied with.' },
      { code: 'Major Must', label: 'Major Must', meaning: '100% compliance is required.' },
      { code: 'Recommendation', label: 'Recommendation', meaning: null },
    ]);
  });

  it('порожні label і meaning стають кодом і null', () => {
    expect(reconcileLegend(['F'], [{ code: 'F', label: ' ', meaning: '  ' }])).toBeNull();
    expect(reconcileLegend(['F', 'G'], [{ code: 'F', label: 'Fundamental', meaning: '' }])).toEqual([
      { code: 'F', label: 'Fundamental', meaning: null },
      { code: 'G', label: 'G', meaning: null },
    ]);
  });

  it('стандарт нічого не пояснив — null, а не легенда «P — P»', () => {
    expect(reconcileLegend(['P', 'R'], [])).toBeNull();
    expect(
      reconcileLegend(['P'], [{ code: 'P', label: 'P', meaning: null }]),
    ).toBeNull();
  });
});

describe('legendCovers', () => {
  const legend: MarkerLegendItem[] = [
    { code: 'P', label: 'Policy', meaning: null },
    { code: 'R', label: 'Records', meaning: null },
  ];

  it('усі коди пояснено — так', () => {
    expect(legendCovers(legend, ['R', 'p'])).toBe(true);
  });

  it('бракує коду, порожня легенда чи порожній реєстр — ні', () => {
    expect(legendCovers(legend, ['P', 'O'])).toBe(false);
    expect(legendCovers(null, ['P'])).toBe(false);
    expect(legendCovers(legend, [])).toBe(false);
  });
});

describe('extractClausesForSpec', () => {
  it('зберігає вимоги, ставить статус і рахує вартість', async () => {
    const provider = fakeProvider({
      // Без позначок — без виклику легенди: тут рахуємо лише сторінки.
      fallback: [item({ clauseNo: '1.1', markers: [] })],
      byPage: {},
    });

    const report = await extractClausesForSpec(db, provider, specVersionId, {
      allPages: true,
      from: 13,
      to: 14,
      concurrency: 2,
    });

    expect(report.pagesProcessed).toBe(2);
    expect(report.clausesStored).toBe(1); // одна й та сама вимога зшилась
    expect(report.usage.costUsd).toBeCloseTo(0.02);
    expect(report.usage.cachedTokens).toBe(400);

    expect(db.specs.getVersion(specVersionId)?.clausesStatus).toBe('extracted');

    const stored = db.clauses.list(specVersionId);
    expect(stored[0]?.clauseNo).toBe('1.1');
    expect(stored[0]?.reviewStatus).toBe('auto');
    expect(stored[0]?.pageFrom).toBe(13);
    expect(stored[0]?.pageTo).toBe(14);
  });

  it('позначає проблемні вимоги flagged, а не приймає мовчки', async () => {
    const provider = fakeProvider({
      byPage: {
        13: [item({ clauseNo: '5.1' })],
        14: [item({ clauseNo: '5.4' })], // пропуск 5.2, 5.3
      },
    });

    const report = await extractClausesForSpec(db, provider, specVersionId, {
      allPages: true,
      from: 13,
      to: 14,
    });

    expect(report.flaggedCount).toBeGreaterThan(0);
    const flagged = db.clauses.list(specVersionId).filter((c) => c.reviewStatus === 'flagged');
    expect(flagged.map((c) => c.clauseNo)).toContain('5.4');
  });

  it('виводить obligation із тексту, коли модель його не повернула', async () => {
    const provider = fakeProvider({
      fallback: [
        item({
          clauseNo: '6.1',
          obligation: null,
          requirementText: 'The site should consider additional checks.',
        }),
      ],
    });

    await extractClausesForSpec(db, provider, specVersionId, { allPages: true, from: 13, to: 13 });

    expect(db.clauses.getByNo(specVersionId, '6.1')?.obligation).toBe('should');
  });

  it('падіння на одній сторінці не зриває весь прогін', async () => {
    const provider = fakeProvider({
      byPage: { 13: [item({ clauseNo: '7.1' })] },
      failOn: [14],
    });

    const report = await extractClausesForSpec(db, provider, specVersionId, {
      allPages: true,
      from: 13,
      to: 14,
    });

    expect(report.failedPages).toHaveLength(1);
    expect(report.failedPages[0]?.pageNo).toBe(14);
    expect(report.clausesStored).toBe(1);
  });

  it('повідомляє прогрес по кожній сторінці й наприкінці', async () => {
    const provider = fakeProvider({ fallback: [item()] });
    const events: Array<{ page: number; done: boolean }> = [];

    await extractClausesForSpec(db, provider, specVersionId, {
      allPages: true,
      from: 13,
      to: 15,
      concurrency: 1,
      onProgress: (p) => events.push({ page: p.page, done: p.done }),
    });

    expect(events).toHaveLength(4); // 3 сторінки + фінальна подія
    expect(events.at(-1)?.done).toBe(true);
  });

  it('вичерпаний баланс зупиняє екстракцію і не чіпає вичитаний реєстр', async () => {
    const first = fakeProvider({ fallback: [item({ clauseNo: '8.1' })] });
    await extractClausesForSpec(db, first, specVersionId, { allPages: true, from: 13, to: 13 });
    db.specs.setClausesStatus(specVersionId, 'reviewed');

    const broke = fakeProvider({
      failOn: [13, 14, 15],
      failWith: () => new LlmError('insufficient_credit', '402 Payment Required', { providerId: 'openrouter' }),
    });
    await expect(
      extractClausesForSpec(db, broke, specVersionId, { allPages: true, from: 13, to: 15, concurrency: 1 }),
    ).rejects.toThrow();

    // Фатальна помилка зупиняє решту сторінок — наступні виклики так само приречені.
    expect(broke.calls).toBe(1);
    expect(db.clauses.list(specVersionId).map((c) => c.clauseNo)).toEqual(['8.1']);
    expect(db.specs.getVersion(specVersionId)?.clausesStatus).toBe('reviewed');
  });

  it('жодна сторінка не вдалась — реєстр лишається, як був', async () => {
    const first = fakeProvider({ fallback: [item({ clauseNo: '8.1' })] });
    await extractClausesForSpec(db, first, specVersionId, { allPages: true, from: 13, to: 13 });

    const failing = fakeProvider({ failOn: [13, 14] });
    await expect(
      extractClausesForSpec(db, failing, specVersionId, { allPages: true, from: 13, to: 14 }),
    ).rejects.toThrow();
    expect(db.clauses.list(specVersionId).map((c) => c.clauseNo)).toEqual(['8.1']);
  });

  it('вичитаний вручну реєстр не замінюється неповним', async () => {
    const first = fakeProvider({ fallback: [item({ clauseNo: '8.1' })] });
    await extractClausesForSpec(db, first, specVersionId, { allPages: true, from: 13, to: 13 });
    db.specs.setClausesStatus(specVersionId, 'reviewed');

    const partial = fakeProvider({ byPage: { 13: [item({ clauseNo: '9.1' })] }, failOn: [14] });
    await expect(
      extractClausesForSpec(db, partial, specVersionId, { allPages: true, from: 13, to: 14 }),
    ).rejects.toThrow();
    expect(db.clauses.list(specVersionId).map((c) => c.clauseNo)).toEqual(['8.1']);
    expect(db.specs.getVersion(specVersionId)?.clausesStatus).toBe('reviewed');
  });

  it('перезапис реєстру не залишає старих вимог', async () => {
    const first = fakeProvider({ fallback: [item({ clauseNo: '8.1' })] });
    await extractClausesForSpec(db, first, specVersionId, { allPages: true, from: 13, to: 13 });

    const second = fakeProvider({ fallback: [item({ clauseNo: '9.1' })] });
    await extractClausesForSpec(db, second, specVersionId, { allPages: true, from: 13, to: 13 });

    const stored = db.clauses.list(specVersionId).map((c) => c.clauseNo);
    expect(stored).toEqual(['9.1']);
  });

  it('скасування зупиняє обробку наступних сторінок', async () => {
    const controller = new AbortController();
    const provider = fakeProvider({ fallback: [item()] });

    const spy = vi.spyOn(provider, 'complete');
    spy.mockImplementationOnce(async (...args) => {
      controller.abort();
      return (await fakeProvider({ fallback: [item()] }).complete(...args)) as never;
    });

    await extractClausesForSpec(db, provider, specVersionId, {
      allPages: true,
      from: 13,
      to: 20,
      concurrency: 1,
      signal: controller.signal,
    });

    expect(provider.calls).toBeLessThan(8);
  });

  // ─── Позначки й легенда ────────────────────────────────────────────────────

  it('позначки зберігаються дослівно (нормалізовані), modules нова екстракція не пише', async () => {
    const provider = fakeProvider({
      byPage: {
        13: [item({ clauseNo: '1.3', markers: [' P ', 'R', 'P', ''] })],
        14: [item({ clauseNo: '1.4', markers: ['Major  Must'] })],
      },
      legend: TESCO_LEGEND_ANSWER,
    });

    await extractClausesForSpec(db, provider, specVersionId, { allPages: true, from: 13, to: 14 });

    const stored = db.clauses.list(specVersionId);
    expect(stored.map((c) => [c.clauseNo, c.markers])).toEqual([
      ['1.3', ['P', 'R']],
      ['1.4', ['Major Must']],
    ]);
    expect(stored.every((c) => c.modules.length === 0)).toBe(true);
  });

  it('без позначок — жодного виклику легенди і легенда null', async () => {
    db.specs.setMarkerLegend(specVersionId, [{ code: 'P', label: 'Policy', meaning: 'old' }]);
    const provider = fakeProvider({ fallback: [item({ clauseNo: '2.1', markers: [] })] });

    const report = await extractClausesForSpec(db, provider, specVersionId, { allPages: true, from: 13, to: 14 });

    expect(provider.legendRequests).toHaveLength(0);
    expect(provider.calls).toBe(2);
    expect(report.markerLegend).toBeNull();
    expect(report.legendError).toBeNull();
    // Стандарт (за новим реєстром) позначок не має — стара легенда теж зникає.
    expect(db.specs.getVersion(specVersionId)?.markerLegend).toBeNull();
  });

  it('позначки є — один виклик легенди з кодами і вступом, легенда зберігається з реєстром', async () => {
    db.specs.setMarkerLegend(specVersionId, null);
    const provider = fakeProvider({
      byPage: {
        13: [item({ clauseNo: '1.3', markers: ['P', 'R'] })],
        14: [item({ clauseNo: '1.4', markers: ['R'] })],
      },
      legend: TESCO_LEGEND_ANSWER,
    });

    const report = await extractClausesForSpec(db, provider, specVersionId, { allPages: true, from: 13, to: 14 });

    expect(provider.legendRequests).toHaveLength(1);
    const legendRequest = provider.legendRequests[0]!;
    expect(legendRequest.stage).toBe('clause_extract');
    const user = legendRequest.messages[0]?.content ?? '';
    expect(user).toContain('<markers count="2">\n<marker>P</marker>\n<marker>R</marker>\n</markers>');
    // Вступ — сторінки до першої сторінки з вимогами (13), тобто 1–12.
    expect(user).toContain('<introduction pages="1-12">');
    expect(user).toContain('--- page 12 ---');
    expect(user).not.toContain('--- page 13 ---');

    const expected = [
      { code: 'P', label: 'Policy / procedure', meaning: 'The site must have a documented policy/procedure.' },
      { code: 'R', label: 'Records', meaning: 'The site must have accurately completed records.' },
    ];
    expect(report.markerLegend).toEqual(expected);
    expect(report.legendError).toBeNull();
    expect(db.specs.getVersion(specVersionId)?.markerLegend).toEqual(expected);
    // Виклик легенди — у вартості екстракції, як і сторінки.
    expect(report.usage.costUsd).toBeCloseTo(0.025);
  });

  it('невдала легенда не зриває екстракцію: реєстр збережено, легенда null, причина — у звіті', async () => {
    db.specs.setMarkerLegend(specVersionId, null);
    const provider = fakeProvider({
      fallback: [item({ clauseNo: '3.1', markers: ['Fundamental'] })],
      legend: () => {
        throw new LlmError('insufficient_credit', '402 Payment Required', { providerId: 'openrouter' });
      },
    });

    const report = await extractClausesForSpec(db, provider, specVersionId, { allPages: true, from: 13, to: 13 });

    expect(report.clausesStored).toBe(1);
    expect(report.markerLegend).toBeNull();
    expect(report.legendError).toEqual(expect.any(String));
    expect(report.legendError?.length).toBeGreaterThan(0);
    expect(db.clauses.list(specVersionId).map((c) => c.markers)).toEqual([['Fundamental']]);
    expect(db.specs.getVersion(specVersionId)?.markerLegend).toBeNull();
    expect(db.specs.getVersion(specVersionId)?.clausesStatus).toBe('extracted');
  });

  it('стандарт у тексті нічого не пояснив — відома легенда тих самих позначок лишається', async () => {
    // Tesco: розшифровка P/R/O — діаграма, у витягнутому тексті її немає.
    const known: MarkerLegendItem[] = [
      { code: 'P', label: 'Policy / procedure', meaning: 'documented policy' },
      { code: 'R', label: 'Records', meaning: 'records' },
      { code: 'O', label: 'Observation', meaning: 'observation' },
    ];
    db.specs.setMarkerLegend(specVersionId, known);
    const provider = fakeProvider({ fallback: [item({ clauseNo: '1.3', markers: ['P', 'R'] })], legend: [] });

    const report = await extractClausesForSpec(db, provider, specVersionId, { allPages: true, from: 13, to: 13 });

    expect(provider.legendRequests).toHaveLength(1);
    expect(report.markerLegend).toEqual(known);
    expect(db.specs.getVersion(specVersionId)?.markerLegend).toEqual(known);
  });

  it('відома легенда не покриває нових позначок — легенда null', async () => {
    db.specs.setMarkerLegend(specVersionId, [{ code: 'P', label: 'Policy', meaning: 'x' }]);
    const provider = fakeProvider({ fallback: [item({ clauseNo: '1.3', markers: ['P', 'Major Must'] })], legend: [] });

    const report = await extractClausesForSpec(db, provider, specVersionId, { allPages: true, from: 13, to: 13 });

    expect(report.markerLegend).toBeNull();
    expect(db.specs.getVersion(specVersionId)?.markerLegend).toBeNull();
  });

  it('відмовляє, якщо версії специфікації немає', async () => {
    await expect(
      extractClausesForSpec(db, fakeProvider(), 99_999, { allPages: true }),
    ).rejects.toThrow('Specification version 99999 not found');
  });
});
