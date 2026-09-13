import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, type Db } from '@main/db';
import { setStorageRoot } from '@main/paths';
import { TESCO_SPEC } from '@main/ingest/fixtures';
import type { ClauseExtractItem } from '@main/llm';
import type { CompleteRequest, CompleteResult, LlmProvider } from '@main/llm';
import { importFiles } from './import';
import {
  extractClausesForSpec,
  looksLikeClausePage,
  mergeContinuations,
  selectClausePages,
  validateClauses,
  type ExtractedClause,
} from './clauseExtraction';

// ─── Заглушка провайдера ─────────────────────────────────────────────────────

interface FakeOptions {
  /** Що повернути для конкретної сторінки. Ключ — номер сторінки. */
  byPage?: Record<number, ClauseExtractItem[]>;
  /** Сторінки, на яких провайдер має впасти. */
  failOn?: number[];
  fallback?: ClauseExtractItem[];
}

function fakeProvider(options: FakeOptions = {}): LlmProvider & { calls: number } {
  const provider = {
    id: 'fake',
    label: 'Fake',
    models: ['fake-model'],
    calls: 0,
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
      const pageNo = Number(/page\s+(\d+)/i.exec(req.messages[0]?.content ?? '')?.[1] ?? 0);

      if (options.failOn?.includes(pageNo)) {
        throw new Error(`сторінка ${pageNo}: провайдер недоступний`);
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

function item(overrides: Partial<ClauseExtractItem> = {}): ClauseExtractItem {
  return {
    clauseNo: '1.1',
    sectionNo: '1',
    sectionTitle: 'Leadership',
    topic: 'Management review',
    requirementText: 'Site management must regularly review all activities.',
    modules: ['P', 'R'],
    obligation: 'must',
    truncated: false,
    ...overrides,
  } as ClauseExtractItem;
}

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
      { pageNo: 1, clauses: [item({ clauseNo: '4.1', topic: null, modules: [] })] },
      { pageNo: 2, clauses: [item({ clauseNo: '4.1', topic: 'Training', modules: ['O'] })] },
    ]);

    expect(merged[0]?.topic).toBe('Training');
    expect(merged[0]?.modules).toEqual(['O']);
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
});

describe('extractClausesForSpec', () => {
  it('зберігає вимоги, ставить статус і рахує вартість', async () => {
    const provider = fakeProvider({
      fallback: [item({ clauseNo: '1.1' })],
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

  it('відмовляє, якщо версії специфікації немає', async () => {
    await expect(
      extractClausesForSpec(db, fakeProvider(), 99_999, { allPages: true }),
    ).rejects.toThrow('не знайдена');
  });
});
