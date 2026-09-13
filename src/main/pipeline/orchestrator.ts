import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '@main/db';
import type { IpcEmitter } from '@main/ipc/events';
import type { RunEstimate, RunOrchestrator } from '@main/ipc/orchestratorPort';
import {
  buildRequest,
  docProfileV1,
  type DocProfileOutput,
  type ProviderRegistry,
} from '@main/llm';
import { exportsDir } from '@main/paths';
import type { DocProfileDto, RunConfig } from '@shared/domain';
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

  return {
    // ─── Stage 1 ─────────────────────────────────────────────────────────────

    async extractClauses(specVersionId) {
      const { provider, model } = providers.resolveProvider('clause_extract', settings(), {
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
        events.toast(
          'warn',
          `Не вдалося обробити сторінок: ${report.failedPages.length}. Реєстр неповний.`,
        );
      }
      if (report.flaggedCount > 0) {
        events.toast(
          'warn',
          `${report.flaggedCount} вимог позначено на перевірку — вичитайте їх першими.`,
        );
      }

      return report.clausesStored;
    },

    // ─── Stage 2 ─────────────────────────────────────────────────────────────

    async buildDocProfile(documentVersionId): Promise<DocProfileDto> {
      const version = db.documents.getVersion(documentVersionId);
      if (!version?.extractionId) {
        throw new Error(`Для версії документа ${documentVersionId} немає екстракції тексту`);
      }
      const document = db.documents.get(version.documentId);
      const text = db.extractions.getText(version.extractionId) ?? '';

      // Реєстр вимог — це підказка «на що дивитись», тому беремо найсвіжішу
      // вичитану специфікацію. Якщо її ще немає, профіль будується без підказки.
      const clauseIndex = latestReviewedClauses(db);

      const { provider, model } = providers.resolveProvider('doc_profile', settings(), {
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
      return estimate(db, config);
    },

    async startRun(config) {
      const cloudAllowed = cloudAllowedFor(config.specVersionId);
      const current = settings();

      // Провайдерів резолвимо ДО планування: краще впасти на «немає ключа»
      // перед створенням прогону, ніж лишити в базі порожній завислий прогін.
      const judge = providers.resolveProvider('judge', current, {
        cloudAllowed,
        routingOverride: config.routing ?? null,
      });
      const critic = config.skipCritic
        ? null
        : providers.resolveProvider('critic', current, {
            cloudAllowed,
            routingOverride: config.routing ?? null,
          });

      // Scope рахуємо ДО планування: один дешевий виклик на документ, який
      // знімає ~19 із 24 викликів судження і, головне, прибирає хибні `partial`
      // на дотичних секціях (див. `scoping.ts`).
      // Спільний контекст журналу: runId стане відомий лише після планування,
      // а профілювання відбувається до нього — і теж має потрапити в облік.
      const ledger: LedgerContext = { specVersionId: config.specVersionId, runId: null };

      const profiler = providers.resolveProvider('doc_profile', current, { cloudAllowed });
      const scope = await scopeDocuments(
        db,
        withSpendLedger(profiler.provider, db, ledger),
        config.specVersionId,
        config.documentVersionIds,
        { mode: config.scope ?? 'profile' },
      );

      const fallbacks = [...scope.values()].filter((s) => s.source === 'fallback');
      if (fallbacks.length > 0) {
        events.toast(
          'warn',
          `Не вдалося звузити перевірку для документів: ${fallbacks.length}. ` +
            'Їх буде перевірено проти всього стандарту.',
        );
      }

      const plan = planRun(
        db,
        config,
        {
          judge: judge.model.model,
          critic: critic?.model.model ?? null,
          promptVersion: 'judge.v1',
        },
        { scope: new Map([...scope].map(([id, s]) => [id, s.sections])) },
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
      if (!run) throw new Error(`Прогін ${runId} не знайдено`);
      if (active.has(runId)) return;

      const cloudAllowed = cloudAllowedFor(run.specVersionId);
      const current = settings();
      const judge = providers.resolveProvider('judge', current, { cloudAllowed });
      const critic = run.modelCritic
        ? providers.resolveProvider('critic', current, { cloudAllowed })
        : null;

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
      .then((report) => {
        events.emit('run:finished', {
          runId,
          status: report.status,
          ...(report.failedTasks.length > 0
            ? { error: `Не виконано завдань: ${report.failedTasks.length}` }
            : {}),
        });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        db.runs.markFinished(runId, 'failed', message);
        events.emit('run:finished', { runId, status: 'failed', error: message });
        events.toast('error', `Прогін ${runId} впав: ${message}`);
      })
      .finally(() => {
        active.delete(runId);
      });
  }
}

// ─── Оцінка вартості ─────────────────────────────────────────────────────────

/** Груба, але миттєва оцінка: ~4 символи на токен. Мережу не чіпає. */
const CHARS_PER_TOKEN = 4;

function estimate(db: Db, config: RunConfig): RunEstimate {
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

  // Ціни Opus 5: $5/1M вхід, $25/1M вихід.
  const costUsd = (inputTokens / 1_000_000) * 5 + (outputTokens / 1_000_000) * 25;

  return { tasks, inputTokens, costUsd: Math.round(costUsd * 100) / 100 };
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
  const run = db.runs.get(runId);
  if (!run) throw new Error(`Прогін ${runId} не знайдено`);

  if (format === 'xlsx' || format === 'pdf') {
    throw new Error(
      `Експорт у ${format.toUpperCase()} ще не реалізовано — потрібна окрема бібліотека. Доступні формати: JSON, Markdown.`,
    );
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

  writeFileSync(path, renderMarkdown(db, runId, summary, findings, gaps), 'utf8');
  return { path };
}

function renderMarkdown(
  db: Db,
  runId: number,
  summary: ReturnType<Db['runs']['summary']>,
  findings: ReturnType<Db['findings']['listByRun']>,
  gaps: ReturnType<Db['runs']['gaps']>,
): string {
  const lines: string[] = [`# Аудит — прогін ${runId}`, ''];

  lines.push('## Підсумок', '');
  lines.push(`- Застосовних вимог: ${summary.clausesApplicable}`);
  lines.push(`- Оцінено: ${summary.clausesAssessed}`);
  lines.push(`- Прогалин: ${summary.gaps}`);
  lines.push(`- Вартість: $${summary.usage.costUsd.toFixed(4)}`, '');

  lines.push('| Вердикт | Кількість |', '|---|---|');
  for (const [verdict, count] of Object.entries(summary.counts)) {
    if (count > 0) lines.push(`| ${verdict} | ${count} |`);
  }
  lines.push('');

  const problems = findings.filter(
    (f) => f.verdict === 'non_compliant' || f.verdict === 'partial',
  );
  if (problems.length > 0) {
    lines.push('## Невідповідності', '');
    for (const f of problems) {
      lines.push(`### ${f.clause.clauseNo} — ${f.clause.topic ?? ''}`.trim());
      lines.push(`**Вердикт:** ${f.verdict}${f.severity ? ` (${f.severity})` : ''}`, '');
      lines.push(f.rationale, '');
      if (f.gap) lines.push(`**Чого бракує:** ${f.gap}`, '');
      if (f.recommendation) lines.push(`**Рекомендація:** ${f.recommendation}`, '');
      for (const e of f.evidence) {
        lines.push(`> ${e.quote}${e.pageNo ? ` _(стор. ${e.pageNo})_` : ''}`);
      }
      lines.push('');
    }
  }

  if (gaps.length > 0) {
    lines.push('## Прогалини — вимоги без жодного доказу', '');
    lines.push('| Вимога | Секція | Тема |', '|---|---|---|');
    for (const g of gaps) {
      lines.push(`| ${g.clauseNo} | ${g.sectionTitle ?? g.sectionNo ?? '—'} | ${g.topic ?? ''} |`);
    }
  }

  void db;
  return lines.join('\n');
}
