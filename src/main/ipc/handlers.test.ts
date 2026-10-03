/**
 * Круговий рейс каналів на тестовій БД: renderer → ipcMain → репозиторії → назад.
 * Electron замоканий цілком, реальне вікно й мережа не піднімаються.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type {
  ClauseDto,
  DocumentDto,
  FindingDto,
  ImportResult,
  SiteProfileDto,
} from '@shared/domain';
import type { LibraryDeleteImpact, ProviderStatus } from '@shared/ipc';
import { seed, type SeedResult } from '@main/db/fixtures';
import { DOC_RECEIVING } from '@main/ingest/fixtures';
import { blobPath, setStorageRoot } from '@main/paths';
import { InMemorySecrets } from '@main/secrets';
import { installIpc, parseIpcErrorMessage, setOrchestrator, type IpcErrorCode } from './index';

const electron = vi.hoisted(() => {
  const registered = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  return {
    registered,
    dialogResult: { canceled: false, filePaths: ['C:/tmp/sop.pdf'] } as {
      canceled: boolean;
      filePaths: string[];
    },
    showOpenDialog: vi.fn(),
    lastDialogOptions: null as unknown,
  };
});

vi.mock('electron', () => ({
  app: { getPath: () => process.cwd(), isPackaged: false },
  ipcMain: {
    handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) {
      electron.registered.set(channel, listener);
    },
    removeHandler(channel: string) {
      electron.registered.delete(channel);
    },
  },
  dialog: {
    showOpenDialog: (...args: unknown[]) => {
      electron.lastDialogOptions = args[args.length - 1];
      return Promise.resolve(electron.dialogResult);
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8'),
  },
  BrowserWindow: class {},
  shell: { openExternal: vi.fn() },
}));

let root: string;
let fixture: SeedResult;
let ipc: ReturnType<typeof installIpc>;
const emitted: Array<{ event: string; payload: unknown }> = [];

/** Виклик каналу так, як його викликав би renderer. */
async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const listener = electron.registered.get(channel);
  if (!listener) throw new Error(`Канал ${channel} не зареєстровано`);
  return (await listener({}, ...args)) as T;
}

/** Перевіряє, що канал відмовив саме цим кодом. */
async function expectCode(promise: Promise<unknown>, code: IpcErrorCode): Promise<string> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e as Error,
  );
  if (!err) throw new Error(`Очікували помилку ${code}, але виклик пройшов успішно`);
  const shape = parseIpcErrorMessage(err.message);
  expect(shape, err.message).not.toBeNull();
  expect(shape?.code).toBe(code);
  return shape?.message ?? '';
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'sa-ipc-handlers-'));
  setStorageRoot(root);
});

afterAll(() => {
  setStorageRoot(null);
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  electron.registered.clear();
  emitted.length = 0;
  setOrchestrator(null);

  fixture = seed();
  ipc = installIpc({
    db: fixture.db,
    getWindow: () => null,
    secrets: new InMemorySecrets(),
    allowNetwork: false,
    logger: { error: () => {} },
  });

  const realEmit = ipc.events.emit.bind(ipc.events);
  ipc.events.emit = ((event: string, payload: unknown) => {
    emitted.push({ event, payload });
    return realEmit(event as never, payload as never);
  }) as typeof ipc.events.emit;
});

afterEach(() => {
  ipc.dispose();
  fixture.db.close();
  setOrchestrator(null);
});

// ─── Читальні канали ─────────────────────────────────────────────────────────

