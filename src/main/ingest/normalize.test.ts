import { describe, expect, it } from 'vitest';
import {
  PAGE_SEPARATOR,
  joinPages,
  normalizePageText,
  pageOfOffset,
  stripBoilerplate,
} from './normalize';
import { extractPdf } from './pdf';
import { ALL_PDFS, TESCO_SPEC } from './fixtures';

describe('normalizePageText', () => {
  it('замінює артефакт булітів U+FFFD', () => {
    expect(normalizePageText('\uFFFD meeting peak production')).toBe(
      '\u2022 meeting peak production',
    );
  });

  it('зводить CRLF до LF', () => {
    expect(normalizePageText('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('схлопує пробіли й таби', () => {
    expect(normalizePageText('P   R \t\t O    1.3')).toBe('P R O 1.3');
  });

  it('обмежує кількість порожніх рядків', () => {
    expect(normalizePageText('a\n\n\n\n\nb')).toBe('a\n\nb');
    expect(normalizePageText('a\n\n\n\n\nb', { maxBlankLines: 0 })).toBe('a\nb');
  });

  it('прибирає нерозривні й нульової ширини символи', () => {
    expect(normalizePageText('Tesco\u00A0Stores\u200BLtd')).toBe('Tesco StoresLtd');
  });

  it('обрізає типові колонтитули, але не рік на обкладинці', () => {
    expect(normalizePageText('Requirements\nPage 12 of 100\n7')).toBe('Requirements');
    expect(normalizePageText('2026\nTesco')).toBe('2026\nTesco');
  });

  it('лишає колонтитули, якщо прапорець вимкнено', () => {
    expect(normalizePageText('Page 12 of 100', { stripRunningHeaders: false })).toBe(
      'Page 12 of 100',
    );
  });

  it('ідемпотентна — інакше офсети «попливли» б при повторній обробці', async () => {
    const { pages } = await extractPdf(TESCO_SPEC.path);
    for (const page of pages.slice(0, 20)) {
      const once = normalizePageText(page);
      expect(normalizePageText(once)).toBe(once);
    }
  });

  it('нормалізує до NFC', () => {
    // 'e' + U+0301 має схлопнутись в один код-пойнт.
    expect(normalizePageText('cafe\u0301')).toBe('caf\u00E9');
  });
});

describe('joinPages', () => {
  it('тримає головний інваріант офсетів на всіх реальних PDF', async () => {
    for (const fixture of ALL_PDFS) {
      const raw = await extractPdf(fixture.path);
      const pages = raw.pages.map((page) => normalizePageText(page));
      const { text, ranges } = joinPages(pages);

      expect(ranges.length, fixture.label).toBe(fixture.pageCount);
      for (let i = 0; i < pages.length; i++) {
        const range = ranges[i]!;
        expect(range.pageNo).toBe(i + 1);
        // ЦЕ і є властивість, від якої залежать клікабельні цитати.
        expect(text.slice(range.charStart, range.charEnd), `${fixture.label} p.${i + 1}`).toBe(
          pages[i],
        );
      }
    }
  });

  it('тримає інваріант і після зняття колонтитулів', async () => {
    const raw = await extractPdf(TESCO_SPEC.path);
    const pages = stripBoilerplate(raw.pages.map((page) => normalizePageText(page)));
    const { text, ranges } = joinPages(pages);
    for (let i = 0; i < pages.length; i++) {
      expect(text.slice(ranges[i]!.charStart, ranges[i]!.charEnd)).toBe(pages[i]);
    }
  });

  it('діапазони не перетинаються і йдуть по зростанню', async () => {
    const raw = await extractPdf(TESCO_SPEC.path);
    const { ranges } = joinPages(raw.pages.map((page) => normalizePageText(page)));
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i]!.charStart).toBeGreaterThanOrEqual(ranges[i - 1]!.charEnd);
      expect(ranges[i]!.charEnd).toBeGreaterThanOrEqual(ranges[i]!.charStart);
    }
  });

  it('роздільник лежить поза діапазонами сторінок', () => {
    const { text, ranges } = joinPages(['aaa', 'bbb']);
    expect(text).toBe(`aaa${PAGE_SEPARATOR}bbb`);
    expect(ranges).toEqual([
      { pageNo: 1, charStart: 0, charEnd: 3 },
      { pageNo: 2, charStart: 3 + PAGE_SEPARATOR.length, charEnd: 6 + PAGE_SEPARATOR.length },
    ]);
  });

  it('порожня сторінка дає коректний вироджений діапазон', () => {
    const pages = ['a', '', 'c'];
    const { text, ranges } = joinPages(pages);
    expect(ranges[1]!.charStart).toBe(ranges[1]!.charEnd);
    for (let i = 0; i < pages.length; i++) {
      expect(text.slice(ranges[i]!.charStart, ranges[i]!.charEnd)).toBe(pages[i]);
    }
  });

  it('порожній вхід — порожній вихід', () => {
    expect(joinPages([])).toEqual({ text: '', ranges: [] });
  });
});

