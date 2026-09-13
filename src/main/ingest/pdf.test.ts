import { describe, expect, it } from 'vitest';
import { extractPdf } from './pdf';
import { normalizePageText } from './normalize';
import { ALL_PDFS, DOC_DAMAGED, DOC_PEST, DOC_RECEIVING, TESCO_SPEC } from './fixtures';

describe('extractPdf — усі реальні файли', () => {
  it('витягує текст із кожного файлу і рахує сторінки правильно', async () => {
    for (const fixture of ALL_PDFS) {
      const result = await extractPdf(fixture.path);
      expect(result.pageCount, fixture.label).toBe(fixture.pageCount);
      expect(result.pages.length, fixture.label).toBe(fixture.pageCount);
      expect(result.toolVersion).toMatch(/^pdfjs-dist@\d+\.\d+\.\d+$/);
      // Жодної порожньої сторінки: усі чотири файли мають текстовий шар.
      for (const [i, page] of result.pages.entries()) {
        expect(page.trim().length, `${fixture.label} p.${i + 1}`).toBeGreaterThan(0);
      }
    }
  });

  it('віддає метадані PDF', async () => {
    const spec = await extractPdf(TESCO_SPEC.path);
    expect(spec.info.producer).toContain('Word');
    expect(spec.info.encrypted).toBe(false);

    const doc = await extractPdf(DOC_PEST.path);
    expect(doc.info.producer).toContain('Aspose.Words');
  });

  it('повідомляє про прогрес по сторінках', async () => {
    const seen: number[] = [];
    const result = await extractPdf(DOC_DAMAGED.path, {
      onPage: (pageNo, pageCount) => {
        expect(pageCount).toBe(DOC_DAMAGED.pageCount);
        seen.push(pageNo);
      },
    });
    expect(seen).toEqual([1, 2]);
    expect(result.pageCount).toBe(2);
  });
});

describe('реконструкція розкладки таблиці Tesco', () => {
  it('на стор. 13 тримає номер вимоги 1.3 разом із топіком «Management review»', async () => {
    const { pages } = await extractPdf(TESCO_SPEC.path);
    const page13 = normalizePageText(pages[12]!);

    expect(page13).toContain('1.3');
    // Топік розбитий по двох фізичних рядках вузької колонки — якщо
    // реконструкція розкладки зламається, тут буде «Management\nreview».
    expect(page13).toContain('Management review');
    expect(page13).toContain('Site management must regularly review all activities');
  });

  it('не зливає колонки: номер вимоги не приклеєний до тексту вимоги', async () => {
    const { pages } = await extractPdf(TESCO_SPEC.path);
    const page13 = normalizePageText(pages[12]!);
    expect(page13).toMatch(/^P R 1\.3$/m);
    expect(page13).toMatch(/^R O 1\.5$/m);
  });

  it('зберігає буліт-списки вимог', async () => {
    const { pages } = await extractPdf(TESCO_SPEC.path);
    const page13 = normalizePageText(pages[12]!);
    const bullets = page13.split('\n').filter((line) => line.startsWith('•'));
    expect(bullets.length).toBeGreaterThanOrEqual(4);
    expect(bullets[0]).toBe('• meeting peak production without exceeding capacity');
  });

  it('витягує розділ «Auditing of Standard» з означеннями Critical/Major/Minor', async () => {
    const { pages } = await extractPdf(TESCO_SPEC.path);
    const page8 = normalizePageText(pages[7]!);
    expect(page8).toContain('Auditing of Standard');
    expect(page8).toContain('A critical non-conformance is identified');
    expect(page8).toContain('A major non-conformance is identified');
  });

  it('запасний геометричний порядок теж дає текст', async () => {
    const { pages } = await extractPdf(TESCO_SPEC.path, { readingOrder: 'geometric' });
    const page13 = normalizePageText(pages[12]!);
    expect(page13).toContain('1.3');
    expect(page13).toContain('Site management must regularly review');
  });

  it('без unwrapLines рядки лишаються фізичними', async () => {
    const { pages } = await extractPdf(TESCO_SPEC.path, { unwrapLines: false });
    const page13 = normalizePageText(pages[12]!);
    expect(page13).toContain('Management\nreview');
  });
});

describe('зміст документів виробництва', () => {
  it('«Pest Management 0068» згадує підрядника Attack', async () => {
    const { pages } = await extractPdf(DOC_PEST.path);
    const text = pages.map((p) => normalizePageText(p)).join('\n');
    expect(text).toContain('Attack');
    expect(text).toContain('Our building is checked monthly for pests by Attack.');
    expect(text).toContain('Pest Management 0068');
  });

  it('«Damaged Products 0072» зберігає буліт-список вимог до скла', async () => {
    const { pages } = await extractPdf(DOC_DAMAGED.path);
    const text = pages.map((p) => normalizePageText(p)).join('\n');
    expect(text).toContain('Damaged Products 0072');
    expect(text.split('\n').filter((l) => l.startsWith('•')).length).toBeGreaterThanOrEqual(8);
  });

  it('«Receiving Flowerbulbs» зберігає шапку з версією та власником процесу', async () => {
    const { pages } = await extractPdf(DOC_RECEIVING.path);
    const first = normalizePageText(pages[0]!);
    expect(first).toContain('Versie: 003');
    expect(first).toContain('Proceseigenaar: Warehouse & Production Manager');
    expect(first).toContain('Incoming Goods Checks');
  });
});
