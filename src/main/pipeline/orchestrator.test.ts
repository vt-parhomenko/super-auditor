/**
 * Оркестратор: оцінка вартості за моделлю з маршрутизації, resume на тих самих
 * моделях, з якими прогін стартував, і мова експорту.
 *
 * Реєстр провайдерів — мінімальна заглушка з тим самим контрактом, що й
 * справжній (`resolveProvider` / `routingFor` / `get`): тест перевіряє рішення
 * оркестратора, а не внутрішню будову реєстру.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seed, type SeedResult } from '@main/db/fixtures';
import { mainMessages } from '@main/i18n';
import type { IpcError } from '@main/ipc/errors';
import type { IpcEmitter } from '@main/ipc/events';
import type { RunOrchestrator } from '@main/ipc/orchestratorPort';
import {
  LlmCloudBlockedError,
  LlmError,
  LlmNotConfiguredError,
  getPricing,
  resolveRouting,
  type CompleteRequest,
  type CompleteResult,
  type LlmProvider,
  type ModelPricing,
  type ProviderRegistry,
} from '@main/llm';
import { setStorageRoot } from '@main/paths';
import type { ModelRef, RunConfig, Stage } from '@shared/domain';
import type { AppSettings, IpcEvents } from '@shared/ipc';
import { createOrchestrator } from './orchestrator';
import { planRun } from './runEngine';

vi.mock('electron', () => ({
  app: { getPath: () => process.cwd(), isPackaged: false },
}));

// ─── Оснастка ────────────────────────────────────────────────────────────────

interface FakeProvider extends LlmProvider {
  calls: number;
  requests: Array<CompleteRequest<unknown>>;
  /** Скільки перших викликів падають фатально (вичерпаний баланс). */
  failFirst: number;
}

function fakeProvider(
  id: string,
  options: { configured?: boolean; pricing?: Record<string, ModelPricing>; failFirst?: number } = {},
): FakeProvider {
  const provider: FakeProvider = {
    id,
    label: id,
    models: [`${id}-model`],
    calls: 0,
    requests: [],
    failFirst: options.failFirst ?? 0,
    caps: {
      contextWindow: 200_000,
      promptCaching: false,
      structuredOutput: 'tool',
      citations: false,
      documentInput: [],
      maxOutputTokens: 8000,
      cloud: false,
    },
    isConfigured: () => options.configured ?? true,
    ...(options.pricing
      ? { pricingFor: (model: string) => options.pricing?.[model] ?? null }
      : {}),
    async complete<T>(req: CompleteRequest<T>): Promise<CompleteResult<T>> {
      provider.calls += 1;
      provider.requests.push(req as CompleteRequest<unknown>);
      if (provider.failFirst > 0) {
        provider.failFirst -= 1;
        throw new LlmError('insufficient_credit', 'credit balance is too low', { providerId: id });
      }
      // Судження: «вимогу не розглянуто» на кожну вимогу батчу.
      const clauseNos = [...(req.messages[0]?.content ?? '').matchAll(/no="(\d+\.\d+)"/g)].map((m) => m[1]!);
      return {
        data: clauseNos.map((no) => ({
          clause_no: no,
          verdict: 'not_addressed',
          confidence: 0.9,
          rationale: 'Not covered.',
          evidence: [],
        })) as T,
        citations: [],
        usage: { input: 100, cachedInput: 0, cacheWrite: 0, output: 10 },
        costUsd: 0,
        modelId: req.model ?? `${id}-model`,
        providerId: id,
        latencyMs: 1,
        raw: null,
        fromCache: false,
      };
    },
  };
  return provider;
}

/**
 * Реєстр-заглушка: та сама логіка маршрутизації (`resolveRouting`), а провайдер
 * «прив'язується» до моделі так само, як у справжньому реєстрі, — запит іде
 * з моделлю маршруту.
 */
