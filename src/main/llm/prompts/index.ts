/** Реєстр промптів: по файлу на етап (architecture.md §8). */

export * from './util';
export * from './clauseExtract.v1';
export * from './clauseExtract.v2';
export * from './markerLegend.v1';
export * from './specSummary.v1';
export * from './docProfile.v1';
export * from './judge.v1';
export * from './judge.v2';
export * from './critic.v1';
export * from './critic.v2';

import type { Stage } from '@shared/domain';
import { clauseExtractV2 } from './clauseExtract.v2';
import { criticV2 } from './critic.v2';
import { docProfileV1 } from './docProfile.v1';
import { judgeV2 } from './judge.v2';
import { specSummaryV1 } from './specSummary.v1';

/**
 * Активна версія промпта на кожен етап. Зміна = інвалідований кеш.
 *
 * `clause_extract.v1`, `judge.v1` і `critic.v1` лишаються у файлах для історії
 * (ними побудовано старі реєстри й прогони — їхня версія записана в
 * `prompt_version`), але не використовуються. Допоміжний `marker_legend.v1`
 * належить тому ж етапу `clause_extract` і живе поза цим переліком: етап —
 * ключ, а на етап тут рівно один основний промпт.
 */
export const CURRENT_PROMPTS = {
  clause_extract: clauseExtractV2,
  spec_summary: specSummaryV1,
  doc_profile: docProfileV1,
  judge: judgeV2,
  critic: criticV2,
} as const;

export const PROMPT_VERSIONS: Record<Stage, string> = {
  clause_extract: clauseExtractV2.version,
  spec_summary: specSummaryV1.version,
  doc_profile: docProfileV1.version,
  judge: judgeV2.version,
  critic: criticV2.version,
};
