/**
 * Провайдер OpenRouter. Мережі немає: `fetchImpl` — заглушка, що віддає
 * заготовлені SSE-потоки / помилки й записує тіла запитів.
 */

import { describe, expect, it, vi } from 'vitest';
import { clauseExtractInput, criticInput, judgeInput } from './__fixtures__/samples';
import { isFatalLlmError, LlmError, LlmNotConfiguredError, LlmRefusalError, LlmSchemaError, LlmUnsupportedError } from './errors';
import { clauseExtractV1, criticV1, judgeV1, type JudgeOutput } from './prompts';
import type { FetchLike } from './providers/openaiCompatible';
import {
  mapOpenRouterEffort,
  OpenRouterProvider,
  openRouterUsageToLlm,
  sessionIdFor,
  type OpenRouterProviderOptions,
} from './providers/openrouter';
import type { OpenRouterModelEntry } from './providers/openrouterCatalogue';
import { buildRequest } from './request';

// ─── Заглушки ────────────────────────────────────────────────────────────────

type SseEvent = string | Record<string, unknown>;

/** `': …'` — коментар, `'[DONE]'` — кінець, обʼєкт — data-подія. */
function sseText(events: SseEvent[]): string {
  return events
    .map((event) => {
      if (typeof event === 'string' && event.startsWith(':')) return `${event}\n\n`;
      if (event === '[DONE]') return 'data: [DONE]\n\n';
      return `data: ${JSON.stringify(event)}\n\n`;
    })
    .join('');
}

/** Потік, порізаний на шматки довільного розміру — перевіряє збирання розірваних рядків. */
function chunkedStream(text: string, size: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
}

const USAGE = {
  prompt_tokens: 1_000,
  completion_tokens: 200,
  prompt_tokens_details: { cached_tokens: 800, cache_write_tokens: 100 },
  completion_tokens_details: { reasoning_tokens: 50 },
  cost: 0.0123,
};

/** Типова успішна відповідь: коментарі, контент у кількох чанках, usage в останньому. */
function okStream(content: string, opts: { usage?: Record<string, unknown>; finish?: string } = {}): SseEvent[] {
  const half = Math.floor(content.length / 2);
  return [
    ': OPENROUTER PROCESSING',
    { id: 'gen-1', model: 'm', provider: 'Anthropic', choices: [{ index: 0, delta: { role: 'assistant', content: content.slice(0, half) }, finish_reason: null }] },
    ': OPENROUTER PROCESSING',
    { id: 'gen-1', choices: [{ index: 0, delta: { content: content.slice(half) }, finish_reason: opts.finish ?? 'stop' }] },
    { id: 'gen-1', choices: [{ index: 0, delta: { content: '' }, finish_reason: opts.finish ?? 'stop' }], usage: opts.usage ?? USAGE },
    '[DONE]',
  ];
}

type Reply =
  | { sse: SseEvent[]; chunkSize?: number }
  | { status: number; error: Record<string, unknown>; headers?: Record<string, string> }
  | { throws: Error }
  | { json: unknown };