describe('бібліотека документів', () => {
  it('list / get / update / delete ходять по колу', async () => {
    const all = await invoke<DocumentDto[]>('documents:list');
    expect(all.map((d) => d.docNumber).sort()).toEqual(['0068', '0072']);

    const filtered = await invoke<DocumentDto[]>('documents:list', { search: 'Pest' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.versions[0]?.versionLabel).toBe('002');

    await invoke('documents:update', fixture.pestDocId, { processOwner: 'QA Manager' });
    const updated = await invoke<DocumentDto | null>('documents:get', fixture.pestDocId);
    expect(updated?.processOwner).toBe('QA Manager');
    expect(emitted.filter((e) => e.event === 'library:changed')).toHaveLength(1);

    const spare = fixture.db.documents.create({ title: 'Тимчасовий SOP', kind: 'other' });
    await invoke('library:delete', { kind: 'document', id: spare.id });
    expect(await invoke<DocumentDto[]>('documents:list')).toHaveLength(2);
  });

  it('документ, який брав участь у перевірці, видаляється разом із нею', async () => {
    // Раніше `documents:delete` тут відмовляв. Тепер ціну показують заздалегідь,
    // а перевірка, що охоплювала й інший документ, зникає повністю.
    const impact = await invoke<LibraryDeleteImpact>('library:deleteImpact', {
      kind: 'document',
      id: fixture.damagedDocId,
    });
    expect(impact.runs).toEqual([
      expect.objectContaining({ id: fixture.runId, documentCount: 2, otherDocuments: 1 }),
    ]);

    fixture.db.runs.setStatus(fixture.runId, 'done');
    const done = await invoke<LibraryDeleteImpact>('library:delete', {
      kind: 'document',
      id: fixture.damagedDocId,
    });
    expect(done.runs.map((run) => run.id)).toEqual([fixture.runId]);
    expect(await invoke('documents:get', fixture.damagedDocId)).toBeNull();
    expect(await invoke('runs:get', fixture.runId)).toBeNull();
    expect(emitted).toContainEqual({ event: 'library:changed', payload: { kind: 'documents' } });
  });

  it('NOT_FOUND для неіснуючого id', async () => {
    expect(await invoke('documents:get', 4242)).toBeNull();
    await expectCode(invoke('documents:update', 4242, { title: 'x' }), 'NOT_FOUND');
    await expectCode(invoke('library:delete', { kind: 'document', id: 4242 }), 'NOT_FOUND');
    await expectCode(invoke('library:deleteImpact', { kind: 'documentVersion', id: 4242 }), 'NOT_FOUND');
  });

  it('кривий запит на видалення — VALIDATION мовою інтерфейсу', async () => {
    const message = await expectCode(invoke('library:delete', { kind: 'blob', id: 1 }), 'VALIDATION');
    expect(message).toContain('expected a specification');
    await expectCode(invoke('library:deleteImpact', { kind: 'document', id: -1 }), 'VALIDATION');
    await expectCode(invoke('library:deleteImpact', null), 'VALIDATION');

    await invoke('settings:set', { uiLanguage: 'uk' });
    const ukrainian = await expectCode(invoke('library:delete', 'документ'), 'VALIDATION');
    expect(ukrainian).toContain('Немає що видаляти');
  });

  it('VALIDATION для явно кривого id', async () => {
    await expectCode(invoke('documents:get', 'абищо'), 'VALIDATION');
    await expectCode(invoke('documents:get', -1), 'VALIDATION');
  });
});

describe('специфікації та версії', () => {
  it('віддає специфікацію з версіями і перемикає cloudAllowed', async () => {
    const specs = await invoke<Array<{ id: number; cloudAllowed: boolean }>>('specs:list');
    expect(specs).toHaveLength(1);
    expect(specs[0]?.cloudAllowed).toBe(false);

    await invoke('specs:setCloudAllowed', fixture.specificationId, true);
    const spec = await invoke<{ cloudAllowed: boolean } | null>('specs:get', fixture.specificationId);
    expect(spec?.cloudAllowed).toBe(true);

    const version = await invoke<{ clauseCount: number } | null>('specs:version', fixture.specVersionId);
    expect(version?.clauseCount).toBe(5);

    expect(await invoke('specs:summary', fixture.specVersionId)).toBeNull();
    await expectCode(invoke('specs:setCloudAllowed', 999, true), 'NOT_FOUND');
    await expectCode(invoke('specs:summary', 999), 'NOT_FOUND');
  });
});

describe('реєстр вимог', () => {
  it('list / get / patch / create / delete', async () => {
    const clauses = await invoke<ClauseDto[]>('clauses:list', fixture.specVersionId);
    expect(clauses.map((c) => c.clauseNo)).toEqual(['3.1', '10.1', '10.2', '10.3', '14.1']);

    const first = clauses[0]!;
    const patched = await invoke<ClauseDto>('clauses:patch', first.id, { topic: 'Ethical audit v2' });
    expect(patched.topic).toBe('Ethical audit v2');

    const created = await invoke<ClauseDto>('clauses:create', fixture.specVersionId, {
      clauseNo: '10.4',
      requirementText: 'Bait stations must be mapped.',
      sectionNo: '10',
    });
    expect(created.sortKey).toBe('010.004');
    expect(created.reviewStatus).toBe('edited');

    await invoke('clauses:delete', created.id);
    expect(await invoke<ClauseDto[]>('clauses:list', fixture.specVersionId)).toHaveLength(5);

    await expectCode(invoke('clauses:patch', 999, {}), 'NOT_FOUND');
    await expectCode(invoke('clauses:delete', 999), 'NOT_FOUND');
    await expectCode(
      invoke('clauses:create', fixture.specVersionId, { clauseNo: '', requirementText: 'x' }),
      'VALIDATION',
    );
  });

  it('позначки стандарту: patch і create нормалізують коректні, відхиляють биті', async () => {
    const clauses = await invoke<ClauseDto[]>('clauses:list', fixture.specVersionId);
    const first = clauses[0]!;

    const patched = await invoke<ClauseDto>('clauses:patch', first.id, { markers: [' P ', 'Major  Must', 'P'] });
    expect(patched.markers).toEqual(['P', 'Major Must']);
    const cleared = await invoke<ClauseDto>('clauses:patch', first.id, { markers: [] });
    expect(cleared.markers).toEqual([]);

    const invalid: unknown[] = [
      'P',
      [''],
      ['   '],
      [42],
      ['x'.repeat(41)],
      Array.from({ length: 9 }, (_, i) => `M${i}`),
    ];
    for (const markers of invalid) {
      await expectCode(invoke('clauses:patch', first.id, { markers }), 'VALIDATION');
    }
    // Відхилена правка нічого не записала.
    expect((await invoke<ClauseDto>('clauses:get', first.id)).markers).toEqual([]);

    const created = await invoke<ClauseDto>('clauses:create', fixture.specVersionId, {
      clauseNo: 'AF 1.1.1',
      requirementText: 'Is there a reference system for each field?',
      markers: ['Major Must'],
    });
    expect(created.markers).toEqual(['Major Must']);
    const message = await expectCode(
      invoke('clauses:create', fixture.specVersionId, {
        clauseNo: 'AF 1.1.2',
        requirementText: 'Is there a recording system?',
        markers: [''],
      }),
      'VALIDATION',
    );
    expect(message).toContain('at most 8 short codes');
    await invoke('clauses:delete', created.id);
  });

  it('markReviewed проходить, коли всі вимоги підтверджені', async () => {
    await expect(invoke('clauses:markReviewed', fixture.specVersionId)).resolves.toBeUndefined();
    const version = await invoke<{ clausesStatus: string } | null>(
      'specs:version',
      fixture.specVersionId,
    );
    expect(version?.clausesStatus).toBe('reviewed');
  });

  it('VALIDATION, якщо лишились вимоги auto або flagged', async () => {
    const clauses = await invoke<ClauseDto[]>('clauses:list', fixture.specVersionId);
    await invoke('clauses:patch', clauses[0]!.id, { reviewStatus: 'flagged' });
    await invoke('clauses:patch', clauses[1]!.id, { reviewStatus: 'auto' });

    const message = await expectCode(
      invoke('clauses:markReviewed', fixture.specVersionId),
      'VALIDATION',
    );
    expect(message).toContain('1 unconfirmed');
    expect(message).toContain('1 flagged');

    await invoke('settings:set', { uiLanguage: 'uk' });
    const ukrainian = await expectCode(
      invoke('clauses:markReviewed', fixture.specVersionId),
      'VALIDATION',
    );
    expect(ukrainian).toContain('1 без підтвердження');
    expect(ukrainian).toContain('1 позначено прапорцем');
  });
});

// ─── Імпорт і блоби ──────────────────────────────────────────────────────────

describe('import:pick', () => {
  it('відкриває діалог із фільтрами PDF/DOCX і множинним вибором', async () => {
    electron.dialogResult = { canceled: false, filePaths: ['a.pdf', 'b.docx'] };
    expect(await invoke('import:pick', 'document')).toEqual(['a.pdf', 'b.docx']);

    const options = electron.lastDialogOptions as Electron.OpenDialogOptions;
    expect(options.properties).toContain('multiSelections');
    expect(options.filters?.[0]?.extensions).toEqual(['pdf', 'docx']);

    electron.dialogResult = { canceled: true, filePaths: [] };
    expect(await invoke('import:pick', 'specification')).toEqual([]);

    await expectCode(invoke('import:pick', 'нісенітниця'), 'VALIDATION');
  });

  it('системний діалог говорить мовою інтерфейсу', async () => {
    electron.dialogResult = { canceled: true, filePaths: [] };

    await invoke('import:pick', 'document');
    expect((electron.lastDialogOptions as Electron.OpenDialogOptions).title).toBe('Import documents');

    await invoke('settings:set', { uiLanguage: 'nl' });
    await invoke('import:pick', 'specification');
    const options = electron.lastDialogOptions as Electron.OpenDialogOptions;
    expect(options.title).toBe('Norm importeren');
    expect(options.buttonLabel).toBe('Importeren');
    expect(options.filters?.[0]?.name).toBe('Documenten (PDF, DOCX)');
  });
});

describe('import:run', () => {
  it('імпортує реальний PDF і повідомляє renderer про зміну бібліотеки', async () => {
    const result = await invoke<ImportResult>('import:run', {
      paths: [DOC_RECEIVING.path],
      target: { kind: 'document' },
    });

    expect(result.failed).toEqual([]);
    expect(result.imported).toHaveLength(1);
    expect(result.imported[0]?.documentVersionId).toBeGreaterThan(0);

    expect(emitted.filter((e) => e.event === 'library:changed')).toEqual([
      { event: 'library:changed', payload: { kind: 'documents' } },
    ]);

    // Блоб реально ліг у сховище — його одразу видно через blob:path.
    const path = await invoke<string | null>('blob:path', result.imported[0]!.blobHash);
    expect(path).not.toBeNull();
  }, 30_000);

  it('VALIDATION для порожнього запиту', async () => {
    await expectCode(invoke('import:run', { paths: [], target: { kind: 'document' } }), 'VALIDATION');
    await expectCode(invoke('import:run', { paths: ['x.pdf'], target: null }), 'VALIDATION');
  });
});

describe('blob:path', () => {
  it('віддає абсолютний шлях лише для хеша, який є в БД', async () => {
    const absolute = blobPath(fixture.specBlob, '.pdf');
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, '%PDF-1.7');

    expect(await invoke('blob:path', fixture.specBlob)).toBe(absolute);
    // Регістр вхідного хеша не має значення — він нормалізується.
    expect(await invoke('blob:path', fixture.specBlob.toUpperCase())).toBe(absolute);
  });

  it('відмовляє для невідомого хеша', async () => {
    await expectCode(invoke('blob:path', 'f'.repeat(64)), 'NOT_FOUND');
  });

  it('не дає піти за межі теки блобів', async () => {
    await expectCode(invoke('blob:path', '../../../etc/passwd'), 'VALIDATION');
    await expectCode(invoke('blob:path', 'aa/bb/../../../secret.pdf'), 'VALIDATION');
    await expectCode(invoke('blob:path', ''), 'VALIDATION');
  });

  it('null, якщо рядок у БД є, а файлу на диску немає', async () => {
    // Блоб документа в фікстурі на диск не кладеться.
    expect(await invoke('blob:path', 'c'.repeat(64))).toBeNull();
  });
});

