import { describe, expect, it } from 'vitest';
import { CURRENT_PROMPTS } from './prompts';
import type { ToolSpec } from './types';

/**
 * Запобіжник проти помилки, яка вже одного разу поклала цілий прогін.
 *
 * Anthropic звужує підмножину JSON Schema, дозволену в `tools[].input_schema`.
 * Схема з `confidence: { type: 'number', minimum: 0, maximum: 1 }` давала:
 *
 *   400 invalid_request_error
 *   tools.0.custom: For 'number' type, properties maximum, minimum are not supported
 *
 * Помилка виявляється ТІЛЬКИ на живому виклику: локально схема валідна, zod
 * її приймає, тести на промптах проходять. 24 з 24 завдань впали, а прогін
 * показав «Завершено». Тому перевіряємо схеми статично.
 *
 * Обмеження діапазонів задаємо словами в `description`, а зрізаємо на боці zod.
 */

/** Ключові слова, які Anthropic відхиляє в схемі інструмента. */
const FORBIDDEN: Record<string, string> = {
  minimum: 'числові межі не підтримуються — опиши діапазон у description',
  maximum: 'числові межі не підтримуються — опиши діапазон у description',
  exclusiveMinimum: 'числові межі не підтримуються',
  exclusiveMaximum: 'числові межі не підтримуються',
  multipleOf: 'кратність не підтримується',
};

interface Violation {
  path: string;
  keyword: string;
  hint: string;
}

function findViolations(node: unknown, path = '$'): Violation[] {
  if (Array.isArray(node)) {
    return node.flatMap((item, i) => findViolations(item, `${path}[${i}]`));
  }
  if (node === null || typeof node !== 'object') return [];

  const out: Violation[] = [];
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const hint = FORBIDDEN[key];
    if (hint) out.push({ path, keyword: key, hint });
    out.push(...findViolations(value, `${path}.${key}`));
  }
  return out;
}

function toolsInUse(): ToolSpec[] {
  return Object.values(CURRENT_PROMPTS)
    .map((prompt) => prompt.tool)
    .filter((tool): tool is ToolSpec => tool !== undefined);
}

describe('схеми інструментів сумісні з Anthropic', () => {
  it('у проекті є хоча б один інструмент — інакше тест нічого не стереже', () => {
    expect(toolsInUse().length).toBeGreaterThan(0);
  });

  it.each(toolsInUse().map((tool) => [tool.name, tool] as const))(
    '%s не містить заборонених ключових слів',
    (_name, tool) => {
      const violations = findViolations(tool.inputSchema);
      expect(
        violations,
        violations.map((v) => `${v.path}.${v.keyword} — ${v.hint}`).join('\n'),
      ).toEqual([]);
    },
  );

  it('strict-схема вимагає additionalProperties: false і required на верхньому рівні', () => {
    for (const tool of toolsInUse()) {
      const schema = tool.inputSchema as Record<string, unknown>;
      expect(schema['additionalProperties'], tool.name).toBe(false);
      expect(Array.isArray(schema['required']), tool.name).toBe(true);
    }
  });

  it('сам детектор ловить порушення (перевірка перевірки)', () => {
    const bad = {
      type: 'object',
      properties: { score: { type: 'number', minimum: 0, maximum: 1 } },
    };
    const found = findViolations(bad);

    expect(found.map((v) => v.keyword).sort()).toEqual(['maximum', 'minimum']);
    expect(found[0]?.path).toBe('$.properties.score');
  });
});

describe('confidence зрізається, а не відкидає батч', () => {
  const schema = CURRENT_PROMPTS.judge.schema;

  const finding = (confidence: number) => [
    {
      clause_no: '10.1',
      verdict: 'compliant',
      confidence,
      rationale: 'ok',
      evidence: [{ quote: 'q' }],
    },
  ];

  it('значення поза діапазоном зрізається до меж', () => {
    expect(schema.parse(finding(1.05))[0]?.confidence).toBe(1);
    expect(schema.parse(finding(-0.2))[0]?.confidence).toBe(0);
  });

  it('нормальне значення не змінюється', () => {
    expect(schema.parse(finding(0.85))[0]?.confidence).toBe(0.85);
  });
});
