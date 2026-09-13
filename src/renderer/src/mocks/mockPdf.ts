/**
 * Генератор валідного багатосторінкового PDF для mock-режиму.
 *
 * Потрібен, щоб `PdfViewer` можна було реально перевірити без бекенда: кожна
 * сторінка друкує свій номер, тож одразу видно, чи відкрилось саме там, де треба.
 *
 * Пишемо байти вручну, бо додавати залежність-генератор заради моку безглуздо.
 * Формат мінімальний, але коректний: xref з реальними зміщеннями, інакше pdf.js
 * піде у режим відновлення й тест перестане щось доводити.
 */

const PAGE_W = 595;
const PAGE_H = 842;

function contentStream(title: string, pageNo: number, pageCount: number): string {
  // BT/ET — текстовий блок; Tf — шрифт і кегль; Td — позиція від низу лівого кута.
  const esc = (s: string) => s.replace(/([()\\])/g, '\\$1');
  return [
    'BT /F1 26 Tf 64 740 Td (' + esc(title) + ') Tj ET',
    'BT /F1 64 Tf 64 640 Td (' + esc('Page ' + pageNo) + ') Tj ET',
    // Тільки ASCII: далі кожен символ пишеться одним байтом, і на цьому
    // тримаються /Length та зміщення xref. Тире тут навмисно дефіс, не em-dash.
    'BT /F1 13 Tf 64 600 Td (' + esc(`page ${pageNo} of ${pageCount} - mock fixture, not the real standard`) + ') Tj ET',
    // рамка, щоб було видно межі сторінки й масштаб
    `1 w 0.6 G 40 40 ${PAGE_W - 80} ${PAGE_H - 80} re S`,
  ].join('\n');
}

/** Будує PDF на `pageCount` сторінок. Повертає байти, придатні для `getDocument`. */
export function buildMockPdf(pageCount: number, title = 'Super Auditor'): Uint8Array {
  const count = Math.max(1, Math.min(400, Math.floor(pageCount)));

  // Нумерація об'єктів: 1 каталог, 2 дерево сторінок, 3 шрифт,
  // далі парами (сторінка, її контент).
  const firstPageObj = 4;
  const objects: string[] = [];

  const kids: string[] = [];
  for (let i = 0; i < count; i += 1) kids.push(`${firstPageObj + i * 2} 0 R`);

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [ ${kids.join(' ')} ] /Count ${count} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

  for (let i = 0; i < count; i += 1) {
    const pageObj = firstPageObj + i * 2;
    const contentObj = pageObj + 1;
    const stream = contentStream(title, i + 1, count);
    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObj} 0 R >>`;
    // /Length рахуємо в байтах ASCII — увесь вміст навмисно в ASCII.
    objects[contentObj] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }

  const total = 3 + count * 2;
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];

  for (let n = 1; n <= total; n += 1) {
    offsets[n] = pdf.length;
    pdf += `${n} 0 obj\n${objects[n] ?? '<< >>'}\nendobj\n`;
  }

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${total + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let n = 1; n <= total; n += 1) {
    pdf += `${String(offsets[n] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  // Увесь документ ASCII, тож довжина рядка збігається з довжиною в байтах —
  // саме на цьому тримається коректність /Length і зміщень xref.
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i += 1) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}