describe('extraction:get', () => {
  it('віддає повний текст із прив язками сторінок', async () => {
    const version = fixture.db.documents.getVersion(fixture.pestVersionId)!;
    const extraction = await invoke<{ text: string; pages: unknown[] } | null>(
      'extraction:get',
      version.extractionId!,
    );
    expect(extraction?.text).toContain('Pest management programme');
    expect(extraction?.pages).toHaveLength(1);
    expect(await invoke('extraction:get', 9999)).toBeNull();
  });
});

// ─── Профілі виробництва ───────────────────────────────────────────────────────────

describe('профілі виробництва й застосовність', () => {
  it('save / list / delete', async () => {
    const saved = await invoke<SiteProfileDto>('sites:save', {
      name: '  Нова площадка  ',
      modules: ['P'],
      certifications: [],
      products: [],
      processes: [],
      notes: null,
    });
    expect(saved.name).toBe('Нова площадка');
    expect(await invoke<SiteProfileDto[]>('sites:list')).toHaveLength(2);

    await invoke('sites:delete', saved.id);
    expect(await invoke<SiteProfileDto[]>('sites:list')).toHaveLength(1);

    await expectCode(
      invoke('sites:save', { name: '   ', modules: [], certifications: [], products: [], processes: [], notes: null }),
      'VALIDATION',
    );
    await expectCode(invoke('sites:delete', 999), 'NOT_FOUND');
  });

  it('recomputeApplicability рахує детермінований фільтр і пише в БД', async () => {
    const counts = await invoke<{ applicable: number; notApplicable: number }>(
      'sites:recomputeApplicability',
      fixture.siteProfileId,
      fixture.specVersionId,
    );

    // ISO 14001 у профілі знімає секцію Environment (вимога 14.1).
    expect(counts.applicable).toBe(4);
    expect(counts.notApplicable).toBe(1);

    await expectCode(
      invoke('sites:recomputeApplicability', 999, fixture.specVersionId),
      'NOT_FOUND',
    );
  });

  it('ручне перевизначення має пріоритет над правилами', async () => {
    const clauseId = fixture.clauseIds['14.1']!;
    await invoke('sites:setApplicabilityOverride', fixture.siteProfileId, clauseId, true, 'аудитор наполіг');

    const stored = fixture.db.siteProfiles.getApplicability(fixture.siteProfileId, clauseId);
    expect(stored?.applicable).toBe(true);
    expect(stored?.overriddenByUser).toBe(true);

    // Перерахунок правил не має затирати рішення людини.
    await invoke('sites:recomputeApplicability', fixture.siteProfileId, fixture.specVersionId);
    expect(
      fixture.db.siteProfiles.getApplicability(fixture.siteProfileId, clauseId)?.applicable,
    ).toBe(true);

    await expectCode(
      invoke('sites:setApplicabilityOverride', fixture.siteProfileId, clauseId, false, '  '),
      'VALIDATION',
    );
  });
});

