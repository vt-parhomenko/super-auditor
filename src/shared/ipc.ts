/**
 * Типізований контракт IPC. Єдине джерело правди для main і renderer.
 *
 * Renderer НІКОЛИ не викликає ipcRenderer напряму — тільки через `window.api`,
 * який preload будує з цього контракту.
 */

import type {
  AuditRunDto,
  ClauseDto,
  ClausePatch,
  CoverageMatrix,
  DocProfileDto,
  DocumentDto,
  DocumentKind,
  DocumentRunStats,
  ExtractionDto,
  FindingDto,
  FindingQuery,
  GapItem,
  HumanReviewDto,
  ImportRequest,
  ImportResult,
  RunConfig,
  RunProgress,
  RunSummary,
  SiteProfileDto,
  SpecSummaryDto,
  SpecVersionDto,
  SpecificationDto,
  SpendEntry,
  SpendSummary,
  Stage,
  UsageTotals,
} from './domain';

// ─── Запити renderer → main ──────────────────────────────────────────────────

export interface IpcApi {
  // — Бібліотека документів
  'documents:list': (query?: { search?: string; kind?: DocumentKind }) => Promise<DocumentDto[]>;
  'documents:get': (documentId: number) => Promise<DocumentDto | null>;
  'documents:update': (
    documentId: number,
    patch: { title?: string; docNumber?: string | null; processOwner?: string | null; kind?: DocumentKind | null },
  ) => Promise<void>;
  'documents:delete': (documentId: number) => Promise<void>;
  /** Усі прогони, що торкались цього документа, від найновішого. */
  'documents:runs': (documentId: number) => Promise<DocumentRunStats[]>;

  // — Специфікації
  'specs:list': () => Promise<SpecificationDto[]>;
  'specs:get': (specificationId: number) => Promise<SpecificationDto | null>;
  'specs:setCloudAllowed': (specificationId: number, allowed: boolean) => Promise<void>;
  'specs:version': (specVersionId: number) => Promise<SpecVersionDto | null>;
  'specs:summary': (specVersionId: number) => Promise<SpecSummaryDto | null>;

  // — Реєстр вимог (Stage 1 + ручна вичитка)
  'clauses:list': (specVersionId: number) => Promise<ClauseDto[]>;
  'clauses:get': (clauseId: number) => Promise<ClauseDto | null>;
  'clauses:patch': (clauseId: number, patch: ClausePatch) => Promise<ClauseDto>;
  'clauses:create': (specVersionId: number, clause: Omit<ClausePatch, 'reviewStatus'> & { clauseNo: string; requirementText: string }) => Promise<ClauseDto>;
  'clauses:delete': (clauseId: number) => Promise<void>;
  /** Запускає Stage 1 — LLM-екстракт реєстру. Повертає id фонового завдання. */
  'clauses:extract': (specVersionId: number) => Promise<number>;
  /** Позначити реєстр вичитаним. Помилка, якщо є clause із reviewStatus='auto'|'flagged'. */
  'clauses:markReviewed': (specVersionId: number) => Promise<void>;

  // — Імпорт та вихідний текст
  'import:pick': (kind: 'document' | 'specification') => Promise<string[]>;
  'import:run': (request: ImportRequest) => Promise<ImportResult>;
  'extraction:get': (extractionId: number) => Promise<ExtractionDto | null>;
  /** Абсолютний шлях до блоба на диску — для відкриття в зовнішній програмі. */
  'blob:path': (blobHash: string) => Promise<string | null>;
  /**
   * Байти блоба для вбудованого PDF-вьювера.
   *
   * Свідомо окремим каналом, а не через `file://`: renderer у пісочниці й без
   * доступу до ФС, а послаблювати CSP заради перегляду одного PDF не варто.
   * Специфікація важить ~1 МБ, тож разова передача дешевша за власний протокол.
   */
  'blob:read': (blobHash: string) => Promise<Uint8Array>;

