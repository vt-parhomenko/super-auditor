import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db, RunRouting } from '@main/db';
import {
  describeLlmError,
  errorText,
  resultsLanguageOf,
  resultsMessages,
  uiLanguageOf,
  uiMessages,
  type MainMessages,
} from '@main/i18n';
import { cloudBlocked } from '@main/ipc/errors';
import type { IpcEmitter } from '@main/ipc/events';
import type { RunEstimate, RunOrchestrator } from '@main/ipc/orchestratorPort';
import {
  DEFAULT_ROUTING,
  buildRequest,
  docProfileV1,
  getPricing,
  isLlmError,
  type DocProfileOutput,
  type LlmProvider,
  type ModelPricing,
  type ProviderRegistry,
} from '@main/llm';
import { exportsDir } from '@main/paths';
import {
  VERDICTS,
  type DocProfileDto,
  type ModelRef,
  type RunConfig,
  type Stage,
} from '@shared/domain';
import type { ExportFormat } from '@shared/ipc';
import { extractClausesForSpec } from './clauseExtraction';
import { executeRun, planRun } from './runEngine';
import { withSpendLedger, type LedgerContext } from './ledger';
import { scopeDocuments } from './scoping';

/**
 * Оркестратор — тонкий шар між IPC і конвеєром.
 *
 * Він НЕ містить логіки аудиту: планування й виконання живуть у `runEngine`,
 * Stage 1 — у `clauseExtraction`. Тут лише вибір провайдера під етап,
 * життєвий цикл фонових прогонів і трансляція подій у renderer.
 */

export interface OrchestratorDeps {
  db: Db;
  providers: ProviderRegistry;
  events: IpcEmitter;
}

