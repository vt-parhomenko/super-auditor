import type { Db } from '@main/db';
import type { ClauseInput } from '@main/db';
import { errorText, uiLanguageOf, uiMessages } from '@main/i18n';
import {
  buildRequest,
  clauseExtractV2,
  clip,
  isFatalLlmError,
  markerLegendV1,
  type ClauseExtractV2Item,
  type ClauseExtractV2Output,
  type CompleteResult,
  type LlmProvider,
  type MarkerLegendOutput,
  type MarkerLegendOutputItem,
} from '@main/llm';
import { markerKey, normalizeMarkers, type MarkerLegendItem, type Obligation } from '@shared/domain';

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
 *
 * Формат стандарту не зашитий: вимоги бувають таблицею (Tesco) чи нумерованою
 * прозою (ISO), номери — `10.3`, `A.5.1`, `AF 1.2.3`. Позначки біля вимог
 * (`markers`) беруться дослівно, а їхня розшифровка — з легенди самого
 * стандарту одним завершальним викликом (`marker_legend.v1`).
 */

// ─── Відбір сторінок ─────────────────────────────────────────────────────────

/**
 * Номер вимоги на початку рядка: `10.3`, `4.2.1`, `A.5`, `A.5.1`, `AF 1.2.3`,
 * `FV 5.1.2`. Числовому номеру потрібна хоч одна крапка — інакше кожен
 * нумерований список («1 The site…») і номер сторінки виглядали б як вимога.
 */
const NUMBERED_LINE =
  /(?:^|\n)[ \t]*(?:\d{1,3}(?:\.\d{1,3})+|[A-Z]\.\d{1,3}(?:\.\d{1,3})*|[A-Z]{2,4}[ \t]?\d{1,3}(?:\.\d{1,3})+)\.?(?=[ \t\n]|$)/g;

/**
 * Дієслово обов'язку. Стандарти бувають не лише англійською: нідерландською
 * (moet, dient), німецькою (muss, soll), українською (повинен, необхідно).
 * Кирилицю шукаємо без `\b`: для `\b` у JS кирилична літера — не «буква».
 */
const OBLIGATION_WORD =
  /\b(?:must|shall|should|required|moet|moeten|dient|dienen|muss|müssen|soll|sollen)\b|повин|необхідно/i;

/**
 * Ознака сторінки з вимогами — таблицею чи нумерованою прозою.
 *
 * Увага на порядок перевірок: шапку таблиці `P R O | Clause number | Topic |
 * Requirements` покладатись не можна — вона повторюється на ~90 сторінках зі 101,
 * і `stripBoilerplate` знімає її як колонтитул. Після зняття рядок вимоги
 * виглядає як `P R 1.3` — прапорці стандарту і номер на початку рядка.
 *
 * Свідомо консервативний: краще віддати моделі зайву сторінку (вона поверне
 * порожній масив), ніж пропустити сторінку з вимогами.
 */
