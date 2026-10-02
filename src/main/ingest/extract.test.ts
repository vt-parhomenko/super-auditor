import { describe, expect, it } from 'vitest';
import {
  OCR_QUALITY_THRESHOLD,
  UnsupportedFormatError,
  extractText,
  isSupportedMime,
  pdfQuality,
} from './extract';
import { MIME_DOCX, MIME_PDF } from './mime';
import { ALL_PDFS, DOC_PEST, TESCO_SPEC } from './fixtures';
import { OcrNotConfiguredError, getOcrEngine, isOcrAvailable, setOcrEngine } from './ocr';

describe('extractText — реальні PDF', () => {
  it('віддає повний контракт екстракції для кожного файлу', async () => {
    for (const fixture of ALL_PDFS) {
      const result = await extractText(fixture.path, MIME_PDF);

      expect(result.method, fixture.label).toBe('pdfjs');
      expect(result.toolVersion).toMatch(/^pdfjs-dist@/);
      expect(result.pageCount).toBe(fixture.pageCount);
      expect(result.pages.length).toBe(fixture.pageCount);
      expect(result.charCount).toBe(result.text.length);
      expect(result.charCount).toBeGreaterThan(0);
      expect(result.quality).not.toBeNull();
      expect(result.quality!).toBeGreaterThan(OCR_QUALITY_THRESHOLD);
      expect(result.needsOcr).toBe(false);

      // Офсети переживають увесь конвеєр (нормалізація + зняття колонтитулів).
      let previousEnd = 0;
      for (const range of result.pages) {
        expect(range.charStart).toBeGreaterThanOrEqual(previousEnd);
        expect(range.charEnd).toBeGreaterThanOrEqual(range.charStart);
        expect(range.charEnd).toBeLessThanOrEqual(result.charCount);
        previousEnd = range.charEnd;
      }
      const last = result.pages[result.pages.length - 1]!;
      expect(last.charEnd).toBe(result.charCount);
    }
  });

  it('усі чотири файли — з текстовим шаром, жоден не потребує OCR', async () => {
    for (const fixture of ALL_PDFS) {
      const result = await extractText(fixture.path, MIME_PDF);
      expect(result.quality!, fixture.label).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('знімає колонтитули у спеці та лишає зміст', async () => {
    const clean = await extractText(TESCO_SPEC.path, MIME_PDF);
    const dirty = await extractText(TESCO_SPEC.path, MIME_PDF, { stripBoilerplate: false });

    expect(dirty.boilerplateRemoved).toBe(0);
    expect(clean.boilerplateRemoved).toBeGreaterThan(0);
    expect(clean.charCount).toBeLessThan(dirty.charCount * 0.85);
    expect(clean.text).not.toContain('© Tesco Stores Ltd');
    expect(dirty.text).toContain('© Tesco Stores Ltd');
    expect(clean.text).toContain('Management review');
  });

  it('вгадує тип за розширенням, якщо mime не переданий', async () => {
    const result = await extractText(DOC_PEST.path);
    expect(result.method).toBe('pdfjs');
    expect(result.pageCount).toBe(DOC_PEST.pageCount);
  });

  it('падає зі зрозумілою помилкою на непідтримуваному форматі', async () => {
    await expect(extractText(DOC_PEST.path, 'image/tiff')).rejects.toBeInstanceOf(
      UnsupportedFormatError,
    );
    await expect(extractText(DOC_PEST.path, 'image/tiff')).rejects.toThrow(/not supported/);
  });
});

describe('pdfQuality', () => {
  it('поріг 200 символів/сторінку лягає рівно на 0.3', () => {
    expect(pdfQuality(200, 1)).toBe(OCR_QUALITY_THRESHOLD);
    expect(pdfQuality(199, 1)).toBeLessThan(OCR_QUALITY_THRESHOLD);
    expect(pdfQuality(201, 1)).toBeGreaterThan(OCR_QUALITY_THRESHOLD);
  });

  it('нормує у 0..1', () => {
    expect(pdfQuality(0, 10)).toBe(0);
    expect(pdfQuality(100_000, 10)).toBe(1);
    expect(pdfQuality(1000, 1)).toBe(1);
    expect(pdfQuality(10, 0)).toBe(0);
  });

  it('монотонно зростає зі щільністю', () => {
    const points = [50, 150, 200, 400, 700, 900, 1000].map((cpp) => pdfQuality(cpp, 1));
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!).toBeGreaterThanOrEqual(points[i - 1]!);
    }
  });

  it('скан (мало символів на сторінку) позначається як такий, що потребує OCR', () => {
    expect(pdfQuality(50 * 30, 30)).toBeLessThan(OCR_QUALITY_THRESHOLD);
  });
});

describe('isSupportedMime', () => {
  it('знає PDF і DOCX', () => {
    expect(isSupportedMime(MIME_PDF)).toBe(true);
    expect(isSupportedMime(MIME_DOCX)).toBe(true);
    expect(isSupportedMime('text/plain')).toBe(false);
  });
});

describe('OCR', () => {
  it('за замовчуванням недоступний і падає зі зрозумілою помилкою', async () => {
    expect(await isOcrAvailable()).toBe(false);
    await expect(getOcrEngine().recognize('/any/path.pdf')).rejects.toBeInstanceOf(
      OcrNotConfiguredError,
    );
    await expect(getOcrEngine().recognize('/any/path.pdf')).rejects.toThrow(/no OCR engine/);
  });

  it('рушій можна підмінити й повернути назад', async () => {
    setOcrEngine({
      name: 'fake@1',
      isAvailable: async () => true,
      recognize: async () => ({
        pages: ['текст'],
        ranges: [{ pageNo: 1, charStart: 0, charEnd: 5 }],
        confidence: 0.8,
        toolVersion: 'fake@1',
      }),
    });
    expect(await isOcrAvailable()).toBe(true);
    expect((await getOcrEngine().recognize('/x.pdf')).confidence).toBe(0.8);

    setOcrEngine(null);
    expect(await isOcrAvailable()).toBe(false);
  });
});