describe('pageOfOffset', () => {
  it('знаходить сторінку за офсетом', async () => {
    const raw = await extractPdf(TESCO_SPEC.path);
    const pages = raw.pages.map((page) => normalizePageText(page));
    const { ranges } = joinPages(pages);
    for (const range of ranges) {
      if (range.charStart === range.charEnd) continue;
      expect(pageOfOffset(ranges, range.charStart)).toBe(range.pageNo);
      expect(pageOfOffset(ranges, range.charEnd - 1)).toBe(range.pageNo);
    }
  });

  it('віддає null для офсету поза текстом', () => {
    const { ranges } = joinPages(['aaa', 'bbb']);
    expect(pageOfOffset(ranges, 999)).toBeNull();
    expect(pageOfOffset(ranges, 3)).toBeNull(); // роздільник
  });
});

describe('stripBoilerplate', () => {
  it('прибирає копірайт Tesco і шапку таблиці, скорочуючи обсяг щонайменше на 15%', async () => {
    const raw = await extractPdf(TESCO_SPEC.path);
    const pages = raw.pages.map((page) => normalizePageText(page));
    const before = pages.reduce((sum, p) => sum + p.length, 0);

    const cleaned = stripBoilerplate(pages);
    const after = cleaned.reduce((sum, p) => sum + p.length, 0);
    const saved = 1 - after / before;

    expect(cleaned.length).toBe(pages.length);
    expect(saved).toBeGreaterThanOrEqual(0.15);

    const joined = cleaned.join('\n');
    expect(joined).not.toContain('© Tesco Stores Ltd. All Rights Reserved.');
    expect(joined).not.toContain('The controlled version of this document is available');
    expect(joined).not.toContain('P R O Clause number');

    // Зміст лишився на місці.
    expect(joined).toContain('Management review');
    expect(joined).toContain('Auditing of Standard');
  });

  it('не чіпає короткі документи — статистики для порогу немає', () => {
    const pages = ['© Acme Ltd\nзміст 1', '© Acme Ltd\nзміст 2'];
    expect(stripBoilerplate(pages)).toEqual(pages);
  });

  it('маскує цифри, тож «Page 1 of 9» і «Page 2 of 9» — той самий колонтитул', () => {
    const pages = Array.from({ length: 10 }, (_, i) => `Doc 0068 Page ${i + 1} of 10\nтіло ${i}`);
    const cleaned = stripBoilerplate(pages);
    expect(cleaned[0]).toBe('тіло 0');
    expect(cleaned[9]).toBe('тіло 9');
  });

  it('поріг повторюваності налаштовується', () => {
    const pages = ['head\nA', 'head\nB', 'head\nC', 'other\nD', 'other\nE'];
    // 'head' на 3/5 = 60% → прибирається за замовчуванням.
    expect(stripBoilerplate(pages, { minLineLength: 4 })[0]).toBe('A');
    // З порогом 0.9 не прибирається нічого.
    expect(stripBoilerplate(pages, { minLineLength: 4, minPageFraction: 0.9 })[0]).toBe('head\nA');
  });

  it('короткі рядки не вважає колонтитулами', () => {
    const pages = Array.from({ length: 10 }, (_, i) => `•\nтіло ${i}`);
    expect(stripBoilerplate(pages)[0]).toBe('•\nтіло 0');
  });
});
