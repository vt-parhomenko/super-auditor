import type { Db } from '@main/db';
import { extractText, putFile, type BlobDescriptor, type ExtractionResult } from '@main/ingest';
import type {
  ExtractionDto,
  ImportRequest,
  ImportResult,
  ImportedItem,
  SpecVersionDto,
  DocumentVersionDto,
} from '@shared/domain';
import {
  parseDocumentHeader,
  parseSpecHeader,
  titleFromFileName,
  uniqueVersionLabel,
} from './docHeader';

/**
 * Stage 0 — оркестрація імпорту: шов між `@main/ingest` (файли, текст)
 * і `@main/db` (метадані). Жоден із них не знає про інший.
 *
 * Важливо для коректності: важка асинхронна робота (копіювання блоба,
 * екстракція тексту) виконується ПОЗА транзакцією, бо better-sqlite3
 * синхронний — `await` усередині `db.transaction()` розірвав би її.
 * У транзакцію заходимо вже з готовими даними.
 */

export interface ImportOptions {
  /** Знімати повторювані колонтитули (для 101-сторінкової спеки це ~28% тексту). */
  stripBoilerplate?: boolean;
  /** Викликається після кожного файлу — для прогресу в UI. */
  onProgress?: (done: number, total: number, path: string) => void;
}

export async function importFiles(
  db: Db,
  request: ImportRequest,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const imported: ImportedItem[] = [];
  const failed: ImportResult['failed'] = [];

  for (const [index, path] of request.paths.entries()) {
    try {
      imported.push(await importOne(db, path, request.target, options));
    } catch (error) {
      failed.push({ path, error: error instanceof Error ? error.message : String(error) });
    }
    options.onProgress?.(index + 1, request.paths.length, path);
  }

  return { imported, failed };
}

async function importOne(
  db: Db,
  path: string,
  target: ImportRequest['target'],
  options: ImportOptions,
): Promise<ImportedItem> {
  // 1. Файл у content-addressed сховище. Дедуплікація — за хешем вмісту.
  const blob = await putFile(path);

  // 2. Той самий вміст уже прив'язаний до версії? Тоді нової версії не створюємо.
  const existing =
    target.kind === 'document'
      ? db.documents.findVersionByBlob(blob.hash)
      : db.specs.findVersionByBlob(blob.hash);

  if (existing) {
    return {
      path,
      blobHash: blob.hash,
      duplicate: true,
      ...(target.kind === 'document'
        ? { documentVersionId: existing.id }
        : { specVersionId: existing.id }),
    };
  }

  // 3. Екстракція тексту — найдорожча частина, тому перевикористовуємо готову.
  const extraction = await resolveExtraction(db, blob, options);

  // 4. Метадані — синхронно, однією транзакцією.
  return db.transaction(() =>
    target.kind === 'document'
      ? attachDocumentVersion(db, path, blob, extraction, target)
      : attachSpecVersion(db, path, blob, extraction, target),
  );
}

/** Готова екстракція для цього блоба або нова. Ключ перевикористання — вміст файлу. */
async function resolveExtraction(
  db: Db,
  blob: BlobDescriptor,
  options: ImportOptions,
): Promise<ExtractionDto> {
  const known = db.extractions.best(blob.hash);
  if (known) {
    const full = db.extractions.get(known.id);
    if (full) return full;
  }

  const result: ExtractionResult = await extractText(blob.absPath, blob.mime, {
    stripBoilerplate: options.stripBoilerplate ?? true,
  });

  return db.transaction(() => {
    db.blobs.insert({
      hash: blob.hash,
      relPath: blob.relPath,
      byteSize: blob.byteSize,
      mime: blob.mime,
    });
    return db.extractions.upsert({
      blobHash: blob.hash,
      method: result.method,
      toolVersion: result.toolVersion,
      text: result.text,
      pageCount: result.pageCount,
      charCount: result.charCount,
      quality: result.quality,
      pages: result.pages,
    });
  });
}

function attachDocumentVersion(
  db: Db,
  path: string,
  blob: BlobDescriptor,
  extraction: ExtractionDto,
  target: Extract<ImportRequest['target'], { kind: 'document' }>,
): ImportedItem {
  const header = parseDocumentHeader(extraction.text);

  // Документ обираємо в такому порядку: явно вказаний → знайдений за номером → новий.
  let documentId = target.documentId ?? null;
  if (documentId === null && header.docNumber) {
    documentId = db.documents.list().find((d) => d.docNumber === header.docNumber)?.id ?? null;
  }
  if (documentId === null) {
    documentId = db.documents.create({
      title: header.title ?? titleFromFileName(path),
      docNumber: header.docNumber,
      processOwner: header.processOwner,
      kind: null,
    }).id;
  }

  const taken = db.documents.listVersions(documentId).map((v: DocumentVersionDto) => v.versionLabel);
  const versionLabel = uniqueVersionLabel(
    target.versionLabel ?? header.versionLabel ?? '1',
    taken,
  );

  const version = db.documents.addVersion({
    documentId,
    versionLabel,
    blobHash: blob.hash,
    extractionId: extraction.id,
    lang: header.lang,
  });

  return { path, blobHash: blob.hash, duplicate: false, documentVersionId: version.id };
}

function attachSpecVersion(
  db: Db,
  path: string,
  blob: BlobDescriptor,
  extraction: ExtractionDto,
  target: Extract<ImportRequest['target'], { kind: 'specification' }>,
): ImportedItem {
  const header = parseSpecHeader(extraction.text, path);

  let specificationId = target.specificationId ?? null;
  if (specificationId === null && header.code) {
    specificationId = db.specs.list().find((s) => s.code === header.code)?.id ?? null;
  }
  if (specificationId === null) {
    specificationId = db.specs.create({
      name: header.name ?? titleFromFileName(path),
      issuer: header.issuer,
      code: header.code,
      // ADR-8: хмарні провайдери за замовчуванням заборонені для чужого стандарту.
      cloudAllowed: false,
    }).id;
  }

  const taken = db.specs.listVersions(specificationId).map((v: SpecVersionDto) => v.versionLabel);
  const versionLabel = uniqueVersionLabel(
    target.versionLabel ?? header.versionLabel ?? '1',
    taken,
  );

  const version = db.specs.addVersion({
    specificationId,
    versionLabel,
    blobHash: blob.hash,
    extractionId: extraction.id,
    clausesStatus: 'pending',
  });

  return { path, blobHash: blob.hash, duplicate: false, specVersionId: version.id };
}
