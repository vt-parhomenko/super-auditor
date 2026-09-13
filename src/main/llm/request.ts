/**
 * Складання `CompleteRequest` з визначення промпта і його входу,
 * плюс ключ кешу для цієї пари (architecture.md §9).
 */

import { buildCacheKey } from './cacheKey';
import type { CompleteRequest, Effort, LlmDocument, PromptDef } from './types';

export interface BuildRequestOptions {
  model?: string;
  effort?: Effort;
  maxOutputTokens?: number;
  /** Додаткові документи (PDF для Citations API). */
  documents?: LlmDocument[];
  outputMode?: CompleteRequest<unknown>['outputMode'];
}

export function buildRequest<TInput, TOutput>(
  prompt: PromptDef<TInput, TOutput>,
  input: TInput,
  opts: BuildRequestOptions = {},
): CompleteRequest<TOutput> {
  const cachedPrefix = prompt.buildCachedPrefix?.(input);
  const documents = opts.documents ?? prompt.buildDocuments?.(input);
  const effort = opts.effort ?? prompt.effort;

  const req: CompleteRequest<TOutput> = {
    stage: prompt.stage,
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.buildUser(input) }],
    schema: prompt.schema,
    maxOutputTokens: opts.maxOutputTokens ?? prompt.maxOutputTokens,
    promptVersion: prompt.version,
    cacheInput: prompt.cacheInput ? prompt.cacheInput(input) : input,
  };

  if (cachedPrefix) req.cachedPrefix = cachedPrefix;
  if (documents && documents.length > 0) req.documents = documents;
  if (prompt.tool) req.tool = prompt.tool;
  if (effort) req.effort = effort;
  if (opts.model) req.model = opts.model;
  if (opts.outputMode) req.outputMode = opts.outputMode;

  return req;
}

/** Ключ кешу для готового запиту. Модель — та, якою реально підуть викликати. */
export function cacheKeyForRequest(req: CompleteRequest<unknown>, model: string): string {
  const input =
    req.cacheInput !== undefined
      ? req.cacheInput
      : {
          system: req.system,
          cachedPrefix: req.cachedPrefix ?? null,
          messages: req.messages,
          documents: (req.documents ?? []).map((doc) => ({ name: doc.name, mime: doc.mime, citations: doc.citations })),
        };

  return buildCacheKey({
    stage: req.stage,
    promptVersion: req.promptVersion,
    model,
    input,
  });
}