function fakeRegistry(byId: Record<string, FakeProvider>): ProviderRegistry {
  const routingFor = (
    stage: Stage,
    settings?: Pick<AppSettings, 'routing'> | null,
    override?: Partial<Record<Stage, ModelRef>> | null,
  ): ModelRef => resolveRouting(stage, settings, override);

  return {
    get: (id: string) => byId[id],
    routingFor,
    resolveProvider(
      stage: Stage,
      settings?: (Pick<AppSettings, 'routing'> & Partial<Pick<AppSettings, 'localOnly'>>) | null,
      opts: { cloudAllowed?: boolean; routingOverride?: Partial<Record<Stage, ModelRef>> | null } = {},
    ) {
      const model = routingFor(stage, settings, opts.routingOverride);
      const provider = byId[model.provider];
      if (!provider) throw new LlmNotConfiguredError(model.provider);
      if (settings?.localOnly) throw new LlmCloudBlockedError(provider.id, 'Local-only mode is on');
      if (!provider.isConfigured()) throw new LlmNotConfiguredError(provider.id);
      const bound: LlmProvider = {
        ...provider,
        models: [model.model],
        complete: (req, signal) => provider.complete({ ...req, model: model.model }, signal),
      };
      return { provider: bound, model };
    },
  } as unknown as ProviderRegistry;
}

interface Recorder extends IpcEmitter {
  events: Array<{ event: string; payload: unknown }>;
  toasts: Array<{ level: string; message: string }>;
  /** Наступна подія `run:finished`. */
  finished(): Promise<IpcEvents['run:finished']>;
}

function recorder(): Recorder {
  const waiters: Array<(payload: IpcEvents['run:finished']) => void> = [];
  const rec: Recorder = {
    events: [],
    toasts: [],
    emit(event, payload) {
      rec.events.push({ event, payload });
      if (event === 'run:finished') {
        for (const resolve of waiters.splice(0)) resolve(payload as IpcEvents['run:finished']);
      }
      return true;
    },
    toast(level, message) {
      rec.toasts.push({ level, message });
      return true;
    },
    finished: () => new Promise((resolve) => waiters.push(resolve)),
  };
  return rec;
}

let root: string;
let fixture: SeedResult;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'sa-orchestrator-'));
  setStorageRoot(root);
  // Теку експорту застосунок створює на старті (`ensureStorageDirs`).
  mkdirSync(join(root, 'exports'), { recursive: true });
});

afterAll(() => {
  setStorageRoot(null);
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  fixture = seed();
});

const runConfig = (overrides: Partial<RunConfig> = {}): RunConfig => ({
  specVersionId: fixture.specVersionId,
  siteProfileId: null,
  documentVersionIds: [fixture.pestVersionId],
  skipCritic: true,
  scope: 'all',
  ...overrides,
});

function orchestrator(byId: Record<string, FakeProvider>, events = recorder()): RunOrchestrator {
  return createOrchestrator({ db: fixture.db, providers: fakeRegistry(byId), events });
}

// ─── Оцінка вартості ─────────────────────────────────────────────────────────

