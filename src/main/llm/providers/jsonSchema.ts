/**
 * JSON Schema для structured output через OpenAI-подібні API (OpenRouter).
 *
 * Строгі режими (OpenAI strict, Anthropic structured outputs, Gemini…)
 * вимагають однакового: у кожного об'єкта `additionalProperties: false` і ВСІ
 * ключі в `required`, а частину ключових слів (`format`, `minLength`,
 * `minimum`…) відхиляють або ігнорують. Тому:
 *  - `strictifySchema` робить строгу копію: необовʼязкові властивості стають
 *    обовʼязковими, але nullable — модель повертає `null` замість пропуску;
 *  - `stripOptionalNulls` після відповіді прибирає ці `null` там, де в
 *    ОРИГІНАЛЬНІЙ схемі властивість була необовʼязковою: zod `.optional()`
 *    не приймає `null`, і без цього кроку кожна відповідь падала б у repair.
 *
 * Обмеження, викинуті зі строгої схеми, нікуди не діваються: відповідь
 * однаково проходить zod-валідацію повної схеми.
 */

export type JsonSchema = Record<string, unknown>;

/** Ключові слова, які строга схема зберігає. Решта (format, pattern, min*, max*, default…) відкидаються. */
const KEPT_KEYWORDS = new Set(['description', 'enum', 'const', 'type', 'properties', 'items', 'required', 'anyOf', '$defs', '$ref']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Строга копія схеми. Оригінал не змінюється. */
export function strictifySchema(schema: JsonSchema): JsonSchema {
  return strictifyNode(schema) as JsonSchema;
}

function strictifyNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictifyNode);
  if (!isRecord(node)) return node;

  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'oneOf') {
      // Строгі режими знають anyOf, але не oneOf; для валідації різниці нема —
      // остаточне слово однаково за zod.
      out.anyOf = (Array.isArray(value) ? value : []).map(strictifyNode);
      continue;
    }
    if (!KEPT_KEYWORDS.has(key)) continue;
    switch (key) {
      case 'properties':
      case 'required':
        break; // нижче, разом з усім об'єктом
      case 'items':
        out.items = strictifyNode(value);
        break;
      case 'anyOf':
        out.anyOf = (Array.isArray(value) ? value : []).map(strictifyNode);
        break;
      case '$defs':
        out.$defs = isRecord(value)
          ? Object.fromEntries(Object.entries(value).map(([name, def]) => [name, strictifyNode(def)]))
          : value;
        break;
      default:
        out[key] = value;
    }
  }

  const isObject = node.type === 'object' || isRecord(node.properties);
  if (isObject) {
    const properties = isRecord(node.properties) ? node.properties : {};
    const required = new Set(Array.isArray(node.required) ? node.required.filter((k): k is string => typeof k === 'string') : []);
    const strictProps: JsonSchema = {};
    for (const [name, child] of Object.entries(properties)) {
      const strictChild = strictifyNode(child);
      strictProps[name] = required.has(name) ? strictChild : makeNullable(strictChild);
    }
    out.type = 'object';
    out.properties = strictProps;
    out.required = Object.keys(properties);
    out.additionalProperties = false;
  }

  return out;
}

/** Схема, що додатково приймає `null`. */
function makeNullable(node: unknown): unknown {
  if (!isRecord(node)) return { anyOf: [node, { type: 'null' }] };

  if (Array.isArray(node.anyOf)) {
    const hasNull = node.anyOf.some((branch) => isRecord(branch) && branch.type === 'null');
    return hasNull ? node : { ...node, anyOf: [...node.anyOf, { type: 'null' }] };
  }

  if (typeof node.type === 'string' && node.type !== 'object' && node.$ref === undefined && node.const === undefined) {
    if (node.type === 'null') return node;
    const next: JsonSchema = { ...node, type: [node.type, 'null'] };
    // enum без null відкинув би null навіть при type: [..., 'null'].
    if (Array.isArray(node.enum) && !node.enum.includes(null)) next.enum = [...node.enum, null];
    return next;
  }

  if (Array.isArray(node.type) && node.$ref === undefined && node.const === undefined && !isObjectType(node)) {
    if (node.type.includes('null')) return node;
    const next: JsonSchema = { ...node, type: [...node.type, 'null'] };
    if (Array.isArray(node.enum) && !node.enum.includes(null)) next.enum = [...node.enum, null];
    return next;
  }

  // Об'єкти, $ref і const — обгорткою: так строгі режими розуміють найнадійніше.
  const { description, ...rest } = node;
  const wrapped: JsonSchema = { anyOf: [rest, { type: 'null' }] };
  if (description !== undefined) wrapped.description = description;
  return wrapped;
}

function isObjectType(node: JsonSchema): boolean {
  return Array.isArray(node.type) && node.type.includes('object');
}

/**
 * Прибирає `null` у властивостей, необовʼязкових в ОРИГІНАЛЬНІЙ схемі.
 * Йде значенням і схемою паралельно; невідомі гілки лишає як є.
 */
export function stripOptionalNulls(value: unknown, schema: JsonSchema, root: JsonSchema = schema): unknown {
  const node = resolveRef(schema, root);
  if (!node) return value;

  if (Array.isArray(value)) {
    const items = node.items;
    if (isRecord(items)) return value.map((item) => stripOptionalNulls(item, items, root));
    const branch = pickBranch(node, 'array', root);
    return branch ? stripOptionalNulls(value, branch, root) : value;
  }

  if (isRecord(value)) {
    if (!isRecord(node.properties)) {
      const branch = pickBranch(node, 'object', root);
      return branch ? stripOptionalNulls(value, branch, root) : value;
    }
    const properties = node.properties;
    const required = new Set(Array.isArray(node.required) ? node.required : []);
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const childSchema = properties[key];
      if (child === null && !required.has(key) && childSchema !== undefined) continue;
      out[key] = isRecord(childSchema) ? stripOptionalNulls(child, childSchema, root) : child;
    }
    return out;
  }

  return value;
}

function resolveRef(node: JsonSchema, root: JsonSchema): JsonSchema | null {
  let current: JsonSchema = node;
  for (let depth = 0; depth < 16 && typeof current.$ref === 'string'; depth += 1) {
    const match = /^#\/(\$defs|definitions)\/(.+)$/.exec(current.$ref);
    if (!match) return null;
    const defs = root[match[1] ?? '$defs'];
    const target = isRecord(defs) ? defs[decodeURIComponent(match[2] ?? '')] : undefined;
    if (!isRecord(target)) return null;
    current = target;
  }
  return current;
}

/** Перша гілка anyOf/oneOf, що описує масив або об'єкт. */
function pickBranch(node: JsonSchema, kind: 'array' | 'object', root: JsonSchema): JsonSchema | null {
  const branches = Array.isArray(node.anyOf) ? node.anyOf : Array.isArray(node.oneOf) ? node.oneOf : [];
  for (const branch of branches) {
    if (!isRecord(branch)) continue;
    const resolved = resolveRef(branch, root);
    if (!resolved) continue;
    const type = resolved.type;
    const matches =
      type === kind ||
      (Array.isArray(type) && type.includes(kind)) ||
      (kind === 'object' && isRecord(resolved.properties)) ||
      (kind === 'array' && isRecord(resolved.items));
    if (matches) return resolved;
  }
  return null;
}
