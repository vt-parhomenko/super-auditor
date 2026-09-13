/**
 * Фасад шару БД. Решта main-процесу працює ТІЛЬКИ через нього —
 * жодних `db.prepare(...)` поза `src/main/db/**`.
 *
 *   const db = createDb(dbPath());
 *   const findings = db.findings.list({ runId: 1, verdicts: ['non_compliant'] });
 */

import { checkpoint, openDb, openTestDb, type OpenDbOptions } from './connection';
import { LATEST_VERSION, migrate, userVersion } from './migrations';
import { BlobsRepo } from './repos/blobs';
import { ClausesRepo } from './repos/clauses';
import { DocProfilesRepo } from './repos/docProfiles';
import { DocumentsRepo } from './repos/documents';
import { ExtractionsRepo } from './repos/extractions';
import { FindingsRepo } from './repos/findings';
import { LlmCacheRepo } from './repos/llmCache';
import { RunTasksRepo, RunsRepo } from './repos/runs';
import { SettingsRepo } from './repos/settings';
import { SpendRepo } from './repos/spend';
import { SiteProfilesRepo } from './repos/siteProfiles';
import { SpecsRepo } from './repos/specs';
import type { SqliteDb } from './types';

export interface Db {
  /** Сире з'єднання. Використовувати лише для міграцій, бекапів і діагностики. */
  readonly raw: SqliteDb;

  readonly blobs: BlobsRepo;
  readonly extractions: ExtractionsRepo;
  readonly documents: DocumentsRepo;
  readonly specs: SpecsRepo;
  readonly clauses: ClausesRepo;
  readonly siteProfiles: SiteProfilesRepo;
  readonly docProfiles: DocProfilesRepo;
  readonly runs: RunsRepo;
  readonly runTasks: RunTasksRepo;
  readonly findings: FindingsRepo;
  readonly llmCache: LlmCacheRepo;
  readonly settings: SettingsRepo;
  readonly spend: SpendRepo;

  /** Версія схеми (`PRAGMA user_version`). */
  schemaVersion(): number;

  /**
   * Синхронна транзакція. Вкладені виклики використовують SAVEPOINT,
   * тож викликати всередині репозиторію безпечно.
   */
  transaction<T>(fn: () => T): T;

  /** Злити WAL у основний файл — перед бекапом чи виходом. */
  checkpoint(): void;

  close(): void;
}

class DbImpl implements Db {
  readonly raw: SqliteDb;
  readonly blobs: BlobsRepo;
  readonly extractions: ExtractionsRepo;
  readonly documents: DocumentsRepo;
  readonly specs: SpecsRepo;
  readonly clauses: ClausesRepo;
  readonly siteProfiles: SiteProfilesRepo;
  readonly docProfiles: DocProfilesRepo;
  readonly runs: RunsRepo;
  readonly runTasks: RunTasksRepo;
  readonly findings: FindingsRepo;
  readonly llmCache: LlmCacheRepo;
  readonly settings: SettingsRepo;
  readonly spend: SpendRepo;

  constructor(raw: SqliteDb) {
    this.raw = raw;
    this.blobs = new BlobsRepo(raw);
    this.extractions = new ExtractionsRepo(raw);
    this.documents = new DocumentsRepo(raw);
    this.specs = new SpecsRepo(raw);
    this.clauses = new ClausesRepo(raw);
    this.siteProfiles = new SiteProfilesRepo(raw);
    this.docProfiles = new DocProfilesRepo(raw);
    this.runs = new RunsRepo(raw);
    this.runTasks = new RunTasksRepo(raw);
    this.findings = new FindingsRepo(raw);
    this.llmCache = new LlmCacheRepo(raw);
    this.settings = new SettingsRepo(raw);
    this.spend = new SpendRepo(raw);
  }

  schemaVersion(): number {
    return userVersion(this.raw);
  }

  transaction<T>(fn: () => T): T {
    return this.raw.transaction(fn)();
  }

  checkpoint(): void {
    checkpoint(this.raw);
  }

  close(): void {
    if (this.raw.open) this.raw.close();
  }
}

/** Відкриває базу за шляхом, прогонить міграції і збирає всі репозиторії. */
export function createDb(path: string, options?: OpenDbOptions): Db {
  return new DbImpl(openDb(path, options));
}

/** База в пам'яті — для тестів. */
export function createTestDb(): Db {
  return new DbImpl(openTestDb());
}

/** Обгортає вже відкрите з'єднання (напр. у воркері). Міграції не прогонить. */
export function wrapDb(raw: SqliteDb): Db {
  return new DbImpl(raw);
}

export { LATEST_VERSION, migrate, userVersion };
export { openDb, openTestDb, applyPragmas, checkpoint, runMigrationsOn } from './connection';
export { MIGRATIONS, type Migration, type MigrationResult } from './migrations';
export type { SqliteDb } from './types';

export * from './mappers';
export { BlobsRepo, type BlobInput } from './repos/blobs';
export {
  ClausesRepo,
  clauseTextHash,
  normalizeClauseText,
  type ClauseDiffEntry,
  type ClauseDiffResult,
  type ClauseInput,
  type SectionInfo,
} from './repos/clauses';
export { DocProfilesRepo, type DocProfileInput } from './repos/docProfiles';
export {
  DocumentsRepo,
  escapeLike,
  type DocumentInput,
  type DocumentPatch,
  type DocumentQuery,
  type DocumentVersionInput,
} from './repos/documents';
export { ExtractionsRepo, type ExtractionInput } from './repos/extractions';
export {
  FindingsRepo,
  effectiveSeverity,
  effectiveVerdict,
  type EvidenceInput,
  type FindingInput,
  type FindingPage,
  type HumanReviewInput,
} from './repos/findings';
export { LlmCacheRepo, type LlmCallInput, type UsageAggregate } from './repos/llmCache';
export {
  RunTasksRepo,
  RunsRepo,
  emptySeverityCounts,
  type RunInput,
  type RunTaskInput,
  type TaskCounts,
} from './repos/runs';
export { DEFAULT_SETTINGS, SettingsRepo } from './repos/settings';
export {
  SiteProfilesRepo,
  type ApplicabilityCounts,
  type ApplicabilityInput,
  type SiteProfileInput,
} from './repos/siteProfiles';
export {
  SpecsRepo,
  type SpecSummaryInput,
  type SpecVersionInput,
  type SpecificationInput,
} from './repos/specs';