export function createOrchestrator(deps: OrchestratorDeps): RunOrchestrator {
  const { db, providers, events } = deps;

  /** Активні прогони: потрібні, щоб скасування обривало вже запущений запит. */
  const active = new Map<number, AbortController>();

  /** Чи дозволила специфікація відправку в хмару (ADR-8). */
  const cloudAllowedFor = (specVersionId: number): boolean => {
    const version = db.specs.getVersion(specVersionId);
    const spec = version ? db.specs.get(version.specificationId) : null;
    return spec?.cloudAllowed ?? false;
  };

  const settings = () => db.settings.get();

  /** Повідомлення мовою інтерфейсу — читаються щоразу, бо мову можна змінити будь-коли. */
  const ui = (): MainMessages => uiMessages(db);

  /**
   * `resolveProvider` з поясненням відмови. Заборону хмари реєстр описує
   * загально; тут відомо, ЧОМУ саме (localOnly чи прапорець специфікації), —
   * і саме це людині треба знати, щоб виправити. Решту помилок LLM пояснить
   * межа IPC (`toIpcError`).
   */
  const resolve = (
    stage: Stage,
    opts: { cloudAllowed: boolean; routingOverride?: Partial<Record<Stage, ModelRef>> | null },
  ) => {
    try {
      return providers.resolveProvider(stage, settings(), opts);
    } catch (error) {
      if (isLlmError(error) && error.kind === 'cloud_blocked') {
        const message = describeLlmError(uiLanguageOf(db), error, {
          localOnly: settings().localOnly,
          cloudAllowed: opts.cloudAllowed,
        });
        throw cloudBlocked(message, { providerId: error.providerId, stage: error.stage });
      }
      throw error;
    }
  };

  return {
    // ─── Stage 1 ─────────────────────────────────────────────────────────────

    async extractClauses(specVersionId) {
      const { provider, model } = resolve('clause_extract', {
        cloudAllowed: cloudAllowedFor(specVersionId),
      });

      const report = await extractClausesForSpec(
        db,
        withSpendLedger(provider, db, { specVersionId }),
        specVersionId,
        {
        model: model.model,
        concurrency: settings().concurrency,
        onProgress: (p) =>
          events.emit('clauses:extractProgress', {
            specVersionId,
            page: p.page,
            pageCount: p.pageCount,
            clausesFound: p.clausesFound,
            done: p.done,
            ...(p.error ? { error: p.error } : {}),
          }),
        },
      );

      if (report.failedPages.length > 0) {
        events.toast('warn', ui().clauses.failedPages(report.failedPages.length));
      }
      if (report.flaggedCount > 0) {
        events.toast('warn', ui().clauses.flagged(report.flaggedCount));
      }

      return report.clausesStored;
    },

    // ─── Stage 2 ─────────────────────────────────────────────────────────────

    async buildDocProfile(documentVersionId): Promise<DocProfileDto> {
      const version = db.documents.getVersion(documentVersionId);
      if (!version?.extractionId) {
        throw new Error(ui().run.noExtraction(documentVersionId));
      }
      const document = db.documents.get(version.documentId);
      const text = db.extractions.getText(version.extractionId) ?? '';

      // Реєстр вимог — це підказка «на що дивитись», тому беремо найсвіжішу
      // вичитану специфікацію. Якщо її ще немає, профіль будується без підказки.
      const clauseIndex = latestReviewedClauses(db);

      const { provider, model } = resolve('doc_profile', {
        cloudAllowed: clauseIndex.cloudAllowed,
      });

      const request = buildRequest(
        docProfileV1,
        {
          title: document?.title ?? 'Document',
          versionLabel: version.versionLabel,
          docText: text,
          clauseIndex: clauseIndex.items,
        },
        { model: model.model },
      );

      const result = await withSpendLedger(provider, db).complete<DocProfileOutput>(
        request,
        new AbortController().signal,
      );

      return db.docProfiles.upsert({
        documentVersionId,
        summary: result.data.summary,
        docType: result.data.docType,
        processes: result.data.processes ?? [],
        candidateClauses: result.data.candidateClauses ?? [],
        model: result.modelId,
        promptVersion: docProfileV1.version,
      });
    },

    // ─── Прогони ─────────────────────────────────────────────────────────────

    async estimateRun(config): Promise<RunEstimate> {
      return estimate(db, config, judgeForEstimate(config));
    },

    async startRun(config) {
      const cloudAllowed = cloudAllowedFor(config.specVersionId);
      const current = settings();

      // Провайдерів резолвимо ДО планування: краще впасти на «немає ключа»
      // перед створенням прогону, ніж лишити в базі порожній завислий прогін.
      const judge = resolve('judge', { cloudAllowed, routingOverride: config.routing ?? null });
      const critic = config.skipCritic
        ? null
        : resolve('critic', { cloudAllowed, routingOverride: config.routing ?? null });

      // Scope рахуємо ДО планування: один дешевий виклик на документ, який
      // знімає ~19 із 24 викликів судження і, головне, прибирає хибні `partial`
      // на дотичних секціях (див. `scoping.ts`).
      // Спільний контекст журналу: runId стане відомий лише після планування,
      // а профілювання відбувається до нього — і теж має потрапити в облік.
      const ledger: LedgerContext = { specVersionId: config.specVersionId, runId: null };

      // Профіль документа: перевизначення з конфігурації прогону діє і тут (інакше
      // користувач лише з ключем OpenRouter упирався б у «Anthropic не налаштовано»),
      // а в режимі `all` модель профілю не потрібна зовсім — і не вимагаємо її.
      const scopeMode = config.scope ?? 'profile';
      const profiler =
        scopeMode === 'all'
          ? null
          : resolve('doc_profile', { cloudAllowed, routingOverride: config.routing ?? null });
      const scope = await scopeDocuments(
        db,
        profiler ? withSpendLedger(profiler.provider, db, ledger) : null,
        config.specVersionId,
        config.documentVersionIds,
        { mode: scopeMode },
      );

      const fallbacks = [...scope.values()].filter((s) => s.source === 'fallback');
      if (fallbacks.length > 0) {
        events.toast('warn', ui().run.scopeFallback(fallbacks.length));
      }

      // Маршрутизацію фіксуємо в прогоні: resume має продовжити на тих самих
      // моделях, навіть якщо налаштування за цей час змінились.
      const routing: RunRouting = { judge: judge.model, critic: critic?.model ?? null };

      const plan = planRun(
        db,
        config,
        {
          judge: judge.model.model,
          critic: critic?.model.model ?? null,
          promptVersion: 'judge.v1',
        },
        { scope: new Map([...scope].map(([id, s]) => [id, s.sections])), routing },
      );

      ledger.runId = plan.runId;
      void launch(
        plan.runId,
        withSpendLedger(judge.provider, db, ledger),
        critic ? withSpendLedger(critic.provider, db, ledger) : undefined,
        current.concurrency,
      );
      return plan.runId;
    },

    async pauseRun(runId) {
      // Пауза — це стан у БД: смуги виконання самі зупиняються, коли його бачать.
      // Уже запущені запити доводяться до кінця, щоб не викидати оплачений результат.
      db.runs.setStatus(runId, 'paused');
    },

    async resumeRun(runId) {
      const run = db.runs.get(runId);
      if (!run) throw new Error(ui().run.notFound(runId));
      if (active.has(runId)) return;

      const cloudAllowed = cloudAllowedFor(run.specVersionId);
      const current = settings();

      // Продовжуємо на тих моделях, з якими прогін стартував (разом із
      // перевизначенням із конфігурації прогону), а не на поточних налаштуваннях:
      // інакше половина findings прийшла б від іншої моделі, ніж записано в
      // `model_judge`. Старі прогони маршрутизації не зберігали — для них, як і
      // раніше, діють поточні налаштування.
      const routingOverride = launchRouting(db.runs.launchSettings(runId)?.routing ?? null);
      const judge = resolve('judge', { cloudAllowed, routingOverride });
      const critic = run.modelCritic ? resolve('critic', { cloudAllowed, routingOverride }) : null;

      db.runTasks.requeueStale(runId);
      db.runTasks.requeueFailed(runId);

      const ledger: LedgerContext = { specVersionId: run.specVersionId, runId };
      void launch(
        runId,
        withSpendLedger(judge.provider, db, ledger),
        critic ? withSpendLedger(critic.provider, db, ledger) : undefined,
        current.concurrency,
      );
    },

    async cancelRun(runId) {
      active.get(runId)?.abort();
      db.runs.setStatus(runId, 'cancelled');
    },

    // ─── Експорт ─────────────────────────────────────────────────────────────

    async exportRun(runId, format) {
      return exportRunToFile(db, runId, format);
    },
  };

  /** Запускає виконання у фоні й транслює події в renderer. */
  function launch(
    runId: number,
    judge: Parameters<typeof executeRun>[0]['judge'],
    critic: Parameters<typeof executeRun>[0]['critic'],
    concurrency: number,
  ): Promise<void> {
    const controller = new AbortController();
    active.set(runId, controller);

    return executeRun({ db, judge, critic }, runId, {
      concurrency,
      signal: controller.signal,
      onProgress: (progress) => {
        events.emit('run:progress', progress);
        events.emit('usage:updated', { runId, usage: progress.usage });
      },
      onFinding: (finding) => events.emit('run:finding', { runId, finding }),
    })
      // Прибираємо з активних ДО `run:finished`: інакше «Продовжити», натиснуте
      // одразу після події, побачило б прогін ще живим і тихо нічого не зробило.
      .finally(() => {
        active.delete(runId);
      })
      .then((report) => {
        // Пауза — не фінал: прогін продовжиться кнопкою «Продовжити», прогрес уже надіслано.
        if (report.status === 'paused') return;
        const error =
          report.fatalError ??
          (report.failedTasks.length > 0
            ? ui().run.tasksNotCompleted(report.failedTasks.length)
            : undefined);
        events.emit('run:finished', {
          runId,
          status: report.status,
          ...(error ? { error } : {}),
        });
      })
      .catch((error: unknown) => {
        const message = errorText(uiLanguageOf(db), error);
        db.runs.markFinished(runId, 'failed', message);
        events.emit('run:finished', { runId, status: 'failed', error: message });
        events.toast('error', ui().run.crashed(runId, message));
      });
  }

  /**
   * Модель судження і її ціни — так само, як їх обере `startRun`
   * (налаштування + перевизначення з конфігурації прогону).
   *
   * Оцінка корисна й до того, як усе налаштовано: якщо провайдер ще без ключа
   * чи хмару заборонено, беремо модель із маршрутизації без перевірок доступу,
   * а за нею — модель судження за замовчуванням.
   */
  function judgeForEstimate(config: RunConfig): JudgePricing {
    const routingOverride = config.routing ?? null;
    try {
      const { provider, model } = providers.resolveProvider('judge', settings(), {
        cloudAllowed: cloudAllowedFor(config.specVersionId),
        routingOverride,
      });
      return { model: model.model, pricing: pricingOf(provider, model.model) };
    } catch {
      const ref = routedJudge(routingOverride);
      return { model: ref.model, pricing: pricingOf(providers.get(ref.provider), ref.model) };
    }
  }

  /**
   * Маршрутизація судження без перевірок доступу — так само, як її розв'яже
   * `resolveProvider` (з моделлю провайдера за замовчуванням, якщо модель не
   * вибрано). Зовсім без моделі — модель судження за замовчуванням.
   */
  function routedJudge(override: Partial<Record<Stage, ModelRef>> | null): ModelRef {
    const ref = providers.routingFor('judge', settings(), override);
    return ref.model ? ref : DEFAULT_ROUTING.judge;
  }
}

