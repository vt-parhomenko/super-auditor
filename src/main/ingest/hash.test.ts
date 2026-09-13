import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { sha256Bytes, sha256File, sha256Text } from './hash';
import { ALL_PDFS, TESCO_SPEC } from './fixtures';

describe('sha256File', () => {
  it('збігається з незалежним обчисленням по всіх реальних PDF', async () => {
    for (const fixture of ALL_PDFS) {
      const streamed = await sha256File(fixture.path);
      const independent = createHash('sha256')
        .update(await readFile(fixture.path))
        .digest('hex');
      expect(streamed, fixture.label).toBe(independent);
    }
  });

  it('стабільний між викликами', async () => {
    const [a, b] = await Promise.all([sha256File(TESCO_SPEC.path), sha256File(TESCO_SPEC.path)]);
    expect(a).toBe(b);
  });

  it('віддає 64 hex-символи в нижньому регістрі', async () => {
    const hash = await sha256File(TESCO_SPEC.path);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('різні файли — різні хеші', async () => {
    const hashes = await Promise.all(ALL_PDFS.map((f) => sha256File(f.path)));
    expect(new Set(hashes).size).toBe(ALL_PDFS.length);
  });

  it('падає на неіснуючому файлі, а не віддає хеш порожнечі', async () => {
    await expect(sha256File(`${TESCO_SPEC.path}.missing`)).rejects.toThrow();
  });
});

describe('sha256Text / sha256Bytes', () => {
  it('відповідає еталонним векторам', () => {
    expect(sha256Text('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Text('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('sha256Bytes і sha256Text узгоджені для UTF-8', () => {
    const text = 'Tesco Ornamental Plant Standard — вимога 1.3';
    expect(sha256Bytes(new TextEncoder().encode(text))).toBe(sha256Text(text));
  });
});
