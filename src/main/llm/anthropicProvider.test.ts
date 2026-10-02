/**
 * Тіло запиту до Anthropic перевіряється на замоканому клієнті SDK.
 * Жодних мережевих викликів і жодних ключів API.
 */

import { describe, expect, it } from 'vitest';
import { DOC_TEXT, clauseExtractInput, judgeInput } from './__fixtures__/samples';
import { LlmRefusalError, LlmSchemaError, LlmUnsupportedError } from './errors';
import { clauseExtractV1, judgeV1 } from './prompts';
import { AnthropicProvider, THINKING_MIN_MAX_TOKENS, type AnthropicClientLike } from './providers/anthropic';
import { buildRequest } from './request';

interface RecordedCall {
  method: 'create' | 'parse' | 'stream';
  params: Record<string, unknown>;
}

function makeClient(message: unknown): { client: AnthropicClientLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const record = (method: RecordedCall['method']) => (params: unknown) => {
    calls.push({ method, params: params as Record<string, unknown> });
    return message;
  };
  const client = {
    messages: {
      create: async (params: unknown) => record('create')(params),
      parse: async (params: unknown) => record('parse')(params),
      stream: (params: unknown) => {
        record('stream')(params);
        return { finalMessage: async () => message };
      },
    },
  };
  return { client: client as unknown as AnthropicClientLike, calls };
}

const usage = {
  input_tokens: 120,
  output_tokens: 45,
  cache_read_input_tokens: 38_000,
  cache_creation_input_tokens: 0,
};

function message(over: Record<string, unknown>): unknown {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    content: [],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage,
    ...over,
  };
}

const provider = (client: AnthropicClientLike): AnthropicProvider =>
  new AnthropicProvider({ getApiKey: () => null, client });

const signal = (): AbortSignal => new AbortController().signal;

describe('buildParams — заборонені параметри', () => {
  it('не передає temperature / top_p / top_k — на Opus 5 і Sonnet 5 це 400', () => {
    const { client } = makeClient(message({}));
    const params = provider(client).buildParams(
      buildRequest(clauseExtractV1, clauseExtractInput),
      'claude-sonnet-5',
    ) as unknown as Record<string, unknown>;

    expect(params).not.toHaveProperty('temperature');
    expect(params).not.toHaveProperty('top_p');
    expect(params).not.toHaveProperty('top_k');
  });

  it('effort іде в output_config, а не top-level; budget_tokens відсутній', () => {
    const { client } = makeClient(message({}));
    const params = provider(client).buildParams(
      buildRequest(clauseExtractV1, clauseExtractInput),
      'claude-sonnet-5',
    ) as unknown as Record<string, unknown>;

    expect(params).not.toHaveProperty('effort');
    expect(params.output_config).toMatchObject({ effort: 'medium' });
    expect(params.thinking).toEqual({ type: 'adaptive' });
    expect(JSON.stringify(params.thinking)).not.toContain('budget_tokens');
  });

  it('adaptive thinking не вмикається на моделях, які його не мають', () => {
    const { client } = makeClient(message({}));
    const params = provider(client).buildParams(
      buildRequest(clauseExtractV1, clauseExtractInput),
      'claude-haiku-4-5',
    ) as unknown as Record<string, unknown>;
    expect(params).not.toHaveProperty('thinking');
  });
});

