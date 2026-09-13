/**
 * Тіло запиту до Anthropic перевіряється на замоканому клієнті SDK.
 * Жодних мережевих викликів і жодних ключів API.
 */

import { describe, expect, it } from 'vitest';
import { DOC_TEXT, clauseExtractInput, judgeInput } from './__fixtures__/samples';
import { LlmRefusalError, LlmSchemaError, LlmUnsupportedError } from './errors';
import { clauseExtractV1, judgeV1 } from './prompts';
import { AnthropicProvider, type AnthropicClientLike } from './providers/anthropic';
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

    expect(calls[0]?.method).toBe('parse');
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

    expect(calls[0]?.method).toBe('create');
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