describe('estimateRun', () => {
  /** Вихід оцінюється як 300 токенів на вимогу: 5 вимог × 1 документ. */
  const OUTPUT_TOKENS = 5 * 300;

  const expectedCost = (inputTokens: number, pricing: ModelPricing): number =>
    (inputTokens / 1_000_000) * pricing.inputPerMTok + (OUTPUT_TOKENS / 1_000_000) * pricing.outputPerMTok;

  it('рахує за цінами моделі судження з налаштувань, а не за зашитим Opus', async () => {
    fixture.db.settings.set({
      routing: { judge: { provider: 'anthropic', model: 'claude-sonnet-5' } },
    });

    const estimate = await orchestrator({ anthropic: fakeProvider('anthropic') }).estimateRun(runConfig());

    expect(estimate.model).toBe('claude-sonnet-5');
    expect(estimate.costUsd).toBeCloseTo(expectedCost(estimate.inputTokens, getPricing('claude-sonnet-5')!), 4);
  });

  it('перевизначення з конфігурації прогону важливіше за налаштування', async () => {
    const estimate = await orchestrator({ anthropic: fakeProvider('anthropic') }).estimateRun(
      runConfig({ routing: { judge: { provider: 'anthropic', model: 'claude-haiku-4-5' } } }),
    );
    expect(estimate.model).toBe('claude-haiku-4-5');
    expect(estimate.costUsd).toBeCloseTo(expectedCost(estimate.inputTokens, getPricing('claude-haiku-4-5')!), 4);
  });

  it('ціни провайдера (живий каталог) мають пріоритет над вбудованою таблицею', async () => {
    const pricing: ModelPricing = {
      inputPerMTok: 1,
      outputPerMTok: 2,
      cacheReadPerMTok: 0.1,
      cacheWritePerMTok: 1.25,
      contextWindow: 128_000,
    };
    fixture.db.settings.set({ routing: { judge: { provider: 'openrouter', model: 'openai/gpt-6-luna' } } });

    const estimate = await orchestrator({
      openrouter: fakeProvider('openrouter', { pricing: { 'openai/gpt-6-luna': pricing } }),
    }).estimateRun(runConfig());

    expect(estimate.model).toBe('openai/gpt-6-luna');
    expect(estimate.costUsd).toBeCloseTo(expectedCost(estimate.inputTokens, pricing), 4);
  });

  it('невідома ціна — null, а не вигадана сума', async () => {
    fixture.db.settings.set({ routing: { judge: { provider: 'local', model: 'mystery-model' } } });

    const estimate = await orchestrator({ local: fakeProvider('local') }).estimateRun(runConfig());

    expect(estimate.model).toBe('mystery-model');
    expect(estimate.costUsd).toBeNull();
    expect(estimate.tasks).toBeGreaterThan(0);
  });

  it('без ключа оцінка все одно є — за моделлю з маршрутизації', async () => {
    const pricing: ModelPricing = {
      inputPerMTok: 3,
      outputPerMTok: 15,
      cacheReadPerMTok: 0.3,
      cacheWritePerMTok: 3.75,
      contextWindow: 200_000,
    };
    fixture.db.settings.set({ routing: { judge: { provider: 'openrouter', model: 'x/model' } } });

    const estimate = await orchestrator({
      openrouter: fakeProvider('openrouter', { configured: false, pricing: { 'x/model': pricing } }),
    }).estimateRun(runConfig());

    expect(estimate.model).toBe('x/model');
    expect(estimate.costUsd).toBeCloseTo(expectedCost(estimate.inputTokens, pricing), 4);
  });

  it('невідомий провайдер у маршрутизації — модель судження за замовчуванням не зникає', async () => {
    const estimate = await orchestrator({}).estimateRun(runConfig());
    // Маршрутизації немає → типовий judge; провайдера в реєстрі немає → ціна з таблиці.
    expect(estimate.model).toBe('claude-opus-5');
    expect(estimate.costUsd).toBeCloseTo(expectedCost(estimate.inputTokens, getPricing('claude-opus-5')!), 4);
  });
});

// ─── Продовження прогону ─────────────────────────────────────────────────────

describe('resumeRun', () => {
  it('продовжує на моделі, з якою прогін стартував, а не на поточних налаштуваннях', async () => {
    fixture.db.settings.set({
      routing: {
        judge: { provider: 'alpha', model: 'alpha-judge' },
        doc_profile: { provider: 'alpha', model: 'alpha-profile' },
      },
    });
    // Перший виклик упаде на балансі — прогін зупиниться з завданнями в черзі.
    const alpha = fakeProvider('alpha', { failFirst: 1 });
    const beta = fakeProvider('beta');
    const events = recorder();
    const orch = orchestrator({ alpha, beta }, events);

    const started = events.finished();
    const runId = await orch.startRun(runConfig());
    expect((await started).status).toBe('failed');
    // Effort не задано в налаштуваннях — береться типовий для етапу, і теж фіксується.
    expect(fixture.db.runs.launchSettings(runId)?.routing).toEqual({
      judge: { provider: 'alpha', model: 'alpha-judge', effort: 'high' },
      critic: null,
    });

    // Поки прогін стояв, у налаштуваннях обрали іншу модель.
    fixture.db.settings.set({ routing: { judge: { provider: 'beta', model: 'beta-judge' } } });

    const resumed = events.finished();
    await orch.resumeRun(runId);
    expect((await resumed).status).toBe('done');

    expect(beta.calls).toBe(0);
    expect(alpha.calls).toBeGreaterThan(1);
    expect(alpha.requests.every((r) => r.model === 'alpha-judge')).toBe(true);
  });

  it('прогін зі старої версії (без зафіксованої маршрутизації) — поточні налаштування', async () => {
    const { runId } = planRun(
      fixture.db,
      runConfig(),
      { judge: 'old-model', critic: null, promptVersion: 'judge.v1' },
    );
    fixture.db.raw.prepare('UPDATE audit_run SET routing = NULL WHERE id = ?').run(runId);
    fixture.db.settings.set({ routing: { judge: { provider: 'beta', model: 'beta-judge' } } });

    const beta = fakeProvider('beta');
    const events = recorder();
    const finished = events.finished();
    await orchestrator({ beta }, events).resumeRun(runId);
    await finished;

    expect(beta.calls).toBeGreaterThan(0);
    expect(beta.requests.every((r) => r.model === 'beta-judge')).toBe(true);
  });
});

