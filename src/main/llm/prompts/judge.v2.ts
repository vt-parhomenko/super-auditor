/**
 * Stage 4 — судження, v2: з позначками стандарту (architecture.md §8).
 *
 * Що не так було з v1. Стандарти на кшталт Tesco друкують біля вимоги коди
 * того, ЧИМ доводиться відповідність: P — задокументована процедура, R —
 * записи, O — огляд майданчика. v1 цих кодів не бачив і оцінював процедуру
 * так, ніби вона мусить довести все сама. Документ — не запис і не показує
 * практику на місці, тож вимога «P R» на ідеальній процедурі отримувала
 * `partial` — найчастіше хибне «зауваження» в аудиті.
 *
 * v2 показує моделі позначки вимоги і легенду стандарту (його ж словами) і
 * просить оцінювати лише ту частину, яку може дати документ. Решту — що
 * перевірити записами чи оглядом — модель пише в окреме поле
 * `outside_evidence`: це не зауваження до документа, а підказка аудитору.
 *
 * Розділ про позначки — загальний: жодних назв стандартів і зашитих кодів.
 * Значення коду бере лише з `<marker_legend>`; код без пояснення — інформація,
 * а не вимога. Стандарт без позначок дає промпт без легенди й без атрибутів
 * `markers` — і оцінюється так само, як у v1.
 *
 * Решта — як у v1: батч по секціях, документ і grading rules (тепер і легенда)
 * у кешованому префіксі, strict tool use `report_finding`.
 */

import { z } from 'zod';
import type { MarkerLegendItem } from '@shared/domain';
import type { PromptDef, ToolSpec } from '../types';
import { reportFindingSchema, reportFindingTool, type JudgeClause, type JudgeInput } from './judge.v1';
import {
  clip,
  joinBlocks,
  languageInstruction,
  languageKey,
  markerLegendBlock,
  markerLegendKey,
  markersAttr,
  tag,
} from './util';

export interface JudgeV2Clause extends JudgeClause {
  /** Позначки стандарту біля вимоги, дослівно: ['P','R']. Порожньо — позначок немає. */
  markers?: readonly string[];
}

export interface JudgeV2Input extends Omit<JudgeInput, 'clauses'> {
  clauses: JudgeV2Clause[];
  /**
   * Легенда позначок версії стандарту — його власні пояснення кодів.
   * null/порожня — легенди немає: блок `<marker_legend>` не рендериться.
   */
  markerLegend?: readonly MarkerLegendItem[] | null;
}

const OUTSIDE_EVIDENCE_DESCRIPTION =
  'What must be verified outside this document — records, on-site observation — according to the clause markers and legend. Omit when nothing.';

export const reportFindingV2Schema = reportFindingSchema.extend({
  outside_evidence: z.string().optional(),
});

/** Один виклик judge повертає по одному finding на кожну вимогу батчу. */
export const judgeV2Schema = z.array(reportFindingV2Schema);

export type ReportFindingV2 = z.infer<typeof reportFindingV2Schema>;
export type JudgeV2Output = z.infer<typeof judgeV2Schema>;

/**
 * Той самий інструмент, що й у v1, плюс необов'язкове `outside_evidence`.
 * Обов'язкові поля не змінились: строгий режим OpenRouter (`strictifySchema`)
 * зробить нове поле nullable, а `stripOptionalNulls` прибере `null` до zod.
 */
export const reportFindingToolV2: ToolSpec = {
  ...reportFindingTool,
  inputSchema: {
    ...reportFindingTool.inputSchema,
    properties: {
      ...reportFindingTool.inputSchema.properties,
      outside_evidence: { type: 'string', description: OUTSIDE_EVIDENCE_DESCRIPTION },
    },
  },
};

/** Поля, які модель пише мовою результатів: `outside_evidence` — теж вільний текст для людини. */
const LANGUAGE_FIELDS = ['rationale', 'gap', 'recommendation', 'outside_evidence'] as const;

/** System — статична частина: правила v1 + загальний розділ про позначки стандарту. */
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

