/**
 * Stage 5 — критик, v2: з позначками стандарту (architecture.md §6 Stage 5, §8).
 *
 * Перевірка №2 у v1 («доказ описує намір/політику там, де вимога хоче
 * процедуру, запис чи доказ виконання») відправляла назад до людини кожен
 * `compliant` на вимогах, які стандарт доводить записами чи оглядом: процедура
 * не є записом — отже, «недостатньо». Тобто критик відкочував рівно те, що
 * `judge.v2` навчився не вважати прогалиною документа.
 *
 * v2 бачить позначки вимоги і пункти легенди лише для її кодів (не всю
 * легенду — критик і так отримує мінімум контексту) та висновок судді «що
 * перевірити поза документом». Коли легенда каже «записи / огляд», документ
 * винен лише свою частину: процедуру й інструкцію вести записи. Без позначок
 * перевірка №2 читається так само, як у v1.
 *
 * Схема відповіді — та сама, що в v1 (`criticSchema`).
 */

import type { MarkerLegendItem } from '@shared/domain';
import type { PromptDef } from '../types';
import { criticSchema, type CriticInput, type CriticOutput } from './critic.v1';
import {
  joinBlocks,
  languageInstruction,
  languageKey,
  markerLegendBlock,
  markerLegendKey,
  markersAttr,
  tag,
} from './util';

export interface CriticV2Input extends Omit<CriticInput, 'clause'> {
  clause: CriticInput['clause'] & {
    /** Позначки стандарту біля вимоги, дослівно; порожньо — позначок немає. */
    markers?: readonly string[];
  };
  /** Пункти легенди лише для позначок ЦІЄЇ вимоги (див. `legendEntriesFor`). */
  markerLegend?: readonly MarkerLegendItem[] | null;
  /** Що суддя виніс «перевірити поза документом»; null — нічого. */
  claimedOutsideEvidence?: string | null;
}

const SYSTEM = `You are reviewing another auditor's finding. The finding claims COMPLIANT.
Your job is to find the strongest reason why it might not be.

Check specifically:
1. Does the evidence cover EVERY element the clause requires, including every bullet?
2. Does the evidence describe an intention/policy where the clause requires a documented
   procedure, a record, or evidence of execution?
   Clause markers change what the document owes. The finding assesses a document, and a
   document cannot be a record or show what happens on site. When the clause has markers
   and <marker_legend> says that compliance is (also) shown through records, through
   observation of the site or through other evidence of execution, the document is only
   expected to provide the documented part: the procedure and the instruction to keep
   the records. Records or on-site practice missing from the document are then NOT a
   reason to disagree and NOT missing elements: the auditor verifies them at the audit,
   outside the document (see <claimed_outside_evidence>). A marker that the legend does
   not explain is informational only — never infer a requirement from a bare code.
3. Is the evidence about a different process that merely sounds similar?

Return \`agree\` only if you can defend COMPLIANT against all three.

You see the quoted evidence, not the whole document. Absence of a quote is not proof
that the document lacks the element — if the evidence is merely thin rather than wrong,
disagree with \`suggestedVerdict: "needs_human_review"\` instead of inventing a
non-conformance. Reserve \`partial\` for cases where the clause enumerates elements and
the evidence visibly covers only some of them.`;

export const criticV2: PromptDef<CriticV2Input, CriticOutput> = {
  version: 'critic.v2',
  stage: 'critic',
  system: SYSTEM,
  schema: criticSchema,
  maxOutputTokens: 2_000,
  effort: 'high',

  buildUser(input) {
    const quotes = input.evidence
      .map((item) =>
        tag(
          'quote',
          { page: item.page ?? undefined, verified: item.verified === undefined ? undefined : String(item.verified) },
          item.quote,
        ),
      )
      .join('\n');
    const outside = input.claimedOutsideEvidence?.trim();

    return joinBlocks(
      `Clause ${input.clause.clauseNo} of ${input.spec.name} v${input.spec.version}${input.clause.topic ? ` — ${input.clause.topic}` : ''}${input.clause.obligation ? ` (${input.clause.obligation})` : ''}.`,
      tag(
        'clause',
        { no: input.clause.clauseNo, markers: markersAttr(input.clause.markers) },
        input.clause.requirementText,
      ),
      markerLegendBlock(input.markerLegend),
      tag('claimed_evidence', { count: input.evidence.length }, quotes),
      tag('claimed_rationale', {}, input.claimedRationale),
      outside ? tag('claimed_outside_evidence', {}, outside) : null,
      'Decide whether COMPLIANT survives.',
      languageInstruction(input.language, {
        fields: ['reason', 'missingElements'],
        keep: 'Keep clause numbers and the `suggestedVerdict` value unchanged as the schema defines them.',
      }),
    );
  },

  cacheInput(input) {
    return {
      spec: input.spec,
      clause: {
        clauseNo: input.clause.clauseNo,
        topic: input.clause.topic,
        obligation: input.clause.obligation,
        requirementText: input.clause.requirementText,
        markers: [...(input.clause.markers ?? [])],
      },
      evidence: input.evidence.map((item) => ({
        quote: item.quote,
        page: item.page ?? null,
        verified: item.verified ?? null,
      })),
      claimedRationale: input.claimedRationale,
      // Позначки, легенда і висновок «поза документом» змінюють рішення критика —
      // тож усі три в ключі кешу.
      markerLegend: markerLegendKey(input.markerLegend),
      claimedOutsideEvidence: input.claimedOutsideEvidence?.trim() || null,
      // Див. judge.v1: мова — частина ключа, порожня — не додає нічого.
      ...languageKey(input.language),
    };
  },
};