// ─── Прогони й findings ──────────────────────────────────────────────────────

describe('прогони — читальні канали', () => {
  it('list / get / progress / summary / coverage / gaps', async () => {
    expect(await invoke<unknown[]>('runs:list')).toHaveLength(1);
    expect(await invoke<{ id: number } | null>('runs:get', fixture.runId)).toMatchObject({
      id: fixture.runId,
    });

    const progress = await invoke<{ tasksTotal: number; status: string }>('runs:progress', fixture.runId);
    expect(progress.tasksTotal).toBe(0);
    expect(progress.status).toBe('queued');

    const summary = await invoke<{ clausesApplicable: number }>('runs:summary', fixture.runId);
    expect(summary.clausesApplicable).toBe(4);

    const coverage = await invoke<{ sections: unknown[]; documents: unknown[] }>(
      'runs:coverage',
      fixture.runId,
    );
    expect(coverage.sections.length).toBeGreaterThan(0);
    expect(coverage.documents).toHaveLength(2);

    expect(Array.isArray(await invoke('runs:gaps', fixture.runId))).toBe(true);

    expect(await invoke('runs:get', 999)).toBeNull();
    for (const channel of ['runs:progress', 'runs:summary', 'runs:coverage', 'runs:gaps']) {
      await expectCode(invoke(channel, 999), 'NOT_FOUND');
    }
  });
});

