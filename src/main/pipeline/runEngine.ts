import type { Db } from '@main/db';
import type { FindingInput } from '@main/db';
import {
  buildRequest,
  criticV1,
  judgeV1,
  describeFatalLlmError,
  isFatalLlmError,
  severityFromTool,
  verifyQuote,
  type CriticInput,
  type JudgeInput,
  type JudgeOutput,
  type LlmProvider,
  type ReportFinding,
} from '@main/llm';
import type {
  ClauseDto,
  FindingDto,
  RunConfig,
  RunProgress,
  Severity,
  UsageTotals,
  Verdict,
} from '@shared/domain';
import { OUT_OF_SCOPE_RATIONALE } from './scoping';

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
  const specVersion = db.specs.getVersion(config.specVersionId);
  if (!specVersion) throw new Error(`Версія специфікації ${config.specVersionId} не знайдена`);
  if (config.documentVersionIds.length === 0) throw new Error('Не вибрано жодного документа');

  const all = db.clauses.list(config.specVersionId);
  if (all.length === 0) throw new Error('Реєстр вимог порожній — спершу виконайте Stage 1');

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
              rationale: OUT_OF_SCOPE_RATIONALE,
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
  status: 'done' | 'cancelled' | 'failed';
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
  if (!run) throw new Error(`Прогін ${runId} не знайдено`);

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

  const context = loadRunContext(db, run.specVersionId);

  try {
    await drainStage(deps, runId, JUDGE_STAGE, controller, options, report, context);

    if (!controller.signal.aborted && deps.critic) {
      enqueueCriticTasks(db, runId);
      await drainStage(deps, runId, CRITIC_STAGE, controller, options, report, context);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.runs.markFinished(runId, 'failed', message);
    return { ...report, status: 'failed' };
  }

  const { status, error } = concludeRun(controller.signal.aborted, report);
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
): { status: 'done' | 'cancelled' | 'failed'; error: string | null } {
  const failed = report.failedTasks.length;

  // Фатальна помилка сильніша за прапорець скасування: скасування тут наше
  // власне, воно й було реакцією на неї.
  if (report.fatalError) return { status: 'failed', error: report.fatalError };

  if (aborted) {
    return { status: 'cancelled', error: failed > 0 ? `Не виконано завдань: ${failed}` : null };
  }
  if (failed === 0) return { status: 'done', error: null };

  if (report.findings === 0) {
    const first = report.failedTasks[0]?.error ?? 'причина невідома';
    return {
      status: 'failed',
      error: `Жодне з ${failed} завдань не виконалось. Перша помилка: ${first}`,
    };
  }
  return { status: 'done', error: `Частково: не виконано завдань ${failed}` };
}

interface RunContext {
  specName: string;
  specVersion: string;
  gradingRules: string | null;
  /** Мова висновків. Цитати лишаються мовою оригіналу незалежно від неї. */
  language: string;
}

function loadRunContext(db: Db, specVersionId: number): RunContext {
  const version = db.specs.getVersion(specVersionId);
  const spec = version ? db.specs.get(version.specificationId) : null;
  return {
    specName: spec?.name ?? 'Specification',
    specVersion: version?.versionLabel ?? '—',
    gradingRules: db.specs.gradingRules(specVersionId),
    language: db.settings.get().resultsLanguage,
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
          report.fatalError ??= describeFatalLlmError(error);
          deps.db.runTasks.fail(task.id, message, true);
          controller.abort();
          return;
        }

        deps.db.runTasks.fail(task.id, message);
        report.failedTasks.push({ taskId: task.id, error: message });
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

  const docText = documentText(db, payload.documentVersionId, options.maxDocChars);
  const version = db.documents.getVersion(payload.documentVersionId);
  const document = version ? db.documents.get(version.documentId) : null;

  const first = clauses[0]!;
  const input: JudgeInput = {
    spec: { name: context.specName, version: context.specVersion, gradingRules: context.gradingRules },
    doc: {
      title: document?.title ?? 'Document',
      versionLabel: version?.versionLabel ?? '—',
      text: docText.text,
    },
    section: { sectionNo: payload.sectionNo, sectionTitle: first.sectionTitle },
    ...(context.language ? { language: context.language } : {}),
    clauses: clauses.map((c) => ({
      clauseNo: c.clauseNo,
      topic: c.topic,
      obligation: c.obligation,
      requirementText: c.requirementText,
    })),
  };

  const request = buildRequest(judgeV1, input, { model: deps.judge.models[0] });
  const result = await deps.judge.complete<JudgeOutput>(request, signal);

  accrueUsage(db, runId, result, report);

  const byNo = new Map(clauses.map((c) => [c.clauseNo, c]));
  const inputs: FindingInput[] = [];

  for (const finding of result.data) {
    const clause = byNo.get(finding.clause_no);
    if (!clause) continue; // модель вигадала номер — мовчки не приймаємо
    inputs.push(toFindingInput(runId, clause.id, payload.documentVersionId, finding, docText, report));
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
      rationale: 'Модель не повернула висновок для цієї вимоги.',
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

function documentText(db: Db, documentVersionId: number, maxChars?: number): DocText {
  const version = db.documents.getVersion(documentVersionId);
  if (!version?.extractionId) {
    throw new Error(`Для версії документа ${documentVersionId} немає екстракції тексту`);
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
  finding: ReportFinding,
  doc: DocText,
  report: RunExecutionReport,
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
    rationale = `[доказ не підтверджено в тексті документа] ${rationale}`;
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
  const compliant = db.findings
    .listByRun(runId)
    .filter((f) => f.verdict === 'compliant');

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

  const input: CriticInput = {
    spec: { name: context.specName, version: context.specVersion },
    clause: {
      clauseNo: clause.clauseNo,
      topic: clause.topic,
      obligation: clause.obligation,
      requirementText: clause.requirementText,
    },
    evidence: finding.evidence.map((e) => ({
      quote: e.quote,
      page: e.pageNo,
      verified: e.verified,
    })),
    claimedRationale: finding.rationale,
    ...(context.language ? { language: context.language } : {}),
  };

  const request = buildRequest(criticV1, input, { model: critic.models[0] });
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
    rationale: `[критик не погодився] ${verdict.reason ?? ''}\n\n${finding.rationale}`.trim(),
    gap: finding.gap,
    recommendation: finding.recommendation,
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
