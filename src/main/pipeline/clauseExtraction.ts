import type { Db } from '@main/db';
import type { ClauseInput } from '@main/db';
import { errorText, uiLanguageOf, uiMessages } from '@main/i18n';
import {
  buildRequest,
  clauseExtractV1,
  isFatalLlmError,
  type ClauseExtractItem,
  type ClauseExtractOutput,
  type CompleteResult,
  type LlmProvider,
} from '@main/llm';
import type { Module, Obligation } from '@shared/domain';

/**
 * Stage 1 — побудова реєстру вимог зі специфікації.
 *
 * Найкритичніший етап конвеєра: якщо реєстр кривий, усе далі безглузде, і на
 * рівні findings це непомітно. Тому тут три захисні шари:
 *   1. відбір сторінок — у модель не йде зміст, глосарій і вступ;
 *   2. зшивання вимог, розірваних між сторінками;
 *   3. механічна валідація результату → статус `flagged` замість тихого прийняття.
 *
 * Нічого з цього не покладається на модель: валідація — чиста функція,
 * і саме вона вирішує, чи можна показувати реєстр як придатний.
 */

// ─── Відбір сторінок ─────────────────────────────────────────────────────────

/**
 * Ознака сторінки з таблицею вимог.
 *
 * Увага на порядок перевірок: шапку таблиці `P R O | Clause number | Topic |
 * Requirements` покладатись не можна — вона повторюється на ~90 сторінках зі 101,
 * і `stripBoilerplate` знімає її як колонтитул. Після зняття рядок вимоги
 * виглядає як `P R 1.3` — прапорці модулів і номер на початку рядка.
 *
 * Свідомо консервативний: краще віддати моделі зайву сторінку (вона поверне
 * порожній масив), ніж пропустити сторінку з вимогами.
 */
export function looksLikeClausePage(text: string): boolean {
  // Прапорці модулів перед номером — найнадійніша ознака, переживає зняття шапки.
  if (/(?:^|\n)[ \t]*(?:[PRO][ \t]+){1,3}\d{1,2}\.\d{1,3}\b/.test(text)) return true;

  // Шапка таблиці, якщо вона все ж лишилась (інший стандарт, стрипінг вимкнено).
  if (/clause\s*number/i.test(text)) return true;

  // Запасна ознака для стандартів без прапорців: кілька нумерованих вимог
  // із дієсловом обов'язку.
  const numbered = text.match(/(?:^|\n)[ \t]*\d{1,2}\.\d{1,3}[ \t]/g)?.length ?? 0;
  return numbered >= 2 && /\b(must|shall|should)\b/i.test(text);
}

export interface PageSelection {
  pageNo: number;
  text: string;
  prevTail: string | undefined;
  nextHead: string | undefined;
}

const CONTEXT_CHARS = 500;

/** Готує сторінки до відправки: фільтрує й додає контекст сусідніх сторінок. */
export function selectClausePages(
  pages: readonly string[],
  options: { all?: boolean; from?: number; to?: number } = {},
): PageSelection[] {
  const from = Math.max(1, options.from ?? 1);
  const to = Math.min(pages.length, options.to ?? pages.length);

  const selected: PageSelection[] = [];
  for (let pageNo = from; pageNo <= to; pageNo += 1) {
    const text = pages[pageNo - 1] ?? '';
    if (!options.all && !looksLikeClausePage(text)) continue;

    const prev = pages[pageNo - 2];
    const next = pages[pageNo];
    selected.push({
      pageNo,
      text,
      prevTail: prev ? prev.slice(-CONTEXT_CHARS) : undefined,
      nextHead: next ? next.slice(0, CONTEXT_CHARS) : undefined,
    });
  }
  return selected;
}

// ─── Зшивання розірваних вимог ─────────────────────────────────────────────

export interface ExtractedClause extends ClauseExtractItem {
  pageFrom: number;
  pageTo: number;
}

/**
 * Вимога, що починається внизу сторінки N і продовжується на N+1, приходить
 * двома шматками. Зшиваємо за номером: другий шматок дописується до першого,
 * а діапазон сторінок розширюється — від цього залежить, чи знайде користувач
 * вимогу в PDF за посиланням.
 */
