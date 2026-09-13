/**
 * Локальний провайдер. Мережі немає: `fetchImpl` — заглушка,
 * яка повертає заздалегідь заготовлені тіла відповідей.
 */

import { describe, expect, it } from 'vitest';
import { LlmSchemaError } from './errors';
import { clauseExtractInput, judgeInput } from './__fixtures__/samples';
import { clauseExtractV1, judgeV1 } from './prompts';
import { OpenAiCompatibleProvider, type FetchLike } from './providers/openaiCompatible';
import { buildRequest } from './request';

interface Recorded {
  url: string;
  body: Record<string, unknown>;
}

function stubFetch(bodies: string[]): { fetchImpl: FetchLike; calls: Recorded[] } {
  const calls: Recorded[] = [];
  let index = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    const content = bodies[Math.min(index, bodies.length - 1)] ?? '';
    index += 1;
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        choices: [{ message: { content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      text: async () => content,
    } as unknown as Response;
  };
  return { fetchImpl, calls };
}

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

const make = (fetchImpl: FetchLike, over: Record<string, unknown> = {}): OpenAiCompatibleProvider =>
  new OpenAiCompatibleProvider({
    id: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1/',
    model: 'qwen3:14b',
    fetchImpl,
    ...over,
  });

const signal = (): AbortSignal => new AbortController().signal;

describe('caps', () => {
  it('без citations, без caching, мале вікно, локальний', () => {
    const { fetchImpl } = stubFetch([VALID_CLAUSES]);
    const provider = make(fetchImpl);
    expect(provider.caps.citations).toBe(false);
    expect(provider.caps.promptCaching).toBe(false);
    expect(provider.caps.structuredOutput).toBe('json_mode');
    expect(provider.caps.contextWindow).toBeLessThanOrEqual(32_768);
    expect(provider.caps.cloud).toBe(false);
    expect(provider.caps.documentInput).toEqual(['text']);
    expect(provider.isConfigured()).toBe(true);
  });
});

describe('тіло запиту', () => {
  it('POST на /chat/completions із json_object і temperature 0', async () => {
    const { fetchImpl, calls } = stubFetch([VALID_CLAUSES]);
    await make(fetchImpl).complete(buildRequest(clauseExtractV1, clauseExtractInput), signal());

    expect(calls[0]?.url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect(calls[0]?.body.response_format).toEqual({ type: 'json_object' });
    expect(calls[0]?.body.temperature).toBe(0);
    expect(calls[0]?.body.model).toBe('qwen3:14b');
    expect(calls[0]?.body.stream).toBe(false);
  });

  it('JSON Schema підставляється в системне повідомлення', async () => {
    const { fetchImpl, calls } = stubFetch([VALID_CLAUSES]);
    await make(fetchImpl).complete(buildRequest(clauseExtractV1, clauseExtractInput), signal());
    const messages = calls[0]?.body.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('must validate against this JSON Schema');
    expect(messages[0]?.content).toContain('requirementText');
    expect(messages[1]?.role).toBe('user');
  });

  it('citations-документ деградує до тексту в системному блоці', async () => {
    const { fetchImpl, calls } = stubFetch([VALID_CLAUSES]);
    const req = buildRequest(clauseExtractV1, clauseExtractInput, {
      documents: [
        {
          name: 'sop.txt',
          mime: 'text/plain',
          base64: Buffer.from('Pest control logbook is kept.', 'utf8').toString('base64'),
          citations: true,
        },
      ],
    });
    await make(fetchImpl).complete(req, signal());
    const messages = calls[0]?.body.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain('Pest control logbook is kept.');
  });
});

describe('retry-repair', () => {
  it('повертає помилку Zod у промпт наступної спроби і зрештою успішний', async () => {
    const { fetchImpl, calls } = stubFetch(['{"clauses":"nope"}', VALID_CLAUSES]);
    const result = await make(fetchImpl).complete(
      buildRequest(clauseExtractV1, clauseExtractInput),
      signal(),
    );

    expect(calls).toHaveLength(2);
    expect(result.data.clauses[0]?.clauseNo).toBe('10.3');
    // Токени сумуються по всіх спробах.
    expect(result.usage.input).toBe(20);
    expect(result.usage.output).toBe(10);

    const second = calls[1]?.body.messages as Array<{ role: string; content: string }>;
    expect(second).toHaveLength(4);
    expect(second[2]?.role).toBe('assistant');
    expect(second[3]?.content).toContain('rejected by the schema validator');
    expect(second[3]?.content).toContain('clauses');
  });

  it('не валідний JSON також іде в repair', async () => {
    const { fetchImpl, calls } = stubFetch(['not json at all', VALID_CLAUSES]);
    await make(fetchImpl).complete(buildRequest(clauseExtractV1, clauseExtractInput), signal());
    const second = calls[1]?.body.messages as Array<{ role: string; content: string }>;
    expect(second[3]?.content).toContain('not valid JSON');
  });

  it('здається після 3 спроб із LlmSchemaError', async () => {
    const { fetchImpl, calls } = stubFetch(['{"clauses":1}']);
    await expect(
      make(fetchImpl).complete(buildRequest(clauseExtractV1, clauseExtractInput), signal()),
    ).rejects.toBeInstanceOf(LlmSchemaError);
    expect(calls).toHaveLength(3);
  });

  it('maxRepairAttempts: 1 вимикає repair', async () => {
    const { fetchImpl, calls } = stubFetch(['{"clauses":1}']);
    await expect(
      make(fetchImpl, { maxRepairAttempts: 1 }).complete(
        buildRequest(clauseExtractV1, clauseExtractInput),
        signal(),
      ),
    ).rejects.toBeInstanceOf(LlmSchemaError);
    expect(calls).toHaveLength(1);
  });
});

describe('батч-інструмент у JSON-режимі', () => {
  it('розгортає обгортку {"report_finding": [...]}', async () => {
    const findings = [
      {
        clause_no: '10.3',
        verdict: 'not_addressed',
        confidence: 0.9,
        rationale: 'Not covered by this SOP.',
        evidence: [],
      },
    ];
    const { fetchImpl, calls } = stubFetch([JSON.stringify({ report_finding: findings })]);
    const result = await make(fetchImpl).complete(buildRequest(judgeV1, judgeInput), signal());

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.clause_no).toBe('10.3');
    expect(result.citations).toEqual([]);
    const messages = calls[0]?.body.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain('"report_finding": [');
    expect(messages[0]?.content).toContain('report_finding');
  });
});
