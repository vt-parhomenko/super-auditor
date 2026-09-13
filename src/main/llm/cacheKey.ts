/**
 * Ключ кешу LLM-викликів (architecture.md §9).
 *
 *   cacheKey = sha256([stage, promptVersion, modelId, sha256(canonicalJson(input))].join('|'))
 *
 * Канонізація з РЕКУРСИВНИМ сортуванням ключів обов'язкова: несортований JSON —
 * типова причина промахів кешу, бо той самий вхід дає інший рядок.
 */

import { createHash } from 'node:crypto';

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Детермінований JSON: ключі об'єктів відсортовані рекурсивно, порядок
 * елементів масиву збережено (він змістовний), `undefined` викинуто.
 */
export function canonicalJson(value: unknown): string {
  return stringify(value);
}

function stringify(value: unknown): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'undefined':
      return 'null';
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      // NaN/Infinity не мають JSON-представлення — нормалізуємо в null,
      // інакше JSON.stringify мовчки зробить те саме, але непередбачувано.
      return Number.isFinite(value) ? JSON.stringify(value) : 'null';
    case 'bigint':
      return JSON.stringify(value.toString());
    case 'string':
      return JSON.stringify(value);
    case 'function':
    case 'symbol':
      return 'null';
    default:
      break;
  }

  if (value instanceof Date) return JSON.stringify(value.toISOString());

  if (Array.isArray(value)) {
    return `[${value.map((item) => stringify(item)).join(',')}]`;
  }

  if (value instanceof Set) {
    // Множина невпорядкована — сортуємо канонічні представлення елементів.
    const items = [...value].map((item) => stringify(item)).sort();
    return `[${items.join(',')}]`;
  }

  if (value instanceof Map) {
    const entries = [...value.entries()]
      .map(([k, v]) => [stringify(String(k)), stringify(v)] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return `{${entries.map(([k, v]) => `${k}:${v}`).join(',')}}`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined && typeof record[key] !== 'function')
    .sort();
  const parts = keys.map((key) => `${JSON.stringify(key)}:${stringify(record[key])}`);
  return `{${parts.join(',')}}`;
}

export interface CacheKeyParts {
  stage: string;
  promptVersion: string;
  model: string;
  input: unknown;
}

export function buildCacheKey(parts: CacheKeyParts): string {
  const inputHash = sha256Hex(canonicalJson(parts.input));
  return sha256Hex([parts.stage, parts.promptVersion, parts.model, inputHash].join('|'));
}
