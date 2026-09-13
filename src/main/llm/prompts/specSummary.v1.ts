/**
 * Stage 1b — самарі специфікації + витяг правил градації.
 *
 * `gradingRules` підставляються в системний префікс судження (Stage 4), тому
 * severity збігається зі шкалою реального аудитора, а не з абстрактним
 * «є зауваження» (architecture.md §6 Stage 1).
 */

import { z } from 'zod';
import { SEVERITIES } from '@shared/domain';
import type { PromptDef } from '../types';
import { clip, joinBlocks, tag } from './util';

export interface SpecSummaryInput {
  specName: string;
  specVersion: string;
  issuer?: string | null;
  /** Текст спеки: шапка, scope і розділ «Auditing of Standard». */
  specText: string;
  /** Перелік секцій (номер + заголовок) для посекційних самарі. */
  sections?: Array<{ sectionNo: string; sectionTitle: string | null }>;
  /** Скільки символів тексту спеки віддати моделі. */
  maxTextChars?: number;
}

export const gradingRulesSchema = z.object({
  rawText: z
    .string()
    .describe('The grading section reproduced verbatim, so a human can audit the extraction.'),
  definitions: z
    .array(z.object({ level: z.enum(SEVERITIES), definition: z.string() }))
    .describe('Definition of each non-conformance level as worded by the standard.'),
  ratings: z
    .array(
      z.object({
        grade: z.string().describe('Rating value as printed, e.g. "3".'),
        label: z.string().describe('Rating label, e.g. "Improvement needed".'),
        criteria: z
          .string()
          .describe('Threshold as printed, e.g. "0 Critical and 1 Major non-conformance".'),
      }),
    )
    .describe('The rating table that maps non-conformance counts onto an overall grade.'),
});

export const specSummarySchema = z.object({
  summary: z.string().min(1).describe('4-8 sentences: what the standard covers and who it binds.'),
  scope: z.string().nullable().describe('Scope statement of the standard, verbatim where possible.'),
  gradingRules: gradingRulesSchema
    .nullable()
    .describe('null only if the document contains no auditing or grading section at all.'),
  sectionSummaries: z
    .array(
      z.object({
        sectionNo: z.string(),
        sectionTitle: z.string().nullable(),
        summary: z.string().describe('1-2 sentences on what this section requires.'),
      }),
    )
    .describe('One entry per section listed in the request, in the same order.'),
});

export type SpecSummaryOutput = z.infer<typeof specSummarySchema>;

const SYSTEM = `You are summarising a customer compliance standard for an audit tool.

Two things matter, in this order:

1. The grading rules. Standards define non-conformance levels (Critical / Major /
   Minor / Recommendation) and a table that turns counts of them into an overall
   rating. Reproduce both exactly. These rules are fed to the auditor model later,
   so a paraphrase that shifts a threshold corrupts every downstream verdict.
   Look for a section named "Auditing of Standard", "Audit protocol", "Grading",
   "Non-conformance" or similar.
2. A short, factual summary of what the standard covers.

Rules:
- Quote thresholds and definitions verbatim. Do not round, merge or reorder them.
- Do not invent a rating row that is not printed. If a level has no definition in
  the text, omit it rather than guessing.
- Never summarise a section you were not given text for; write "not covered in the
  supplied text" instead.`;

export const specSummaryV1: PromptDef<SpecSummaryInput, SpecSummaryOutput> = {
  version: 'spec_summary.v1',
  stage: 'spec_summary',
  system: SYSTEM,
  schema: specSummarySchema,
  maxOutputTokens: 12_000,
  effort: 'medium',

  buildCachedPrefix(input) {
    return tag(
      'standard',
      { name: input.specName, version: input.specVersion, issuer: input.issuer ?? undefined },
      clip(input.specText, input.maxTextChars ?? 400_000),
    );
  },

  buildUser(input) {
    const sections = input.sections ?? [];
    const rendered = sections
      .map((s) => `<section no="${s.sectionNo}">${s.sectionTitle ?? ''}</section>`)
      .join('\n');
    return joinBlocks(
      `Summarise ${input.specName} v${input.specVersion} using the text above.`,
      sections.length > 0 ? tag('sections', {}, rendered) : null,
      sections.length > 0
        ? 'Produce one sectionSummaries entry for each section above, in the same order.'
        : 'Leave sectionSummaries empty — no section list was supplied.',
      'Extract the grading rules into gradingRules, including the verbatim text of the grading section.',
    );
  },

  cacheInput(input) {
    return {
      specName: input.specName,
      specVersion: input.specVersion,
      issuer: input.issuer ?? null,
      specText: input.specText,
      sections: input.sections ?? [],
      maxTextChars: input.maxTextChars ?? null,
    };
  },
};