describe('buildParams — кешування', () => {
  it('cache_control стоїть на останньому системному блоці', () => {
    const { client } = makeClient(message({}));
    const params = provider(client).buildParams(
      buildRequest(judgeV1, judgeInput, { maxOutputTokens: 4_000 }),
      'claude-opus-5',
    ) as unknown as Record<string, unknown>;

    const system = params.system as Array<Record<string, unknown>>;
    expect(Array.isArray(system)).toBe(true);
    expect(system).toHaveLength(2);
    expect(system[0]).not.toHaveProperty('cache_control');
    expect(system[1]?.cache_control).toEqual({ type: 'ephemeral' });
    expect(String(system[1]?.text)).toContain(DOC_TEXT);
  });

  it('текст документа — в system, батч вимог — в messages', () => {
    const { client } = makeClient(message({}));
    const params = provider(client).buildParams(
      buildRequest(judgeV1, judgeInput, { maxOutputTokens: 4_000 }),
      'claude-opus-5',
    ) as unknown as Record<string, unknown>;

    const systemText = (params.system as Array<{ text: string }>)
      .map((block) => block.text)
      .join(' ');
    const userText = String(
      (params.messages as Array<{ content: unknown }>)[0]?.content ?? '',
    );

    expect(systemText).toContain('Monitoring devices are numbered');
    expect(userText).toContain('<clause no="10.3"');
    expect(userText).not.toContain('Monitoring devices are numbered');
  });

  it('breakpoint-ів не більше 4', () => {
    const { client } = makeClient(message({}));
    const req = buildRequest(judgeV1, judgeInput, {
      maxOutputTokens: 4_000,
      documents: [
        { name: 'doc.pdf', mime: 'application/pdf', base64: 'AAAA', citations: true },
      ],
    });
    const params = provider(client).buildParams(req, 'claude-opus-5');
    const count = (JSON.stringify(params).match(/"cache_control"/g) ?? []).length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(4);
  });
});

describe('buildParams — structured vs tool', () => {
  it('без citations і без інструмента — output_config.format', () => {
    const { client } = makeClient(message({}));
    const params = provider(client).buildParams(
      buildRequest(clauseExtractV1, clauseExtractInput),
      'claude-sonnet-5',
    ) as unknown as Record<string, unknown>;

    const outputConfig = params.output_config as Record<string, unknown>;
    expect(outputConfig.format).toMatchObject({ type: 'json_schema' });
    expect(params).not.toHaveProperty('tools');
    expect(params).not.toHaveProperty('output_format');
  });

  it('при citations використано tool-режим зі strict: true і БЕЗ output_config.format', () => {
    const { client } = makeClient(message({}));
    const req = buildRequest(judgeV1, judgeInput, {
      maxOutputTokens: 4_000,
      documents: [
        { name: 'Pest Management 0068.pdf', mime: 'application/pdf', base64: 'JVBERi0x', citations: true },
      ],
    });
    const params = provider(client).buildParams(req, 'claude-opus-5') as unknown as Record<string, unknown>;

    const tools = params.tools as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('report_finding');
    expect(tools[0]?.strict).toBe(true);
    expect((tools[0]?.input_schema as Record<string, unknown>).additionalProperties).toBe(false);
    expect(params.tool_choice).toEqual({ type: 'any' });

    const outputConfig = (params.output_config ?? {}) as unknown as Record<string, unknown>;
    expect(outputConfig.format).toBeUndefined();
    expect(outputConfig.effort).toBe('high');
  });

  it('документ іде блоком document із citations.enabled і cache_control', () => {
    const { client } = makeClient(message({}));
    const req = buildRequest(judgeV1, judgeInput, {
      maxOutputTokens: 4_000,
      documents: [
        {
          name: 'doc.pdf',
          mime: 'application/pdf',
          base64: 'JVBE\nRi0x',
          citations: true,
          context: 'SOP 0068 v002',
        },
      ],
    });
    const params = provider(client).buildParams(req, 'claude-opus-5') as unknown as Record<string, unknown>;
    const messages = params.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>;
    const block = messages[0]?.content?.[0] as Record<string, unknown>;

    expect(block.type).toBe('document');
    expect(block.citations).toEqual({ enabled: true });
    expect(block.cache_control).toEqual({ type: 'ephemeral' });
    expect(block.context).toBe('SOP 0068 v002');
    expect((block.source as Record<string, unknown>).data).toBe('JVBERi0x');
    expect(messages[0]?.content?.[1]).toMatchObject({ type: 'text' });
  });

  it('citations без інструмента — типізована помилка, а не 400 від API', () => {
    const { client } = makeClient(message({}));
    const req = buildRequest(clauseExtractV1, clauseExtractInput, {
      documents: [{ name: 'doc.pdf', mime: 'application/pdf', base64: 'AA', citations: true }],
    });
    expect(() => provider(client).buildParams(req, 'claude-sonnet-5')).toThrow(LlmUnsupportedError);
  });
});