/** Перевизначення маршрутизації для resume з зафіксованої на старті. */
function launchRouting(routing: RunRouting | null): Partial<Record<Stage, ModelRef>> | null {
  if (!routing) return null;
  return routing.critic ? { judge: routing.judge, critic: routing.critic } : { judge: routing.judge };
}

// ─── Оцінка вартості ─────────────────────────────────────────────────────────

/** Модель судження, за якою рахуємо оцінку. `pricing: null` — ціна невідома. */
interface JudgePricing {
  model: string;
  pricing: ModelPricing | null;
}

/**
 * Ціни моделі: спершу від самого провайдера (живий каталог OpenRouter тощо),
 * потім із вбудованої таблиці. Невідома модель — `null`, ціну не вигадуємо.
 */
function pricingOf(provider: LlmProvider | undefined, model: string): ModelPricing | null {
  return provider?.pricingFor?.(model) ?? getPricing(model);
}

/** Груба, але миттєва оцінка: ~4 символи на токен. Мережу не чіпає. */
const CHARS_PER_TOKEN = 4;

function estimate(db: Db, config: RunConfig, judge: JudgePricing): RunEstimate {
  const clauses = db.clauses.list(config.specVersionId);
  const sections = new Set(clauses.map((c) => c.sectionNo ?? 'inne'));
  const tasks = sections.size * config.documentVersionIds.length;

  const clauseChars = clauses.reduce((sum, c) => sum + c.requirementText.length, 0);

  let docChars = 0;
  for (const id of config.documentVersionIds) {
    const version = db.documents.getVersion(id);
    if (!version?.extractionId) continue;
    docChars += db.extractions.getMeta(version.extractionId)?.charCount ?? 0;
  }

  // Текст документа їде в кожен батч секцій цього документа, але як кешований
  // префікс: перший раз повна ціна, далі ~10%. Рахуємо як 1 повний + решта по 0.1.
  const perDocSections = sections.size;
  const cacheFactor = perDocSections > 0 ? 1 + (perDocSections - 1) * 0.1 : 0;
  const inputTokens = Math.round(
    (docChars * cacheFactor + clauseChars * config.documentVersionIds.length) / CHARS_PER_TOKEN,
  );

  // Вихід оцінюємо як ~300 токенів на вимогу (rationale + докази).
  const outputTokens = clauses.length * config.documentVersionIds.length * 300;

  // Ціни — моделі судження з маршрутизації. Дешеві моделі коштують частки
  // цента, тож округлюємо до 4 знаків, а не до центів: «$0.00» збрехало б.
  const costUsd = judge.pricing
    ? Math.round(
        ((inputTokens / 1_000_000) * judge.pricing.inputPerMTok +
          (outputTokens / 1_000_000) * judge.pricing.outputPerMTok) *
          10_000,
      ) / 10_000
    : null;

  return { tasks, inputTokens, costUsd, model: judge.model };
}

