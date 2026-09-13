import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type Db } from '@main/db';
import { languageInstruction } from '@main/llm';
import type { CompleteRequest, CompleteResult, LlmProvider } from '@main/llm';
import { withSpendLedger } from './ledger';

let db: Db;

beforeEach(() => {
  db = createTestDb();
});

function provider(cost = 0.25): LlmProvider {
  return {
    id: 'anthropic',
    label: 'Anthropic',
    models: ['claude-opus-5'],
    caps: {
      contextWindow: 1_000_000,
      promptCaching: true,
      structuredOutput: 'tool',
      citations: true,
      documentInput: ['pdf'],
      maxOutputTokens: 64_000,
      cloud: true,
    },
    isConfigured: () => true,
    async complete<T>(_req: CompleteRequest<T>): Promise<CompleteResult<T>> {
      return {
        data: {} as T,
        citations: [],
        usage: { input: 1000, cachedInput: 800, cacheWrite: 0, output: 400 },
        costUsd: cost,
        modelId: 'claude-opus-5',
        providerId: 'anthropic',
        latencyMs: 120,
        raw: null,
        fromCache: false,
      };
    },
  };
}

const request = (stage: CompleteRequest<unknown>['stage']): CompleteRequest<unknown> =>
  ({
    stage,
    system: 's',
    messages: [{ role: 'user', content: 'u' }],
    schema: { parse: (v: unknown) => v } as never,
    maxOutputTokens: 100,
    promptVersion: `${stage}.v1`,
  }) as CompleteRequest<unknown>;

describe('журнал витрат', () => {
  it('записує кожен виклик, зокрема поза прогоном', async () => {
    const p = withSpendLedger(provider(), db, { specVersionId: null, runId: null });

    await p.complete(request('clause_extract'), new AbortController().signal);
    await p.complete(request('clause_extract'), new AbortController().signal);

    const summary = db.spend.summary();
    expect(summary.total).toBeCloseTo(0.5);
    expect(summary.byStage).toHaveLength(1);
    expect(summary.byStage[0]).toMatchObject({
      stage: 'clause_extract',
      model: 'claude-opus-5',
      calls: 2,
      inputTokens: 2000,
      cachedTokens: 1600,
      outputTokens: 800,
    });
  });

  it('розділяє витрати по етапах і моделях', async () => {
    await withSpendLedger(provider(0.4), db).complete(request('judge'), new AbortController().signal);
    await withSpendLedger(provider(0.1), db).complete(
      request('doc_profile'),
      new AbortController().signal,
    );

    const byStage = Object.fromEntries(db.spend.summary().byStage.map((r) => [r.stage, r.costUsd]));
    expect(byStage['judge']).toBeCloseTo(0.4);
    expect(byStage['doc_profile']).toBeCloseTo(0.1);
  });

  it("прив'язує виклик до прогону, коли той відомий", async () => {
    const ledger = { runId: null as number | null, specVersionId: 7 };
    const p = withSpendLedger(provider(), db, ledger);

    await p.complete(request('doc_profile'), new AbortController().signal); // до створення прогону
    ledger.runId = 42;
    await p.complete(request('judge'), new AbortController().signal);

    const entries = db.spend.recent();
    expect(entries.find((e) => e.stage === 'doc_profile')?.runId).toBeNull();
    expect(entries.find((e) => e.stage === 'judge')?.runId).toBe(42);
  });

  it('поломка обліку не коштує вже оплаченого результату', async () => {
    const broken = {
      ...db,
      spend: {
        ...db.spend,
        record: () => {
          throw new Error('диск заповнений');
        },
      },
    } as unknown as Db;

    const p = withSpendLedger(provider(), broken);
    await expect(p.complete(request('judge'), new AbortController().signal)).resolves.toBeDefined();
  });

  it('сьогоднішні й місячні витрати відокремлені від старих', () => {
    const old = new Date(Date.UTC(2020, 0, 15)).toISOString();
    db.spend.record({ stage: 'judge', provider: 'anthropic', model: 'm', costUsd: 5, createdAt: old });
    db.spend.record({ stage: 'judge', provider: 'anthropic', model: 'm', costUsd: 2 });

    const summary = db.spend.summary();
    expect(summary.total).toBeCloseTo(7);
    expect(summary.today).toBeCloseTo(2);
    expect(summary.month).toBeCloseTo(2);
  });

  it('порожній журнал дає нулі, а не помилку', () => {
    expect(db.spend.summary()).toMatchObject({ today: 0, month: 0, total: 0, byStage: [] });
  });
});

describe('мова результатів', () => {
  it('порожнє значення не додає інструкції', () => {
    expect(languageInstruction('')).toBeNull();
    expect(languageInstruction(undefined)).toBeNull();
    expect(languageInstruction('   ')).toBeNull();
  });

  it('перекладає код мови в назву, зрозумілу моделі', () => {
    expect(languageInstruction('uk')).toContain('Ukrainian');
    expect(languageInstruction('nl')).toContain('Dutch');
    // Невідомий код передається як є, а не мовчки ігнорується.
    expect(languageInstruction('sv')).toContain('sv');
  });

  it('ЗАВЖДИ забороняє переклад цитат', () => {
    // Це головна властивість: перекладена цитата не знайдеться в документі,
    // і кожен `compliant` буде понижено до `needs_human_review`.
    for (const code of ['uk', 'en', 'de']) {
      const text = languageInstruction(code)!;
      expect(text).toContain('EXACTLY');
      expect(text).toContain('never translate');
    }
  });

  it('називає саме ті поля, які треба перекладати', () => {
    const text = languageInstruction('uk')!;
    for (const field of ['rationale', 'gap', 'recommendation']) {
      expect(text).toContain(field);
    }
  });
});
