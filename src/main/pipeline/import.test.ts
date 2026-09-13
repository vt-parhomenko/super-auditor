import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type Db } from '@main/db';
import { setStorageRoot } from '@main/paths';
import { ALL_PDFS, DOC_PEST, DOC_RECEIVING, TESCO_SPEC } from '@main/ingest/fixtures';
import { importFiles } from './import';
import { parseDocumentHeader, parseSpecHeader, uniqueVersionLabel } from './docHeader';

let root: string;
let db: Db;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'sa-import-'));
  setStorageRoot(root);
  db = createTestDb();
});

afterAll(() => {
  db.close();
  setStorageRoot(null);
  rmSync(root, { recursive: true, force: true });
});

describe('імпорт реальних документів', () => {
  it('заводить документ, версію, блоб і екстракцію за один прохід', async () => {
    const result = await importFiles(db, {
      paths: [DOC_PEST.path],
      target: { kind: 'document' },
    });

    expect(result.failed).toEqual([]);
    expect(result.imported).toHaveLength(1);

    const item = result.imported[0]!;
    expect(item.duplicate).toBe(false);
    expect(item.documentVersionId).toBeGreaterThan(0);

    const version = db.documents.getVersion(item.documentVersionId!)!;
    const doc = db.documents.get(version.documentId)!;

    // Шапка документа: 'Pest Management  0068 / Versie: 002 / Proceseigenaar: …'
    expect(doc.docNumber).toBe('0068');
    expect(doc.title).toContain('Pest Management');
    expect(doc.processOwner).toContain('Warehouse');
    expect(version.versionLabel).toBe('002');
    expect(version.lang).toBe('nl');

    // Екстракція прив'язана і містить справжній текст.
    const extraction = db.extractions.get(version.extractionId!)!;
    expect(extraction.pageCount).toBe(DOC_PEST.pageCount);
    expect(extraction.text).toContain('Attack');
    expect(extraction.pages).toHaveLength(DOC_PEST.pageCount);

    // Блоб зареєстрований і файл лежить у сховищі.
    const blob = db.blobs.get(item.blobHash)!;
    expect(blob.mime).toBe('application/pdf');
    expect(blob.relPath.startsWith(item.blobHash.slice(0, 2))).toBe(true);
  });

  it('повторний імпорт того самого файлу не створює другу версію', async () => {
    const before = db.documents.list().length;

    const result = await importFiles(db, {
      paths: [DOC_PEST.path],
      target: { kind: 'document' },
    });

    expect(result.imported[0]?.duplicate).toBe(true);
    expect(db.documents.list()).toHaveLength(before);
  });

  it('імпортує специфікацію з кодом і версією з імені файлу', async () => {
    const result = await importFiles(db, {
      paths: [TESCO_SPEC.path],
      target: { kind: 'specification' },
    });

    const specVersionId = result.imported[0]?.specVersionId;
    expect(specVersionId).toBeGreaterThan(0);

    const version = db.specs.getVersion(specVersionId!)!;
    const spec = db.specs.get(version.specificationId)!;

    expect(spec.code).toBe('20405');
    expect(spec.name).toContain('Tesco Ornamental Plant Standard');
    expect(spec.issuer).toContain('Tesco');
    expect(version.versionLabel).toBe('5.0');
    expect(version.clausesStatus).toBe('pending');

    // ADR-8: чужий стандарт за замовчуванням не йде в хмару.
    expect(spec.cloudAllowed).toBe(false);

    const extraction = db.extractions.get(version.extractionId!)!;
    expect(extraction.pageCount).toBe(101);
    expect(extraction.text).toContain('Pest management programme specification');
  });

  it('імпортує весь набір документів і рахує прогрес', async () => {
    const fresh = createTestDb();
    const seen: string[] = [];

    const result = await importFiles(
      fresh,
      {
        paths: ALL_PDFS.filter((f) => f !== TESCO_SPEC).map((f) => f.path),
        target: { kind: 'document' },
      },
      { onProgress: (_done, _total, path) => seen.push(path) },
    );

    expect(result.failed).toEqual([]);
    expect(result.imported).toHaveLength(3);
    expect(seen).toHaveLength(3);
    expect(fresh.documents.list()).toHaveLength(3);

    // Кожен документ отримав свій номер із шапки, жоден не злився з іншим.
    const numbers = fresh.documents
      .list()
      .map((d) => d.docNumber)
      .sort();
    expect(numbers).toEqual(['0045', '0068', '0072']);

    fresh.close();
  });

  it('неіснуючий файл потрапляє у failed, решта імпортується', async () => {
    const fresh = createTestDb();

    const result = await importFiles(fresh, {
      paths: [join(root, 'no-such-file.pdf'), DOC_RECEIVING.path],
      target: { kind: 'document' },
    });

    expect(result.imported).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.path).toContain('no-such-file');

    fresh.close();
  });
});