export function mergeContinuations(
  perPage: ReadonlyArray<{ pageNo: number; clauses: readonly ClauseExtractItem[] }>,
): ExtractedClause[] {
  const byNo = new Map<string, ExtractedClause>();
  const order: string[] = [];

  for (const { pageNo, clauses } of perPage) {
    for (const item of clauses) {
      const existing = byNo.get(item.clauseNo);

      if (!existing) {
        byNo.set(item.clauseNo, { ...item, pageFrom: pageNo, pageTo: pageNo });
        order.push(item.clauseNo);
        continue;
      }

      // Дублікат на тій самій сторінці — не продовження, а справжній дубль.
      if (existing.pageTo === pageNo) continue;

      existing.requirementText = joinFragments(existing.requirementText, item.requirementText);
      existing.pageTo = pageNo;
      existing.topic ??= item.topic;
      existing.sectionTitle ??= item.sectionTitle;
      if (existing.modules.length === 0) existing.modules = item.modules;
    }
  }

  return order.map((no) => byNo.get(no)!);
}

function joinFragments(head: string, tail: string): string {
  const a = head.trimEnd();
  const b = tail.trimStart();
  if (!b) return a;
  if (a.endsWith(b) || a.includes(b)) return a;
  // Обірваний буліт-список продовжується з нового рядка, обірване речення — ні.
  const separator = /[.:;]$/.test(a) || b.startsWith('•') ? '\n' : ' ';
  return `${a}${separator}${b}`;
}

// ─── Валідація реєстру ───────────────────────────────────────────────────────

export type ClauseIssueKind =
  | 'duplicate'
  | 'malformed_number'
  | 'empty_requirement'
  | 'requirement_shorter_than_topic'
  | 'numbering_gap';

export interface ClauseIssue {
  kind: ClauseIssueKind;
  clauseNo: string;
  message: string;
}

export interface ValidationReport {
  issues: ClauseIssue[];
  /** Номери вимог, які треба позначити `flagged` і показати на вичитку першими. */
  flagged: Set<string>;
}

const CLAUSE_NO = /^\d{1,2}(\.\d{1,3})*$/;

/**
 * Механічна перевірка реєстру. Пропуск у нумерації всередині секції — найважливіший
 * сигнал: він означає, що модель проґавила цілу вимогу, а не помилилась у полі.
 */
export function validateClauses(clauses: readonly ExtractedClause[]): ValidationReport {
  const issues: ClauseIssue[] = [];
  const flagged = new Set<string>();

  const flag = (kind: ClauseIssueKind, clauseNo: string, message: string): void => {
    issues.push({ kind, clauseNo, message });
    flagged.add(clauseNo);
  };

  const seen = new Set<string>();
  for (const c of clauses) {
    if (seen.has(c.clauseNo)) {
      flag('duplicate', c.clauseNo, `Вимога ${c.clauseNo} трапилась двічі`);
    }
    seen.add(c.clauseNo);

    if (!CLAUSE_NO.test(c.clauseNo)) {
      flag('malformed_number', c.clauseNo, `Номер «${c.clauseNo}» не схожий на номер вимоги`);
    }

    const text = c.requirementText.trim();
    if (text.length === 0) {
      flag('empty_requirement', c.clauseNo, `Порожній текст вимоги`);
    } else if (c.topic && text.length <= c.topic.trim().length) {
      flag(
        'requirement_shorter_than_topic',
        c.clauseNo,
        `Текст вимоги не довший за topic — схоже, колонки злились`,
      );
    }
  }

  // Пропуски в нумерації рахуємо в межах секції: між стандартами нумерація різна,
  // але всередині однієї секції вона майже завжди суцільна.
  const bySection = new Map<string, number[]>();
  for (const c of clauses) {
    const match = /^(\d{1,2})\.(\d{1,3})$/.exec(c.clauseNo);
    if (!match?.[1] || !match[2]) continue;
    const list = bySection.get(match[1]) ?? [];
    list.push(Number(match[2]));
    bySection.set(match[1], list);
  }

  for (const [section, numbers] of bySection) {
    const sorted = [...new Set(numbers)].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1]!;
      const curr = sorted[i]!;
      if (curr - prev > 1) {
        const missing = Array.from({ length: curr - prev - 1 }, (_, k) => `${section}.${prev + k + 1}`);
        flag(
          'numbering_gap',
          `${section}.${curr}`,
          `Пропущено ${missing.join(', ')} — можливо, вимогу не витягнуто`,
        );
      }
    }
  }

  return { issues, flagged };
}

