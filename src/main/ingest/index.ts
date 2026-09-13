/**
 * Публічний API шару імпорту й екстракції (Stage 0).
 *
 * Типовий сценарій оркестрації, який будує шар вище:
 *
 *   const blob = await putFile(pickedPath);          // → рядок у `blob`
 *   const result = await extractText(blob.absPath, blob.mime);
 *   // → рядок у `extraction` + `extraction_page` з result.pages
 *
 * Модуль не звертається до БД і нічого не мутує поза `blobs/`.
 */

export { sha256Bytes, sha256File, sha256Text } from './hash';

export {
  MIME_BIN,
  MIME_DOC,
  MIME_DOCX,
  MIME_HTML,
  MIME_MD,
  MIME_PDF,
  MIME_RTF,
  MIME_TXT,
  detectMime,
  extOf,
  mimeFromExt,
  mimeFromSignature,
} from './mime';

export {
  cleanupTemp,
  exists as blobExists,
  putFile,
  relPathOf,
  remove as removeBlob,
  resolve as resolveBlob,
  type BlobDescriptor,
} from './blobStore';

export {
  PAGE_SEPARATOR,
  joinPages,
  normalizePageText,
  pageOfOffset,
  stripBoilerplate,
  type NormalizeOptions,
  type StripBoilerplateOptions,
} from './normalize';

export { extractPdf, type PdfExtraction, type PdfExtractOptions, type PdfInfo } from './pdf';

export { extractDocx, htmlToMarkdown, type DocxExtraction } from './docx';

export {
  OCR_QUALITY_THRESHOLD,
  UnsupportedFormatError,
  extractText,
  isSupportedMime,
  pdfQuality,
  type ExtractOptions,
  type ExtractionResult,
} from './extract';

export {
  OcrNotConfiguredError,
  getOcrEngine,
  isOcrAvailable,
  nullOcrEngine,
  setOcrEngine,
  type OcrEngine,
  type OcrOptions,
  type OcrPageResult,
  type OcrResult,
} from './ocr';
