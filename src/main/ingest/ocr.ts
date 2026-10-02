/**
 * Інтерфейс OCR і заглушка.
 *
 * Реалізації поки немає СВІДОМО: tesseract (або будь-який інший рушій) тягне
 * десятки мегабайтів мовних даних, а на нашому корпусі жоден із файлів не є
 * сканом — усі чотири PDF мають текстовий шар (quality = 1.0).
 * Диспетчер лише позначає `needsOcr: true`, коли щільність тексту падає
 * нижче 0.3, і UI має показати це користувачу як «документ схожий на скан».
 *
 * Щоб під'єднати рушій — зареєструйте свою реалізацію через `setOcrEngine`.
 */

import { LocalizedError } from '@main/i18n';
import type { PageRange } from '@shared/domain';

export interface OcrPageResult {
  pageNo: number;
  text: string;
  /** Впевненість рушія, 0..1. */
  confidence: number;
}

export interface OcrResult {
  pages: string[];
  ranges: PageRange[];
  /** Середня впевненість по документу, 0..1 — іде в `extraction.quality`. */
  confidence: number;
  toolVersion: string;
}

export interface OcrOptions {
  /** Мови у нотації рушія, напр. `['eng', 'nld']`. */
  languages?: string[];
  /** Обмежити діапазоном сторінок (1-індексовано, включно). */
  pageRange?: { from: number; to: number };
  onPage?: (pageNo: number, pageCount: number) => void;
}

export interface OcrEngine {
  /** Ідентифікатор рушія для `extraction.tool_version`, напр. `'tesseract@5.3.4'`. */
  readonly name: string;
  /** Чи готовий рушій до роботи (є бінарник, завантажені мовні дані). */
  isAvailable(): Promise<boolean>;
  recognize(absPath: string, options?: OcrOptions): Promise<OcrResult>;
}

/**
 * Документ схожий на скан (щільність тексту нижча за поріг), але жодного
 * OCR-рушія не зареєстровано — під'єднати його можна через `setOcrEngine()`.
 */
export class OcrNotConfiguredError extends LocalizedError {
  constructor() {
    super((m) => m.importing.ocrNotConfigured);
    this.name = 'OcrNotConfiguredError';
  }
}

/** Заглушка за замовчуванням: чесно каже, що її немає. */
export const nullOcrEngine: OcrEngine = {
  name: 'none',
  isAvailable: async () => false,
  recognize: async () => {
    throw new OcrNotConfiguredError();
  },
};

let engine: OcrEngine = nullOcrEngine;

/** Реєструє рушій OCR. `null` повертає заглушку. */
export function setOcrEngine(next: OcrEngine | null): void {
  engine = next ?? nullOcrEngine;
}

export function getOcrEngine(): OcrEngine {
  return engine;
}

/** Чи є під рукою робочий OCR. Дешева перевірка для UI. */
export async function isOcrAvailable(): Promise<boolean> {
  return engine.isAvailable();
}
