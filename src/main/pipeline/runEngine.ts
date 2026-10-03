import type { Db } from '@main/db';
import type { FindingInput, RunRouting } from '@main/db';
import {
  describeLlmError,
  errorText,
  resultsLanguageOf,
  resultsMessages,
  uiLanguageOf,
  uiMessages,
  type MainMessages,
} from '@main/i18n';
import {
  buildRequest,
  criticV2,
  judgeV2,
  isFatalLlmError,
  severityFromTool,
  verifyQuote,
  type CriticV2Input,
  type JudgeV2Input,
  type JudgeV2Output,
  type LlmProvider,
  type ReportFindingV2,
} from '@main/llm';
import {
  legendEntriesFor,
  type ClauseDto,
  type FindingDto,
  type Language,
  type MarkerLegendItem,
  type ResultsLanguage,
  type RunConfig,
  type RunProgress,
  type Severity,
  type UsageTotals,
  type Verdict,
} from '@shared/domain';

/**
 * Stage 4/5 — рушій прогону аудиту.
 *
 * Дві властивості, заради яких він виглядає саме так:
 *
 *  • **Відновлюваність.** План прогону матеріалізується в `run_task` ДО першого
 *    виклику моделі, а результат кожного завдання комітиться одразу. Прогін на
 *    183 вимоги × 10 документів гарантовано десь обірветься — після
 *    перезапуску він продовжиться, а не почнеться спочатку.
 *
 *  • **Дешевизна.** Батч = (документ × секція). Текст документа їде в кешованому
 *    префіксі й перевикористовується всіма секціями, змінна частина — лише
 *    список вимог.
 */

export interface JudgeTaskPayload {
  documentVersionId: number;
  sectionNo: string;
  clauseIds: number[];
}

export interface CriticTaskPayload {
  findingId: number;
}

export const JUDGE_STAGE = 'judge';
export const CRITIC_STAGE = 'critic';

// ─── Планування ──────────────────────────────────────────────────────────────

export interface PlanResult {
  runId: number;
  tasks: number;
  clausesApplicable: number;
  documents: number;
  skippedNotApplicable: number;
  /** Вимоги, закриті як `not_addressed` за scope документа, без виклику моделі. */
  skippedOutOfScope: number;
}

export interface PlanOptions {
  /**
   * Секції, релевантні кожному документу (див. `scoping.ts`). Документи, яких
   * немає в мапі, перевіряються повністю.
   */
  scope?: Map<number, Set<string>>;
  /**
   * Моделі, якими прогін стартує. Фіксуються в прогоні, щоб resume продовжив
   * на них же, а не на тому, що на той момент стоїть у налаштуваннях.
   */
  routing?: RunRouting;
}

/**
 * Створює прогін і матеріалізує план. Модель тут ще не викликається —
 * після цієї функції прогін можна закрити й продовжити завтра.
 */