  // — Профілі виробництва
  'sites:list': () => Promise<SiteProfileDto[]>;
  'sites:save': (profile: Omit<SiteProfileDto, 'id'> & { id?: number }) => Promise<SiteProfileDto>;
  'sites:delete': (siteProfileId: number) => Promise<void>;
  /** Перерахунок детермінованого фільтра застосовності (Stage 3). */
  'sites:recomputeApplicability': (
    siteProfileId: number,
    specVersionId: number,
  ) => Promise<{ applicable: number; notApplicable: number }>;
  'sites:setApplicabilityOverride': (
    siteProfileId: number,
    clauseId: number,
    applicable: boolean,
    reason: string,
  ) => Promise<void>;

  // — Профілі документів (Stage 2)
  'docProfiles:get': (documentVersionId: number) => Promise<DocProfileDto | null>;
  'docProfiles:build': (documentVersionId: number) => Promise<DocProfileDto>;

  // — Прогони
  'runs:list': () => Promise<AuditRunDto[]>;
  'runs:get': (runId: number) => Promise<AuditRunDto | null>;
  /** Оцінка вартості до старту (через count_tokens). */
  'runs:estimate': (config: RunConfig) => Promise<{ tasks: number; inputTokens: number; costUsd: number }>;
  'runs:start': (config: RunConfig) => Promise<number>;
  'runs:pause': (runId: number) => Promise<void>;
  'runs:resume': (runId: number) => Promise<void>;
  'runs:cancel': (runId: number) => Promise<void>;
  'runs:progress': (runId: number) => Promise<RunProgress>;
  'runs:summary': (runId: number) => Promise<RunSummary>;
  'runs:coverage': (runId: number) => Promise<CoverageMatrix>;
  'runs:gaps': (runId: number) => Promise<GapItem[]>;
  /**
   * Видаляє прогін разом із findings, доказами, рев'ю та чергою завдань.
   * Записи журналу витрат НЕ видаляються — гроші витрачені незалежно від того,
   * чи потрібен нам результат.
   */
  'runs:delete': (runId: number) => Promise<void>;

  // — Findings і рев'ю
  'findings:list': (query: FindingQuery) => Promise<{ items: FindingDto[]; total: number }>;
  'findings:get': (findingId: number) => Promise<FindingDto | null>;
  'findings:review': (
    findingId: number,
    review: Omit<HumanReviewDto, 'findingId' | 'reviewedAt'>,
  ) => Promise<HumanReviewDto>;
  'findings:clearReview': (findingId: number) => Promise<void>;

  // — Налаштування та провайдери
  'settings:get': () => Promise<AppSettings>;
  'settings:set': (patch: Partial<AppSettings>) => Promise<AppSettings>;
  'providers:list': () => Promise<ProviderStatus[]>;
  /** Ключ шифрується через safeStorage і НІКОЛИ не повертається в renderer. */
  'providers:setApiKey': (providerId: string, apiKey: string) => Promise<void>;
  'providers:clearApiKey': (providerId: string) => Promise<void>;
  'providers:test': (providerId: string) => Promise<{ ok: boolean; message: string }>;

  // — Витрати
  /**
   * Власний облік витрат застосунку. Ендпоінта «залишок коштів» в Anthropic
   * немає, тож показуємо те, що знаємо точно: скільки витратили ми.
   */
  'usage:spend': () => Promise<SpendSummary>;
  'usage:recent': (limit?: number) => Promise<SpendEntry[]>;

  // — Експорт
  'export:run': (runId: number, format: ExportFormat) => Promise<{ path: string }>;
}

export type ExportFormat = 'xlsx' | 'markdown' | 'pdf' | 'json';

export interface AppSettings {
  routing: Partial<Record<Stage, { provider: string; model: string; effort?: string }>>;
  /** Скільки одночасних LLM-викликів робити в прогоні. */
  concurrency: number;
  /** Не відправляти дані в хмару навіть якщо специфікація це дозволяє. */
  localOnly: boolean;
  theme: 'system' | 'light' | 'dark';
  /**
   * Мова, якою модель пише висновки, «чого бракує» та рекомендації.
   * Код BCP-47 (`uk`, `en`, `nl`) або порожньо — мовою стандарту.
   *
   * УВАГА: цитати-докази завжди лишаються мовою оригіналу. Переклад цитати
   * зламав би механічну перевірку, і всі вердикти впали б у `needs_human_review`.
   */
  resultsLanguage: string;
}