export function looksLikeClausePage(text: string): boolean {
  // Прапорці Tesco перед номером — найнадійніша ознака, переживає зняття шапки.
  if (/(?:^|\n)[ \t]*(?:[PRO][ \t]+){1,3}\d{1,2}\.\d{1,3}\b/.test(text)) return true;

  // Шапка таблиці, якщо вона все ж лишилась (інший стандарт, стрипінг вимкнено).
  if (/clause\s*number/i.test(text)) return true;

  // Стандарти без прапорців: нумерована вимога з дієсловом обов'язку. Одного
  // номера досить — сторінка прози ISO нерідко містить рівно один пункт
  // («8.5.1 … The organization shall …»), і вимогу на ній втрачати не можна.
  const numbered = text.match(NUMBERED_LINE)?.length ?? 0;
  return numbered >= 1 && OBLIGATION_WORD.test(text);
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

export interface ExtractedClause extends ClauseExtractV2Item {
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
  perPage: ReadonlyArray<{ pageNo: number; clauses: readonly ClauseExtractV2Item[] }>,
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
      // Позначки друкуються в рядку, де вимога починається; продовження зазвичай без них.
      if (existing.markers.length === 0) existing.markers = item.markers;
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

/**
 * Номер вимоги: `10.3`, `4.2.1`, `A.5.1`, `AF 1.2.3`, `FV 5.1.2`, з необов'язковою
 * літерою в кінці (`10.3a`). Префікс — до чотирьох великих літер через пробіл,
 * крапку чи дефіс або впритул. Слово на кшталт «Requirements» сюди не пролізе.
 */
const CLAUSE_NO = /^(?:[A-Z]{1,4}[ .-]?)?\d{1,3}(?:\.\d{1,3})*[a-z]?$/;

/** Скільки пропущених номерів перелічувати в повідомленні — решта стискається в «…». */
const GAP_LIST_LIMIT = 5;

/**
 * Позиції номера в нумерації: «батько» — номер без останньої частини, «крок» —
 * останнє число. `A.5.3` → ('A.5', 3), ('A', 5); `AF 1.2.3` → ('AF 1.2', 3), ('AF 1', 2).
 *
 * Предки реєструються теж: `7.1.5.1` означає, що пункт `7.1.5` існує (хай навіть
 * як заголовок над підпунктами без власного тексту), — інакше перехід
 * 7.1.4 → 7.1.6 виглядав би як пропуск. Верхній рівень (самі секції) не
 * перевіряємо: стандарти пропускають номери секцій свідомо.
 */
function numberingSteps(clauseNo: string): Array<{ parent: string; step: number }> {
  const parts = clauseNo.trim().split('.').map((p) => p.trim());
  const out: Array<{ parent: string; step: number }> = [];
  for (let depth = parts.length - 1; depth >= 1; depth -= 1) {
    const last = parts[depth] ?? '';
    // `10.3a` — літерний підпункт: числової послідовності на цьому рівні немає.
    if (!/^\d{1,3}$/.test(last)) break;
    out.push({ parent: parts.slice(0, depth).join('.'), step: Number(last) });
  }
  return out;
}

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

  // Пропуски в нумерації рахуємо в межах «батька» (секції, підсекції): між
  // стандартами нумерація різна, але всередині одного рівня вона майже завжди
  // суцільна. Для кожного кроку пам'ятаємо першу вимогу, що його зайняла, —
  // її й позначаємо, бо самого номера-заголовка в реєстрі може не бути.
  const byParent = new Map<string, Map<number, string>>();
  for (const c of clauses) {
    for (const { parent, step } of numberingSteps(c.clauseNo)) {
      const steps = byParent.get(parent) ?? new Map<number, string>();
      if (!steps.has(step)) steps.set(step, c.clauseNo);
      byParent.set(parent, steps);
    }
  }

  for (const [parent, steps] of byParent) {
    const sorted = [...steps.keys()].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1]!;
      const curr = sorted[i]!;
      if (curr - prev <= 1) continue;
      const count = curr - prev - 1;
      const missing = Array.from(
        { length: Math.min(count, GAP_LIST_LIMIT) },
        (_, k) => `${parent}.${prev + k + 1}`,
      );
      const listed = count > GAP_LIST_LIMIT ? `${missing.join(', ')}… (${count})` : missing.join(', ');
      flag(
        'numbering_gap',
        steps.get(curr) ?? `${parent}.${curr}`,
        `Пропущено ${listed} — можливо, вимогу не витягнуто`,
      );
    }
  }

  return { issues, flagged };
}

// ─── Легенда позначок ────────────────────────────────────────────────────────

/** Скільки символів вступу віддаємо моделі для легенди. Вступ Tesco (11 сторінок) влазить цілком. */
export const LEGEND_INTRO_MAX_CHARS = 40_000;
/** Скільки перших сторінок брати, коли вимоги починаються з першої ж сторінки. */
export const LEGEND_FALLBACK_PAGES = 8;

/** Різні позначки реєстру в порядку першої появи. */
export function distinctMarkers(clauses: ReadonlyArray<{ markers: readonly string[] }>): string[] {
  const out: string[] = [];
  for (const clause of clauses) {
    for (const marker of clause.markers) if (!out.includes(marker)) out.push(marker);
  }
  return out;
}

export interface LegendSource {
  pageFrom: number;
  pageTo: number;
  text: string;
}