// ─── Допоміжне ───────────────────────────────────────────────────────────────

interface ClauseIndex {
  items: Array<{ clauseNo: string; topic: string | null; sectionTitle: string | null }>;
  cloudAllowed: boolean;
}

/** Найсвіжіша вичитана специфікація — джерело підказки для профілю документа. */
function latestReviewedClauses(db: Db): ClauseIndex {
  for (const spec of db.specs.list()) {
    for (const version of spec.versions) {
      if (version.clausesStatus !== 'reviewed') continue;
      return {
        items: db.clauses.list(version.id).map((c) => ({
          clauseNo: c.clauseNo,
          topic: c.topic,
          sectionTitle: c.sectionTitle,
        })),
        cloudAllowed: spec.cloudAllowed,
      };
    }
  }
  return { items: [], cloudAllowed: false };
}

/**
 * Експорт. JSON і Markdown робимо самі; XLSX і PDF потребують бібліотек,
 * яких у проекті немає — краще чесна помилка, ніж мовчазний неповний файл.
 */
export function exportRunToFile(db: Db, runId: number, format: ExportFormat): { path: string } {
  const ui = uiMessages(db);
  const run = db.runs.get(runId);
  if (!run) throw new Error(ui.run.notFound(runId));

  if (format === 'xlsx' || format === 'pdf') {
    throw new Error(ui.exporting.notImplemented(format.toUpperCase()));
  }

  const summary = db.runs.summary(runId);
  const findings = db.findings.listByRun(runId);
  const gaps = db.runs.gaps(runId);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(exportsDir(), `run-${runId}-${stamp}.${format === 'json' ? 'json' : 'md'}`);

  if (format === 'json') {
    writeFileSync(path, JSON.stringify({ run, summary, findings, gaps }, null, 2), 'utf8');
    return { path };
  }

  // Звіт — частина результатів: мовою, якою прогін писав висновки
  // (у старих прогонів її не записано — тоді поточна мова результатів).
  const language = db.runs.launchSettings(runId)?.resultsLanguage ?? resultsLanguageOf(db);
  writeFileSync(
    path,
    renderMarkdown(resultsMessages(language).export, runId, summary, findings, gaps),
    'utf8',
  );
  return { path };
}