Clause markers. Some standards mark each clause with short codes that say how
compliance with it is evidenced. Such a clause carries a \`markers\` attribute, and the
codes are explained in <marker_legend>, in the standard's own words.

You are assessing a DOCUMENT. A document can only evidence what a document can contain:
a policy or procedure, responsibilities, frequencies, methods, and the instruction to
keep records. When the legend says that compliance with a clause is (also) shown through
records, through observation of the site or through other evidence of execution:
- judge only whether the document provides its part of the clause;
- do NOT mark the clause \`partial\` or \`non_compliant\` merely because the document is
  not itself a record or cannot show what happens on site;
- instead, describe in \`outside_evidence\` what the auditor must verify outside the
  document: which records to inspect, what to observe on site.
If the document is missing something a document must contain — the procedure itself, a
required element, the instruction to keep a required record — that IS a gap: put it in
\`gap\` and grade the verdict as usual.

A marker that <marker_legend> does not explain (its meaning is unknown) is informational
only: never infer a requirement from a bare code. When the legend describes how critical
a clause is, take that into account together with the grading rules when you set
severity. Omit \`outside_evidence\` when the markers and the legend ask for nothing
beyond the document, and for \`not_addressed\`.

Quotes must be copied character for character from the document. Do not paraphrase,
do not stitch fragments together, do not add ellipses. A quote that cannot be found
verbatim in the document is treated as fabricated and voids the verdict.`;

export const judgeV2: PromptDef<JudgeV2Input, JudgeV2Output> = {
  version: 'judge.v2',
  stage: 'judge',
  system: SYSTEM,
  schema: judgeV2Schema,
  tool: reportFindingToolV2,
  maxOutputTokens: 16_000,
  effort: 'high',

  /**
   * Кешований префікс: grading rules + легенда позначок + повний текст документа.
   * Легенда — властивість версії стандарту, однакова для всіх батчів, тож
   * місце їй у стабільному префіксі, а не в кожному user-повідомленні.
   */
  buildCachedPrefix(input) {
    return joinBlocks(
      tag('grading_rules', {}, input.spec.gradingRules ?? 'Not supplied. Fall back to: Critical = product safety, legality or brand risk; Major = a mandatory element is absent; Minor = a mandatory element is incomplete; Recommendation = improvement only.'),
      markerLegendBlock(input.markerLegend),
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
            markers: markersAttr(clause.markers),
          },
          clause.requirementText,
        ),
      )
      .join('\n');

    return joinBlocks(
      `Assess the document above against the following clauses from ${input.spec.name} v${input.spec.version}, section ${input.section.sectionNo}${input.section.sectionTitle ? ` — ${input.section.sectionTitle}` : ''}.`,
      tag('clauses', { count: input.clauses.length }, clauses),
      'For each clause call `report_finding` exactly once.',
      languageInstruction(input.language, { fields: LANGUAGE_FIELDS }),
    );
  },

  cacheInput(input) {
    return {
      spec: { name: input.spec.name, version: input.spec.version, gradingRules: input.spec.gradingRules ?? null },
      doc: { title: input.doc.title, versionLabel: input.doc.versionLabel, text: input.doc.text },
      section: { sectionNo: input.section.sectionNo, sectionTitle: input.section.sectionTitle },
      // Позначки й легенда змінюють відповідь (що вважати прогалиною документа, а що —
      // перевіркою поза ним), тож обидві — у ключі: правка легенди чи позначки
      // вимоги в реєстрі не має віддати закешований вердикт, винесений без неї.
      clauses: input.clauses.map((clause) => ({
        clauseNo: clause.clauseNo,
        topic: clause.topic,
        obligation: clause.obligation,
        requirementText: clause.requirementText,
        markers: [...(clause.markers ?? [])],
      })),
      markerLegend: markerLegendKey(input.markerLegend),
      maxTextChars: input.maxTextChars ?? null,
      // Див. judge.v1: мова — частина ключа, порожня — не додає нічого.
      ...languageKey(input.language),
    };
  },
};