// ─── Повідомлення й експорт ──────────────────────────────────────────────────

describe('повідомлення мовою інтерфейсу', () => {
  it('заборону хмари пояснює конкретно: увімкнено «лише локальні моделі»', async () => {
    fixture.db.settings.set({
      uiLanguage: 'uk',
      localOnly: true,
      routing: { judge: { provider: 'alpha', model: 'alpha-judge' } },
    });

    const error = await orchestrator({ alpha: fakeProvider('alpha') })
      .startRun(runConfig())
      .then(
        () => null,
        (err: unknown) => err as IpcError,
      );
    expect(error?.code).toBe('CLOUD_BLOCKED');
    expect(error?.localize('uk')).toContain('«Тільки локальні моделі»');
  });

  it('причина зупинки в `run:finished` — мовою інтерфейсу', async () => {
    fixture.db.settings.set({
      uiLanguage: 'nl',
      routing: {
        judge: { provider: 'alpha', model: 'alpha-judge' },
        doc_profile: { provider: 'alpha', model: 'alpha-profile' },
      },
    });
    const events = recorder();
    const finished = events.finished();
    await orchestrator({ alpha: fakeProvider('alpha', { failFirst: 1 }) }, events).startRun(runConfig());

    const payload = await finished;
    expect(payload.error).toContain('Het tegoed bij alpha is op');
  });
});

describe('експорт Markdown', () => {
  it('пишеться мовою результатів прогону, а не поточною', async () => {
    fixture.db.settings.set({ resultsLanguage: 'uk', uiLanguage: 'en' });
    const { runId } = planRun(fixture.db, runConfig({ documentVersionIds: [fixture.pestVersionId] }), {
      judge: 'claude-opus-5',
      critic: null,
      promptVersion: 'judge.v1',
    });
    fixture.db.findings.upsert({
      runId,
      clauseId: fixture.clauseIds['10.1']!,
      documentVersionId: fixture.pestVersionId,
      verdict: 'partial',
      severity: 'major',
      rationale: 'Програма описана частково.',
      gap: 'Немає мапи пасток.',
      evidence: [
        {
          documentVersionId: fixture.pestVersionId,
          quote: 'Pest management programme is documented',
          pageNo: 1,
          source: 'model_quote',
          verified: true,
        },
      ],
    });
    // Після старту мову результатів змінили — звіт усе одно мовою висновків прогону.
    fixture.db.settings.set({ resultsLanguage: 'nl' });

    const { path } = await orchestrator({}).exportRun(runId, 'markdown');
    const markdown = readFileSync(path, 'utf8');
    const m = mainMessages('uk').export;

    expect(markdown).toContain(`# ${m.title(runId)}`);
    expect(markdown).toContain(`## ${m.nonConformities}`);
    expect(markdown).toContain(`**${m.verdictLabel}:** ${m.verdicts.partial} (${m.severities.major})`);
    expect(markdown).toContain(`**${m.gapLabel}:** Немає мапи пасток.`);
    expect(markdown).toContain(`_(${m.page(1)})_`);
    // Цитата — дослівно, мовою оригіналу.
    expect(markdown).toContain('> Pest management programme is documented');
  });

  it('«мовою стандарту» — англійською', async () => {
    const { runId } = planRun(fixture.db, runConfig(), {
      judge: 'claude-opus-5',
      critic: null,
      promptVersion: 'judge.v1',
    });

    const { path } = await orchestrator({}).exportRun(runId, 'markdown');
    expect(readFileSync(path, 'utf8')).toContain(`# ${mainMessages('en').export.title(runId)}`);
  });

  it('непідтримуваний формат — помилка мовою інтерфейсу', async () => {
    fixture.db.settings.set({ uiLanguage: 'uk' });
    await expect(orchestrator({}).exportRun(fixture.runId, 'xlsx')).rejects.toThrow(
      'Експорт у XLSX ще не реалізовано',
    );
  });
});
