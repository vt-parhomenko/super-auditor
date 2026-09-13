/**
 * Stage 2 — профіль версії документа. Один виклик на версію, дешева модель.
 *
 * `candidateClauses` — пріоритезація, а НЕ фільтр: скорочувати за ними набір
 * не можна, інакше пропустимо невідповідність там, де модель не здогадалась
 * подивитись (architecture.md §6 Stage 2).
 */

import { z } from 'zod';
import { DOCUMENT_KINDS } from '@shared/domain';
import type { PromptDef } from '../types';
import { clip, joinBlocks, tag } from './util';

export interface DocProfileInput {
  title: string;
  versionLabel: string;
  docText: string;
  /** Реєстр вимог скорочено: модель бачить номер + тему, не повні тексти. */
  clauseIndex: Array<{ clauseNo: string; topic: string | null; sectionTitle?: string | null }>;
  maxTextChars?: number;
}

export const docProfileSchema = z.object({
  summary: z.string().min(1).describe('3-6 sentences: what this document governs and how.'),
  docType: z
    .enum(DOCUMENT_KINDS)
    .nullable()
    .describe('sop, policy, form, record, manual or other; null if genuinely unclear.'),
  docNumber: z
    .string()
    .nullable()
    .describe('Document number from the header block, e.g. "0068". null if absent.'),
  versionLabel: z
    .string()
    .nullable()
    .describe('Version from the header, e.g. "002". Dutch headers use "Versie".'),
  processOwner: z
    .string()
    .nullable()
    .describe('Owner from the header. Dutch headers use "Proceseigenaar".'),
  lang: z
    .string()
    .nullable()
    .describe('ISO 639-1 code of the dominant language of the body text, e.g. "en", "nl".'),
  processes: z
    .array(z.string())
    .describe('Business processes covered, e.g. "goods receiving", "pest monitoring".'),
  candidateClauses: z
    .array(z.string())
    .describe('Clause numbers from the supplied index that this document plausibly addresses.'),
});

export type DocProfileOutput = z.infer<typeof docProfileSchema>;

const SYSTEM = `You profile a supplier internal document so an audit tool can route it.

You do three things:
1. Summarise what the document actually governs — the processes, not the boilerplate.
2. Read the header block for document number, version and process owner. Headers may
   be Dutch: "Versie" = version, "Proceseigenaar" = process owner, "Datum" = date.
   Extract the values as printed; do not translate them.
3. Pick candidate clauses from the supplied clause index.

About candidates: they are a priority hint, not a filter. Everything you list will be
checked first, and everything you omit will still be checked afterwards. So be generous
— list a clause whenever the document plausibly touches its topic. Never invent a clause
number that is not in the index.

Use null rather than a guess for any header field that is not printed.`;

export const docProfileV1: PromptDef<DocProfileInput, DocProfileOutput> = {
  version: 'doc_profile.v1',
  stage: 'doc_profile',
  system: SYSTEM,
  schema: docProfileSchema,
  maxOutputTokens: 4_000,

  buildCachedPrefix(input) {
    return tag(
      'document',
      { name: input.title, version: input.versionLabel },
      clip(input.docText, input.maxTextChars ?? 200_000),
    );
  },

  buildUser(input) {
    const index = input.clauseIndex
      .map((c) => `<clause no="${c.clauseNo}">${c.topic ?? c.sectionTitle ?? ''}</clause>`)
      .join('\n');
    return joinBlocks(
      'Profile the document above.',
      tag('clause_index', { count: input.clauseIndex.length }, index),
      'List in candidateClauses every clause number from the index that this document plausibly addresses.',
    );
  },

  cacheInput(input) {
    return {
      title: input.title,
      versionLabel: input.versionLabel,
      docText: input.docText,
      clauseIndex: input.clauseIndex.map((c) => ({
        clauseNo: c.clauseNo,
        topic: c.topic ?? null,
        sectionTitle: c.sectionTitle ?? null,
      })),
      maxTextChars: input.maxTextChars ?? null,
    };
  },
};
