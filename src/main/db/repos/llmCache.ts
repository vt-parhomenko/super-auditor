/**
 * Кеш LLM-викликів і облік вартості (ADR-7, §9 architecture.md).
 *
 * Ключ = sha256(stage | prompt_version | model | hash(канонічний JSON входу)).
 * Ключ будує llm-шар; тут — тільки зберігання й вибірка.
 */

import { nowIso, toLlmCallDto, type LlmCallDto, type LlmCallRow } from '../mappers';
import { BaseRepo, type SqliteDb } from '../types';

export interface LlmCallInput {
  cacheKey: string;
  stage: string;
  provider: string;
  model: string;
  promptVersion: string;
  response: unknown;
  inputTokens?: number | null;
  cachedTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  latencyMs?: number | null;
  createdAt?: string;
}

export interface UsageAggregate {
  calls: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  costUsd: number;
}

export class LlmCacheRepo extends BaseRepo {
  constructor(db: SqliteDb) {
    super(db);
  }

  get(cacheKey: string): LlmCallDto | null {
    const row = this.stmt<LlmCallRow>('SELECT * FROM llm_call WHERE cache_key = ?').get(cacheKey);
    return row ? toLlmCallDto(row) : null;
  }

  has(cacheKey: string): boolean {
    return this.stmt('SELECT 1 FROM llm_call WHERE cache_key = ?').get(cacheKey) !== undefined;
  }

  /**
   * Записує відповідь. Той самий ключ = той самий вхід, тож перезапис
   * безпечний (свіжіші лічильники вартості й латентності).
   */
  put(input: LlmCallInput): LlmCallDto {
    this.stmt(
      `INSERT INTO llm_call
         (cache_key, stage, provider, model, prompt_version, response_json,
          input_tokens, cached_tokens, output_tokens, cost_usd, latency_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         response_json = excluded.response_json,
         input_tokens = excluded.input_tokens,
         cached_tokens = excluded.cached_tokens,
         output_tokens = excluded.output_tokens,
         cost_usd = excluded.cost_usd,
         latency_ms = excluded.latency_ms,
         created_at = excluded.created_at`,
    ).run(
      input.cacheKey,
      input.stage,
      input.provider,
      input.model,
      input.promptVersion,
      JSON.stringify(input.response ?? null),
      input.inputTokens ?? null,
      input.cachedTokens ?? null,
      input.outputTokens ?? null,
      input.costUsd ?? null,
      input.latencyMs ?? null,
      input.createdAt ?? nowIso(),
    );
    const dto = this.get(input.cacheKey);
    if (!dto) throw new Error(`Не вдалося прочитати запис кешу ${input.cacheKey}`);
    return dto;
  }

  totals(): UsageAggregate {
    return this.aggregate('SELECT COUNT(*) AS calls, SUM(input_tokens) AS i, SUM(cached_tokens) AS c, SUM(output_tokens) AS o, SUM(cost_usd) AS cost FROM llm_call');
  }

  totalsForStage(stage: string): UsageAggregate {
    return this.aggregate(
      'SELECT COUNT(*) AS calls, SUM(input_tokens) AS i, SUM(cached_tokens) AS c, SUM(output_tokens) AS o, SUM(cost_usd) AS cost FROM llm_call WHERE stage = ?',
      stage,
    );
  }

  listByStage(stage: string, limit = 100): LlmCallDto[] {
    return this.stmt<LlmCallRow>(
      'SELECT * FROM llm_call WHERE stage = ? ORDER BY created_at DESC LIMIT ?',
    )
      .all(stage, limit)
      .map(toLlmCallDto);
  }

  /** Інвалідація кешу при зміні промпта: `prompt_version` — частина ключа, але
   *  старі записи лишаються висіти. Прибираємо їх явно. */
  deleteByPromptVersion(stage: string, promptVersion: string): number {
    return this.stmt('DELETE FROM llm_call WHERE stage = ? AND prompt_version = ?').run(
      stage,
      promptVersion,
    ).changes;
  }

  deleteOlderThan(isoDate: string): number {
    return this.stmt('DELETE FROM llm_call WHERE created_at < ?').run(isoDate).changes;
  }

  clear(): number {
    return this.stmt('DELETE FROM llm_call').run().changes;
  }

  private aggregate(sql: string, ...params: Array<string | number>): UsageAggregate {
    const row = this.stmt<{
      calls: number;
      i: number | null;
      c: number | null;
      o: number | null;
      cost: number | null;
    }>(sql).get(...params);
    return {
      calls: row?.calls ?? 0,
      inputTokens: row?.i ?? 0,
      cachedTokens: row?.c ?? 0,
      outputTokens: row?.o ?? 0,
      costUsd: row?.cost ?? 0,
    };
  }
}