describe('findings і рев ю', () => {
  it('list / get / review / clearReview', async () => {
    const finding = fixture.db.findings.upsert({
      runId: fixture.runId,
      clauseId: fixture.clauseIds['10.1']!,
      documentVersionId: fixture.pestVersionId,
      verdict: 'compliant',
      severity: null,
      rationale: 'Програма задокументована.',
      evidence: [
        {
          documentVersionId: fixture.pestVersionId,
          quote: 'Pest management programme is documented',
          source: 'citations_api',
          verified: true,
        },
      ],
    });

    const page = await invoke<{ items: FindingDto[]; total: number }>('findings:list', {
      runId: fixture.runId,
    });
    expect(page.total).toBe(1);
    expect(page.items[0]?.clause.clauseNo).toBe('10.1');
    expect(page.items[0]?.evidence[0]?.verified).toBe(true);

    const review = await invoke<{ humanVerdict: string | null }>('findings:review', finding.id, {
      humanVerdict: 'partial',
      humanSeverity: 'minor',
      note: 'Немає мапи станцій',
    });
    expect(review.humanVerdict).toBe('partial');
    expect((await invoke<FindingDto | null>('findings:get', finding.id))?.review?.note).toBe(
      'Немає мапи станцій',
    );

    await invoke('findings:clearReview', finding.id);
    expect((await invoke<FindingDto | null>('findings:get', finding.id))?.review).toBeNull();

    expect(await invoke('findings:get', 999)).toBeNull();
    await expectCode(invoke('findings:review', 999, { humanVerdict: null, humanSeverity: null, note: null }), 'NOT_FOUND');
    await expectCode(invoke('findings:clearReview', 999), 'NOT_FOUND');
    await expectCode(invoke('findings:list', { runId: 999 }), 'NOT_FOUND');
  });
});

