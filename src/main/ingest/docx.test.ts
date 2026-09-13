/**
 * DOCX-фікстур у репозиторії немає (усі чотири реальні файли — PDF), тому
 * тут перевіряється те, що можна перевірити чесно: конвертер HTML → Markdown,
 * через який проходить весь вихід mammoth.
 */

import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from './docx';

describe('htmlToMarkdown', () => {
  it('перетворює заголовки', () => {
    expect(htmlToMarkdown('<h1>Pest Management</h1><h3>Mice</h3>')).toBe(
      '# Pest Management\n\n### Mice',
    );
  });

  it('перетворює абзаци з інлайновим форматуванням', () => {
    expect(htmlToMarkdown('<p>Mice traps are <strong>set up</strong> with <em>Attack</em>.</p>')).toBe(
      'Mice traps are **set up** with *Attack*.',
    );
  });

  it('перетворює марковані списки', () => {
    const html = '<ul><li>peak production</li><li>bottlenecks</li></ul>';
    expect(htmlToMarkdown(html)).toBe('- peak production\n\n- bottlenecks');
  });

  it('нумерує впорядковані списки', () => {
    const html = '<ol><li>first</li><li>second</li><li>third</li></ol>';
    expect(htmlToMarkdown(html)).toBe('1. first\n\n2. second\n\n3. third');
  });

  it('перетворює таблиці у markdown-таблиці', () => {
    const html =
      '<table><tr><th>Clause</th><th>Topic</th></tr>' +
      '<tr><td>1.3</td><td>Management review</td></tr></table>';
    const md = htmlToMarkdown(html);
    expect(md).toContain('| Clause | Topic |');
    expect(md).toContain('| --- | --- |');
    expect(md).toContain('| 1.3 | Management review |');
  });

  it('вирівнює таблиці з нерівною кількістю клітинок', () => {
    const html = '<table><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>d</td></tr></table>';
    const md = htmlToMarkdown(html).split('\n');
    expect(md[0]).toBe('| a | b | c |');
    expect(md[md.length - 1]).toBe('| d |   |   |');
  });

  it('декодує html-сутності', () => {
    expect(htmlToMarkdown('<p>Tesco &amp; Co &ndash; &quot;quality&quot; &#48;068</p>')).toBe(
      'Tesco & Co – "quality" 0068',
    );
  });

  it('ігнорує невідомі теги, зберігаючи їхній вміст', () => {
    expect(htmlToMarkdown('<p>text with <span class="x">span</span> inside</p>')).toBe(
      'text with span inside',
    );
  });

  it('порожній вхід — порожній вихід', () => {
    expect(htmlToMarkdown('')).toBe('');
    expect(htmlToMarkdown('<p></p><p>  </p>')).toBe('');
  });
});