export function planRun(
  db: Db,
  config: RunConfig,
  models: { judge: string; critic: string | null; promptVersion: string },
  options: PlanOptions = {},
): PlanResult {
  const ui = uiMessages(db);
  const specVersion = db.specs.getVersion(config.specVersionId);
  if (!specVersion) throw new Error(ui.run.specVersionNotFound(config.specVersionId));
  if (config.documentVersionIds.length === 0) throw new Error(ui.run.noDocuments);

  const all = db.clauses.list(config.specVersionId);
  if (all.length === 0) throw new Error(ui.run.emptyRegistry);

  // Мова висновків фіксується на старті: один прогін — одна мова, навіть якщо
  // налаштування змінять між паузою і продовженням.
  const resultsLanguage = resultsLanguageOf(db);
  const outOfScopeRationale = resultsMessages(resultsLanguage).results.outOfScope;

  // Застосовність уже порахована детерміновано (Stage 3); тут лише читаємо.
  const applicable = config.siteProfileId
    ? all.filter((c) => isApplicable(db, config.siteProfileId!, c.id))
    : all;

  const bySection = groupBySection(applicable);

  return db.transaction(() => {
    const run = db.runs.create({
      label: config.label ?? null,
      specVersionId: config.specVersionId,
      siteProfileId: config.siteProfileId,
      documentVersionIds: config.documentVersionIds,
      modelJudge: models.judge,
      modelCritic: config.skipCritic ? null : models.critic,
      promptVersion: models.promptVersion,
      status: 'queued',
      routing: options.routing ?? null,
      resultsLanguage,
    });

    const tasks = [];
    const outOfScope: FindingInput[] = [];

    for (const documentVersionId of config.documentVersionIds) {
      const relevant = options.scope?.get(documentVersionId);

      for (const [sectionNo, clauses] of bySection) {
        // Секція поза scope документа закривається одразу, без виклику моделі.
        if (relevant && !relevant.has(sectionNo)) {
          for (const clause of clauses) {
            outOfScope.push({
              runId: run.id,
              clauseId: clause.id,
              documentVersionId,
              verdict: 'not_addressed',
              severity: null,
              confidence: null,
              rationale: outOfScopeRationale,
              evidence: [],
            });
          }
          continue;
        }

        tasks.push({
          stage: JUDGE_STAGE,
          payload: {
            documentVersionId,
            sectionNo,
            clauseIds: clauses.map((c) => c.id),
          } satisfies JudgeTaskPayload,
        });
      }
    }

    db.runTasks.enqueueMany(run.id, tasks);
    if (outOfScope.length > 0) db.findings.upsertMany(outOfScope);

    return {
      runId: run.id,
      tasks: tasks.length,
      clausesApplicable: applicable.length,
      documents: config.documentVersionIds.length,
      skippedNotApplicable: all.length - applicable.length,
      skippedOutOfScope: outOfScope.length,
    };
  });
}

function isApplicable(db: Db, siteProfileId: number, clauseId: number): boolean {
  const row = db.siteProfiles.getApplicability(siteProfileId, clauseId);
  // Відсутній рядок = застосовно: краще зайвий finding, ніж мовчки зрізаний набір.
  return row === null || row.applicable;
}

/** Вимоги однієї секції йдуть у модель разом — так вона бачить сусідні вимоги. */
function groupBySection(clauses: readonly ClauseDto[]): Map<string, ClauseDto[]> {
  const map = new Map<string, ClauseDto[]>();
  for (const clause of clauses) {
    const key = clause.sectionNo ?? 'inne';
    const list = map.get(key) ?? [];
    list.push(clause);
    map.set(key, list);
  }
  return map;
}

// ─── Виконання ───────────────────────────────────────────────────────────────

export interface RunEngineDeps {
  db: Db;
  judge: LlmProvider;
  /** Якщо не задано — прохід критика пропускається. */
  critic?: LlmProvider | undefined;
}

export interface ExecuteOptions {
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: RunProgress) => void;
  onFinding?: (finding: FindingDto) => void;
  /** Скільки символів документа віддавати моделі. Захист від велетенських файлів. */
  maxDocChars?: number;
}

export interface RunExecutionReport {
  runId: number;
  /** `paused` — прогін зупинено паузою: він не завершений, завдання лишаються в черзі. */
  status: 'done' | 'cancelled' | 'failed' | 'paused';
  judgeTasks: number;
  criticTasks: number;
  findings: number;
  downgraded: number;
  failedTasks: Array<{ taskId: number; error: string }>;
  /**
   * Помилка, після якої продовжувати не можна (баланс, ключ, доступ).
   * Прогін зупиняється одразу, а завдання повертаються в чергу — щоб після
   * поповнення рахунку «Продовжити» доробив, а не почав спочатку.
   */
  fatalError?: string;
  usage: UsageTotals;
}

