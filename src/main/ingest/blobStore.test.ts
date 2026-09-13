import { mkdtempSync, rmSync } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blobsDir, setStorageRoot } from '@main/paths';
import { blobExists, putFile, relPathOf, removeBlob, resolveBlob } from './index';
import { cleanupTemp } from './blobStore';
import { sha256File } from './hash';
import { MIME_PDF } from './mime';
import { DOC_DAMAGED, DOC_PEST, TESCO_SPEC } from './fixtures';

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'super-auditor-blobs-'));
  setStorageRoot(root);
});

afterAll(() => {
  setStorageRoot(null);
  rmSync(root, { recursive: true, force: true });
});

describe('putFile', () => {
  it('розкладає блоб по шардах 2+2 і зберігає байт-у-байт', async () => {
    const descriptor = await putFile(DOC_PEST.path);
    const hash = await sha256File(DOC_PEST.path);

    expect(descriptor.hash).toBe(hash);
    expect(descriptor.ext).toBe('.pdf');
    expect(descriptor.mime).toBe(MIME_PDF);
    expect(descriptor.duplicate).toBe(false);
    expect(descriptor.byteSize).toBe((await stat(DOC_PEST.path)).size);

    // Шардинг: <blobs>/ab/cd/abcd….pdf
    const tail = descriptor.absPath.slice(blobsDir().length + 1).split(sep);
    expect(tail).toEqual([hash.slice(0, 2), hash.slice(2, 4), `${hash}.pdf`]);
    expect(descriptor.relPath).toBe(relPathOf(hash, '.pdf'));
    expect(descriptor.relPath).toBe(`${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.pdf`);

    // Оригінал не мутований, копія ідентична.
    const [source, stored] = await Promise.all([
      readFile(DOC_PEST.path),
      readFile(descriptor.absPath),
    ]);
    expect(stored.equals(source)).toBe(true);
  });

  it('дедуплікує повторний імпорт того самого файлу', async () => {
    const first = await putFile(DOC_DAMAGED.path);
    expect(first.duplicate).toBe(false);
    const mtime = (await stat(first.absPath)).mtimeMs;

    const second = await putFile(DOC_DAMAGED.path);
    expect(second.duplicate).toBe(true);
    expect(second.hash).toBe(first.hash);
    expect(second.absPath).toBe(first.absPath);
    // Файл не переписано — це і є економія на повторному імпорті.
    expect((await stat(second.absPath)).mtimeMs).toBe(mtime);
  });

  it('дедуплікує копію файлу під іншим іменем', async () => {
    const copyPath = join(root, 'renamed-copy.pdf');
    await writeFile(copyPath, await readFile(DOC_DAMAGED.path));

    const descriptor = await putFile(copyPath);
    expect(descriptor.duplicate).toBe(true);
    expect(basename(descriptor.absPath)).toBe(`${descriptor.hash}.pdf`);
  });

  it('не лишає недописаних .part після успішного запису', async () => {
    await putFile(TESCO_SPEC.path);
    const entries = await readdir(join(blobsDir(), '.tmp')).catch(() => [] as string[]);
    expect(entries.filter((e) => e.endsWith('.part'))).toEqual([]);
  });

  it('паралельний імпорт того самого файлу не ламає блоб', async () => {
    const results = await Promise.all([
      putFile(DOC_PEST.path),
      putFile(DOC_PEST.path),
      putFile(DOC_PEST.path),
    ]);
    const hashes = new Set(results.map((r) => r.hash));
    expect(hashes.size).toBe(1);
    const stored = await readFile(results[0]!.absPath);
    expect(stored.equals(await readFile(DOC_PEST.path))).toBe(true);
  });

  it('визначає mime за сигнатурою, а не за розширенням', async () => {
    const lying = join(root, 'actually-a-pdf.docx');
    await writeFile(lying, await readFile(DOC_PEST.path));
    const descriptor = await putFile(lying);
    expect(descriptor.mime).toBe(MIME_PDF);
    // Розширення все одно зберігаємо як є — воно частина адреси блоба.
    expect(descriptor.ext).toBe('.docx');
  });
});

describe('resolve / exists / remove', () => {
  it('повний цикл життя блоба', async () => {
    const descriptor = await putFile(DOC_DAMAGED.path);
    expect(resolveBlob(descriptor.hash, '.pdf')).toBe(descriptor.absPath);
    expect(await blobExists(descriptor.hash, '.pdf')).toBe(true);

    await removeBlob(descriptor.hash, '.pdf');
    expect(await blobExists(descriptor.hash, '.pdf')).toBe(false);

    // Повторне видалення — не помилка.
    await expect(removeBlob(descriptor.hash, '.pdf')).resolves.toBeUndefined();

    // Після видалення файл кладеться заново, вже не як дублікат.
    const again = await putFile(DOC_DAMAGED.path);
    expect(again.duplicate).toBe(false);
  });

  it('exists відповідає false для незнайомого хешу', async () => {
    expect(await blobExists('0'.repeat(64), '.pdf')).toBe(false);
  });
});

describe('cleanupTemp', () => {
  it('прибирає теку часткових записів', async () => {
    await putFile(DOC_PEST.path);
    await cleanupTemp();
    await expect(readdir(join(blobsDir(), '.tmp'))).rejects.toThrow();
    // Самі блоби не постраждали.
    expect(await blobExists(await sha256File(DOC_PEST.path), '.pdf')).toBe(true);
  });
});
