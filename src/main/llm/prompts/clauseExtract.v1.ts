/**
 * Stage 1 — посторінковий екстракт реєстру вимог із табличного PDF.
 *
 * Найкритичніший етап конвеєра: кривий реєстр робить усе далі безглуздим,
 * і на етапі findings це помітити неможливо (architecture.md §6 Stage 1).
 * Citations тут не потрібні — беремо звичайний structured output.
 */

import { z } from 'zod';
import { MODULES, OBLIGATIONS } from '@shared/domain';
import type { PromptDef } from '../types';
import { joinBlocks, tag } from './util';

export interface ClauseExtractInput {
  specName: string;
  specVersion: string;
  /** 1-індексований номер сторінки. */
  pageNo: number;
  /** Хвіст попередньої сторінки (~500 символів) — щоб побачити перенесену вимогу. */
  prevTail?: string;
  pageText: string;
  /** Голова наступної сторінки (~500 символів). */
  nextHead?: string;
}

export const clauseExtractItemSchema = z.object({
  clauseNo: z.string().min(1).describe('Clause number exactly as printed, e.g. "10.3".'),
  sectionNo: z.string().nullable().describe('Leading part of the clause number, e.g. "10".'),
  sectionTitle: z.string().nullable().describe('Section heading, e.g. "Pest management".'),
  topic: z.string().nullable().describe('Short topic from the Topic column.'),
  requirementText: z
    .string()
    .min(1)
    .describe('Verbatim requirement text. Bullet lines start with "- ". Never summarised.'),
  modules: z
    .array(z.enum(MODULES))
    .describe('Applicability flags printed before the clause number: P, R, O.'),
  obligation: z
    .enum(OBLIGATIONS)
    .nullable()
    .describe('"must" if the requirement is mandatory, "should"/"may" otherwise.'),
  truncated: z
    .boolean()
    .describe('true if the requirement continues from the previous page or onto the next one.'),
});

export const clauseExtractSchema = z.object({
  clauses: z.array(clauseExtractItemSchema),
});

export type ClauseExtractItem = z.infer<typeof clauseExtractItemSchema>;
export type ClauseExtractOutput = z.infer<typeof clauseExtractSchema>;

const SYSTEM = `Extract clause definitions from one page of a customer standard.

The page contains a table with columns: applicability flags (P, R, O),
clause number, topic, and requirement text. Column boundaries are lost in the
extracted text — reconstruct them.

Rules:
- Requirement text is verbatim. Preserve bullet lists as "- " lines. Do not summarise.
- Flags appear before the clause number: "P R  1.3" → modules ["P","R"].
  A blank position means that module does not apply.
- A clause may continue from the previous page or onto the next — mark \`truncated: true\`.
- Ignore page headers, footers, and copyright notices.
- If the page contains no clause table, return an empty array.
- \`sectionNo\` is the part of the clause number before the first dot ("10.3" → "10").
  \`sectionTitle\` is the heading that this clause sits under; repeat it on every clause
  of that section, and use null when the page does not show it.
- \`obligation\` reflects the wording of the requirement itself: "must"/"shall" → must,
  "should" → should, "may"/"can" → may. Use null if the clause states no obligation verb.
- Return clauses in the order they appear on the page. Never invent a clause number
  that is not printed on the page.`;

export const clauseExtractV1: PromptDef<ClauseExtractInput, ClauseExtractOutput> = {
  version: 'clause_extract.v1',
  stage: 'clause_extract',
  system: SYSTEM,
  schema: clauseExtractSchema,
  maxOutputTokens: 8_000,
  effort: 'medium',

  buildUser(input) {
    return joinBlocks(
      `Standard: ${input.specName} v${input.specVersion}. Page ${input.pageNo}.`,
      input.prevTail
        ? tag('previous_page_tail', {}, input.prevTail)
        : null,
      tag('page', { no: input.pageNo }, input.pageText),
      input.nextHead ? tag('next_page_head', {}, input.nextHead) : null,
      'Extract every clause whose row starts on this page. Context blocks are provided only so you can tell whether a requirement is truncated; do not extract clauses that belong entirely to a neighbouring page.',
    );
  },

  cacheInput(input) {
    return {
      specName: input.specName,
      specVersion: input.specVersion,
      pageNo: input.pageNo,
      prevTail: input.prevTail ?? '',
      pageText: input.pageText,
      nextHead: input.nextHead ?? '',
    };
  },
};
