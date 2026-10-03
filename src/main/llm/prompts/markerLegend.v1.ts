/**
 * Stage 1, завершальний крок — легенда позначок стандарту.
 *
 * Після посторінкового екстракту відомо, ЯКІ позначки стоять біля вимог
 * («P», «R», «O»; «Major Must»), але не що вони означають. Пояснення
 * стандарт дає сам — у вступі («Clause Layout» у Tesco, стор. 10). Один
 * дешевий виклик на всю версію: на вході коди і текст вступних сторінок,
 * на виході — розшифровка словами стандарту.
 *
 * Головне правило: значення беруться лише з тексту стандарту. Модель знає,
 * що зазвичай означає «Major Must», але «зазвичай» — не легенда цього
 * стандарту; краще `meaning: null`, ніж правдоподібна вигадка в аудиті.
 */

import { z } from 'zod';
import type { PromptDef } from '../types';
import { joinBlocks, openTag, tag } from './util';

export interface MarkerLegendInput {
  specName: string;
  specVersion: string;
  /** Різні позначки, знайдені біля вимог, у порядку першої появи. */
  codes: readonly string[];
  /** Текст сторінок перед першою сторінкою з вимогами (обрізаний). */
  introText: string;
  /** Діапазон сторінок, з яких узято текст, — щоб модель могла на них посилатись. */
  pageFrom: number;
  pageTo: number;
}

export const markerLegendItemSchema = z.object({
  code: z.string().min(1).describe('The marker exactly as given in the list.'),
  label: z
    .string()
    .describe('The short name the standard gives the marker; the code itself if the standard names it nowhere.'),
  meaning: z
    .string()
    .nullable()
    .describe('The standard\'s own explanation of the marker, quoted as closely as possible; null if the text does not explain it.'),
});

export const markerLegendSchema = z.object({
  items: z.array(markerLegendItemSchema),
});

export type MarkerLegendOutputItem = z.infer<typeof markerLegendItemSchema>;
export type MarkerLegendOutput = z.infer<typeof markerLegendSchema>;

const SYSTEM = `You read the introductory pages of a standard to find out what the markers
printed next to its clauses mean.

You get the list of markers that were found next to the clauses (for example "P", "R",
"O", or "Major Must", "Fundamental") and the text of the pages before the clauses start.
Standards usually explain such markers in a section like "Clause layout", "How to use
this standard", "Structure of the standard", or in a key or legend.

Return exactly one item for every marker in the list:
- \`code\` — the marker exactly as given in the list.
- \`label\` — the short name the standard gives the marker (for a flag column, the name
  of that column, e.g. "Policy / procedure"). If the standard gives it no name, repeat the code.
- \`meaning\` — the standard's own explanation of the marker, quoted as closely as possible
  and in the language of the standard. Use null when the provided text does not explain
  the marker.

Never explain a marker from general knowledge, never guess and never translate: a wrong
explanation would mislead the auditor, a null tells them to look it up. Return the items
in the order in which the standard explains the markers; markers it does not explain go
last, in the order given. Do not add markers that are not in the list.`;

export const markerLegendV1: PromptDef<MarkerLegendInput, MarkerLegendOutput> = {
  version: 'marker_legend.v1',
  stage: 'clause_extract',
  system: SYSTEM,
  schema: markerLegendSchema,
  maxOutputTokens: 4_000,
  effort: 'medium',

  buildUser(input) {
    const markers = [
      openTag('markers', { count: input.codes.length }),
      ...input.codes.map((code) => `<marker>${code}</marker>`),
      '</markers>',
    ].join('\n');
    const pages = input.pageFrom === input.pageTo ? `${input.pageFrom}` : `${input.pageFrom}-${input.pageTo}`;
    return joinBlocks(
      `Standard: ${input.specName} v${input.specVersion}.`,
      markers,
      tag('introduction', { pages }, input.introText),
      `Return one item for each of the ${input.codes.length} markers.`,
    );
  },

  cacheInput(input) {
    return {
      specName: input.specName,
      specVersion: input.specVersion,
      codes: [...input.codes],
      introText: input.introText,
      pageFrom: input.pageFrom,
      pageTo: input.pageTo,
    };
  },
};