export interface ProviderStatus {
  id: string;
  label: string;
  configured: boolean;
  /** Хмарний провайдер підпадає під обмеження cloudAllowed (ADR-8). */
  cloud: boolean;
  models: string[];
  error: string | null;
}

// ─── Події main → renderer ───────────────────────────────────────────────────

export interface IpcEvents {
  'run:progress': RunProgress;
  'run:finished': { runId: number; status: 'done' | 'failed' | 'cancelled'; error?: string };
  /** Стрімінг результатів під час прогону — UI дописує рядки, не чекаючи кінця. */
  'run:finding': { runId: number; finding: FindingDto };
  'clauses:extractProgress': {
    specVersionId: number;
    page: number;
    pageCount: number;
    clausesFound: number;
    done: boolean;
    error?: string;
  };
  'library:changed': { kind: 'documents' | 'specifications' };
  'usage:updated': { runId: number; usage: UsageTotals };
  'toast': { level: 'info' | 'warn' | 'error'; message: string };
}

// ─── Допоміжні типи ──────────────────────────────────────────────────────────

export type IpcChannel = keyof IpcApi;
export type IpcEventChannel = keyof IpcEvents;

export type IpcArgs<C extends IpcChannel> = Parameters<IpcApi[C]>;
export type IpcResult<C extends IpcChannel> = Awaited<ReturnType<IpcApi[C]>>;

/** Реалізація в main: та сама сигнатура, але може бути async. */
export type IpcHandlers = {
  [C in IpcChannel]: (...args: IpcArgs<C>) => IpcResult<C> | Promise<IpcResult<C>>;
};

/** Форма, у якій контракт видно в renderer через `window.api`. */
export type RendererApi = {
  [C in IpcChannel]: (...args: IpcArgs<C>) => Promise<IpcResult<C>>;
} & {
  /** Підписка на подію. Повертає функцію відписки. */
  on<E extends IpcEventChannel>(event: E, listener: (payload: IpcEvents[E]) => void): () => void;
};

export const IPC_CHANNELS: readonly IpcChannel[] = [
  'documents:list',
  'documents:get',
  'documents:update',
  'documents:delete',
  'specs:list',
  'specs:get',
  'specs:setCloudAllowed',
  'specs:version',
  'specs:summary',
  'clauses:list',
  'clauses:get',
  'clauses:patch',
  'clauses:create',
  'clauses:delete',
  'clauses:extract',
  'clauses:markReviewed',
  'import:pick',
  'import:run',
  'extraction:get',
  'blob:path',
  'blob:read',
  'documents:runs',
  'usage:spend',
  'usage:recent',
  'sites:list',
  'sites:save',
  'sites:delete',
  'sites:recomputeApplicability',
  'sites:setApplicabilityOverride',
  'docProfiles:get',
  'docProfiles:build',
  'runs:list',
  'runs:get',
  'runs:estimate',
  'runs:start',
  'runs:pause',
  'runs:resume',
  'runs:cancel',
  'runs:progress',
  'runs:summary',
  'runs:coverage',
  'runs:gaps',
  'runs:delete',
  'findings:list',
  'findings:get',
  'findings:review',
  'findings:clearReview',
  'settings:get',
  'settings:set',
  'providers:list',
  'providers:setApiKey',
  'providers:clearApiKey',
  'providers:test',
  'export:run',
] as const;

export const IPC_EVENT_CHANNELS: readonly IpcEventChannel[] = [
  'run:progress',
  'run:finished',
  'run:finding',
  'clauses:extractProgress',
  'library:changed',
  'usage:updated',
  'toast',
] as const;
