/**
 * Реалізація `RendererApi` на фікстурах — вмикається через `?mock=1` або `VITE_MOCK=1`.
 *
 * Це не тест-дубль, а інструмент розробки UI: він емулює латентність, події
 * прогресу й мутації, щоб екрани можна було реально побачити до появи бекенда.
 */

import {
  clauseSortKey,
  type AuditRunDto,
  type ClauseDto,
  type DocumentDto,
  type FindingDto,
  type HumanReviewDto,
  type RunConfig,
  type RunProgress,
  type SiteProfileDto,
  type SpecificationDto,
  type SpecVersionDto,
  type UsageTotals,
} from '@shared/domain';
import type { AppSettings, IpcEventChannel, IpcEvents, ProviderStatus, RendererApi } from '@shared/ipc';
import {
  buildCoverage,
  buildDocumentRuns,
  buildExtraction,
  buildGaps,
  buildRecentSpend,
  buildSpendSummary,
  buildSummary,
  buildOpenRouterBalance,
  applicableCount,
  CLAUSES,
  DOCUMENTS,
  DOC_PROFILES,
  FINDINGS,
  PROSE_CLAUSES,
  PROVIDERS,
  RUNS,
  RUN_DOC_VERSION_IDS,
  SETTINGS,
  SITE_PROFILES,
  SPECIFICATIONS,
  SPEC_SUMMARY,
} from './fixtures';
import { effectiveRouting } from '@renderer/lib/models';
import { buildMockPdf } from './mockPdf';
import { applyMockDeletion, mockDeleteImpact } from './mockLibraryDeletion';

type Handlers = Omit<RendererApi, 'on'>;

const delay = (ms = 110) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// ─── Мутабельний стан ────────────────────────────────────────────────────────

const state = {
  documents: clone(DOCUMENTS) as DocumentDto[],
  specs: clone(SPECIFICATIONS) as SpecificationDto[],
  clauses: clone([...CLAUSES, ...PROSE_CLAUSES]) as ClauseDto[],
  sites: clone(SITE_PROFILES) as SiteProfileDto[],
  runs: clone(RUNS) as AuditRunDto[],
  findings: clone(FINDINGS) as FindingDto[],
  settings: clone(SETTINGS) as AppSettings,
  providers: clone(PROVIDERS) as ProviderStatus[],
  /** Стан management-ключа: «bad» у полі вводу емулює ключ, який провайдер відхилив. */
  managementKeys: { openrouter: 'valid' } as Record<string, 'none' | 'valid' | 'rejected'>,
};

/**
 * Модель судження, за цінами якої рахується оцінка: перевизначення прогону →
 * налаштування → вбудоване значення. Так само, як `resolveRouting` у main.
 */
function judgeModel(config: RunConfig): { provider: string; model: string } {
  return effectiveRouting('judge', config.routing?.judge ?? state.settings.routing.judge ?? null);
}

/** `lastRun` — похідне поле: найновіший прогін, що торкався документа. */
function withLastRun(doc: DocumentDto): DocumentDto {
  return { ...doc, lastRun: liveDocumentRuns(doc.id)[0] ?? null };
}

/** Статистика з фікстур, але лише по перевірках, яких ще не видалили. */
function liveDocumentRuns(documentId: number) {
  return buildDocumentRuns(documentId).filter((stats) => state.runs.some((r) => r.id === stats.runId));
}

function allSpecVersions(): SpecVersionDto[] {
  return state.specs.flatMap((s) => s.versions);
}

function refreshSpecCounters(): void {
  for (const spec of state.specs) {
    for (const version of spec.versions) {
      const list = state.clauses.filter((c) => c.specVersionId === version.id);
      // Версії без вимог у моку (Tesco 4.2) тримають свої статичні лічильники.
      if (list.length === 0) continue;
      version.clauseCount = list.length;
      version.reviewedClauseCount = list.filter(
        (c) => c.reviewStatus === 'confirmed' || c.reviewStatus === 'edited',
      ).length;
    }
  }
}

