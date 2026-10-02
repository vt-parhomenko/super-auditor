/**
 * Stage 5 — критик (architecture.md §6 Stage 5).
 *
 * Перепровіряємо ТІЛЬКИ `compliant`: найдорожча помилка — пропущена
 * невідповідність, а не зайва. Критик отримує вимогу + цитати-докази,
 * а НЕ весь документ — дешевше і не дає йому «дочитати» те, чого в доказах нема.
 * Citations не потрібні → звичайний structured output.
 */

import { z } from 'zod';
import { MODEL_VERDICTS } from '@shared/domain';
import type { Obligation, ResultsLanguage } from '@shared/domain';
import type { PromptDef } from '../types';
import { joinBlocks, languageInstruction, languageKey, tag } from './util';

export interface CriticInput {
  spec: { name: string; version: string };
  clause: {
    clauseNo: string;
    topic: string | null;
    obligation: Obligation | null;
    requirementText: string;
  };
  /** Докази, на яких judge побудував вердикт `compliant`. */
  evidence: Array<{ quote: string; page?: number | null; verified?: boolean }>;
  claimedRationale: string;
  /**
   * Мова пояснення критика: `reason` дописується в rationale finding'а, тож
   * користувач читає його поруч із висновком судження. `''` — мовою стандарту.
   */
  language?: ResultsLanguage;
}

export const criticSchema = z.object({
  agree: z
    .boolean()
    .describe('true only if COMPLIANT survives all three checks below.'),
  reason: z
    .string()
    .min(1)
    .describe('2-4 sentences. If you disagree, name the strongest single reason.'),
  missingElements: z
    .array(z.string())
    .describe('Required elements the evidence does not cover. Empty when you agree.'),
  suggestedVerdict: z
    .enum(MODEL_VERDICTS)
    .describe('compliant when you agree; otherwise the verdict you would give instead.'),
  confidence: z.number().min(0).max(1),
});

export type CriticOutput = z.infer<typeof criticSchema>;

const SYSTEM = `You are reviewing another auditor's finding. The finding claims COMPLIANT.
Your job is to find the strongest reason why it might not be.

Check specifically:
1. Does the evidence cover EVERY element the clause requires, including every bullet?
2. Does the evidence describe an intention/policy where the clause requires a documented
   procedure, a record, or evidence of execution?
3. Is the evidence about a different process that merely sounds similar?

Return \`agree\` only if you can defend COMPLIANT against all three.

You see the quoted evidence, not the whole document. Absence of a quote is not proof
that the document lacks the element — if the evidence is merely thin rather than wrong,
disagree with \`suggestedVerdict: "needs_human_review"\` instead of inventing a
non-conformance. Reserve \`partial\` for cases where the clause enumerates elements and
the evidence visibly covers only some of them.`;

export const criticV1: PromptDef<CriticInput, CriticOutput> = {
  version: 'critic.v1',
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

    return joinBlocks(
      `Clause ${input.clause.clauseNo} of ${input.spec.name} v${input.spec.version}${input.clause.topic ? ` — ${input.clause.topic}` : ''}${input.clause.obligation ? ` (${input.clause.obligation})` : ''}.`,
      tag('clause', { no: input.clause.clauseNo }, input.clause.requirementText),
      tag('claimed_evidence', { count: input.evidence.length }, quotes),
      tag('claimed_rationale', {}, input.claimedRationale),
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
      clause: input.clause,
      evidence: input.evidence.map((item) => ({
        quote: item.quote,
        page: item.page ?? null,
        verified: item.verified ?? null,
      })),
      claimedRationale: input.claimedRationale,
      // Див. judge.v1: мова — частина ключа, порожня — не додає нічого.
      ...languageKey(input.language),
    };
  },
};