export async function executeRun(
  deps: RunEngineDeps,
  runId: number,
  options: ExecuteOptions = {},
): Promise<RunExecutionReport> {
  const { db } = deps;
  const run = db.runs.get(runId);
  if (!run) throw new Error(uiMessages(db).run.notFound(runId));

  const controller = new AbortController();
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true });

  const report: RunExecutionReport = {
    runId,
    status: 'done',
    judgeTasks: 0,
    criticTasks: 0,
    findings: 0,
    downgraded: 0,
    failedTasks: [],
    usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, costUsd: 0 },
  };

  db.runs.markStarted(runId);
  db.runs.setStatus(runId, 'running');

  // Завдання, що зависли в 'running' після падіння процесу, повертаємо в чергу.
  db.runTasks.requeueStale(runId);

  const context = loadRunContext(db, runId, run.specVersionId);

  // Пауза — стан у БД, смуги самі зупиняються, коли його бачать. Але це НЕ
  // завершення: без цієї перевірки прогін ішов далі до критика й `markFinished`,
  // і пауза на півдорозі перетворювалась на «done» з половиною результатів.
  const paused = (): boolean => db.runs.get(runId)?.status === 'paused';

  try {
    await drainStage(deps, runId, JUDGE_STAGE, controller, options, report, context);

    if (!controller.signal.aborted && !paused() && deps.critic) {
      enqueueCriticTasks(db, runId);
      await drainStage(deps, runId, CRITIC_STAGE, controller, options, report, context);
    }
  } catch (error) {
    db.runs.markFinished(runId, 'failed', errorText(context.uiLanguage, error));
    return { ...report, status: 'failed' };
  }

  if (!controller.signal.aborted && paused()) {
    emitProgress(db, runId, null, options);
    return { ...report, status: 'paused', usage: db.runs.usage(runId) };
  }

  const { status, error } = concludeRun(controller.signal.aborted, report, context.ui.run);
  db.runs.markFinished(runId, status, error);
  emitProgress(db, runId, null, options);

  return { ...report, status, usage: db.runs.usage(runId) };
}

/**
 * Підсумок прогону.
 *
 * Прогін, у якому впали ВСІ завдання, раніше завершувався зі статусом `done`,
 * і в інтерфейсі це виглядало як успішний аудит без зауважень — найнебезпечніша
 * з можливих брехень для цього продукту. Справжня причина при цьому лежала в
 * `run_task.last_error`, куди ніхто не дивиться.
 *
 * Тепер: жодного результату → `failed`, і текст першої помилки йде в `audit_run.error`,
 * тобто на екран. Часткова невдача лишається `done`, але теж із поясненням.
 */
export function concludeRun(
  aborted: boolean,
  report: Pick<RunExecutionReport, 'findings' | 'failedTasks'> & { fatalError?: string },
  messages: MainMessages['run'],
): { status: 'done' | 'cancelled' | 'failed'; error: string | null } {
  const failed = report.failedTasks.length;

  // Фатальна помилка сильніша за прапорець скасування: скасування тут наше
  // власне, воно й було реакцією на неї.
  if (report.fatalError) return { status: 'failed', error: report.fatalError };

  if (aborted) {
    return { status: 'cancelled', error: failed > 0 ? messages.tasksNotCompleted(failed) : null };
  }
  if (failed === 0) return { status: 'done', error: null };

  if (report.findings === 0) {
    const first = report.failedTasks[0]?.error ?? messages.unknownCause;
    return { status: 'failed', error: messages.allTasksFailed(failed, first) };
  }
  return { status: 'done', error: messages.partial(failed) };
}

interface RunContext {
  specName: string;
  specVersion: string;
  gradingRules: string | null;
  /**
   * Легенда позначок стандарту — його власні пояснення кодів біля вимог.
   * Читається на старті виконання: прогін, продовжений після правки легенди,
   * бере нову, і ключ кешу (легенда в ньому) це врахує.
   */
  markerLegend: MarkerLegendItem[] | null;
  /** Мова висновків моделі; `''` — мовою стандарту. Цитати — завжди мовою оригіналу. */
  language: ResultsLanguage;
  /** Службові позначки у findings — мовою результатів. */
  results: MainMessages['results'];
  /** Тексти помилок і статусу прогону — мовою інтерфейсу. */
  uiLanguage: Language;
  ui: MainMessages;
}

function loadRunContext(db: Db, runId: number, specVersionId: number): RunContext {
  const version = db.specs.getVersion(specVersionId);
  const spec = version ? db.specs.get(version.specificationId) : null;

  // Мова, зафіксована на старті прогону; у старих прогонів її немає — тоді поточна.
  const language = db.runs.launchSettings(runId)?.resultsLanguage ?? resultsLanguageOf(db);
  const uiLanguage = uiLanguageOf(db);

  return {
    specName: spec?.name ?? 'Specification',
    specVersion: version?.versionLabel ?? '—',
    gradingRules: db.specs.gradingRules(specVersionId),
    markerLegend: version?.markerLegend ?? null,
    language,
    results: resultsMessages(language).results,
    uiLanguage,
    ui: uiMessages(db),
  };
}

