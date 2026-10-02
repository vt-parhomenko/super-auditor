import type { Db } from '@main/db';
import { uiMessages } from '@main/i18n';
import { buildRequest, docProfileV1, type DocProfileOutput, type LlmProvider } from '@main/llm';

/**
 * Stage 2.5 — визначення, яких секцій стандарту стосується документ.
 *
 * Навіщо. Реальний прогін `Pest Management 0068` (3 сторінки про шкідників)
 * проти всього стандарту дав 24 виклики моделі, з яких змістовними були ~5.
 * Решта 19 витрачали токени на те, щоб модель написала «цей документ не про
 * транспорт», «не про скло», «не про етичний аудит».
 *
 * Гірше за вартість була якість: на дотичних секціях модель знаходила уривки
 * («документ називає носіїв ролей») і ставила `partial` там, де правильна
 * відповідь — `not_addressed`. Інструкція про шкідників НЕ ПОВИННА містити
 * організаційну схему; питати про це — питати не те. Так набігло 41 хибне
 * зауваження, кожне з severity.
 *
 * Тому секції, яких документ не стосується, отримують `not_addressed` без
 * звернення до моделі — і це чесно: рішення ухвалене на етапі профілювання,
 * що прямо написано в rationale кожного такого finding (`results.outOfScope`
 * у каталозі `@main/i18n`, мовою результатів).
 */

export interface DocumentScope {
  documentVersionId: number;
  /** Секції, які підуть у модель. */
  sections: Set<string>;
  /** Як визначено: профілем документа чи взято все. */
  source: 'profile' | 'all' | 'fallback';
  candidateClauses: string[];
}

export interface ScopeOptions {
  /** `all` — перевіряти всі секції, без звуження. */
  mode?: 'profile' | 'all';
  /** Скільки символів документа давати моделі профілю. */
  maxDocChars?: number;
  signal?: AbortSignal;
}

/**
 * Визначає scope для кожного документа. Один дешевий виклик на документ,
 * результат кешується в `doc_profile` і перевикористовується наступними прогонами.
 */
export async function scopeDocuments(
  db: Db,
  /** null — лише для `mode: 'all'`, де модель не викликається. */
  provider: LlmProvider | null,
  specVersionId: number,
  documentVersionIds: readonly number[],
  options: ScopeOptions = {},
): Promise<Map<number, DocumentScope>> {
  const result = new Map<number, DocumentScope>();
  const clauses = db.clauses.list(specVersionId);
  const allSections = new Set(clauses.map((c) => c.sectionNo ?? 'inne'));

  if (options.mode === 'all') {
    for (const id of documentVersionIds) {
      result.set(id, {
        documentVersionId: id,
        sections: new Set(allSections),
        source: 'all',
        candidateClauses: [],
      });
    }
    return result;
  }

  if (!provider) throw new Error('scopeDocuments: provider is required unless mode is "all"');

  const sectionOf = new Map(clauses.map((c) => [c.clauseNo, c.sectionNo ?? 'inne']));

  for (const documentVersionId of documentVersionIds) {
    result.set(
      documentVersionId,
      await scopeOne(db, provider, {
        documentVersionId,
        clauses,
        sectionOf,
        allSections,
        options,
      }),
    );
  }

  return result;
}

interface ScopeOneArgs {
  documentVersionId: number;
  clauses: ReturnType<Db['clauses']['list']>;
  sectionOf: Map<string, string>;
  allSections: Set<string>;
  options: ScopeOptions;
}

async function scopeOne(
  db: Db,
  provider: LlmProvider,
  args: ScopeOneArgs,
): Promise<DocumentScope> {
  const { documentVersionId, clauses, sectionOf, allSections, options } = args;

  const candidates = await candidateClausesFor(db, provider, documentVersionId, clauses, options);

  // Порожній або невпізнаваний результат — НЕ привід мовчки не перевіряти нічого.
  // Краще заплатити за повний прогін, ніж видати «зауважень немає» через те,
  // що профілювання не спрацювало.
  const sections = new Set<string>();
  for (const clauseNo of candidates) {
    const section = sectionOf.get(clauseNo.trim());
    if (section) sections.add(section);
  }

  if (sections.size === 0) {
    return {
      documentVersionId,
      sections: new Set(allSections),
      source: 'fallback',
      candidateClauses: candidates,
    };
  }

  return { documentVersionId, sections, source: 'profile', candidateClauses: candidates };
}

/** Кешований профіль документа або новий виклик моделі. */
async function candidateClausesFor(
  db: Db,
  provider: LlmProvider,
  documentVersionId: number,
  clauses: ReturnType<Db['clauses']['list']>,
  options: ScopeOptions,
): Promise<string[]> {
  const model = provider.models[0] ?? 'unknown';

  const cached = db.docProfiles.find(documentVersionId, model, docProfileV1.version);
  if (cached) return cached.candidateClauses;

  const version = db.documents.getVersion(documentVersionId);
  if (!version?.extractionId) {
    throw new Error(uiMessages(db).run.noExtraction(documentVersionId));
  }
  const document = db.documents.get(version.documentId);
  const text = db.extractions.getText(version.extractionId) ?? '';

  const request = buildRequest(
    docProfileV1,
    {
      title: document?.title ?? 'Document',
      versionLabel: version.versionLabel,
      docText: text,
      clauseIndex: clauses.map((c) => ({
        clauseNo: c.clauseNo,
        topic: c.topic,
        sectionTitle: c.sectionTitle,
      })),
      ...(options.maxDocChars ? { maxTextChars: options.maxDocChars } : {}),
    },
    { model },
  );

  const result = await provider.complete<DocProfileOutput>(
    request,
    options.signal ?? new AbortController().signal,
  );

  db.docProfiles.upsert({
    documentVersionId,
    summary: result.data.summary,
    docType: result.data.docType,
    processes: result.data.processes ?? [],
    candidateClauses: result.data.candidateClauses ?? [],
    model: result.modelId,
    promptVersion: docProfileV1.version,
  });

  return result.data.candidateClauses ?? [];
}