// ─── Налаштування ────────────────────────────────────────────────────────────

describe('налаштування', () => {
  it('get / set із частковим патчем', async () => {
    expect(await invoke('settings:get')).toMatchObject({ concurrency: 3, localOnly: false });

    const updated = await invoke<{ concurrency: number; theme: string }>('settings:set', {
      concurrency: 8,
      theme: 'dark',
    });
    expect(updated).toMatchObject({ concurrency: 8, theme: 'dark', localOnly: false });

    await expectCode(invoke('settings:set', { theme: 'neon' }), 'VALIDATION');
    await expectCode(invoke('settings:set', null), 'VALIDATION');
  });

  it('мова результатів і мова інтерфейсу зберігаються', async () => {
    expect(await invoke('settings:get')).toMatchObject({ resultsLanguage: '', uiLanguage: 'en' });

    await invoke('settings:set', { resultsLanguage: 'nl', uiLanguage: 'uk' });
    expect(await invoke('settings:get')).toMatchObject({ resultsLanguage: 'nl', uiLanguage: 'uk' });

    // `''` — мовою стандарту — валідне значення, а не «порожній патч».
    await invoke('settings:set', { resultsLanguage: '' });
    expect(await invoke('settings:get')).toMatchObject({ resultsLanguage: '', uiLanguage: 'uk' });
  });

  it('невідома мова — VALIDATION із поясненням, нічого не зберігається', async () => {
    const results = await expectCode(invoke('settings:set', { resultsLanguage: 'de' }), 'VALIDATION');
    expect(results).toContain('"de"');
    expect(results).toContain('en, nl, uk');

    const ui = await expectCode(invoke('settings:set', { uiLanguage: 'uk-UA' }), 'VALIDATION');
    expect(ui).toContain('interface language');

    await expectCode(invoke('settings:set', { uiLanguage: '' }), 'VALIDATION');
    expect(await invoke('settings:get')).toMatchObject({ resultsLanguage: '', uiLanguage: 'en' });
  });
});

// ─── Провайдери й ключі ──────────────────────────────────────────────────────

describe('провайдери', () => {
  it('ключ ніколи не повертається в renderer', async () => {
    const anthropicOf = (list: ProviderStatus[]) => list.find((p) => p.id === 'anthropic');
    const before = await invoke<ProviderStatus[]>('providers:list');
    expect(anthropicOf(before)?.configured).toBe(false);

    await invoke('providers:setApiKey', 'anthropic', 'sk-ant-секретне-значення');

    const after = await invoke<ProviderStatus[]>('providers:list');
    expect(anthropicOf(after)?.configured).toBe(true);
    expect(JSON.stringify(after)).not.toContain('sk-ant');

    // Перевірка без мережі: підтверджує лише наявність ключа.
    const test = await invoke<{ ok: boolean; message: string }>('providers:test', 'anthropic');
    expect(test.ok).toBe(true);
    expect(test.message).not.toContain('sk-ant');

    await invoke('providers:clearApiKey', 'anthropic');
    expect(anthropicOf(await invoke<ProviderStatus[]>('providers:list'))?.configured).toBe(false);

    const unconfigured = await invoke<{ ok: boolean }>('providers:test', 'anthropic');
    expect(unconfigured.ok).toBe(false);
  });

  it('NOT_FOUND для невідомого провайдера, VALIDATION для порожнього ключа', async () => {
    await expectCode(invoke('providers:setApiKey', 'skynet', 'k'), 'NOT_FOUND');
    await expectCode(invoke('providers:test', 'skynet'), 'NOT_FOUND');
    await expectCode(invoke('providers:setApiKey', 'anthropic', '   '), 'VALIDATION');
  });
});

