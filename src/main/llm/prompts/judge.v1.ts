/**
 * Stage 4 — судження. Головний промпт (architecture.md §6 Stage 4, §8).
 *
 * Батчимо по секціях: секція 10 «Pest management» = 6 вимог за один виклик.
 * Текст документа й grading rules — у кешованому системному префіксі,
 * вимоги — в messages: порядок рендерингу tools → system → messages,
 * кеш працює як префіксний матч.
 *
 * Citations несумісні з `output_config.format`, тому структуру дає strict
 * tool use — інструмент `report_finding` зі `strict: true`.
 */

import { z } from 'zod';
import { MODEL_VERDICTS } from '@shared/domain';
import type { Obligation, Severity } from '@shared/domain';
import type { PromptDef, ToolSpec } from '../types';
import { clip, joinBlocks, languageInstruction, tag } from './util';

export interface JudgeClause {
  clauseNo: string;
  topic: string | null;
  obligation: Obligation | null;
  requirementText: string;
}

export interface JudgeInput {
  spec: { name: string; version: string; gradingRules: string | null };
  doc: { title: string; versionLabel: string; text: string };
  section: { sectionNo: string; sectionTitle: string | null };
  clauses: JudgeClause[];
  maxTextChars?: number;
  /** Мова висновків (BCP-47). Цитати завжди лишаються мовою оригіналу. */
  language?: string;
}

/** `none` існує тільки в схемі інструмента; у БД severity — nullable. */
export const TOOL_SEVERITIES = ['critical', 'major', 'minor', 'recommendation', 'none'] as const;

export const reportFindingSchema = z.object({
  clause_no: z.string().min(1),
  verdict: z.enum(MODEL_VERDICTS),
  severity: z.enum(TOOL_SEVERITIES).optional(),
  // Зрізаємо, а не відхиляємо: схема інструмента не може нести minimum/maximum
  // (Anthropic дає 400), тож модель інколи поверне 1.05 — через це не варто
  // втрачати цілий батч вимог.
  confidence: z.number().transform((v) => Math.min(1, Math.max(0, v))),
  rationale: z.string().min(1),
  evidence: z.array(
    z.object({
      quote: z.string(),
      page: z.number().int().optional(),
    }),
  ),
  gap: z.string().optional(),
  recommendation: z.string().optional(),
});

/** Один виклик judge повертає по одному finding на кожну вимогу батчу. */
export const judgeSchema = z.array(reportFindingSchema);

export type ReportFinding = z.infer<typeof reportFindingSchema>;
export type JudgeOutput = z.infer<typeof judgeSchema>;

export function severityFromTool(value: string | undefined): Severity | null {
  if (!value || value === 'none') return null;
  return value as Severity;
}

export const reportFindingTool: ToolSpec = {
  name: 'report_finding',
  description:
    'Report the assessment of exactly one clause. Call once per clause in the batch, in the order the clauses were given.',
  multiCall: true,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['clause_no', 'verdict', 'rationale', 'evidence', 'confidence'],
    properties: {
      clause_no: { type: 'string' },
      verdict: {
        type: 'string',
        enum: ['compliant', 'partial', 'non_compliant', 'not_addressed', 'needs_human_review'],
      },
      severity: {
        type: 'string',
        enum: ['critical', 'major', 'minor', 'recommendation', 'none'],
      },
      // `minimum`/`maximum` тут НЕ можна: Anthropic відхиляє схему інструмента
      // з 400 `For 'number' type, properties maximum, minimum are not supported`.
      // Діапазон задаємо описом, а зрізаємо вже на боці zod-схеми.
      confidence: {
        type: 'number',
        description: 'Confidence between 0 and 1 inclusive, e.g. 0.85.',
      },
      rationale: {
        type: 'string',
        description: '2-4 sentences. Name the specific elements met and missing.',
      },
      evidence: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['quote'],
          properties: {
            quote: { type: 'string' },
            page: { type: 'integer' },
          },
        },
        description:
          'Verbatim quotes from the document. Required unless verdict is not_addressed.',
      },
      gap: { type: 'string', description: 'What is missing, concretely.' },
      recommendation: {
        type: 'string',
        description: 'What the site should add or change.',
      },
    },
  },
};

/** System — статична частина. Дослівно з architecture.md §8, мінус плейсхолдери. */
const SYSTEM = `You are a compliance auditor. You assess whether a supplier's internal document
satisfies specific clauses of a customer standard.

You do NOT make things up. Every verdict about compliance must be grounded in an
exact quote from the supplied document. If the document does not mention the subject
of a clause at all, the verdict is \`not_addressed\` — this is NOT the same as
\`non_compliant\`.

Verdicts:
- compliant        — the document explicitly satisfies every element of the requirement
- partial          — the subject is covered but one or more required elements are missing
- non_compliant    — the document addresses the subject but contradicts the requirement
- not_addressed    — the document does not cover the subject of this clause
- needs_human_review — the text is ambiguous, illegible, or you cannot decide

Severity — use the customer's own grading rules, supplied below.

Requirement wording matters: "must" is mandatory, "should" is a recommendation.
A missing element of a "must" clause is at least Minor. A failure affecting product
safety, legality or the customer's brand is Critical.

Clauses often contain bulleted lists of minimum required elements. Check EVERY bullet
separately. A document covering 7 of 9 bullets is \`partial\`, not \`compliant\`.

Quotes must be copied character for character from the document. Do not paraphrase,
do not stitch fragments together, do not add ellipses. A quote that cannot be found
verbatim in the document is treated as fabricated and voids the verdict.`;

export const judgeV1: PromptDef<JudgeInput, JudgeOutput> = {
  version: 'judge.v1',
  stage: 'judge',
  system: SYSTEM,
  schema: judgeSchema,
  tool: reportFindingTool,
  maxOutputTokens: 16_000,
  effort: 'high',

  /** Кешований префікс: grading rules + повний текст документа. */
  buildCachedPrefix(input) {
    return joinBlocks(
      tag('grading_rules', {}, input.spec.gradingRules ?? 'Not supplied. Fall back to: Critical = product safety, legality or brand risk; Major = a mandatory element is absent; Minor = a mandatory element is incomplete; Recommendation = improvement only.'),
      tag(
        'document',
        { name: input.doc.title, version: input.doc.versionLabel },
        clip(input.doc.text, input.maxTextChars ?? 400_000),
      ),
    );
  },

  buildUser(input) {
    const clauses = input.clauses
      .map((clause) =>
        tag(
          'clause',
          {
            no: clause.clauseNo,
            topic: clause.topic ?? undefined,
            obligation: clause.obligation ?? undefined,
          },
          clause.requirementText,
        ),
      )
      .join('\n');

    return joinBlocks(
      `Assess the document above against the following clauses from ${input.spec.name} v${input.spec.version}, section ${input.section.sectionNo}${input.section.sectionTitle ? ` — ${input.section.sectionTitle}` : ''}.`,
      tag('clauses', { count: input.clauses.length }, clauses),
      'For each clause call `report_finding` exactly once.',
      languageInstruction(input.language),
    );
  },

  cacheInput(input) {
    return {
      spec: { name: input.spec.name, version: input.spec.version, gradingRules: input.spec.gradingRules ?? null },
      doc: { title: input.doc.title, versionLabel: input.doc.versionLabel, text: input.doc.text },
      section: { sectionNo: input.section.sectionNo, sectionTitle: input.section.sectionTitle },
      clauses: input.clauses,
      maxTextChars: input.maxTextChars ?? null,
    };
  },
};
