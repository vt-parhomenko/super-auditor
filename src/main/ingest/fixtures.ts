/**
 * Шляхи до реальних тестових файлів у репозиторії.
 *
 * Тести Stage 0 пишемо ПРОТИ НИХ, а не проти синтетики: єдине, що тут може
 * зламатись, — це поведінка pdfjs на конкретних PDF-генераторах
 * (Microsoft Word і Aspose.Words), і синтетичний PDF цього не показав би.
 */

import { resolve } from 'node:path';

/** Корінь репозиторію: `src/main/ingest` → `../../..`. */
export const REPO_ROOT = resolve(__dirname, '../../..');

export interface PdfFixture {
  path: string;
  /** Очікувана кількість сторінок — жорстко зафіксована. */
  pageCount: number;
  label: string;
}

/** Табличний стандарт Tesco: 101 сторінка, колонтитули на кожній. */
export const TESCO_SPEC: PdfFixture = {
  path: resolve(REPO_ROOT, 'specifications/20405V5.0EN - Tesco Ornamental Plant Standard 2026.pdf'),
  pageCount: 101,
  label: 'Tesco Ornamental Plant Standard v5.0',
};

export const DOC_RECEIVING: PdfFixture = {
  path: resolve(REPO_ROOT, 'documents/0e443916-1f3d-4585-96f8-1167c0a66988.pdf'),
  pageCount: 6,
  label: 'Receiving Flowerbulbs 0033',
};

export const DOC_PEST: PdfFixture = {
  path: resolve(REPO_ROOT, 'documents/11c22d29-47ce-47d5-8be9-19a2ed0b99b2.pdf'),
  pageCount: 3,
  label: 'Pest Management 0068',
};

export const DOC_DAMAGED: PdfFixture = {
  path: resolve(REPO_ROOT, 'documents/f5e7e0c4-8434-4fc7-b959-0bc45e5d48d9.pdf'),
  pageCount: 2,
  label: 'Damaged Products 0072',
};

export const ALL_PDFS: readonly PdfFixture[] = [
  TESCO_SPEC,
  DOC_RECEIVING,
  DOC_PEST,
  DOC_DAMAGED,
];
