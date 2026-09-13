/** Реєстр промптів: по файлу на етап (architecture.md §8). */

export * from './util';
export * from './clauseExtract.v1';
export * from './specSummary.v1';
export * from './docProfile.v1';
export * from './judge.v1';
export * from './critic.v1';

import type { Stage } from '@shared/domain';
import { clauseExtractV1 } from './clauseExtract.v1';
import { criticV1 } from './critic.v1';
import { docProfileV1 } from './docProfile.v1';
import { judgeV1 } from './judge.v1';
import { specSummaryV1 } from './specSummary.v1';

/** Активна версія промпта на кожен етап. Зміна = інвалідований кеш. */
export const CURRENT_PROMPTS = {
  clause_extract: clauseExtractV1,
  spec_summary: specSummaryV1,
  doc_profile: docProfileV1,
  judge: judgeV1,
  critic: criticV1,
} as const;

export const PROMPT_VERSIONS: Record<Stage, string> = {
  clause_extract: clauseExtractV1.version,
  spec_summary: specSummaryV1.version,
  doc_profile: docProfileV1.version,
  judge: judgeV1.version,
  critic: criticV1.version,
};