// ─── Шина подій ──────────────────────────────────────────────────────────────

type Listener = (payload: never) => void;
const listeners = new Map<IpcEventChannel, Set<Listener>>();

function emit<E extends IpcEventChannel>(event: E, payload: IpcEvents[E]): void {
  const set = listeners.get(event);
  if (!set) return;
  for (const listener of set) (listener as (p: IpcEvents[E]) => void)(payload);
}

function on<E extends IpcEventChannel>(event: E, listener: (payload: IpcEvents[E]) => void): () => void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(listener as Listener);
  return () => {
    set?.delete(listener as Listener);
  };
}

const info = (message: string) => emit('toast', { level: 'info', message });

// ─── Симуляція прогону ───────────────────────────────────────────────────────

const timers = new Map<number, number>();
let nextRunId = Math.max(...RUNS.map((r) => r.id)) + 1;

function addUsage(a: UsageTotals, delta: UsageTotals): UsageTotals {
  return {
    inputTokens: a.inputTokens + delta.inputTokens,
    cachedTokens: a.cachedTokens + delta.cachedTokens,
    outputTokens: a.outputTokens + delta.outputTokens,
    costUsd: Math.round((a.costUsd + delta.costUsd) * 10000) / 10000,
  };
}

const progressByRun = new Map<number, RunProgress>();

function tick(runId: number): void {
  const run = state.runs.find((r) => r.id === runId);
  const progress = progressByRun.get(runId);
  if (!run || !progress || run.status !== 'running') return;

  progress.tasksDone = Math.min(progress.tasksTotal, progress.tasksDone + 1);
  progress.stage = progress.tasksDone < 4 ? 'doc_profile' : progress.tasksDone > progress.tasksTotal - 4 ? 'critic' : 'judge';
  const section = ((progress.tasksDone * 3) % 24) + 1;
  progress.currentLabel = `Секція ${section} · документ ${RUN_DOC_VERSION_IDS[progress.tasksDone % 3] ?? 11}`;
  progress.usage = addUsage(progress.usage, {
    inputTokens: 24_000,
    cachedTokens: 17_000,
    outputTokens: 2400,
    costUsd: 0.083,
  });
  run.usage = progress.usage;

  emit('run:progress', clone(progress));
  emit('usage:updated', { runId, usage: clone(progress.usage) });

  if (progress.tasksDone >= progress.tasksTotal) {
    stopTimer(runId);
    run.status = 'done';
    run.finishedAt = new Date().toISOString();
    progress.status = 'done';
    emit('run:progress', clone(progress));
    emit('run:finished', { runId, status: 'done' });
    info(`Прогін #${runId} завершено`);
  }
}

function startTimer(runId: number): void {
  stopTimer(runId);
  timers.set(runId, window.setInterval(() => tick(runId), 900));
}

function stopTimer(runId: number): void {
  const handle = timers.get(runId);
  if (handle != null) window.clearInterval(handle);
  timers.delete(runId);
}

// ─── Хендлери ────────────────────────────────────────────────────────────────

