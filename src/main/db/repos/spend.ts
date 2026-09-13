import type { SpendEntry, SpendSummary, Stage } from '@shared/domain';
import { BaseRepo, type SqliteDb } from '../types';

export interface SpendInput {
  stage: Stage | string;
  provider: string;
  model: string;
  promptVersion?: string | null;
  inputTokens?: number;
  cachedTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs?: number | null;
  runId?: number | null;
  specVersionId?: number | null;
  fromCache?: boolean;
  createdAt?: string;
}

interface SpendRow {
  id: number;
  stage: string;
  provider: string;
  model: string;
  prompt_version: string | null;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number | null;
  run_id: number | null;
  spec_version_id: number | null;
  from_cache: number;
  created_at: string;
}

const nowIso = (): string => new Date().toISOString();

/**
 * Журнал витрат на LLM.
 *
 * Окремо від `llm_call` (кеш із ключем-дедуплікатором): там кожен унікальний
 * запит займає один рядок, тут — кожен фактичний виклик. Саме тому сюди
 * потрапляють і виклики поза прогонами: побудова реєстру вимог і профілювання
 * документа коштують грошей, але не належать жодному `audit_run`.
 */
export class SpendRepo extends BaseRepo {
  constructor(db: SqliteDb) {
    super(db);
  }

  record(input: SpendInput): number {
    const result = this.stmt(
      `INSERT INTO llm_spend
         (stage, provider, model, prompt_version, input_tokens, cached_tokens,
          output_tokens, cost_usd, latency_ms, run_id, spec_version_id, from_cache, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.stage,
      input.provider,
      input.model,
      input.promptVersion ?? null,
      input.inputTokens ?? 0,
      input.cachedTokens ?? 0,
      input.outputTokens ?? 0,
      input.costUsd ?? 0,
      input.latencyMs ?? null,
      input.runId ?? null,
      input.specVersionId ?? null,
      input.fromCache ? 1 : 0,
      input.createdAt ?? nowIso(),
    );
    return Number(result.lastInsertRowid);
  }

  /** Зведення витрат: сьогодні, поточний місяць, усього, і розбивка по етапах. */
  summary(now: Date = new Date()): SpendSummary {
    const dayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    ).toISOString();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).toISOString();

    const since = (from: string | null): number => {
      const row = from
        ? this.stmt<{ total: number | null }>(
            'SELECT SUM(cost_usd) AS total FROM llm_spend WHERE created_at >= ?',
          ).get(from)
        : this.stmt<{ total: number | null }>('SELECT SUM(cost_usd) AS total FROM llm_spend').get();
      return row?.total ?? 0;
    };

    const byStage = this.stmt<{
      stage: string;
      model: string;
      calls: number;
      cost: number;
      input: number;
      cached: number;
      output: number;
    }>(
      `SELECT stage, model,
              COUNT(*) AS calls,
              SUM(cost_usd) AS cost,
              SUM(input_tokens) AS input,
              SUM(cached_tokens) AS cached,
              SUM(output_tokens) AS output
         FROM llm_spend
        GROUP BY stage, model
        ORDER BY cost DESC`,
    ).all();

    return {
      today: since(dayStart),
      month: since(monthStart),
      total: since(null),
      byStage: byStage.map((r) => ({
        stage: r.stage,
        model: r.model,
        calls: r.calls,
        costUsd: r.cost ?? 0,
        inputTokens: r.input ?? 0,
        cachedTokens: r.cached ?? 0,
        outputTokens: r.output ?? 0,
      })),
    };
  }

  /** Останні записи — для діагностики «куди пішли гроші». */
  recent(limit = 50): SpendEntry[] {
    return this.stmt<SpendRow>(
      'SELECT * FROM llm_spend ORDER BY id DESC LIMIT ?',
    )
      .all(limit)
      .map(toSpendEntry);
  }

  forRun(runId: number): SpendEntry[] {
    return this.stmt<SpendRow>(
      'SELECT * FROM llm_spend WHERE run_id = ? ORDER BY id',
    )
      .all(runId)
      .map(toSpendEntry);
  }

  clear(): number {
    return this.stmt('DELETE FROM llm_spend').run().changes;
  }
}

function toSpendEntry(row: SpendRow): SpendEntry {
  return {
    id: row.id,
    stage: row.stage,
    provider: row.provider,
    model: row.model,
    promptVersion: row.prompt_version,
    inputTokens: row.input_tokens,
    cachedTokens: row.cached_tokens,
    outputTokens: row.output_tokens,
    costUsd: row.cost_usd,
    latencyMs: row.latency_ms,
    runId: row.run_id,
    specVersionId: row.spec_version_id,
    fromCache: row.from_cache === 1,
    createdAt: row.created_at,
  };
}
