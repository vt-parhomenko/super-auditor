/**
 * Публічний API шару LLM.
 *
 * Правило: решта main-процесу імпортує тільки звідси —
 * `import { ... } from '@main/llm'`.
 */

// Контракти й помилки
export * from './types';
export * from './errors';

// Вартість, кеш, детермінізм
export * from './cost';
export * from './cacheKey';
export * from './cache';
export * from './request';

// Верифікація доказів (Stage 5)
export * from './verifyEvidence';

// Провайдери й маршрутизація
export * from './providers/anthropic';
export * from './providers/openaiCompatible';
export * from './registry';

// Промпти
export * from './prompts';