const handlers: Handlers = {
  // — Бібліотека
  'documents:list': async (query) => {
    await delay();
    const search = query?.search?.trim().toLowerCase();
    return state.documents
      .filter((d) => {
        if (query?.kind && d.kind !== query.kind) return false;
        if (!search) return true;
        return (
          d.title.toLowerCase().includes(search) ||
          (d.docNumber ?? '').toLowerCase().includes(search) ||
          (d.processOwner ?? '').toLowerCase().includes(search)
        );
      })
      .map(withLastRun);
  },
  'documents:get': async (documentId) => {
    await delay(60);
    const doc = state.documents.find((d) => d.id === documentId);
    return doc ? withLastRun(doc) : null;
  },
  'documents:runs': async (documentId) => {
    await delay(150);
    return liveDocumentRuns(documentId);
  },
  'documents:update': async (documentId, patch) => {
    await delay(140);
    const doc = state.documents.find((d) => d.id === documentId);
    if (!doc) throw new Error(`Документ ${documentId} не знайдено`);
    Object.assign(doc, patch);
    emit('library:changed', { kind: 'documents' });
    info(`Метадані «${doc.title}» збережено`);
  },

  // — Видалення специфікацій і документів (разом із перевірками, що на них спираються)
  'library:deleteImpact': async (target) => {
    await delay(280);
    const impact = mockDeleteImpact(state, target);
    if (!impact) throw new Error(`[NOT_FOUND] ${target.kind} ${target.id}`);
    return impact;
  },
  'library:delete': async (target) => {
    await delay(360);
    const before = mockDeleteImpact(state, target);
    if (!before) throw new Error(`[NOT_FOUND] ${target.kind} ${target.id}`);
    // Як у main: живу перевірку спершу зупиняємо. Журнал витрат не чіпаємо.
    for (const run of before.runs) {
      stopTimer(run.id);
      progressByRun.delete(run.id);
    }
    const impact = applyMockDeletion(state, target);
    if (!impact) throw new Error(`[NOT_FOUND] ${target.kind} ${target.id}`);
    const isSpec = target.kind === 'specification' || target.kind === 'specVersion';
    if (isSpec) emit('library:changed', { kind: 'specifications' });
    if (!isSpec || impact.runs.length > 0) emit('library:changed', { kind: 'documents' });
    return impact;
  },

  // — Специфікації
  'specs:list': async () => {
    await delay();
    return state.specs;
  },
  'specs:get': async (specificationId) => {
    await delay(60);
    return state.specs.find((s) => s.id === specificationId) ?? null;
  },
  'specs:setCloudAllowed': async (specificationId, allowed) => {
    await delay(120);
    const spec = state.specs.find((s) => s.id === specificationId);
    if (spec) spec.cloudAllowed = allowed;
    emit('toast', {
      level: allowed ? 'warn' : 'info',
      message: allowed
        ? `Вміст «${spec?.name ?? specificationId}» тепер може йти у хмарного провайдера`
        : `Хмарні провайдери для «${spec?.name ?? specificationId}» заборонено`,
    });
  },
  'specs:version': async (specVersionId) => {
    await delay(60);
    refreshSpecCounters();
    return allSpecVersions().find((v) => v.id === specVersionId) ?? null;
  },
  'specs:summary': async (specVersionId) => {
    await delay(90);
    return specVersionId === 1 ? SPEC_SUMMARY : null;
  },

  // — Реєстр вимог
  'clauses:list': async (specVersionId) => {
    await delay(180);
    return state.clauses
      .filter((c) => c.specVersionId === specVersionId)
      .slice()
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  },
  'clauses:get': async (clauseId) => {
    await delay(50);
    return state.clauses.find((c) => c.id === clauseId) ?? null;
  },
  'clauses:patch': async (clauseId, patch) => {
    await delay(90);
    const clause = state.clauses.find((c) => c.id === clauseId);
    if (!clause) throw new Error(`Вимогу ${clauseId} не знайдено`);
    Object.assign(clause, patch);
    if (patch.clauseNo) clause.sortKey = clauseSortKey(patch.clauseNo);
    refreshSpecCounters();
    return clause;
  },
  'clauses:create': async (specVersionId, clause) => {
    await delay(120);
    const created: ClauseDto = {
      id: Math.max(...state.clauses.map((c) => c.id)) + 1,
      specVersionId,
      clauseNo: clause.clauseNo,
      sortKey: clauseSortKey(clause.clauseNo),
      sectionNo: clause.sectionNo ?? null,
      sectionTitle: clause.sectionTitle ?? null,
      topic: clause.topic ?? null,
      requirementText: clause.requirementText,
      modules: clause.modules ?? [],
      markers: clause.markers ?? [],
      obligation: clause.obligation ?? null,
      pageFrom: null,
      pageTo: null,
      textHash: `sha256:${Date.now().toString(16)}`,
      reviewStatus: 'edited',
    };
    state.clauses.push(created);
    refreshSpecCounters();
    return created;
  },
  'clauses:delete': async (clauseId) => {
    await delay(90);
    state.clauses = state.clauses.filter((c) => c.id !== clauseId);
    refreshSpecCounters();
  },
  'clauses:extract': async (specVersionId) => {
    await delay(200);
    const pageCount = 101;
    let page = 0;
    let found = 0;
    const handle = window.setInterval(() => {
      page += 4;
      found += Math.floor(Math.random() * 9);
      const done = page >= pageCount;
      emit('clauses:extractProgress', {
        specVersionId,
        page: Math.min(page, pageCount),
        pageCount,
        clausesFound: done ? state.clauses.length : found,
        done,
      });
      if (done) {
        window.clearInterval(handle);
        info('Реєстр вимог витягнуто. Потрібна ручна вичитка.');
      }
    }, 260);
    return 777;
  },
  'clauses:markReviewed': async (specVersionId) => {
    await delay(160);
    const pending = state.clauses.filter(
      (c) => c.specVersionId === specVersionId && (c.reviewStatus === 'auto' || c.reviewStatus === 'flagged'),
    );
    if (pending.length > 0) {
      throw new Error(`Залишилось ${pending.length} вимог без підтвердження або з позначкою`);
    }
    const version = allSpecVersions().find((v) => v.id === specVersionId);
    if (version) version.clausesStatus = 'reviewed';
    info('Реєстр позначено вичитаним — аудит розблоковано');
  },

  // — Імпорт
  'import:pick': async (kind) => {
    await delay(300);
    return kind === 'specification'
      ? ['C:\\Users\\demo\\Documents\\20405V5.0EN - Tesco Ornamental Plant Standard 2026.pdf']
      : [
          'C:\\Users\\demo\\Documents\\SOP 0045 Receiving v003.pdf',
          'C:\\Users\\demo\\Documents\\SOP 0068 Pest Management v002.pdf',
        ];
  },
  'import:run': async (request) => {
    await delay(700);
    emit('library:changed', {
      kind: request.target.kind === 'specification' ? 'specifications' : 'documents',
    });
    info(`Імпортовано файлів: ${request.paths.length}`);
    return {
      imported: request.paths.map((path, i) => ({
        path,
        blobHash: `mock${Date.now().toString(16)}${i}`,
        duplicate: i > 0 && Math.random() < 0.3,
        ...(request.target.kind === 'document' ? { documentVersionId: 100 + i } : { specVersionId: 100 + i }),
      })),
      failed: [],
    };
  },
  'extraction:get': async (extractionId) => {
    await delay(120);
    return buildExtraction(extractionId);
  },
  'blob:path': async (blobHash) => {
    await delay(40);
    return `C:\\Users\\demo\\AppData\\Roaming\\super-auditor\\blobs\\${blobHash.slice(0, 2)}\\${blobHash}.pdf`;
  },
  'blob:read': async (blobHash) => {
    // Затримка більша за решту: справжній блоб стандарту ~1.1 МБ, і саме через
    // це UI кешує байти за хешем. З миттєвою відповіддю кеш нічого не доводить.
    await delay(420);
    const known = new Map<string, { pages: number; title: string }>();
    for (const spec of state.specs) {
      for (const version of spec.versions) {
        known.set(version.blobHash, { pages: 101, title: `${spec.name} v${version.versionLabel}` });
      }
    }
    for (const doc of state.documents) {
      for (const version of doc.versions) {
        known.set(version.blobHash, {
          pages: version.pageCount ?? 3,
          title: `${doc.title} v${version.versionLabel}`,
        });
      }
    }
    const meta = known.get(blobHash);
    if (!meta) throw new Error(`Блоб ${blobHash.slice(0, 12)}… не знайдено у сховищі`);
    return buildMockPdf(meta.pages, meta.title);
  },

  // — Профілі виробництва
  'sites:list': async () => {
    await delay(90);
    return state.sites;
  },
  'sites:save': async (profile) => {
    await delay(160);
    if (profile.id != null) {
      const existing = state.sites.find((s) => s.id === profile.id);
      if (existing) {
        Object.assign(existing, profile);
        info(`Профіль «${existing.name}» збережено`);
        return existing;
      }
    }
    const created: SiteProfileDto = {
      ...profile,
      id: Math.max(0, ...state.sites.map((s) => s.id)) + 1,
    };
    state.sites.push(created);
    info(`Профіль «${created.name}» створено`);
    return created;
  },
  'sites:delete': async (siteProfileId) => {
    await delay(120);
    state.sites = state.sites.filter((s) => s.id !== siteProfileId);
  },
  'sites:recomputeApplicability': async (siteProfileId) => {
    await delay(420);
    return applicableCount(siteProfileId);
  },
  'sites:setApplicabilityOverride': async () => {
    await delay(120);
    info('Перевизначення застосовності збережено');
  },

  // — Профілі документів
  'docProfiles:get': async (documentVersionId) => {
    await delay(90);
    return DOC_PROFILES.find((p) => p.documentVersionId === documentVersionId) ?? null;
  },
  'docProfiles:build': async (documentVersionId) => {
    await delay(900);
    const existing = DOC_PROFILES.find((p) => p.documentVersionId === documentVersionId);
    if (existing) return existing;
    throw new Error('Немає екстракції для цієї версії документа');
  },

  // — Прогони
  'runs:list': async () => {
    await delay(120);
    return state.runs.slice().sort((a, b) => b.id - a.id);
  },
  'runs:get': async (runId) => {
    await delay(60);
    return state.runs.find((r) => r.id === runId) ?? null;
  },
  'runs:estimate': async (config) => {
    await delay(520);
    const clauseCount = state.clauses.filter((c) => c.specVersionId === config.specVersionId).length;
    const docs = Math.max(1, config.documentVersionIds.length);
    const sections = 24;
    const tasks = sections * docs + docs + (config.skipCritic ? 0 : Math.round(clauseCount * docs * 0.2));
    const inputTokens = tasks * 21_500;
    const outputTokens = tasks * 1800;
    const judge = judgeModel(config);
    const info = state.providers
      .find((p) => p.id === judge.provider)
      ?.modelInfo.find((m) => m.id === judge.model);
    // Оцінка «до кешування префікса» — за повною ціною входу. Ціни немає — так і кажемо.
    const costUsd =
      info?.inputPerMTok != null && info.outputPerMTok != null
        ? Math.round(((inputTokens * info.inputPerMTok + outputTokens * info.outputPerMTok) / 1_000_000) * 100) / 100
        : null;
    return { tasks, inputTokens, costUsd, model: judge.model };
  },
  'runs:start': async (config) => {
    await delay(400);
    const id = nextRunId++;
    const run: AuditRunDto = {
      id,
      label: config.label ?? null,
      specVersionId: config.specVersionId,
      siteProfileId: config.siteProfileId,
      status: 'running',
      modelJudge: judgeModel(config).model,
      modelCritic: config.skipCritic
        ? null
        : effectiveRouting('critic', config.routing?.critic ?? state.settings.routing.critic ?? null).model,
      promptVersion: 'judge.v2',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, costUsd: 0 },
      error: null,
      documentVersionIds: config.documentVersionIds,
    };
    state.runs.push(run);
    progressByRun.set(id, {
      runId: id,
      status: 'running',
      stage: 'doc_profile',
      tasksTotal: Math.max(12, config.documentVersionIds.length * 24),
      tasksDone: 0,
      tasksFailed: 0,
      currentLabel: 'Підготовка профілів документів',
      usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, costUsd: 0 },
    });
    startTimer(id);
    info(`Прогін #${id} запущено`);
    return id;
  },
  'runs:pause': async (runId) => {
    await delay(120);
    stopTimer(runId);
    const run = state.runs.find((r) => r.id === runId);
    if (run) run.status = 'paused';
    const p = progressByRun.get(runId);
    if (p) {
      p.status = 'paused';
      emit('run:progress', clone(p));
    }
  },
  'runs:resume': async (runId) => {
    await delay(120);
    const run = state.runs.find((r) => r.id === runId);
    if (run) run.status = 'running';
    const p = progressByRun.get(runId);
    if (p) {
      p.status = 'running';
      emit('run:progress', clone(p));
    }
    startTimer(runId);
  },
  'runs:cancel': async (runId) => {
    await delay(120);
    stopTimer(runId);
    const run = state.runs.find((r) => r.id === runId);
    if (run) {
      run.status = 'cancelled';
      run.finishedAt = new Date().toISOString();
    }
    const p = progressByRun.get(runId);
    if (p) {
      p.status = 'cancelled';
      emit('run:progress', clone(p));
    }
    emit('run:finished', { runId, status: 'cancelled' });
  },
  'runs:progress': async (runId) => {
    await delay(50);
    const existing = progressByRun.get(runId);
    if (existing) return clone(existing);
    const run = state.runs.find((r) => r.id === runId);
    const total = Math.max(12, (run?.documentVersionIds.length ?? 1) * 24);
    return {
      runId,
      status: run?.status ?? 'queued',
      stage: null,
      tasksTotal: total,
      tasksDone: run?.status === 'done' ? total : 0,
      tasksFailed: run?.status === 'failed' ? 1 : 0,
      currentLabel: null,
      usage: run?.usage ?? { inputTokens: 0, cachedTokens: 0, outputTokens: 0, costUsd: 0 },
    };
  },
  'runs:summary': async (runId) => {
    await delay(200);
    return buildSummary(runId);
  },
  'runs:coverage': async (runId) => {
    await delay(240);
    return buildCoverage(runId);
  },
  'runs:delete': async (runId) => {
    await delay(180);
    stopTimer(runId);
    state.runs = state.runs.filter((r) => r.id !== runId);
    state.findings = state.findings.filter((f) => f.runId !== runId);
    progressByRun.delete(runId);
    // Журнал витрат навмисно не чіпаємо: гроші витрачені незалежно від того,
    // чи лишився результат.
    info(`Прогін #${runId} видалено`);
  },
  'runs:gaps': async (runId) => {
    await delay(220);
    return buildGaps(runId);
  },

  // — Findings
  'findings:list': async (query) => {
    await delay(180);
    const search = query.search?.trim().toLowerCase();
    const filtered = state.findings.filter((f) => {
      if (f.runId !== query.runId) return false;
      if (query.verdicts?.length && !query.verdicts.includes(f.verdict)) return false;
      if (query.severities?.length && (!f.severity || !query.severities.includes(f.severity))) return false;
      if (query.sectionNo && f.clause.sectionNo !== query.sectionNo) return false;
      if (query.documentVersionId != null && f.documentVersionId !== query.documentVersionId) return false;
      if (query.unreviewed === true && f.review) return false;
      if (query.unreviewed === false && !f.review) return false;
      if (search) {
        const hay = `${f.clause.clauseNo} ${f.clause.topic ?? ''} ${f.rationale} ${f.gap ?? ''} ${f.outsideEvidence ?? ''}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 100;
    return { items: filtered.slice(offset, offset + limit), total: filtered.length };
  },
  'findings:get': async (findingId) => {
    await delay(70);
    return state.findings.find((f) => f.id === findingId) ?? null;
  },
  'findings:review': async (findingId, review) => {
    await delay(110);
    const finding = state.findings.find((f) => f.id === findingId);
    if (!finding) throw new Error(`Finding ${findingId} не знайдено`);
    const saved: HumanReviewDto = { findingId, ...review, reviewedAt: new Date().toISOString() };
    finding.review = saved;
    return saved;
  },
  'findings:clearReview': async (findingId) => {
    await delay(90);
    const finding = state.findings.find((f) => f.id === findingId);
    if (finding) finding.review = null;
  },

  // — Налаштування
  'settings:get': async () => {
    await delay(70);
    return state.settings;
  },
  'settings:set': async (patch) => {
    await delay(110);
    state.settings = { ...state.settings, ...patch };
    return state.settings;
  },
  'usage:spend': async () => {
    await delay(160);
    return buildSpendSummary();
  },
  'usage:recent': async (limit) => {
    await delay(140);
    return buildRecentSpend(limit ?? 50);
  },
  'providers:list': async () => {
    await delay(140);
    // Копія, а не живий стан: інакше мутації (збережений ключ) потрапляють у кеш
    // тим самим об'єктом, react-query не бачить змін і не перемальовує картки.
    return clone(state.providers);
  },
  'providers:setApiKey': async (providerId) => {
    await delay(320);
    const provider = state.providers.find((p) => p.id === providerId);
    if (provider) {
      provider.configured = true;
      provider.error = null;
    }
    info(`Ключ для ${provider?.label ?? providerId} збережено`);
  },
  'providers:clearApiKey': async (providerId) => {
    await delay(160);
    const provider = state.providers.find((p) => p.id === providerId);
    if (provider) provider.configured = false;
  },
  'providers:test': async (providerId) => {
    await delay(760);
    const provider = state.providers.find((p) => p.id === providerId);
    if (!provider) return { ok: false, message: 'Невідомий провайдер' };
    if (!provider.configured) return { ok: false, message: 'Ключ не задано' };
    if (provider.error) return { ok: false, message: provider.error };
    return { ok: true, message: `Доступно моделей: ${provider.models.length}` };
  },
  'providers:refreshModels': async (providerId) => {
    await delay(900);
    const provider = state.providers.find((p) => p.id === providerId);
    if (!provider) throw new Error(`Невідомий провайдер ${providerId}`);
    // Як у main: Anthropic віддає /v1/models лише з ключем, каталог OpenRouter
    // публічний, а локальний сервер живого каталогу не має — тоді статус як є.
    if ((providerId === 'anthropic' && !provider.configured) || !provider.cloud) return clone(provider);
    provider.catalogueUpdatedAt = new Date().toISOString();
    return clone(provider);
  },
  'providers:balance': async (providerId) => {
    await delay(260);
    const provider = state.providers.find((p) => p.id === providerId);
    if (!provider?.supportsBalance || !provider.configured) return null;
    return buildOpenRouterBalance(state.managementKeys[providerId] ?? 'none');
  },
  'providers:setManagementKey': async (providerId, key) => {
    await delay(300);
    const provider = state.providers.find((p) => p.id === providerId);
    if (!provider?.supportsBalance) throw new Error('Провайдер не підтримує management-ключ');
    provider.managementKeyConfigured = true;
    state.managementKeys[providerId] = key.trim().toLowerCase() === 'bad' ? 'rejected' : 'valid';
  },
  'providers:clearManagementKey': async (providerId) => {
    await delay(160);
    const provider = state.providers.find((p) => p.id === providerId);
    if (provider) provider.managementKeyConfigured = false;
    state.managementKeys[providerId] = 'none';
  },

  // — Експорт
  'export:run': async (runId, format) => {
    await delay(900);
    const path = `C:\\Users\\demo\\Documents\\super-auditor-run-${runId}.${format === 'markdown' ? 'md' : format}`;
    info(`Експортовано: ${path}`);
    return { path };
  },
};

export function createMockApi(): RendererApi {
  refreshSpecCounters();
  return Object.assign({}, handlers, { on }) as RendererApi;
}
