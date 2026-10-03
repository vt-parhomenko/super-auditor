/**
 * Stage 1 — посторінковий екстракт реєстру вимог, незалежний від формату стандарту.
 *
 * v1 знав лише таблицю Tesco (`P R O | Clause number | Topic | Requirements`) і
 * для інших стандартів радив «повернути порожній масив»: ISO 9001 із вимогами
 * нумерованою прозою чи GlobalG.A.P. з номерами `AF 1.2.3` витягувались погано
 * або ніяк. Крім того, прапорці P/R/O v1 читав як «модулі застосовності», хоча
 * стандарт Tesco пояснює їх як тип доказу.
 *
 * v2 описує вимоги загально і замість фіксованих модулів повертає `markers` —
 * будь-які короткі позначки, які стандарт друкує біля вимоги, дослівно.
 * Що вони означають, вирішує не модель із загальних знань, а легенда самого
 * стандарту (окремий виклик `marker_legend.v1`).
 */

import { z } from 'zod';
import { OBLIGATIONS } from '@shared/domain';
import type { PromptDef } from '../types';
import type { ClauseExtractInput } from './clauseExtract.v1';
import { joinBlocks, tag } from './util';

export const clauseExtractV2ItemSchema = z.object({
  clauseNo: z
    .string()
    .min(1)
    .describe('Clause number exactly as printed, including any letter prefix: "10.3", "A.5.1", "AF 1.2.3".'),
  sectionNo: z
    .string()
    .nullable()
    .describe('Number of the top-level section heading the clause belongs to, as printed: "10", "A.5", "AF 1".'),
  sectionTitle: z.string().nullable().describe('Title of that section heading, as printed.'),
  topic: z.string().nullable().describe('The clause\'s own short title or Topic column, if printed.'),
  requirementText: z
    .string()
    .min(1)
    .describe('Verbatim requirement text. Bullet lines start with "- ". Never summarised or translated.'),
  markers: z
    .array(z.string())
    .describe('Short codes or labels the standard prints with this clause, verbatim; [] if none.'),
  obligation: z
    .enum(OBLIGATIONS)
    .nullable()
    .describe('"must" if the requirement is mandatory, "should"/"may" otherwise.'),
  truncated: z
    .boolean()
    .describe('true if the clause continues from the previous page or onto the next one.'),
});

export const clauseExtractV2Schema = z.object({
  clauses: z.array(clauseExtractV2ItemSchema),
});

export type ClauseExtractV2Item = z.infer<typeof clauseExtractV2ItemSchema>;
export type ClauseExtractV2Output = z.infer<typeof clauseExtractV2Schema>;

const SYSTEM = `Extract the clauses (auditable requirements) from one page of a standard.

Standards are laid out in different ways. Clauses may be rows of a table (marker
columns, clause number, topic, requirement text) or numbered paragraphs of prose.
Column boundaries and line breaks are often lost in the extracted text — reconstruct
the structure from the numbering and the wording.

A clause is a numbered requirement that a site can be audited against. Clause numbers
look like "10.3", "4.2.1", "A.5.1", "AF 1.2.3" or "FV 5.1.2". Introductions, notes,
examples, guidance and tables of contents are not clauses. A numbered heading with no
requirement text of its own (only a title above its sub-clauses) is not a clause either.

Fields:
- \`clauseNo\` — the number exactly as printed, including any letter prefix.
- \`requirementText\` — verbatim. Preserve bullet lists as "- " lines. Do not summarise
  and do not translate.
- \`topic\` — the clause's own short title or Topic column if the standard prints one,
  otherwise null.
- \`sectionNo\` — the number of the top-level section heading the clause belongs to,
  as printed: "10" for 10.3, "4" for 4.2.1, "A.5" for A.5.1 (an annex section),
  "AF 1" for AF 1.2.3.
- \`sectionTitle\` — the title of that section heading as printed. Repeat it on every
  clause of the section; use null when neither the page nor the context shows it.
- \`markers\` — short codes or labels that the standard prints with this particular
  clause to classify it: ticked flag columns, level or criticality labels such as
  "Major Must", "Minor Must", "Recommendation", "Fundamental". Copy each marker
  verbatim as one array item, in the order printed. Flag columns often come out of
  the text extraction as letters before the clause number: "P R  1.3 …" → ["P","R"];
  a blank column means that marker does not apply. Use [] when the clause has no
  markers. Never invent, expand, translate or normalise a marker, and never take
  column headings, the topic, words of the requirement or the obligation verb as markers.
- \`obligation\` — from the wording of the requirement itself: "must"/"shall" → must,
  "should" → should, "may"/"can" → may (or the equivalent words in the language of the
  standard). Use null if the clause states no obligation verb.
- \`truncated\` — true if the clause continues from the previous page or onto the next.

Rules:
- Ignore page headers, footers and copyright notices.
- If the page contains no clauses, return an empty array.
- Return clauses in the order they appear on the page. Never invent a clause number
  that is not printed on the page.`;

export const clauseExtractV2: PromptDef<ClauseExtractInput, ClauseExtractV2Output> = {
  version: 'clause_extract.v2',
  stage: 'clause_extract',
  system: SYSTEM,
  schema: clauseExtractV2Schema,
  maxOutputTokens: 8_000,
  effort: 'medium',

  buildUser(input) {
    return joinBlocks(
      `Standard: ${input.specName} v${input.specVersion}. Page ${input.pageNo}.`,
      input.prevTail ? tag('previous_page_tail', {}, input.prevTail) : null,
      tag('page', { no: input.pageNo }, input.pageText),
      input.nextHead ? tag('next_page_head', {}, input.nextHead) : null,
      'Extract every clause that starts on this page. Context blocks are provided only so you can tell whether a clause is truncated and which section it belongs to; do not extract clauses that belong entirely to a neighbouring page.',
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