/**
 * Звідки читати легенду: стандарти пояснюють свої позначки у вступі — перед
 * першою сторінкою з вимогами («Clause Layout» у Tesco, стор. 10). Якщо
 * вимоги починаються з першої сторінки, беремо перші `LEGEND_FALLBACK_PAGES`.
 * Текст обрізається до `LEGEND_INTRO_MAX_CHARS` з явною позначкою обрізання.
 */
export function legendSource(pages: readonly string[], firstClausePage: number | null): LegendSource | null {
  if (pages.length === 0) return null;
  const before = firstClausePage !== null ? firstClausePage - 1 : 0;
  const pageTo = before >= 1 ? Math.min(before, pages.length) : Math.min(LEGEND_FALLBACK_PAGES, pages.length);
  const text = pages
    .slice(0, pageTo)
    .map((page, i) => `--- page ${i + 1} ---\n${page.trim()}`)
    .join('\n\n');
  return { pageFrom: 1, pageTo, text: clip(text, LEGEND_INTRO_MAX_CHARS) };
}

/**
 * Зводить відповідь моделі з тим, що реально стоїть біля вимог:
 *  - код — у написанні реєстру (інакше підказка не знайде свій значок);
 *  - позначки, яких у реєстрі немає, відкидаються — модель їх вигадала;
 *  - на кожну позначку реєстру рівно один пункт; непояснені — в кінці, з `meaning: null`.
 *
 * null, якщо стандарт не пояснив жодної позначки: тоді в UI чесне «стандарт
 * не пояснює ці позначки», а не легенда виду «P — P».
 */
export function reconcileLegend(
  codes: readonly string[],
  items: readonly MarkerLegendOutputItem[],
): MarkerLegendItem[] | null {
  const byKey = new Map(codes.map((code) => [markerKey(code), code]));
  const out: MarkerLegendItem[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const code = byKey.get(markerKey(item.code));
    if (code === undefined || seen.has(code)) continue;
    seen.add(code);
    const label = item.label.replace(/\s+/g, ' ').trim();
    const meaning = item.meaning?.trim() ?? '';
    out.push({ code, label: label || code, meaning: meaning || null });
  }
  for (const code of codes) {
    if (!seen.has(code)) out.push({ code, label: code, meaning: null });
  }

  const explained = out.some((item) => item.meaning !== null || item.label !== item.code);
  return explained ? out : null;
}

/**
 * Чи пояснює наявна легенда кожну з позначок. Потрібно, щоб повторна
 * екстракція не стирала легенду, якої з тексту не прочитати: у Tesco
 * розшифровка P/R/O — це діаграма на стор. 10, у витягнутому тексті її немає,
 * тож легенда цієї версії відома лише з міграції 4 (слова стандарту).
 */
export function legendCovers(
  legend: readonly MarkerLegendItem[] | null,
  codes: readonly string[],
): legend is MarkerLegendItem[] {
  if (!legend || legend.length === 0 || codes.length === 0) return false;
  const known = new Set(legend.map((item) => markerKey(item.code)));
  return codes.every((code) => known.has(markerKey(code)));
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
  /** Збережена легенда позначок; null — позначок немає, стандарт їх не пояснює або виклик не вдався. */
  markerLegend: MarkerLegendItem[] | null;
  /**
   * Чому легенду не прочитано (мовою інтерфейсу). Екстракцію це не зриває —
   * реєстр збережено, позначки показуються без розшифровки.
   */
  legendError: string | null;
  usage: { inputTokens: number; cachedTokens: number; outputTokens: number; costUsd: number };
}

/**
 * Відповідь моделі → придатний до злиття вигляд: позначки нормалізовані
 * (« P », дублі, «позначка» на пів речення), порожній `sectionNo` — це null.
 */