describe('parseDocumentHeader', () => {
  it('розбирає нідерландську шапку', () => {
    const header = parseDocumentHeader(
      'Pest Management 0068 Versie: 002 Proceseigenaar: Warehouse & Production Manager\n\n' +
        'This procedure sets out how to deal with notifiable outbreaks…',
    );

    expect(header).toMatchObject({
      title: 'Pest Management',
      docNumber: '0068',
      versionLabel: '002',
      lang: 'nl',
    });
    expect(header.processOwner).toBe('Warehouse & Production Manager');
  });

  it('розбирає англійський варіант міток', () => {
    const header = parseDocumentHeader('Glass Policy 0110 Version: 3 Process owner: QHSE Manager');

    expect(header).toMatchObject({
      docNumber: '0110',
      versionLabel: '3',
      processOwner: 'QHSE Manager',
      lang: null,
    });
  });

  it('повертає null-и, а не вигадки, коли шапки немає', () => {
    const header = parseDocumentHeader('Just some free-form text without any header at all.');

    expect(header).toEqual({
      title: null,
      docNumber: null,
      versionLabel: null,
      processOwner: null,
      lang: null,
    });
  });

  it('не плутає числа з тіла документа з номером документа', () => {
    const header = parseDocumentHeader(
      'Receiving Flowerbulbs 0045 Versie: 003 Proceseigenaar: Manager. ' +
        'Store bulbs at 2000 units per pallet for 2026 season.',
    );

    expect(header.docNumber).toBe('0045');
  });
});

describe('parseSpecHeader', () => {
  it('дістає код і версію з імені файлу', () => {
    const header = parseSpecHeader(
      'Tesco Ornamental Plant Standard Version 5.0 2026 © Tesco Stores Ltd. All Rights Reserved.',
      'C:/x/20405V5.0EN - Tesco Ornamental Plant Standard 2026.pdf',
    );

    expect(header).toMatchObject({
      code: '20405',
      versionLabel: '5.0',
      name: 'Tesco Ornamental Plant Standard',
    });
    expect(header.issuer).toContain('Tesco');
  });

  it("падає назад на текст, коли ім'я файлу неінформативне", () => {
    const header = parseSpecHeader(
      'Some Retailer Produce Standard Version 2.1',
      'C:/x/scan-001.pdf',
    );

    expect(header.versionLabel).toBe('2.1');
    expect(header.name).toContain('Standard');
  });
});

describe('uniqueVersionLabel', () => {
  it('віддає бажану мітку, якщо вона вільна', () => {
    expect(uniqueVersionLabel('002', ['001'])).toBe('002');
  });

  it('додає суфікс, коли мітка зайнята', () => {
    expect(uniqueVersionLabel('002', ['002'])).toBe('002-2');
    expect(uniqueVersionLabel('002', ['002', '002-2'])).toBe('002-3');
  });
});
