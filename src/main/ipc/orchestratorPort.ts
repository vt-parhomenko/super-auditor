/**
 * Вузький порт до оркестратора прогонів (`@main/pipeline/orchestrator`).
 *
 * Шар IPC не знає, як влаштований оркестратор, і не імпортує його напряму:
 * інакше кожен тест хендлерів тягнув би за собою весь конвеєр, а два модулі
 * не можна було б писати паралельно. Реалізація підключається один раз
 * у `main/index.ts` через `setOrchestrator`.
 *
 * Поки реалізації немає, канали прогону кидають зрозумілий `INTERNAL`,
 * а не «undefined is not a function».
 */

import type { DocProfileDto, RunConfig } from '@shared/domain';
import type { ExportFormat } from '@shared/ipc';
import { internal } from './errors';

export interface RunEstimate {
  tasks: number;
  inputTokens: number;
  costUsd: number;
}

export interface RunOrchestrator {
  /** Stage 1: LLM-екстракт реєстру вимог. Повертає id фонового завдання (прогону). */
  extractClauses(specVersionId: number): Promise<number>;
  /** Stage 2: профіль версії документа. */
  buildDocProfile(documentVersionId: number): Promise<DocProfileDto>;
  /** Оцінка вартості до старту (count_tokens), без жодного платного виклику. */
  estimateRun(config: RunConfig): Promise<RunEstimate>;
  /** Створює прогін і запускає його. Повертає `audit_run.id`. */
  startRun(config: RunConfig): Promise<number>;
  pauseRun(runId: number): Promise<void>;
  resumeRun(runId: number): Promise<void>;
  cancelRun(runId: number): Promise<void>;
  /** Stage 6: експорт результатів. Повертає абсолютний шлях до файлу. */
  exportRun(runId: number, format: ExportFormat): Promise<{ path: string }>;
}

let current: RunOrchestrator | null = null;

export function setOrchestrator(impl: RunOrchestrator | null): void {
  current = impl;
}

export function hasOrchestrator(): boolean {
  return current !== null;
}

/** Поточна реалізація або зрозуміла помилка. */
export function requireOrchestrator(): RunOrchestrator {
  if (!current) {
    throw internal(
      'Оркестратор ще не підключено — операції прогону недоступні в цій збірці',
      { port: 'orchestrator' },
    );
  }
  return current;
}