/** Тягне завдання одного етапу, поки вони не закінчаться. */
async function drainStage(
  deps: RunEngineDeps,
  runId: number,
  stage: string,
  controller: AbortController,
  options: ExecuteOptions,
  report: RunExecutionReport,
  context: RunContext,
): Promise<void> {
  const lanes = Math.max(1, options.concurrency ?? 3);

  const lane = async (): Promise<void> => {
    for (;;) {
      if (controller.signal.aborted) return;

      // Пауза ззовні — просто змінений статус у БД; смуги самі зупиняються.
      if (deps.db.runs.get(runId)?.status === 'paused') return;

      const task = deps.db.runTasks.claimNext(runId, stage);
      if (!task) return;

      try {
        if (stage === JUDGE_STAGE) {
          await runJudgeTask(
            deps,
            runId,
            task.payload as JudgeTaskPayload,
            context,
            options,
            report,
            controller.signal,
          );
        } else {
          await runCriticTask(
            deps,
            runId,
            task.payload as CriticTaskPayload,
            context,
            options,
            report,
            controller.signal,
          );
        }
        deps.db.runTasks.complete(task.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        // Скасування — не помилка завдання: повертаємо його в чергу для resume.
        if (controller.signal.aborted) {
          deps.db.runTasks.fail(task.id, 'скасовано', true);
          return;
        }

        // Баланс, ключ, доступ: наступні виклики так само приречені. Зупиняємо
        // весь прогін, а завдання ПОВЕРТАЄМО в чергу — це не його провина.
        if (isFatalLlmError(error)) {
          report.fatalError ??= describeLlmError(context.uiLanguage, error);
          deps.db.runTasks.fail(task.id, message, true);
          controller.abort();
          return;
        }

        // У `run_task` — сирий текст для діагностики, у звіт (а з ним і на
        // екран) — пояснення мовою інтерфейсу.
        deps.db.runTasks.fail(task.id, message);
        report.failedTasks.push({ taskId: task.id, error: errorText(context.uiLanguage, error) });
      }

      emitProgress(deps.db, runId, stage, options);
    }
  };

  await Promise.all(Array.from({ length: lanes }, lane));
}

// ─── Судження ────────────────────────────────────────────────────────────────

async function runJudgeTask(
  deps: RunEngineDeps,
  runId: number,
  payload: JudgeTaskPayload,
  context: RunContext,
  options: ExecuteOptions,
  report: RunExecutionReport,
  signal: AbortSignal,
): Promise<void> {
  const { db } = deps;
  const clauses = db.clauses.getMany(payload.clauseIds);
  if (clauses.length === 0) return;

  const docText = documentText(db, payload.documentVersionId, context.ui, options.maxDocChars);
  const version = db.documents.getVersion(payload.documentVersionId);
  const document = version ? db.documents.get(version.documentId) : null;

  const first = clauses[0]!;
  const input: JudgeV2Input = {
    spec: { name: context.specName, version: context.specVersion, gradingRules: context.gradingRules },
    doc: {
      title: document?.title ?? 'Document',
      versionLabel: version?.versionLabel ?? '—',
      text: docText.text,
    },
    section: { sectionNo: payload.sectionNo, sectionTitle: first.sectionTitle },
    ...(context.language ? { language: context.language } : {}),
    // Позначки й легенда — щоб процедура не отримувала `partial` лише за те, що
    // вона не запис і не огляд майданчика (див. judge.v2).
    markerLegend: context.markerLegend,
    clauses: clauses.map((c) => ({
      clauseNo: c.clauseNo,
      topic: c.topic,
      obligation: c.obligation,
      requirementText: c.requirementText,
      markers: c.markers,
    })),
  };

  const request = buildRequest(judgeV2, input, { model: deps.judge.models[0] });
  const result = await deps.judge.complete<JudgeV2Output>(request, signal);

  accrueUsage(db, runId, result, report);

  const byNo = new Map(clauses.map((c) => [c.clauseNo, c]));
  const inputs: FindingInput[] = [];

  for (const finding of result.data) {
    const clause = byNo.get(finding.clause_no);
    if (!clause) continue; // модель вигадала номер — мовчки не приймаємо
    inputs.push(
      toFindingInput(runId, clause.id, payload.documentVersionId, finding, docText, report, context),
    );
  }

  // Вимоги, про які модель не сказала нічого, — це не «відповідає».
  for (const clause of clauses) {
    if (result.data.some((f) => f.clause_no === clause.clauseNo)) continue;
    inputs.push({
      runId,
      clauseId: clause.id,
      documentVersionId: payload.documentVersionId,
      verdict: 'needs_human_review',
      severity: null,
      confidence: null,
      rationale: context.results.noConclusion,
      evidence: [],
    });
  }

  const saved = db.findings.upsertMany(inputs);
  report.findings += saved.length;
  report.judgeTasks += 1;

  for (const finding of saved) options.onFinding?.(finding);
}

interface DocText {
  text: string;
  extractionId: number | null;
  truncated: boolean;
  /** Офсет у тексті → номер сторінки оригіналу. Робить цитати клікабельними. */
  pageAt(offset: number): number | null;
}

function documentText(
  db: Db,
  documentVersionId: number,
  ui: MainMessages,
  maxChars?: number,
): DocText {
  const version = db.documents.getVersion(documentVersionId);
  if (!version?.extractionId) {
    throw new Error(ui.run.noExtraction(documentVersionId));
  }
  const full = db.extractions.getText(version.extractionId) ?? '';
  const limit = maxChars ?? Number.POSITIVE_INFINITY;
  const extractionId = version.extractionId;

  return {
    text: full.length > limit ? full.slice(0, limit) : full,
    extractionId,
    truncated: full.length > limit,
    pageAt: (offset) => db.extractions.pageAtOffset(extractionId, offset),
  };
}

/**
 * Перетворює відповідь інструмента на рядок БД, дорогою верифікуючи докази.
 *
 * Правило (§10 architecture.md): `compliant` без жодної підтвердженої цитати
 * понижується до `needs_human_review`. Це найдешевший захист від оптимістичних
 * вердиктів, і він механічний — не залежить від моделі.
 */
function toFindingInput(
  runId: number,
  clauseId: number,
  documentVersionId: number,
  finding: ReportFindingV2,
  doc: DocText,
  report: RunExecutionReport,
  context: Pick<RunContext, 'results'>,
): FindingInput {
  const evidence = finding.evidence.map((item) => {
    const verified = verifyQuote(item.quote, doc.text);
    const offset = verified ? doc.text.indexOf(item.quote) : -1;

    // Сторінку беремо з ОФСЕТУ, а не з відповіді моделі: текст їй передається
    // без розбивки на сторінки, тож `item.page` заповнений лише зрідка
    // (у реальному прогоні — 43 зі 169). Офсет же відомий завжди, коли цитату
    // знайдено, а прив'язка офсетів до сторінок лежить в `extraction_page`.
    const pageFromOffset = offset >= 0 ? doc.pageAt(offset) : null;

    return {
      documentVersionId,
      quote: item.quote,
      pageNo: pageFromOffset ?? item.page ?? null,
      charStart: offset >= 0 ? offset : null,
      charEnd: offset >= 0 ? offset + item.quote.length : null,
      source: 'model_quote' as const,
      verified,
    };
  });

  let verdict: Verdict = finding.verdict;
  let severity: Severity | null = severityFromTool(finding.severity);
  let rationale = finding.rationale;

  if (verdict === 'compliant' && !evidence.some((e) => e.verified)) {
    verdict = 'needs_human_review';
    severity = null;
    rationale = `${context.results.unverifiedEvidence} ${rationale}`;
    report.downgraded += 1;
  }

  return {
    runId,
    clauseId,
    documentVersionId,
    verdict,
    severity,
    confidence: finding.confidence,
    rationale,
    gap: finding.gap ?? null,
    recommendation: finding.recommendation ?? null,
    // Порожній рядок — те саме, що «нічого перевіряти поза документом».
    outsideEvidence: finding.outside_evidence?.trim() || null,
    evidence,
  };
}

// ─── Критик ──────────────────────────────────────────────────────────────────

/**
 * Критик перевіряє ТІЛЬКИ `compliant`: найдорожча помилка — пропущена
 * невідповідність. Зайву NC аудитор зніме за десять секунд, пропущену
 * не побачить ніколи.
 */
function enqueueCriticTasks(db: Db, runId: number): number {
  // Ідемпотентно: після паузи чи збою в критику «Продовжити» знову проходить
  // тут, а завдання критика вже в черзі (або виконані). Без фільтра кожен
  // finding отримував би другого критика — подвійна оплата й шанс, що повторна
  // недетермінована перевірка понизить уже підтверджений вердикт.
  const queued = new Set(
    db.runTasks
      .list(runId)
      .filter((task) => task.stage === CRITIC_STAGE)
      .map((task) => (task.payload as Partial<CriticTaskPayload> | null)?.findingId),
  );
  const compliant = db.findings
    .listByRun(runId)
    .filter((f) => f.verdict === 'compliant' && !queued.has(f.id));

  return db.runTasks.enqueueMany(
    runId,
    compliant.map((f) => ({ stage: CRITIC_STAGE, payload: { findingId: f.id } satisfies CriticTaskPayload })),
  );
}

async function runCriticTask(
  deps: RunEngineDeps,
  runId: number,
  payload: CriticTaskPayload,
  context: RunContext,
  options: ExecuteOptions,
  report: RunExecutionReport,
  signal: AbortSignal,
): Promise<void> {
  const { db, critic } = deps;
  if (!critic) return;

  const finding = db.findings.get(payload.findingId);
  if (!finding || finding.verdict !== 'compliant') return;

  const clause = db.clauses.get(finding.clauseId);
  if (!clause) return;

  const input: CriticV2Input = {
    spec: { name: context.specName, version: context.specVersion },
    clause: {
      clauseNo: clause.clauseNo,
      topic: clause.topic,
      obligation: clause.obligation,
      requirementText: clause.requirementText,
      markers: clause.markers,
    },
    // Лише пункти легенди для кодів цієї вимоги: критик бачить мінімум контексту.
    markerLegend: legendEntriesFor(clause.markers, context.markerLegend),
    claimedOutsideEvidence: finding.outsideEvidence,
    evidence: finding.evidence.map((e) => ({
      quote: e.quote,
      page: e.pageNo,
      verified: e.verified,
    })),
    claimedRationale: finding.rationale,
    ...(context.language ? { language: context.language } : {}),
  };

  const request = buildRequest(criticV2, input, { model: critic.models[0] });
  const result = await critic.complete(request, signal);

  accrueUsage(db, runId, result, report);
  report.criticTasks += 1;

  const verdict = result.data as { agree: boolean; reason?: string };
  if (verdict.agree) return;

  // Незгода критика — не автоматична невідповідність, а привід для людини.
  db.findings.upsert({
    runId,
    clauseId: finding.clauseId,
    documentVersionId: finding.documentVersionId,
    verdict: 'needs_human_review',
    severity: finding.severity,
    confidence: finding.confidence,
    rationale: `${context.results.criticDisagreed} ${verdict.reason ?? ''}\n\n${finding.rationale}`.trim(),
    gap: finding.gap,
    recommendation: finding.recommendation,
    // Що перевірити на аудиті, не залежить від того, чи погодився критик.
    outsideEvidence: finding.outsideEvidence,
    evidence: finding.evidence.map((e) => ({
      documentVersionId: e.documentVersionId,
      quote: e.quote,
      pageNo: e.pageNo,
      charStart: e.charStart,
      charEnd: e.charEnd,
      source: e.source,
      verified: e.verified,
    })),
  });

  report.downgraded += 1;
  void options;
}

// ─── Службове ────────────────────────────────────────────────────────────────

function accrueUsage(
  db: Db,
  runId: number,
  result: { usage: { input: number; cachedInput: number; output: number }; costUsd: number },
  report: RunExecutionReport,
): void {
  const delta = {
    inputTokens: result.usage.input,
    cachedTokens: result.usage.cachedInput,
    outputTokens: result.usage.output,
    costUsd: result.costUsd,
  };
  db.runs.addUsage(runId, delta);
  report.usage.inputTokens += delta.inputTokens;
  report.usage.cachedTokens += delta.cachedTokens;
  report.usage.outputTokens += delta.outputTokens;
  report.usage.costUsd += delta.costUsd;
}

function emitProgress(
  db: Db,
  runId: number,
  stage: string | null,
  options: ExecuteOptions,
): void {
  if (!options.onProgress) return;
  const progress = db.runs.progress(runId);
  options.onProgress({
    ...progress,
    stage: (stage as RunProgress['stage']) ?? progress.stage,
  });
}