describe('complete — structured', () => {
  it('parse(), parsed_output, usage і вартість', async () => {
    const parsedOutput = {
      clauses: [
        {
          clauseNo: '10.3',
          sectionNo: '10',
          sectionTitle: 'Pest management',
          topic: 'Programme',
          requirementText: 'The site must have a documented pest management programme.',
          modules: ['P', 'R'],
          obligation: 'must',
          truncated: false,
        },
      ],
    };
    const { client, calls } = makeClient(
      message({ content: [{ type: 'text', text: '{}', citations: null }], parsed_output: parsedOutput }),
    );

    const result = await provider(client).complete(
      buildRequest(clauseExtractV1, clauseExtractInput, { model: 'claude-sonnet-5' }),
      signal(),
    );

    // Sonnet 5 думає за замовчуванням → запас max_tokens під роздуми → стрім.
    expect(calls[0]?.method).toBe('stream');
    expect(calls[0]?.params.max_tokens).toBe(THINKING_MIN_MAX_TOKENS);
    expect(result.data.clauses[0]?.clauseNo).toBe('10.3');
    expect(result.usage).toEqual({ input: 120, cachedInput: 38_000, cacheWrite: 0, output: 45 });
    expect(result.costUsd).toBeCloseTo(120 * 2e-6 + 38_000 * 0.2e-6 + 45 * 10e-6, 12);
    expect(result.fromCache).toBe(false);
  });

  it('parsed_output === null → падаємо назад на текст', async () => {
    const { client } = makeClient(
      message({
        content: [{ type: 'text', text: '```json\n{"clauses":[]}\n```', citations: null }],
        parsed_output: null,
      }),
    );
    const result = await provider(client).complete(
      buildRequest(clauseExtractV1, clauseExtractInput),
      signal(),
    );
    expect(result.data.clauses).toEqual([]);
  });

  it('відповідь, що не проходить схему, → LlmSchemaError', async () => {
    const { client } = makeClient(
      message({
        content: [{ type: 'text', text: '{"clauses":"nope"}', citations: null }],
        parsed_output: null,
      }),
    );
    await expect(
      provider(client).complete(buildRequest(clauseExtractV1, clauseExtractInput), signal()),
    ).rejects.toBeInstanceOf(LlmSchemaError);
  });
});

describe('complete — tool, streaming, refusal', () => {
  it('збирає всі виклики report_finding у масив і тягне цитати', async () => {
    const findings = [
      {
        clause_no: '10.3',
        verdict: 'partial',
        severity: 'minor',
        confidence: 0.8,
        rationale: 'Programme documented, frequency missing.',
        evidence: [{ quote: 'Monitoring devices are numbered and shown on a site map.', page: 1 }],
      },
      {
        clause_no: '10.4',
        verdict: 'compliant',
        confidence: 0.9,
        rationale: 'Licence copy is held.',
        evidence: [{ quote: 'The site has a contract with a licensed pest control contractor.', page: 1 }],
      },
    ];
    const { client, calls } = makeClient(
      message({
        model: 'claude-opus-5',
        stop_reason: 'tool_use',
        content: [
          {
            type: 'text',
            text: 'Checked.',
            citations: [
              {
                type: 'page_location',
                cited_text: 'Monitoring devices are numbered and shown on a site map.',
                document_index: 0,
                document_title: 'Pest Management',
                start_page_number: 1,
                end_page_number: 1,
                file_id: null,
              },
            ],
          },
          { type: 'tool_use', id: 't1', name: 'report_finding', input: findings[0] },
          { type: 'tool_use', id: 't2', name: 'report_finding', input: findings[1] },
        ],
      }),
    );

    const result = await provider(client).complete(
      buildRequest(judgeV1, judgeInput, {
        model: 'claude-opus-5',
        maxOutputTokens: 4_000,
        documents: [{ name: 'doc.pdf', mime: 'application/pdf', base64: 'AA', citations: true }],
      }),
      signal(),
    );

    // Opus 5 думає за замовчуванням: 4 000 піднято до запасу під роздуми → стрім.
    expect(calls[0]?.method).toBe('stream');
    expect(calls[0]?.params.max_tokens).toBe(THINKING_MIN_MAX_TOKENS);
    expect(result.data).toHaveLength(2);
    expect(result.data[0]?.clause_no).toBe('10.3');
    expect(result.citations).toEqual([
      {
        quote: 'Monitoring devices are numbered and shown on a site map.',
        documentName: 'Pest Management',
        documentIndex: 0,
        pageFrom: 1,
        pageTo: 1,
        charStart: null,
        charEnd: null,
        source: 'citations_api',
      },
    ]);
  });

  it('стрімить, коли max_tokens вище 8000', async () => {
    const { client, calls } = makeClient(
      message({
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'report_finding',
            input: {
              clause_no: '10.3',
              verdict: 'not_addressed',
              confidence: 0.9,
              rationale: 'Not covered.',
              evidence: [],
            },
          },
        ],
      }),
    );
    await provider(client).complete(buildRequest(judgeV1, judgeInput), signal());
    expect(calls[0]?.method).toBe('stream');
  });

  it('refusal — окрема типізована помилка, content не читається', async () => {
    const { client } = makeClient(
      message({
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'general_harms', explanation: 'nope' },
        content: [],
      }),
    );
    await expect(
      provider(client).complete(buildRequest(clauseExtractV1, clauseExtractInput), signal()),
    ).rejects.toBeInstanceOf(LlmRefusalError);
  });

  it('без ключа і без клієнта провайдер не налаштований', () => {
    expect(new AnthropicProvider({ getApiKey: () => null }).isConfigured()).toBe(false);
    expect(new AnthropicProvider({ getApiKey: () => 'sk-test' }).isConfigured()).toBe(true);
  });
});