// ─── Оркестрація ─────────────────────────────────────────────────────────────

export interface ClauseExtractionProgress {
  page: number;
  pageCount: number;
  clausesFound: number;
  done: boolean;
  /** Пояснення мовою інтерфейсу — іде прямо в `clauses:extractProgress`. */
  error?: string;
}

export interface ClauseExtractionOptions {
  /** Скільки сторінок обробляти одночасно. */
  concurrency?: number;
  /** Не фільтрувати сторінки за ознакою таблиці вимог. */
  allPages?: boolean;
  from?: number;
  to?: number;
  model?: string;
  onProgress?: (progress: ClauseExtractionProgress) => void;
  signal?: AbortSignal;
}

export interface ClauseExtractionReport {
  specVersionId: number;
  pagesProcessed: number;
  clausesFound: number;
  clausesStored: number;
  issues: ClauseIssue[];
  flaggedCount: number;
  failedPages: Array<{ pageNo: number; error: string }>;
  usage: { inputTokens: number; cachedTokens: number; outputTokens: number; costUsd: number };
}

/**
 * Витягує реєстр вимог і зберігає його. Провайдер передається ззовні —
 * так само працює і з живим API, і з детермінованою заглушкою в тестах.
 */
export async function extractClausesForSpec(
  db: Db,
  provider: LlmProvider,
  specVersionId: number,
  options: ClauseExtractionOptions = {},
): Promise<ClauseExtractionReport> {
  const ui = uiMessages(db);
  const uiLanguage = uiLanguageOf(db);

  const version = db.specs.getVersion(specVersionId);
  if (!version) throw new Error(ui.run.specVersionNotFound(specVersionId));
  if (version.extractionId === null) throw new Error(ui.clauses.noExtraction);

  const extraction = db.extractions.get(version.extractionId);
  if (!extraction) throw new Error(ui.clauses.extractionMissing);

  const spec = db.specs.get(version.specificationId);
  const pages = extraction.pages.map((p) => extraction.text.slice(p.charStart, p.charEnd));

  const selected = selectClausePages(pages, {
    all: options.allPages ?? false,
    from: options.from,
    to: options.to,
  });

  const perPage: Array<{ pageNo: number; clauses: ClauseExtractItem[] }> = [];
  const failedPages: ClauseExtractionReport['failedPages'] = [];
  const usage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0, costUsd: 0 };
  let processed = 0;

  const controller = new AbortController();
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true });

  /** Баланс, ключ, доступ: наступні сторінки так само приречені — зупиняємось. */
  let fatal: string | null = null;

  const runPage = async (page: PageSelection): Promise<void> => {
    const request = buildRequest(
      clauseExtractV1,
      {
        specName: spec?.name ?? 'Specification',
        specVersion: version.versionLabel,
        pageNo: page.pageNo,
        pageText: page.text,
        ...(page.prevTail ? { prevTail: page.prevTail } : {}),
        ...(page.nextHead ? { nextHead: page.nextHead } : {}),
      },
      options.model ? { model: options.model } : {},
    );

    try {
      const result: CompleteResult<ClauseExtractOutput> = await provider.complete(
        request,
        controller.signal,
      );
      perPage.push({ pageNo: page.pageNo, clauses: result.data.clauses });

      usage.inputTokens += result.usage.input;
      usage.cachedTokens += result.usage.cachedInput;
      usage.outputTokens += result.usage.output;
      usage.costUsd += result.costUsd;

      processed += 1;
      options.onProgress?.({
        page: page.pageNo,
        pageCount: selected.length,
        clausesFound: result.data.clauses.length,
        done: false,
      });
    } catch (error) {
      // Текст іде на екран (прогрес екстракції), тож — мовою інтерфейсу.
      const message = errorText(uiLanguage, error);
      if (isFatalLlmError(error) && fatal === null) {
        fatal = message;
        controller.abort();
      }
      failedPages.push({ pageNo: page.pageNo, error: message });
      processed += 1;
      options.onProgress?.({
        page: page.pageNo,
        pageCount: selected.length,
        clausesFound: 0,
        done: false,
        error: message,
      });
    }
  };

  await runWithConcurrency(selected, options.concurrency ?? 4, runPage, controller.signal);

  // Реєстр замінюється ЦІЛКОМ (deleteAll + createMany), а з ним каскадом ідуть
  // ручні перевизначення застосовності. Тож неповний результат не має права
  // затерти наявний реєстр: ні після фатальної помилки (вичерпаний баланс на
  // першій же сторінці дав би порожній реєстр), ні коли не вдалася жодна
  // сторінка, ні — якщо щось не вдалося — поверх уже вичитаного вручну.
  const keepReason =
    fatal ??
    (selected.length > 0 && failedPages.length === selected.length
      ? ui.clauses.allPagesFailed(failedPages[0]?.error ?? '')
      : failedPages.length > 0 && version.clausesStatus === 'reviewed'
        ? ui.clauses.reviewedKept(failedPages.length)
        : null);
  if (keepReason !== null) {
    options.onProgress?.({
      page: selected.length,
      pageCount: selected.length,
      clausesFound: 0,
      done: true,
      error: keepReason,
    });
    throw new Error(keepReason);
  }

  // Порядок сторінок відновлюємо явно: конкурентні виклики завершуються врізнобій,
  // а зшивання продовжень залежить від послідовності.
  perPage.sort((a, b) => a.pageNo - b.pageNo);

  const merged = mergeContinuations(perPage);
  const validation = validateClauses(merged);

  const inputs: ClauseInput[] = merged.map((c) => ({
    clauseNo: c.clauseNo,
    requirementText: c.requirementText.trim(),
    sectionNo: c.sectionNo ?? sectionOf(c.clauseNo),
    sectionTitle: c.sectionTitle,
    topic: c.topic,
    modules: c.modules as Module[],
    obligation: (c.obligation ?? inferObligation(c.requirementText)) as Obligation | null,
    pageFrom: c.pageFrom,
    pageTo: c.pageTo,
    reviewStatus: validation.flagged.has(c.clauseNo) ? 'flagged' : 'auto',
  }));

  const stored = db.transaction(() => {
    db.clauses.deleteAll(specVersionId);
    const count = db.clauses.createMany(specVersionId, inputs);
    db.specs.setClausesStatus(specVersionId, 'extracted');
    return count;
  });

  options.onProgress?.({
    page: selected.length,
    pageCount: selected.length,
    clausesFound: merged.length,
    done: true,
  });

  return {
    specVersionId,
    pagesProcessed: processed,
    clausesFound: merged.length,
    clausesStored: stored,
    issues: validation.issues,
    flaggedCount: validation.flagged.size,
    failedPages,
    usage,
  };
}

function sectionOf(clauseNo: string): string | null {
  return /^(\d{1,2})\./.exec(clauseNo)?.[1] ?? null;
}

/** `must` — обов'язок, `should` — рекомендація. Впливає на severity в Stage 4. */
function inferObligation(text: string): Obligation | null {
  if (/\bmust\b|\bshall\b|\bis required to\b/i.test(text)) return 'must';
  if (/\bshould\b/i.test(text)) return 'should';
  if (/\bmay\b|\bcan\b/i.test(text)) return 'may';
  return null;
}

/** Проста черга з обмеженням паралелізму. Порядок результатів не гарантується. */
async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  let cursor = 0;
  const size = Math.max(1, Math.min(limit, items.length));

  const lane = async (): Promise<void> => {
    while (cursor < items.length) {
      if (signal.aborted) return;
      const item = items[cursor++];
      if (item === undefined) return;
      await worker(item);
    }
  };

  await Promise.all(Array.from({ length: size }, lane));
}