// ─── Оркестратор ─────────────────────────────────────────────────────────────

describe('канали, що потребують оркестратора', () => {
  const cases: Array<[string, unknown[]]> = [
    ['clauses:extract', []],
    ['docProfiles:build', []],
    ['runs:estimate', []],
    ['runs:start', []],
    ['runs:pause', []],
    ['runs:resume', []],
    ['runs:cancel', []],
    ['export:run', []],
  ];

  function argsFor(channel: string): unknown[] {
    switch (channel) {
      case 'clauses:extract':
        return [fixture.specVersionId];
      case 'docProfiles:build':
        return [fixture.pestVersionId];
      case 'runs:estimate':
      case 'runs:start':
        return [
          {
            specVersionId: fixture.specVersionId,
            siteProfileId: fixture.siteProfileId,
            documentVersionIds: [fixture.pestVersionId],
          },
        ];
      case 'export:run':
        return [fixture.runId, 'xlsx'];
      default:
        return [fixture.runId];
    }
  }

  it.each(cases)('%s кидає зрозумілу помилку, поки реалізації немає', async (channel) => {
    const message = await expectCode(invoke(channel, ...argsFor(channel)), 'INTERNAL');
    expect(message).toContain('orchestrator is not connected');
  });

  it('помилка відсутнього оркестратора — мовою інтерфейсу', async () => {
    await invoke('settings:set', { uiLanguage: 'uk' });
    const message = await expectCode(invoke('runs:pause', fixture.runId), 'INTERNAL');
    expect(message).toContain('Оркестратор ще не підключено');
  });

  it('після setOrchestrator виклики йдуть у порт', async () => {
    const startRun = vi.fn(async () => 77);
    setOrchestrator({
      extractClauses: vi.fn(async () => 1),
      buildDocProfile: vi.fn(),
      estimateRun: vi.fn(async () => ({
        tasks: 5,
        inputTokens: 100,
        costUsd: 0.01,
        model: 'claude-opus-5',
      })),
      startRun,
      pauseRun: vi.fn(async () => {}),
      resumeRun: vi.fn(async () => {}),
      cancelRun: vi.fn(async () => {}),
      exportRun: vi.fn(async () => ({ path: 'C:/exports/run.xlsx' })),
    } as never);

    const config = {
      specVersionId: fixture.specVersionId,
      siteProfileId: fixture.siteProfileId,
      documentVersionIds: [fixture.pestVersionId],
    };
    expect(await invoke('runs:start', config)).toBe(77);
    expect(startRun).toHaveBeenCalledWith(config);
    expect(await invoke('runs:estimate', config)).toEqual({
      tasks: 5,
      inputTokens: 100,
      costUsd: 0.01,
      model: 'claude-opus-5',
    });
    expect(await invoke('export:run', fixture.runId, 'xlsx')).toEqual({
      path: 'C:/exports/run.xlsx',
    });
  });

  it('валідація конфігурації спрацьовує до звернення в порт', async () => {
    fixture.db.specs.setClausesStatus(fixture.specVersionId, 'extracted');
    const message = await expectCode(
      invoke('runs:start', {
        specVersionId: fixture.specVersionId,
        siteProfileId: null,
        documentVersionIds: [fixture.pestVersionId],
      }),
      'VALIDATION',
    );
    expect(message).toContain('clause registry has not been reviewed');

    fixture.db.specs.setClausesStatus(fixture.specVersionId, 'reviewed');
    await expectCode(
      invoke('runs:start', {
        specVersionId: fixture.specVersionId,
        siteProfileId: null,
        documentVersionIds: [],
      }),
      'VALIDATION',
    );
    await expectCode(invoke('export:run', fixture.runId, 'csv'), 'VALIDATION');
  });
});