describe('нові моделі: tool_choice, effort, thinking', () => {
  const toolRequest = () =>
    buildRequest(judgeV1, judgeInput, {
      maxOutputTokens: 4_000,
      documents: [{ name: 'doc.pdf', mime: 'application/pdf', base64: 'AA', citations: true }],
    });

  it('Opus 5.5 і Fable 5.1: примусовий tool_choice дає 400 — тому auto', () => {
    const { client } = makeClient(message({}));
    for (const model of ['claude-opus-5-5', 'claude-fable-5-1']) {
      const params = provider(client).buildParams(toolRequest(), model) as unknown as Record<string, unknown>;
      expect(params.tool_choice).toEqual({ type: 'auto' });
      const tools = params.tools as Array<Record<string, unknown>>;
      expect(tools[0]?.strict).toBe(true);
      expect(params.thinking).toEqual({ type: 'adaptive' });
      expect(params.output_config).toMatchObject({ effort: 'high' });
    }
  });

  it('невідома майбутня модель теж отримує auto, а не примус', () => {
    const { client } = makeClient(message({}));
    const params = provider(client).buildParams(toolRequest(), 'claude-opus-6') as unknown as Record<string, unknown>;
    expect(params.tool_choice).toEqual({ type: 'auto' });
    expect(params.thinking).toEqual({ type: 'adaptive' });
  });

  it('одиночний інструмент на Opus 5.5 — auto з disable_parallel_tool_use', () => {
    const { client } = makeClient(message({}));
    const req = toolRequest();
    req.tool = { ...req.tool!, multiCall: false };
    const params = provider(client).buildParams(req, 'claude-opus-5-5') as unknown as Record<string, unknown>;
    expect(params.tool_choice).toEqual({ type: 'auto', disable_parallel_tool_use: true });
  });

  it('Opus 5 / Sonnet 5 зберігають примусовий виклик', () => {
    const { client } = makeClient(message({}));
    const req = toolRequest();
    req.tool = { ...req.tool!, multiCall: false };
    const single = provider(client).buildParams(req, 'claude-sonnet-5') as unknown as Record<string, unknown>;
    expect(single.tool_choice).toEqual({ type: 'tool', name: 'report_finding', disable_parallel_tool_use: true });
    const multi = provider(client).buildParams(toolRequest(), 'claude-opus-5') as unknown as Record<string, unknown>;
    expect(multi.tool_choice).toEqual({ type: 'any' });
  });

  it('Haiku 4.5: effort мовчки відкидається — інакше помилка API; thinking не вмикається', () => {
    const { client } = makeClient(message({}));
    const req = buildRequest(clauseExtractV1, clauseExtractInput, { effort: 'max' });
    const params = provider(client).buildParams(req, 'claude-haiku-4-5') as unknown as Record<string, unknown>;
    const outputConfig = (params.output_config ?? {}) as Record<string, unknown>;
    expect(outputConfig.effort).toBeUndefined();
    expect(outputConfig.format).toBeDefined();
    expect(params).not.toHaveProperty('thinking');
  });

  it('ніколи не шле thinking.disabled, budget_tokens чи temperature', () => {
    const { client } = makeClient(message({}));
    for (const model of ['claude-opus-5-5', 'claude-fable-5-1', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']) {
      const json = JSON.stringify(provider(client).buildParams(buildRequest(clauseExtractV1, clauseExtractInput), model));
      expect(json).not.toContain('"disabled"');
      expect(json).not.toContain('budget_tokens');
      expect(json).not.toContain('temperature');
    }
  });

  it('вартість Opus 5.5 рахується за явними цінами кешу', async () => {
    const { client } = makeClient(
      message({ content: [{ type: 'text', text: '{"clauses":[]}', citations: null }], parsed_output: { clauses: [] } }),
    );
    const result = await provider(client).complete(
      buildRequest(clauseExtractV1, clauseExtractInput, { model: 'claude-opus-5-5' }),
      signal(),
    );
    // input 120 × $4, cache read 38 000 × $0.20, output 45 × $20 (за 1M)
    expect(result.costUsd).toBeCloseTo(120 * 4e-6 + 38_000 * 0.2e-6 + 45 * 20e-6, 12);
    expect(result.modelId).toBe('claude-opus-5-5');
  });

  it('pricingFor віддає таблицю Anthropic, невідома модель — null', () => {
    const { client } = makeClient(message({}));
    expect(provider(client).pricingFor('claude-fable-5-1')?.cacheReadPerMTok).toBe(0.25);
    expect(provider(client).pricingFor('claude-unknown')).toBeNull();
  });
});

describe('живий список моделей', () => {
  const liveClient = (models: Array<Record<string, unknown>>) => {
    const { client } = makeClient(message({}));
    (client as { models?: unknown }).models = {
      list: () =>
        (async function* () {
          for (const model of models) yield model;
        })(),
    };
    return client;
  };

  it('нові id додаються в кінець, статичні лишаються, ціна невідомої — null; результат зберігається', async () => {
    const saved: unknown[] = [];
    const client = liveClient([
      { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', max_input_tokens: 1_000_000, max_tokens: 128_000 },
      { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', max_input_tokens: 1_000_000, max_tokens: 128_000 },
      { id: 'claude-opus-6', display_name: 'Claude Opus 6', max_input_tokens: 2_000_000, max_tokens: 128_000 },
    ]);
    const anthropic = new AnthropicProvider({
      getApiKey: () => null,
      client,
      saveCatalogue: (value) => saved.push(value),
      now: () => Date.parse('2026-10-02T10:00:00.000Z'),
    });

    expect(anthropic.catalogueUpdatedAt()).toBeNull();
    await anthropic.refreshModels();

    const infos = anthropic.listModelInfo();
    expect(infos.map((info) => info.id)).toEqual([
      'claude-opus-5-5',
      'claude-fable-5-1',
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-haiku-4-5',
      'claude-sonnet-5-5',
      'claude-opus-6',
    ]);
    // Ціна Sonnet 5.5 є лише в таблиці (id не перевірено) — спрацьовує, бо API його повернув.
    expect(infos.find((info) => info.id === 'claude-sonnet-5-5')).toMatchObject({
      inputPerMTok: 2,
      recommended: false,
      tier: 'balanced',
    });
    expect(infos.find((info) => info.id === 'claude-opus-6')).toMatchObject({
      label: 'Claude Opus 6',
      contextWindow: 2_000_000,
      inputPerMTok: null,
      outputPerMTok: null,
      tier: 'top',
    });
    expect(anthropic.catalogueUpdatedAt()).toBe('2026-10-02T10:00:00.000Z');
    expect(saved).toHaveLength(1);

    // Новий екземпляр піднімає збережений список без мережі.
    const restored = new AnthropicProvider({ getApiKey: () => null, client, loadCatalogue: () => saved[0] });
    expect(restored.models).toContain('claude-opus-6');
  });

  it('без ключа оновлення неможливе — типізована помилка', async () => {
    await expect(new AnthropicProvider({ getApiKey: () => null }).refreshModels()).rejects.toMatchObject({
      kind: 'not_configured',
    });
  });

  it('зіпсований збережений каталог ігнорується', () => {
    const anthropic = new AnthropicProvider({ getApiKey: () => null, loadCatalogue: () => ({ version: 7 }) });
    expect(anthropic.models).toHaveLength(5);
    expect(anthropic.catalogueUpdatedAt()).toBeNull();
  });
});

describe('complete — без примусового tool_choice (Opus 5.5 / Fable 5.1)', () => {
  const finding = {
    clause_no: '10.3',
    verdict: 'partial',
    severity: 'minor',
    confidence: 0.8,
    rationale: 'Programme documented, frequency missing.',
    evidence: [{ quote: 'Monitoring devices are numbered and shown on a site map.' }],
  };
  const textOnly = message({
    model: 'claude-opus-5-5',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'Section 10 looks fine overall.', citations: null }],
  });
  const withTool = message({
    model: 'claude-opus-5-5',
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: 't1', name: 'report_finding', input: finding }],
  });

  /** Клієнт, що віддає відповіді по черзі — щоб відтворити «текст, потім інструмент». */
  function sequenceClient(replies: unknown[]): { client: AnthropicClientLike; calls: Array<Record<string, unknown>> } {
    const calls: Array<Record<string, unknown>> = [];
    const next = (params: unknown) => {
      calls.push(params as Record<string, unknown>);
      return replies[Math.min(calls.length - 1, replies.length - 1)];
    };
    const client = {
      messages: {
        create: async (params: unknown) => next(params),
        parse: async (params: unknown) => next(params),
        stream: (params: unknown) => {
          const reply = next(params);
          return { finalMessage: async () => reply };
        },
      },
    };
    return { client: client as unknown as AnthropicClientLike, calls };
  }

  const lastUserText = (params: Record<string, unknown>): string => {
    const messages = params.messages as Array<{ role: string; content: unknown }>;
    const last = [...messages].reverse().find((m) => m.role === 'user');
    const content = last?.content;
    if (typeof content === 'string') return content;
    return (content as Array<{ type: string; text?: string }>).map((b) => b.text ?? '').join('');
  };

  it('текст замість виклику → один повтор із прямою вимогою, usage обох спроб', async () => {
    const { client, calls } = sequenceClient([textOnly, withTool]);
    const result = await provider(client).complete(
      buildRequest(judgeV1, judgeInput, { model: 'claude-opus-5-5' }),
      signal(),
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]?.tool_choice).toEqual({ type: 'auto' });
    expect(lastUserText(calls[0]!)).not.toContain('Respond only by calling');
    expect(lastUserText(calls[1]!)).toContain('Respond only by calling the `report_finding` tool');
    expect(result.data).toHaveLength(1);
    expect(result.usage).toEqual({ input: 240, cachedInput: 76_000, cacheWrite: 0, output: 90 });
  });

  it('і після повтору без виклику → LlmSchemaError, а не «порожній батч»', async () => {
    const { client, calls } = sequenceClient([textOnly, textOnly]);
    await expect(
      provider(client).complete(buildRequest(judgeV1, judgeInput, { model: 'claude-fable-5-1' }), signal()),
    ).rejects.toBeInstanceOf(LlmSchemaError);
    expect(calls).toHaveLength(2);
  });

  it('з примусовим tool_choice (Opus 5) не повторює: порожня відповідь — одразу помилка', async () => {
    const { client, calls } = sequenceClient([textOnly]);
    await expect(
      provider(client).complete(buildRequest(judgeV1, judgeInput, { model: 'claude-opus-5' }), signal()),
    ).rejects.toBeInstanceOf(LlmSchemaError);
    expect(calls).toHaveLength(1);
  });

  it('Haiku 4.5 без роздумів: малий max_tokens лишається, іде parse без стріму', async () => {
    const { client, calls } = sequenceClient([
      message({ content: [{ type: 'text', text: '{"clauses":[]}', citations: null }], parsed_output: { clauses: [] } }),
    ]);
    await provider(client).complete(
      buildRequest(clauseExtractV1, clauseExtractInput, { model: 'claude-haiku-4-5', maxOutputTokens: 4_000 }),
      signal(),
    );
    expect(calls[0]?.max_tokens).toBe(4_000);
    expect(calls[0]?.thinking).toBeUndefined();
  });
});