/**
 * Markdown-звіт. Заголовки й підписи — мовою результатів; вердикти й severity
 * перекладено тими самими словами, що й у самому звіті (у JSON лишаються коди).
 */
function renderMarkdown(
  m: MainMessages['export'],
  runId: number,
  summary: ReturnType<Db['runs']['summary']>,
  findings: ReturnType<Db['findings']['listByRun']>,
  gaps: ReturnType<Db['runs']['gaps']>,
): string {
  const lines: string[] = [`# ${m.title(runId)}`, ''];

  lines.push(`## ${m.summary}`, '');
  lines.push(`- ${m.applicable(summary.clausesApplicable)}`);
  lines.push(`- ${m.assessed(summary.clausesAssessed)}`);
  lines.push(`- ${m.gaps(summary.gaps)}`);
  lines.push(`- ${m.cost(`$${summary.usage.costUsd.toFixed(4)}`)}`, '');

  lines.push(`| ${m.colVerdict} | ${m.colCount} |`, '|---|---|');
  for (const verdict of VERDICTS) {
    const count = summary.counts[verdict] ?? 0;
    if (count > 0) lines.push(`| ${m.verdicts[verdict]} | ${count} |`);
  }
  lines.push('');

  const problems = findings.filter(
    (f) => f.verdict === 'non_compliant' || f.verdict === 'partial',
  );
  if (problems.length > 0) {
    lines.push(`## ${m.nonConformities}`, '');
    for (const f of problems) {
      lines.push(`### ${f.clause.clauseNo} — ${f.clause.topic ?? ''}`.trim());
      const severity = f.severity ? ` (${m.severities[f.severity]})` : '';
      lines.push(`**${m.verdictLabel}:** ${m.verdicts[f.verdict]}${severity}`, '');
      lines.push(f.rationale, '');
      if (f.gap) lines.push(`**${m.gapLabel}:** ${f.gap}`, '');
      if (f.recommendation) lines.push(`**${m.recommendationLabel}:** ${f.recommendation}`, '');
      for (const e of f.evidence) {
        lines.push(`> ${e.quote}${e.pageNo ? ` _(${m.page(e.pageNo)})_` : ''}`);
      }
      lines.push('');
    }
  }

  if (gaps.length > 0) {
    lines.push(`## ${m.gapsTitle}`, '');
    lines.push(`| ${m.colClause} | ${m.colSection} | ${m.colTopic} |`, '|---|---|---|');
    for (const g of gaps) {
      lines.push(`| ${g.clauseNo} | ${g.sectionTitle ?? g.sectionNo ?? '—'} | ${g.topic ?? ''} |`);
    }
  }

  return lines.join('\n');
}
