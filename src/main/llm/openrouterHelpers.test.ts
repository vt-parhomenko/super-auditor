/**
 * Чисті хелпери OpenRouter: розбір SSE, строга JSON Schema, прибирання null.
 * Без мережі й без провайдера.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { reportFindingTool, reportFindingToolV2 } from './prompts';
import { strictifySchema, stripOptionalNulls, type JsonSchema } from './providers/jsonSchema';
import { SseParser } from './providers/sse';

describe('SseParser', () => {
  it('ігнорує коментарі `: OPENROUTER PROCESSING` і віддає data-події', () => {
    const parser = new SseParser();
    const events = parser.feed(': OPENROUTER PROCESSING\n\ndata: {"a":1}\n\n: OPENROUTER PROCESSING\n\ndata: [DONE]\n\n');
    expect(events).toEqual(['{"a":1}', '[DONE]']);
  });

  it('збирає подію, розірвану між чанками, у тому числі посеред \\r\\n', () => {
    const parser = new SseParser();
    const out = [
      ...parser.feed('da'),
      ...parser.feed('ta: {"text":"hel'),
      ...parser.feed('lo"}\r'),
      ...parser.feed('\n\r\n'),
      ...parser.feed('data: x\n'),
    ];
    expect(out).toEqual(['{"text":"hello"}']);
    expect(parser.flush()).toEqual(['x']);
  });

  it('склеює кілька data: однієї події через \\n і пропускає event:/id:', () => {
    const parser = new SseParser();
    expect(parser.feed('event: message\nid: 7\ndata: line1\ndata:line2\n\n')).toEqual(['line1\nline2']);
  });
});

describe('strictifySchema', () => {
  it('усі ключі обовʼязкові, необовʼязкові стають nullable; additionalProperties: false скрізь', () => {
    const strict = strictifySchema(reportFindingTool.inputSchema as JsonSchema);
    expect(strict.required).toEqual([
      'clause_no',
      'verdict',
      'severity',
      'confidence',
      'rationale',
      'evidence',
      'gap',
      'recommendation',
    ]);
    expect(strict.additionalProperties).toBe(false);

    const props = strict.properties as Record<string, JsonSchema>;
    expect(props.clause_no).toEqual({ type: 'string' });
    expect(props.gap?.type).toEqual(['string', 'null']);
    // Перелічення стає nullable лише обгорткою anyOf — null усередині enum разом із
    // type-масивом Anthropic відхиляв («400 Provider returned error» на кожному судженні).
    expect(props.severity?.enum).toBeUndefined();
    expect(props.severity?.anyOf).toEqual([
      { type: 'string', enum: ['critical', 'major', 'minor', 'recommendation', 'none'] },
      { type: 'null' },
    ]);
    expect(JSON.stringify(props.severity)).not.toContain('null,');
    expect(props.verdict?.enum).not.toContain(null);

    const evidenceItem = (props.evidence?.items ?? {}) as JsonSchema;
    expect(evidenceItem.additionalProperties).toBe(false);
    expect(evidenceItem.required).toEqual(['quote', 'page']);
    expect((evidenceItem.properties as Record<string, JsonSchema>).page?.type).toEqual(['integer', 'null']);
  });

  it('judge.v2: outside_evidence стає обовʼязковим nullable-рядком, а null потім прибирається', () => {
    const strict = strictifySchema(reportFindingToolV2.inputSchema as JsonSchema);
    expect(strict.required).toContain('outside_evidence');
    const props = strict.properties as Record<string, JsonSchema>;
    expect(props.outside_evidence).toEqual({
      type: ['string', 'null'],
      description:
        'What must be verified outside this document — records, on-site observation — according to the clause markers and legend. Omit when nothing.',
    });
    // Решта схеми — як у v1: нове поле нічого не зламало у строгій копії.
    expect(props.severity).toEqual(
      (strictifySchema(reportFindingTool.inputSchema as JsonSchema).properties as Record<string, JsonSchema>).severity,
    );

    const finding = {
      clause_no: '10.3',
      verdict: 'compliant',
      confidence: 0.9,
      rationale: 'x',
      evidence: [],
    };
    const schema = reportFindingToolV2.inputSchema as JsonSchema;
    // Модель у строгому режимі мусить повернути поле — `null`, коли перевіряти нічого.
    expect(stripOptionalNulls({ ...finding, outside_evidence: null }, schema)).toEqual(finding);
    expect(stripOptionalNulls({ ...finding, outside_evidence: 'Check records.' }, schema)).toEqual({
      ...finding,
      outside_evidence: 'Check records.',
    });
  });

  it('відкидає ключові слова, які строгі режими не приймають', () => {
    const source = z.toJSONSchema(
      z.object({
        name: z.string().min(1).max(10).describe('Name'),
        count: z.number().int().min(0).optional(),
        email: z.email().optional(),
        tags: z.array(z.string()).min(1),
      }),
      { io: 'input' },
    ) as JsonSchema;
    const json = JSON.stringify(strictifySchema(source));
    for (const banned of ['$schema', 'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', '"format"', '"pattern"']) {
      expect(json).not.toContain(banned);
    }
    expect(json).toContain('"description":"Name"');
  });

  it('nullable-обʼєкт загортається в anyOf, а не ламає type', () => {
    const strict = strictifySchema({
      type: 'object',
      properties: { meta: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] } },
      required: [],
    });
    const meta = (strict.properties as Record<string, JsonSchema>).meta as JsonSchema;
    expect(meta.anyOf).toEqual([
      { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false },
      { type: 'null' },
    ]);
  });

  it('oneOf стає anyOf; вже nullable anyOf не дублює null', () => {
    const strict = strictifySchema({
      type: 'object',
      properties: {
        a: { oneOf: [{ type: 'string' }, { type: 'number' }] },
        b: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      },
      required: ['a'],
    });
    const props = strict.properties as Record<string, JsonSchema>;
    expect(props.a).toEqual({ anyOf: [{ type: 'string' }, { type: 'number' }] });
    expect(props.b).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
  });

  it('не змінює оригінал', () => {
    const original = JSON.stringify(reportFindingTool.inputSchema);
    strictifySchema(reportFindingTool.inputSchema as JsonSchema);
    expect(JSON.stringify(reportFindingTool.inputSchema)).toBe(original);
  });
});

describe('stripOptionalNulls', () => {
  const schema = reportFindingTool.inputSchema as JsonSchema;

  it('прибирає null лише там, де властивість була необовʼязковою', () => {
    const cleaned = stripOptionalNulls(
      {
        clause_no: '10.3',
        verdict: 'partial',
        severity: null,
        confidence: 0.7,
        rationale: 'x',
        evidence: [{ quote: 'q', page: null }],
        gap: null,
        recommendation: 'add frequency',
      },
      schema,
    );
    expect(cleaned).toEqual({
      clause_no: '10.3',
      verdict: 'partial',
      confidence: 0.7,
      rationale: 'x',
      evidence: [{ quote: 'q' }],
      recommendation: 'add frequency',
    });
  });

  it('обовʼязкове nullable-поле (z.nullable) лишає null — zod його приймає', () => {
    const source = z.toJSONSchema(
      z.object({ sectionNo: z.string().nullable(), topic: z.string().optional() }),
      { io: 'input' },
    ) as JsonSchema;
    expect(stripOptionalNulls({ sectionNo: null, topic: null }, source)).toEqual({ sectionNo: null });
  });

  it('йде крізь масиви, anyOf і $ref', () => {
    const source: JsonSchema = {
      type: 'array',
      items: { $ref: '#/$defs/Item' },
      $defs: {
        Item: {
          anyOf: [{ type: 'object', properties: { a: { type: 'string' } }, required: [] }, { type: 'null' }],
        },
      },
    };
    expect(stripOptionalNulls([{ a: null }, null], source)).toEqual([{}, null]);
  });
});