function sanitizeItem(item: ClauseExtractV2Item): ClauseExtractV2Item {
  const sectionNo = item.sectionNo?.trim() ?? '';
  return {
    ...item,
    clauseNo: item.clauseNo.trim(),
    sectionNo: sectionNo.length > 0 ? sectionNo : null,
    markers: normalizeMarkers(item.markers),
  };
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

  const perPage: Array<{ pageNo: number; clauses: ClauseExtractV2Item[] }> = [];
  const failedPages: ClauseExtractionReport['failedPages'] = [];
  const usage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0, costUsd: 0 };
  const addUsage = (result: CompleteResult<unknown>): void => {
    usage.inputTokens += result.usage.input;
    usage.cachedTokens += result.usage.cachedInput;
    usage.outputTokens += result.usage.output;
    usage.costUsd += result.costUsd;
  };
  let processed = 0;

  const controller = new AbortController();
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true });

  /** Баланс, ключ, доступ: наступні сторінки так само приречені — зупиняємось. */
  let fatal: string | null = null;

  const runPage = async (page: PageSelection): Promise<void> => {
    const request = buildRequest(
      clauseExtractV2,
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
      const result: CompleteResult<ClauseExtractV2Output> = await provider.complete(
        request,
        controller.signal,
      );
      perPage.push({ pageNo: page.pageNo, clauses: result.data.clauses.map(sanitizeItem) });
      addUsage(result);

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
    // Застаріле поле профілів виробництва: нова екстракція його не заповнює,
    // і прихований фільтр застосовності вважає такі вимоги «завжди застосовними».
    modules: [],
    markers: c.markers,
    obligation: (c.obligation ?? inferObligation(c.requirementText)) as Obligation | null,
    pageFrom: c.pageFrom,
    pageTo: c.pageTo,
    reviewStatus: validation.flagged.has(c.clauseNo) ? 'flagged' : 'auto',
  }));

  // Легенда позначок — один виклик на всю версію і лише тоді, коли позначки є.
  // Її невдача реєстр не зриває: вимоги вже витягнуто й оплачено, а позначки
  // без розшифровки — менша біда, ніж втрачений реєстр.
  const codes = distinctMarkers(merged);
  let markerLegend: MarkerLegendItem[] | null = null;
  let legendError: string | null = null;
  const firstClausePage = merged.length > 0 ? Math.min(...merged.map((c) => c.pageFrom)) : null;
  const source =
    codes.length > 0 && !controller.signal.aborted ? legendSource(pages, firstClausePage) : null;
  if (source) {
    try {
      const request = buildRequest(
        markerLegendV1,
        {
          specName: spec?.name ?? 'Specification',
          specVersion: version.versionLabel,
          codes,
          introText: source.text,
          pageFrom: source.pageFrom,
          pageTo: source.pageTo,
        },
        options.model ? { model: options.model } : {},
      );
      const result: CompleteResult<MarkerLegendOutput> = await provider.complete(request, controller.signal);
      addUsage(result);
      markerLegend = reconcileLegend(codes, result.data.items);
    } catch (error) {
      // Скасування — не збій легенди: попереджати нема про що.
      if (!controller.signal.aborted) legendError = errorText(uiLanguage, error);
    }
  }
  // Нова легенда нічого не пояснила (чи виклик не вдався), а стара пояснює всі
  // позначки цієї ж версії стандарту — лишаємо стару: той самий PDF, ті самі
  // коди, і відомі слова стандарту не мають зникати від повторної екстракції.
  if (markerLegend === null && legendCovers(version.markerLegend, codes)) {
    markerLegend = version.markerLegend;
  }

  // Реєстр і його легенда — одна транзакція: легенда від старого реєстру
  // поруч із новими позначками брехала б.
  const stored = db.transaction(() => {
    db.clauses.deleteAll(specVersionId);
    const count = db.clauses.createMany(specVersionId, inputs);
    db.specs.setClausesStatus(specVersionId, 'extracted');
    db.specs.setMarkerLegend(specVersionId, markerLegend);
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
    markerLegend,
    legendError,
    usage,
  };
}

/**
 * Секція за номером — запасний варіант, коли модель `sectionNo` не повернула.
 * '10.3' → '10', 'AF 1.2.3' → 'AF 1', а додаток ISO 'A.5.1' → 'A.5': сама
 * літера «A» — це весь додаток, а секцією в ньому є 'A.5'.
 */
export function sectionOf(clauseNo: string): string | null {
  const parts = clauseNo.trim().split('.').map((p) => p.trim());
  const head = parts[0] ?? '';
  if (parts.length < 2 || head.length === 0) return null;
  if (/^[A-Z]$/i.test(head) && parts.length >= 3 && parts[1]) return `${head}.${parts[1]}`;
  return head;
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