interface Recorded {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

function stubFetch(replies: Reply[]): { fetchImpl: FetchLike; calls: Recorded[] } {
  const calls: Recorded[] = [];
  let index = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({
      url,
      body: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>,
      headers: init.headers as Record<string, string>,
    });
    const reply = replies[Math.min(index, replies.length - 1)];
    index += 1;
    if (!reply) throw new Error('no reply configured');
    if ('throws' in reply) throw reply.throws;
    if ('json' in reply) {
      return new Response(JSON.stringify(reply.json), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if ('status' in reply) {
      return new Response(JSON.stringify({ error: reply.error }), {
        status: reply.status,
        headers: { 'content-type': 'application/json', ...(reply.headers ?? {}) },
      });
    }
    const text = sseText(reply.sse);
    return new Response(reply.chunkSize ? chunkedStream(text, reply.chunkSize) : text, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  return { fetchImpl, calls };
}

const make = (fetchImpl: FetchLike, over: Partial<OpenRouterProviderOptions> = {}): OpenRouterProvider =>
  new OpenRouterProvider({ getApiKey: () => 'sk-or-test', fetchImpl, sleep: async () => undefined, ...over });

const signal = (): AbortSignal => new AbortController().signal;

const VALID_CLAUSES = JSON.stringify({
  clauses: [
    {
      clauseNo: '10.3',
      sectionNo: '10',
      sectionTitle: 'Pest management',
      topic: 'Programme',
      requirementText: 'The site must have a documented pest management programme.',
      modules: ['P'],
      obligation: 'must',
      truncated: false,
    },
  ],
});

/** Відповідь строгого режиму: необовʼязкові поля приходять як null. */
const JUDGE_ITEMS = JSON.stringify({
  items: [
    {
      clause_no: '10.3',
      verdict: 'partial',
      severity: 'minor',
      confidence: 0.8,
      rationale: 'Programme documented, frequency missing.',
      evidence: [{ quote: 'Monitoring devices are numbered and shown on a site map.', page: null }],
      gap: null,
      recommendation: null,
    },
    {
      clause_no: '10.4',
      verdict: 'not_addressed',
      severity: null,
      confidence: 0.9,
      rationale: 'Not covered.',
      evidence: [],
      gap: 'No licence copy.',
      recommendation: null,
    },
  ],
});

/** Запис каталогу для збереженого каталогу в тестах. */
const entry = (over: Partial<OpenRouterModelEntry> & { id: string }): OpenRouterModelEntry => ({
  name: `Acme: ${over.id}`,
  contextWindow: 128_000,
  maxOutputTokens: 16_000,
  inputPerMTok: 1,
  outputPerMTok: 2,
  cacheReadPerMTok: null,
  cacheWritePerMTok: null,
  structuredOutputs: true,
  reasoning: false,
  supportedEfforts: null,
  reasoningMandatory: false,
  inputModalities: ['text'],
  ...over,
});

const storedCatalogue = (models: OpenRouterModelEntry[]) => () => ({
  version: 1,
  fetchedAt: new Date().toISOString(),
  models,
});

// ─── Тіло запиту ─────────────────────────────────────────────────────────────

describe('buildBody — повідомлення й кеш', () => {
  const { fetchImpl } = stubFetch([]);
  const provider = make(fetchImpl);
  const judgeReq = () => buildRequest(judgeV1, judgeInput);

  it('система — три блоки; cache_control лише на кешованому префіксі', () => {
    const body = provider.buildBody(judgeReq(), 'anthropic/claude-opus-5.5');
    const messages = body.messages as Array<{ role: string; content: unknown }>;
    expect(messages[0]?.role).toBe('system');

    const parts = messages[0]?.content as Array<Record<string, unknown>>;
    expect(parts).toHaveLength(3);
    expect(parts[0]?.text).toBe(judgeV1.system);
    expect(parts[0]).not.toHaveProperty('cache_control');
    expect(parts[1]).not.toHaveProperty('cache_control');
    expect(parts[2]?.cache_control).toEqual({ type: 'ephemeral' });
    expect(String(parts[2]?.text)).toContain('Monitoring devices are numbered');

    // Інструкції формату: дослівні цитати, масив items замість викликів інструмента.
    const instructions = String(parts[1]?.text);
    expect(instructions).toContain('character for character');
    expect(instructions).toContain('"items"');
    expect(instructions).toContain('report_finding');

    expect(messages[1]?.role).toBe('user');
    expect(String(messages[1]?.content)).toContain('<clause no="10.3"');
  });

  it('без кешованого префікса breakpoint стоїть на останньому системному блоці', () => {
    const body = provider.buildBody(buildRequest(criticV1, criticInput), 'openai/gpt-6-luna');
    const parts = (body.messages as Array<{ content: Array<Record<string, unknown>> }>)[0]?.content ?? [];
    expect(parts).toHaveLength(2);
    expect(parts[1]?.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('session_id — короткий стабільний хеш моделі й префікса: усі батчі документа йдуть на один апстрім', () => {
    const a = provider.buildBody(judgeReq(), 'anthropic/claude-opus-5.5');
    const otherBatch = buildRequest(judgeV1, { ...judgeInput, section: { sectionNo: '11', sectionTitle: 'Other' } });
    const b = provider.buildBody(otherBatch, 'anthropic/claude-opus-5.5');
    const c = provider.buildBody(judgeReq(), 'openai/gpt-6-luna');

    expect(a.session_id).toMatch(/^sa-[0-9a-f]{32}$/);
    expect(String(a.session_id).length).toBeLessThanOrEqual(256);
    expect(b.session_id).toBe(a.session_id);
    expect(c.session_id).not.toBe(a.session_id);
    expect(a.session_id).toBe(sessionIdFor('anthropic/claude-opus-5.5', judgeV1.system, judgeReq().cachedPrefix));
  });

  it('стрім завжди; temperature не шлемо; приватність — data_collection: deny', () => {
    const body = provider.buildBody(judgeReq(), 'anthropic/claude-opus-5.5');
    expect(body.stream).toBe(true);
    expect(body).not.toHaveProperty('temperature');
    expect(body.provider).toEqual({ data_collection: 'deny', require_parameters: true });
    expect(body.model).toBe('anthropic/claude-opus-5.5');
  });

  it('data_collection можна явно дозволити опцією', () => {
    const body = make(fetchImpl, { dataCollection: 'allow' }).buildBody(judgeReq(), 'openai/gpt-6-luna');
    expect((body.provider as Record<string, unknown>).data_collection).toBe('allow');
  });
});

describe('buildBody — строга схема', () => {
  const { fetchImpl } = stubFetch([]);
  const provider = make(fetchImpl);

  it('multiCall-інструмент загортається в { items: [...] } зі строгою схемою', () => {
    const body = provider.buildBody(buildRequest(judgeV1, judgeInput), 'anthropic/claude-opus-5.5');
    const format = body.response_format as { type: string; json_schema: Record<string, unknown> };
    expect(format.type).toBe('json_schema');
    expect(format.json_schema.strict).toBe(true);
    expect(format.json_schema.name).toBe('report_finding_batch');

    const schema = format.json_schema.schema as Record<string, unknown>;
    expect(schema).toMatchObject({ type: 'object', required: ['items'], additionalProperties: false });
    const items = (schema.properties as Record<string, Record<string, unknown>>).items;
    expect(items?.type).toBe('array');
    const item = items?.items as Record<string, unknown>;
    expect(item.additionalProperties).toBe(false);
    expect(item.required).toEqual(expect.arrayContaining(['severity', 'gap', 'recommendation']));
  });

  it('схема з zod: без $schema і без обмежень, яких строгі режими не знають', () => {
    const body = provider.buildBody(buildRequest(clauseExtractV1, clauseExtractInput), 'openai/gpt-6-luna');
    const jsonSchema = (body.response_format as { json_schema: Record<string, unknown> }).json_schema;
    expect(jsonSchema.name).toBe('clause_extract_response');
    const text = JSON.stringify(jsonSchema.schema);
    expect(text).not.toContain('$schema');
    expect(text).not.toContain('minLength');
    expect((jsonSchema.schema as Record<string, unknown>).required).toEqual(['clauses']);
  });
});

describe('buildBody — reasoning effort і max_tokens', () => {
  const { fetchImpl } = stubFetch([]);

  it('effort моделі, що його підтримує, іде як є; exclude: true; max_tokens із запасом на роздуми', () => {
    const body = make(fetchImpl).buildBody(buildRequest(judgeV1, judgeInput), 'anthropic/claude-opus-5.5');
    expect(body.reasoning).toEqual({ effort: 'high', exclude: true });
    // 16 000 × 3 = 48 000 > 32 000, і менше за 128 000 моделі.
    expect(body.max_tokens).toBe(48_000);
  });

  it('непідтримуваний рівень зводиться до доступного; мінімум запасу — 32 000', () => {
    // DeepSeek V4 Pro приймає лише xhigh/high; clause_extract просить medium.
    const body = make(fetchImpl).buildBody(buildRequest(clauseExtractV1, clauseExtractInput), 'deepseek/deepseek-v4-pro');
    expect(body.reasoning).toEqual({ effort: 'high', exclude: true });
    expect(body.max_tokens).toBe(32_000);
  });

  it('модель без reasoning: параметра немає, max_tokens обрізається лімітом моделі', () => {
    const provider = make(fetchImpl, { loadCatalogue: storedCatalogue([entry({ id: 'acme/plain', maxOutputTokens: 4_000 })]) });
    const body = provider.buildBody(buildRequest(clauseExtractV1, clauseExtractInput), 'acme/plain');
    expect(body).not.toHaveProperty('reasoning');
    expect(body.max_tokens).toBe(4_000);
  });

  it('обовʼязкові роздуми без effort однаково отримують запас max_tokens', () => {
    const provider = make(fetchImpl, {
      loadCatalogue: storedCatalogue([entry({ id: 'acme/thinker', reasoning: true, reasoningMandatory: true, maxOutputTokens: 100_000 })]),
    });
    const req = buildRequest(clauseExtractV1, clauseExtractInput);
    delete req.effort;
    const body = provider.buildBody(req, 'acme/thinker');
    expect(body).not.toHaveProperty('reasoning');
    expect(body.max_tokens).toBe(32_000);
  });

  it('довільний id користувача: effort як є, стеля 64 000', () => {
    const req = buildRequest(judgeV1, judgeInput, { maxOutputTokens: 30_000 });
    const body = make(fetchImpl).buildBody(req, 'acme/brand-new-model');
    expect(body.reasoning).toEqual({ effort: 'high', exclude: true });
    expect(body.max_tokens).toBe(64_000);
  });

  it('модель без supported_efforts (Haiku 4.5) приймає рівень як є', () => {
    const body = make(fetchImpl).buildBody(buildRequest(clauseExtractV1, clauseExtractInput), 'anthropic/claude-haiku-4.5');
    expect(body.reasoning).toEqual({ effort: 'medium', exclude: true });
  });
});

describe('mapOpenRouterEffort', () => {
  it.each([
    ['high', ['max', 'xhigh', 'high', 'medium', 'low'], 'high'],
    ['xhigh', ['high', 'medium', 'low'], 'high'],
    ['max', ['high', 'medium', 'low'], 'high'],
    ['medium', ['max', 'high', 'low'], 'low'],
    ['low', ['xhigh', 'high'], 'high'],
    ['medium', ['xhigh', 'high'], 'high'],
    ['max', ['xhigh', 'high', 'medium', 'low', 'minimal'], 'xhigh'],
    ['low', ['max', 'xhigh', 'high', 'medium', 'low', 'none'], 'low'],
    ['low', ['minimal', 'none'], 'minimal'],
    ['low', ['none'], null],
    ['high', null, 'high'],
  ] as const)('%s з %j → %s', (requested, supported, expected) => {
    expect(mapOpenRouterEffort(requested, supported)).toBe(expected);
  });
});

describe('buildBody — документи', () => {
  const { fetchImpl } = stubFetch([]);
  const pdf = { name: 'Pest Management 0068.pdf', mime: 'application/pdf' as const, base64: 'JVBE\nRi0x', citations: false };

  it('текстовий документ — блок <document> у першому user-повідомленні', () => {
    const req = buildRequest(clauseExtractV1, clauseExtractInput, {
      documents: [{ name: 'SOP "0068"', mime: 'text/plain', base64: Buffer.from('Hello doc').toString('base64'), citations: false }],
    });
    const body = make(fetchImpl).buildBody(req, 'openai/gpt-6-luna');
    const user = (body.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>)[1];
    expect(user?.role).toBe('user');
    expect(user?.content[0]?.text).toBe('<document name="SOP &quot;0068&quot;">\nHello doc\n</document>');
    expect(user?.content[0]?.cache_control).toEqual({ type: 'ephemeral' });
    expect(user?.content[1]?.type).toBe('text');
  });

  it('PDF — file-частина з data URL і лише нативний парсер', () => {
    const req = buildRequest(clauseExtractV1, clauseExtractInput, { documents: [pdf] });
    const body = make(fetchImpl).buildBody(req, 'anthropic/claude-opus-5.5');
    const user = (body.messages as Array<{ content: Array<Record<string, unknown>> }>)[1];
    expect(user?.content[0]).toMatchObject({
      type: 'file',
      file: { filename: 'Pest Management 0068.pdf', file_data: 'data:application/pdf;base64,JVBERi0x' },
    });
    expect(body.plugins).toEqual([{ id: 'file-parser', pdf: { engine: 'native' } }]);
  });

  it('PDF моделі, що не читає файли сама, — типізована помилка, а не тихий OCR третьою стороною', () => {
    const req = buildRequest(clauseExtractV1, clauseExtractInput, { documents: [pdf] });
    expect(() => make(fetchImpl).buildBody(req, 'deepseek/deepseek-v4-pro')).toThrow(LlmUnsupportedError);
  });
});

// ─── Виклик ──────────────────────────────────────────────────────────────────

describe('complete — стрім, usage, вартість', () => {
  it('збирає SSE з коментарями й розірваними рядками; usage без кешованих у input', async () => {
    const { fetchImpl, calls } = stubFetch([{ sse: okStream(VALID_CLAUSES), chunkSize: 7 }]);
    const result = await make(fetchImpl).complete(
      buildRequest(clauseExtractV1, clauseExtractInput, { model: 'openai/gpt-6-luna' }),
      signal(),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(calls[0]?.headers.authorization).toBe('Bearer sk-or-test');
    expect(result.data.clauses[0]?.clauseNo).toBe('10.3');
    // prompt 1000 = 100 некешованих + 800 з кешу + 100 запису в кеш.
    expect(result.usage).toEqual({ input: 100, cachedInput: 800, cacheWrite: 100, output: 200 });
    expect(result.costUsd).toBeCloseTo(0.0123, 10);
    expect(result).toMatchObject({ modelId: 'openai/gpt-6-luna', providerId: 'openrouter', fromCache: false, citations: [] });
  });

  it('без usage.cost вартість рахується за цінами каталогу', async () => {
    const usage = { ...USAGE, cost: undefined };
    const { fetchImpl } = stubFetch([{ sse: okStream(VALID_CLAUSES, { usage }) }]);
    const result = await make(fetchImpl).complete(
      buildRequest(clauseExtractV1, clauseExtractInput, { model: 'anthropic/claude-opus-5.5' }),
      signal(),
    );
    // Opus 5.5: $4 вхід, $0.20 читання кешу, $5 запис, $20 вихід за 1M.
    expect(result.costUsd).toBeCloseTo(100 * 4e-6 + 800 * 0.2e-6 + 100 * 5e-6 + 200 * 20e-6, 12);
  });

  it('BYOK: до комісії OpenRouter додається вартість апстріму', async () => {
    const usage = { ...USAGE, cost: 0.001, is_byok: true, cost_details: { upstream_inference_cost: 0.02 } };
    const { fetchImpl } = stubFetch([{ sse: okStream(VALID_CLAUSES, { usage }) }]);
    const result = await make(fetchImpl).complete(buildRequest(clauseExtractV1, clauseExtractInput), signal());
    expect(result.costUsd).toBeCloseTo(0.021, 10);
  });

  it('openRouterUsageToLlm не дає відʼємного input', () => {
    expect(openRouterUsageToLlm({ prompt_tokens: 10, prompt_tokens_details: { cached_tokens: 50 } })).toEqual({
      input: 0,
      cachedInput: 50,
      cacheWrite: 0,
      output: 0,
    });
    expect(openRouterUsageToLlm(null)).toEqual({ input: 0, cachedInput: 0, cacheWrite: 0, output: 0 });
  });

  it('null необовʼязкових полів прибирається до zod; items розгортаються в масив', async () => {
    const { fetchImpl } = stubFetch([{ sse: okStream(JUDGE_ITEMS) }]);
    const result = await make(fetchImpl).complete<JudgeOutput>(
      buildRequest(judgeV1, judgeInput, { model: 'anthropic/claude-opus-5.5' }),
      signal(),
    );
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).not.toHaveProperty('gap');
    expect(result.data[0]?.evidence[0]).toEqual({ quote: 'Monitoring devices are numbered and shown on a site map.' });
    expect(result.data[1]).not.toHaveProperty('severity');
    expect(result.data[1]?.gap).toBe('No licence copy.');
  });

  it('не-стрімова JSON-відповідь теж розбирається', async () => {
    const { fetchImpl } = stubFetch([
      { json: { id: 'gen-2', choices: [{ message: { content: VALID_CLAUSES }, finish_reason: 'stop' }], usage: USAGE } },
    ]);
    const result = await make(fetchImpl).complete(buildRequest(clauseExtractV1, clauseExtractInput), signal());
    expect(result.data.clauses).toHaveLength(1);
  });

  it('без ключа — LlmNotConfiguredError і жодного запиту', async () => {
    const { fetchImpl, calls } = stubFetch([]);
    const provider = make(fetchImpl, { getApiKey: () => null });
    expect(provider.isConfigured()).toBe(false);
    await expect(provider.complete(buildRequest(clauseExtractV1, clauseExtractInput), signal())).rejects.toBeInstanceOf(
      LlmNotConfiguredError,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('complete — json_object і repair', () => {
  it('400 на response_format → один раз json_object без require_parameters, модель запамʼятовується', async () => {
    const { fetchImpl, calls } = stubFetch([
      { status: 400, error: { code: 400, message: "Invalid schema for response_format 'clause_extract_response'" } },
      { sse: okStream(VALID_CLAUSES) },
      { sse: okStream(VALID_CLAUSES) },
    ]);
    const provider = make(fetchImpl);
    const req = buildRequest(clauseExtractV1, clauseExtractInput, { model: 'qwen/qwen3.8-max-0902' });

    const result = await provider.complete(req, signal());
    expect(result.data.clauses).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect((calls[0]?.body.response_format as Record<string, unknown>).type).toBe('json_schema');
    expect(calls[1]?.body.response_format).toEqual({ type: 'json_object' });
    expect(calls[1]?.body.provider).toEqual({ data_collection: 'deny' });
    const instructions = (calls[1]?.body.messages as Array<{ content: Array<{ text: string }> }>)[0]?.content[1]?.text;
    expect(instructions).toContain('must validate against this JSON Schema');
    expect(provider.isJsonObjectOnly('qwen/qwen3.8-max-0902')).toBe(true);

    // Наступний виклик одразу йде в json_object — без зайвої відмови.
    await provider.complete(req, signal());
    expect(calls).toHaveLength(3);
    expect(calls[2]?.body.response_format).toEqual({ type: 'json_object' });
  });

  it('«No endpoints … requested parameters» → json_object; якщо й там нема ендпоінта — чесна помилка приватності', async () => {
    const noEndpoints = { status: 404, error: { code: 404, message: 'No endpoints found that can handle the requested parameters.' } };
    const { fetchImpl, calls } = stubFetch([noEndpoints, noEndpoints]);
    const error = await make(fetchImpl)
      .complete(buildRequest(clauseExtractV1, clauseExtractInput, { model: 'z-ai/glm-5.3' }), signal())
      .catch((err: unknown) => err);

    expect(calls).toHaveLength(2);
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).kind).toBe('unsupported');
    expect((error as LlmError).message).toContain('data_collection=deny');
    expect((error as LlmError).retryable).toBe(false);
  });

  it('відмова через політику даних не маскується під проблему схеми', async () => {
    const { fetchImpl, calls } = stubFetch([
      { status: 404, error: { code: 404, message: 'No endpoints found matching your data policy (Paid model training)' } },
    ]);
    const error = (await make(fetchImpl)
      .complete(buildRequest(clauseExtractV1, clauseExtractInput), signal())
      .catch((err: unknown) => err)) as LlmError;
    expect(calls).toHaveLength(1);
    expect(error.kind).toBe('unsupported');
    expect(error.message).toContain('privacy');
  });

  it('помилка zod повертається моделі; успіх із другої спроби, usage сумується', async () => {
    const { fetchImpl, calls } = stubFetch([
      { sse: okStream(JSON.stringify({ clauses: 'nope' })) },
      { sse: okStream(VALID_CLAUSES) },
    ]);
    const result = await make(fetchImpl).complete(buildRequest(clauseExtractV1, clauseExtractInput), signal());

    expect(result.data.clauses).toHaveLength(1);
    expect(calls).toHaveLength(2);
    const messages = calls[1]?.body.messages as Array<{ role: string; content: unknown }>;
    expect(messages.at(-2)?.role).toBe('assistant');
    expect(String(messages.at(-1)?.content)).toContain('rejected by the schema validator');
    expect(result.usage.output).toBe(400);
    expect(result.costUsd).toBeCloseTo(0.0246, 10);
  });

  it('після 2 ходів repair — LlmSchemaError з кількістю спроб', async () => {
    const { fetchImpl, calls } = stubFetch([{ sse: okStream('not json at all') }]);
    const error = (await make(fetchImpl)
      .complete(buildRequest(clauseExtractV1, clauseExtractInput), signal())
      .catch((err: unknown) => err)) as LlmSchemaError;
    expect(error).toBeInstanceOf(LlmSchemaError);
    expect(error.attempts).toBe(3);
    expect(calls).toHaveLength(3);
  });

  it('finish_reason length з неповним JSON — LlmSchemaError про обрізання, без repair', async () => {
    const { fetchImpl, calls } = stubFetch([{ sse: okStream('{"clauses": [{"clauseNo": "10', { finish: 'length' }) }]);
    const error = (await make(fetchImpl)
      .complete(buildRequest(clauseExtractV1, clauseExtractInput), signal())
      .catch((err: unknown) => err)) as LlmSchemaError;
    expect(error).toBeInstanceOf(LlmSchemaError);
    expect(error.issues).toContain('truncated');
    expect(calls).toHaveLength(1);
  });
});

describe('complete — відмови й помилки', () => {
  const req = () => buildRequest(clauseExtractV1, clauseExtractInput, { model: 'openai/gpt-6-luna' });
  const run = async (replies: Reply[], over: Partial<OpenRouterProviderOptions> = {}) => {
    const { fetchImpl, calls } = stubFetch(replies);
    const error = await make(fetchImpl, over)
      .complete(req(), signal())
      .then(() => null, (err: unknown) => err);
    return { error: error as LlmError, calls };
  };

  it('finish_reason content_filter → LlmRefusalError', async () => {
    const { error } = await run([{ sse: okStream('', { finish: 'content_filter' }) }]);
    expect(error).toBeInstanceOf(LlmRefusalError);
  });

  it('message.refusal → LlmRefusalError з поясненням', async () => {
    const { error } = await run([
      { sse: [{ choices: [{ index: 0, delta: { refusal: 'I cannot help with that.' }, finish_reason: 'stop' }] }, '[DONE]'] },
    ]);
    expect(error).toBeInstanceOf(LlmRefusalError);
    expect((error as LlmRefusalError).explanation).toBe('I cannot help with that.');
  });

  it('401 → auth, фатальна', async () => {
    const { error, calls } = await run([{ status: 401, error: { code: 401, message: 'User not found.' } }]);
    expect(error.kind).toBe('auth');
    expect(isFatalLlmError(error)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('402 → insufficient_credit, фатальна: прогін стає на паузу', async () => {
    const { error, calls } = await run([{ status: 402, error: { code: 402, message: 'Insufficient credits' } }]);
    expect(error.kind).toBe('insufficient_credit');
    expect(isFatalLlmError(error)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('402 з Retry-After (бюджет у польоті) — повторюється', async () => {
    const sleep = vi.fn(async () => undefined);
    const { fetchImpl, calls } = stubFetch([
      { status: 402, error: { code: 402, message: 'In-flight budget exceeded' }, headers: { 'retry-after': '2' } },
      { sse: okStream(VALID_CLAUSES) },
    ]);
    await make(fetchImpl, { sleep }).complete(req(), signal());
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(2_000, expect.anything());
  });

  it('403 модерації → LlmRefusalError; інший 403 → auth', async () => {
    const moderated = await run([
      {
        status: 403,
        error: { code: 403, message: 'Input was flagged', metadata: { reasons: ['violence'], flagged_input: '...' } },
      },
    ]);
    expect(moderated.error).toBeInstanceOf(LlmRefusalError);
    expect((moderated.error as LlmRefusalError).explanation).toContain('violence');

    const forbidden = await run([{ status: 403, error: { code: 403, message: 'Key disabled' } }]);
    expect(forbidden.error.kind).toBe('auth');
  });

  it('404 моделі → model_not_found', async () => {
    const { error } = await run([{ status: 404, error: { code: 404, message: 'Model acme/ghost does not exist' } }]);
    expect(error.kind).toBe('model_not_found');
  });

  it('429 з Retry-After: чекаємо стільки, скільки просять, і повторюємо', async () => {
    const sleep = vi.fn(async () => undefined);
    const { fetchImpl, calls } = stubFetch([
      { status: 429, error: { code: 429, message: 'Rate limit exceeded' }, headers: { 'retry-after': '7' } },
      { sse: okStream(VALID_CLAUSES) },
    ]);
    const result = await make(fetchImpl, { sleep }).complete(req(), signal());
    expect(result.data.clauses).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(7_000, expect.anything());
  });

  it('429 без кінця — після 2 повторів rate_limit, ретраїбельна', async () => {
    const sleep = vi.fn(async () => undefined);
    const { error, calls } = await run([{ status: 429, error: { code: 429, message: 'Rate limit exceeded' } }], {
      sleep,
      retryBaseDelayMs: 100,
    });
    expect(error.kind).toBe('rate_limit');
    expect(error.retryable).toBe(true);
    expect(calls).toHaveLength(3);
    expect(sleep.mock.calls.map((call) => (call as unknown[])[0])).toEqual([100, 200]);
  });

  it('5xx повторюється, потім api retryable', async () => {
    const { error, calls } = await run([{ status: 502, error: { code: 502, message: 'Bad gateway' } }]);
    expect(error.kind).toBe('api');
    expect(error.retryable).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it('обрив мережі → transport, ретраїбельна', async () => {
    const { error, calls } = await run([{ throws: new TypeError('fetch failed') }]);
    expect(error.kind).toBe('transport');
    expect(error.retryable).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it('помилка посеред потоку: 502 повторюється, 400 — ні', async () => {
    const midStream = (code: number): Reply => ({
      sse: [
        { choices: [{ index: 0, delta: { content: '{"cla' }, finish_reason: null }] },
        { error: { code, message: 'Provider disconnected', metadata: { error_type: 'provider_unavailable' } }, choices: [{ index: 0, delta: { content: '' }, finish_reason: 'error' }] },
      ],
    });

    const { fetchImpl, calls } = stubFetch([midStream(502), { sse: okStream(VALID_CLAUSES) }]);
    const result = await make(fetchImpl).complete(req(), signal());
    expect(result.data.clauses).toHaveLength(1);
    expect(calls).toHaveLength(2);

    // 400 не повторюється як збій транспорту — лише одна спроба без строгої схеми.
    const bad = await run([midStream(400), midStream(400)]);
    expect(bad.error.kind).toBe('api');
    expect(bad.error.retryable).toBe(false);
    expect(bad.calls).toHaveLength(2);
    expect(bad.calls[1]?.body.response_format).toEqual({ type: 'json_object' });
  });

  it('400 «Provider returned error» → одна спроба в json_object; у тексті — причина від постачальника', async () => {
    const providerError = {
      status: 400,
      error: {
        code: 400,
        message: 'Provider returned error',
        metadata: {
          provider_name: 'Anthropic',
          raw: JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'output_format: schema is not supported' } }),
        },
      },
    };
    const { fetchImpl, calls } = stubFetch([providerError, { sse: okStream(VALID_CLAUSES) }]);
    const result = await make(fetchImpl).complete(req(), signal());
    expect(result.data.clauses).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body.response_format).toEqual({ type: 'json_object' });

    // Якщо й без схеми відмова — у повідомленні видно, що сказав постачальник.
    const failing = await run([providerError, providerError]);
    expect(failing.error.message).toContain('Provider returned error — Anthropic: output_format: schema is not supported');
  });

  it('потік, що закрився без [DONE] і finish_reason, — обрив транспорту: повторюється', async () => {
    const cut: Reply = { sse: [{ choices: [{ index: 0, delta: { content: '{"clauses": [' }, finish_reason: null }] }] };
    const { fetchImpl, calls } = stubFetch([cut, { sse: okStream(VALID_CLAUSES) }]);
    const result = await make(fetchImpl).complete(req(), signal());
    expect(result.data.clauses).toHaveLength(1);
    expect(calls).toHaveLength(2);

    const always = await run([cut]);
    expect(always.error.kind).toBe('transport');
    expect(always.calls).toHaveLength(3);
  });

  it('скасування: до запиту — aborted без мережі; під час паузи між повторами — aborted', async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 429, error: { code: 429, message: 'slow down' } }]);
    const controller = new AbortController();
    controller.abort();
    const early = await make(fetchImpl).complete(req(), controller.signal).catch((err: unknown) => err);
    expect((early as LlmError).kind).toBe('aborted');
    expect(calls).toHaveLength(0);

    const during = new AbortController();
    const sleep = vi.fn(async () => {
      during.abort();
      throw new Error('aborted');
    });
    const late = await make(fetchImpl, { sleep }).complete(req(), during.signal).catch((err: unknown) => err);
    expect((late as LlmError).kind).toBe('aborted');
    expect(calls).toHaveLength(1);
  });

  it('AbortSignal доходить до fetch', async () => {
    const seen: Array<AbortSignal | null | undefined> = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      seen.push(init.signal);
      return new Response(sseText(okStream(VALID_CLAUSES)), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    const controller = new AbortController();
    await make(fetchImpl).complete(req(), controller.signal);
    expect(seen[0]).toBe(controller.signal);
  });
});

describe('pricingFor і каталог', () => {
  const { fetchImpl } = stubFetch([]);

  it('ціни кураторських моделей зі знімка; невідома ціна кешу — як звичайний вхід', () => {
    const provider = make(fetchImpl);
    expect(provider.pricingFor('anthropic/claude-opus-5.5')).toMatchObject({
      inputPerMTok: 4,
      outputPerMTok: 20,
      cacheReadPerMTok: 0.2,
      cacheWritePerMTok: 5,
    });
    expect(provider.pricingFor('deepseek/deepseek-v4-pro')?.cacheWritePerMTok).toBe(0.2088);
    expect(provider.pricingFor('acme/unknown')).toBeNull();
    // Маршрутний суфікс не змінює метаданих моделі.
    expect(provider.pricingFor('openai/gpt-6-luna:nitro')?.inputPerMTok).toBe(0.1);
  });

  it('models: модель за замовчуванням першою, далі каталог', () => {
    const provider = make(fetchImpl);
    expect(provider.models[0]).toBe('anthropic/claude-sonnet-5.5');
    expect(provider.models).toContain('anthropic/claude-opus-5.5');
    expect(new Set(provider.models).size).toBe(provider.models.length);
  });
});
