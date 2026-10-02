/**
 * Єдине місце, де snake_case-рядки SQLite перетворюються на camelCase-DTO
 * з `@shared/domain` і навпаки.
 *
 * Тут же — і тільки тут — парситься/серіалізується JSON колонок
 * (`modules`, `certifications`, `products`, `processes`, `candidate_clauses`,
 * `section_summaries`) і конвертуються булеві 0/1.
 *
 * Значення перелічень із БД кастяться без рантайм-перевірки: CHECK-обмеження
 * в схемі вже гарантують домен. Виняток — JSON-масиви, які CHECK не покриває:
 * `modules` фільтруємо явно.
 */

import {
  MODULES,
  type AuditRunDto,
  type BlobDto,
  type ClauseApplicabilityDto,
  type ClauseDto,
  type ClauseReviewStatus,
  type ClausesStatus,
  type DocProfileDto,
  type DocumentDto,
  type DocumentKind,
  type DocumentVersionDto,
  type EvidenceDto,
  type EvidenceSource,
  type ExtractionDto,
  type ExtractionMetaDto,
  type ExtractionMethod,
  type FindingDto,
  type HumanReviewDto,
  type Module,
  type Obligation,
  type PageRange,
  type RunStatus,
  type Severity,
  type SiteProfileDto,
  type SpecSummaryDto,
  type SpecVersionDto,
  type SpecificationDto,
  type TaskStatus,
  type UsageTotals,
  type Verdict,
} from '@shared/domain';

// ─── Скалярні хелпери ────────────────────────────────────────────────────────

/** SQLite не має boolean: 0/1 (а іноді NULL зі старих даних) → boolean. */
export function toBool(value: unknown): boolean {
  return value === 1 || value === true || value === 1n;
}

/** boolean → 0/1 для біндингу. */
export function fromBool(value: boolean | null | undefined): number {
  return value ? 1 : 0;
}

export function toNum(value: unknown): number {
  return typeof value === 'bigint' ? Number(value) : Number(value ?? 0);
}

export function toNullableNum(value: unknown): number | null {
  return value === null || value === undefined ? null : toNum(value);
}

function parseJson(raw: string | null | undefined, fallback: unknown): unknown {
  if (raw === null || raw === undefined || raw === '') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** JSON-масив рядків із колонки. Сміття в колонці не має валити застосунок. */
export function parseStringArray(raw: string | null | undefined): string[] {
  const parsed = parseJson(raw, []);
  return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
}

export function parseStringRecord(raw: string | null | undefined): Record<string, string> {
  const parsed = parseJson(raw, {});
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

export function parseModules(raw: string | null | undefined): Module[] {
  const all: readonly string[] = MODULES;
  return parseStringArray(raw).filter((m): m is Module => all.includes(m));
}

/**
 * Серіалізація JSON-колонок. Ключі сортуються, бо ці ж значення потрапляють
 * у ключ кешу LLM (§9 architecture.md) — несортований JSON = промах кешу.
 */
export function toJson(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const record = val as Record<string, unknown>;
      return Object.fromEntries(Object.keys(record).sort().map((k) => [k, record[k]]));
    }
    return val;
  });
}

export function nowIso(): string {
  return new Date().toISOString();
}

// ─── Рядки таблиць ───────────────────────────────────────────────────────────

export interface BlobRow {
  hash: string;
  rel_path: string;
  byte_size: number;
  mime: string;
  created_at: string;
}

export interface ExtractionRow {
  id: number;
  blob_hash: string;
  method: string;
  tool_version: string;
  text: string;
  page_count: number | null;
  char_count: number | null;
  quality: number | null;
  created_at: string;
}

export type ExtractionMetaRow = Omit<ExtractionRow, 'text'>;

export interface ExtractionPageRow {
  extraction_id: number;
  page_no: number;
  char_start: number;
  char_end: number;
}

export interface DocumentRow {
  id: number;
  title: string;
  doc_number: string | null;
  process_owner: string | null;
  kind: string | null;
  created_at: string;
}

export interface DocumentVersionRow {
  id: number;
  document_id: number;
  version_label: string;
  blob_hash: string;
  extraction_id: number | null;
  lang: string | null;
  effective_from: string | null;
  imported_at: string;
  /** JOIN blob. */
  byte_size: number;
  /** JOIN extraction. */
  page_count: number | null;
}

export interface SpecificationRow {
  id: number;
  name: string;
  issuer: string | null;
  code: string | null;
  cloud_allowed: number;
}

export interface SpecVersionRow {
  id: number;
  specification_id: number;
  version_label: string;
  blob_hash: string;
  extraction_id: number | null;
  effective_from: string | null;
  clauses_status: string;
  /** Підзапит. */
  clause_count: number;
  /** Підзапит: review_status IN ('confirmed','edited'). */
  reviewed_clause_count: number;
}

export interface ClauseRow {
  id: number;
  spec_version_id: number;
  clause_no: string;
  sort_key: string;
  section_no: string | null;
  section_title: string | null;
  topic: string | null;
  requirement_text: string;
  modules: string;
  obligation: string | null;
  page_from: number | null;
  page_to: number | null;
  text_hash: string;
  review_status: string;
}

export interface SpecSummaryRow {
  spec_version_id: number;
  summary: string;
  scope: string | null;
  grading_rules: string | null;
  section_summaries: string;
  model: string | null;
  prompt_version: string | null;
  created_at: string | null;
}

export interface SiteProfileRow {
  id: number;
  name: string;
  modules: string;
  certifications: string;
  products: string;
  processes: string;
  notes: string | null;
}

export interface ClauseApplicabilityRow {
  site_profile_id: number;
  clause_id: number;
  applicable: number;
  reason: string;
  overridden_by_user: number;
}

export interface DocProfileRow {
  id: number;
  document_version_id: number;
  summary: string;
  doc_type: string | null;
  processes: string;
  candidate_clauses: string;
  model: string;
  prompt_version: string;
  created_at: string;
}

export interface AuditRunRow {
  id: number;
  label: string | null;
  spec_version_id: number;
  site_profile_id: number | null;
  status: string;
  model_judge: string;
  model_critic: string | null;
  prompt_version: string;
  started_at: string | null;
  finished_at: string | null;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  cost_usd: number;
  error: string | null;
  /** JSON `RunRouting`; NULL у прогонів до міграції 3. */
  routing: string | null;
  results_language: string | null;
}

export interface RunTaskRow {
  id: number;
  run_id: number;
  stage: string;
  payload: string;
  status: string;
  attempts: number;
  last_error: string | null;
  updated_at: string;
}

export interface FindingRow {
  id: number;
  run_id: number;
  clause_id: number;
  document_version_id: number | null;
  verdict: string;
  severity: string | null;
  confidence: number | null;
  rationale: string;
  gap: string | null;
  recommendation: string | null;
  created_at: string;
}

/** FindingRow + денормалізовані поля вимоги (FindingDto.clause). */
export interface FindingJoinedRow extends FindingRow {
  c_clause_no: string;
  c_section_no: string | null;
  c_section_title: string | null;
  c_topic: string | null;
  c_obligation: string | null;
  c_page_from: number | null;
  c_page_to: number | null;
}

export interface EvidenceRow {
  id: number;
  finding_id: number;
  document_version_id: number;
  quote: string;
  page_no: number | null;
  char_start: number | null;
  char_end: number | null;
  source: string;
  verified: number;
}

export interface FindingReviewRow {
  finding_id: number;
  human_verdict: string | null;
  human_severity: string | null;
  note: string | null;
  reviewed_at: string;
}

export interface LlmCallRow {
  cache_key: string;
  stage: string;
  provider: string;
  model: string;
  prompt_version: string;
  response_json: string;
  input_tokens: number | null;
  cached_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
  created_at: string;
}

// ─── Локальні DTO (немає в @shared/domain) ───────────────────────────────────

/** Завдання черги прогону. Не виходить у renderer, тому живе тут. */
export interface RunTaskDto {
  id: number;
  runId: number;
  stage: string;
  payload: unknown;
  status: TaskStatus;
  attempts: number;
  lastError: string | null;
  updatedAt: string;
}

/** Запис кешу LLM-виклику (ADR-7). */
export interface LlmCallDto {
  cacheKey: string;
  stage: string;
  provider: string;
  model: string;
  promptVersion: string;
  response: unknown;
  inputTokens: number | null;
  cachedTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  createdAt: string;
}

// ─── Мапери row → DTO ────────────────────────────────────────────────────────

export function toBlobDto(row: BlobRow): BlobDto {
  return {
    hash: row.hash,
    relPath: row.rel_path,
    byteSize: toNum(row.byte_size),
    mime: row.mime,
    createdAt: row.created_at,
  };
}

export function toPageRange(row: ExtractionPageRow): PageRange {
  return { pageNo: toNum(row.page_no), charStart: toNum(row.char_start), charEnd: toNum(row.char_end) };
}

export function toExtractionMetaDto(row: ExtractionMetaRow): ExtractionMetaDto {
  return {
    id: toNum(row.id),
    blobHash: row.blob_hash,
    method: row.method as ExtractionMethod,
    toolVersion: row.tool_version,
    pageCount: toNullableNum(row.page_count),
    charCount: toNum(row.char_count),
    quality: row.quality === null ? null : Number(row.quality),
    createdAt: row.created_at,
  };
}

export function toExtractionDto(row: ExtractionRow, pages: ExtractionPageRow[]): ExtractionDto {
  return {
    ...toExtractionMetaDto(row),
    text: row.text,
    pages: pages.map(toPageRange),
  };
}

export function toDocumentVersionDto(row: DocumentVersionRow): DocumentVersionDto {
  return {
    id: toNum(row.id),
    documentId: toNum(row.document_id),
    versionLabel: row.version_label,
    blobHash: row.blob_hash,
    extractionId: toNullableNum(row.extraction_id),
    lang: row.lang,
    effectiveFrom: row.effective_from,
    importedAt: row.imported_at,
    byteSize: toNum(row.byte_size),
    pageCount: toNullableNum(row.page_count),
  };
}

export function toDocumentDto(row: DocumentRow, versions: DocumentVersionDto[]): DocumentDto {
  return {
    id: toNum(row.id),
    title: row.title,
    docNumber: row.doc_number,
    processOwner: row.process_owner,
    kind: row.kind === null ? null : (row.kind as DocumentKind),
    createdAt: row.created_at,
    versions,
    // Заповнює шар вище: щоб мапер не ходив у БД по статистику прогонів.
    lastRun: null,
  };
}

export function toSpecVersionDto(row: SpecVersionRow): SpecVersionDto {
  return {
    id: toNum(row.id),
    specificationId: toNum(row.specification_id),
    versionLabel: row.version_label,
    blobHash: row.blob_hash,
    extractionId: toNullableNum(row.extraction_id),
    effectiveFrom: row.effective_from,
    clausesStatus: row.clauses_status as ClausesStatus,
    clauseCount: toNum(row.clause_count),
    reviewedClauseCount: toNum(row.reviewed_clause_count),
  };
}

export function toSpecificationDto(row: SpecificationRow, versions: SpecVersionDto[]): SpecificationDto {
  return {
    id: toNum(row.id),
    name: row.name,
    issuer: row.issuer,
    code: row.code,
    cloudAllowed: toBool(row.cloud_allowed),
    versions,
  };
}

export function toClauseDto(row: ClauseRow): ClauseDto {
  return {
    id: toNum(row.id),
    specVersionId: toNum(row.spec_version_id),
    clauseNo: row.clause_no,
    sortKey: row.sort_key,
    sectionNo: row.section_no,
    sectionTitle: row.section_title,
    topic: row.topic,
    requirementText: row.requirement_text,
    modules: parseModules(row.modules),
    obligation: row.obligation === null ? null : (row.obligation as Obligation),
    pageFrom: toNullableNum(row.page_from),
    pageTo: toNullableNum(row.page_to),
    textHash: row.text_hash,
    reviewStatus: row.review_status as ClauseReviewStatus,
  };
}

export function toSpecSummaryDto(row: SpecSummaryRow): SpecSummaryDto {
  return {
    specVersionId: toNum(row.spec_version_id),
    summary: row.summary,
    scope: row.scope,
    gradingRules: row.grading_rules,
    sectionSummaries: parseStringRecord(row.section_summaries),
    model: row.model,
    promptVersion: row.prompt_version,
    // created_at у DDL nullable; репозиторій завжди пише значення, але
    // на чужих/старих даних краще порожній рядок, ніж null у не-null полі DTO.
    createdAt: row.created_at ?? '',
  };
}

export function toSiteProfileDto(row: SiteProfileRow): SiteProfileDto {
  return {
    id: toNum(row.id),
    name: row.name,
    modules: parseModules(row.modules),
    certifications: parseStringArray(row.certifications),
    products: parseStringArray(row.products),
    processes: parseStringArray(row.processes),
    notes: row.notes,
  };
}

export function toClauseApplicabilityDto(row: ClauseApplicabilityRow): ClauseApplicabilityDto {
  return {
    siteProfileId: toNum(row.site_profile_id),
    clauseId: toNum(row.clause_id),
    applicable: toBool(row.applicable),
    reason: row.reason,
    overriddenByUser: toBool(row.overridden_by_user),
  };
}

export function toDocProfileDto(row: DocProfileRow): DocProfileDto {
  return {
    id: toNum(row.id),
    documentVersionId: toNum(row.document_version_id),
    summary: row.summary,
    docType: row.doc_type === null ? null : (row.doc_type as DocumentKind),
    processes: parseStringArray(row.processes),
    candidateClauses: parseStringArray(row.candidate_clauses),
    model: row.model,
    promptVersion: row.prompt_version,
    createdAt: row.created_at,
  };
}

export function toUsageTotals(row: Pick<AuditRunRow, 'input_tokens' | 'cached_tokens' | 'output_tokens' | 'cost_usd'>): UsageTotals {
  return {
    inputTokens: toNum(row.input_tokens),
    cachedTokens: toNum(row.cached_tokens),
    outputTokens: toNum(row.output_tokens),
    costUsd: Number(row.cost_usd ?? 0),
  };
}

export function toAuditRunDto(row: AuditRunRow, documentVersionIds: number[]): AuditRunDto {
  return {
    id: toNum(row.id),
    label: row.label,
    specVersionId: toNum(row.spec_version_id),
    siteProfileId: toNullableNum(row.site_profile_id),
    status: row.status as RunStatus,
    modelJudge: row.model_judge,
    modelCritic: row.model_critic,
    promptVersion: row.prompt_version,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    usage: toUsageTotals(row),
    error: row.error,
    documentVersionIds,
  };
}

export function toRunTaskDto(row: RunTaskRow): RunTaskDto {
  return {
    id: toNum(row.id),
    runId: toNum(row.run_id),
    stage: row.stage,
    payload: parseJson(row.payload, null),
    status: row.status as TaskStatus,
    attempts: toNum(row.attempts),
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

export function toEvidenceDto(row: EvidenceRow): EvidenceDto {
  return {
    id: toNum(row.id),
    findingId: toNum(row.finding_id),
    documentVersionId: toNum(row.document_version_id),
    quote: row.quote,
    pageNo: toNullableNum(row.page_no),
    charStart: toNullableNum(row.char_start),
    charEnd: toNullableNum(row.char_end),
    source: row.source as EvidenceSource,
    verified: toBool(row.verified),
  };
}

export function toHumanReviewDto(row: FindingReviewRow): HumanReviewDto {
  return {
    findingId: toNum(row.finding_id),
    humanVerdict: row.human_verdict === null ? null : (row.human_verdict as Verdict),
    humanSeverity: row.human_severity === null ? null : (row.human_severity as Severity),
    note: row.note,
    reviewedAt: row.reviewed_at,
  };
}

export function toFindingDto(
  row: FindingJoinedRow,
  evidence: EvidenceDto[],
  review: HumanReviewDto | null,
): FindingDto {
  return {
    id: toNum(row.id),
    runId: toNum(row.run_id),
    clauseId: toNum(row.clause_id),
    documentVersionId: toNullableNum(row.document_version_id),
    verdict: row.verdict as Verdict,
    severity: row.severity === null ? null : (row.severity as Severity),
    confidence: row.confidence === null ? null : Number(row.confidence),
    rationale: row.rationale,
    gap: row.gap,
    recommendation: row.recommendation,
    createdAt: row.created_at,
    evidence,
    review,
    clause: {
      clauseNo: row.c_clause_no,
      sectionNo: row.c_section_no,
      sectionTitle: row.c_section_title,
      topic: row.c_topic,
      obligation: row.c_obligation === null ? null : (row.c_obligation as Obligation),
      pageFrom: toNullableNum(row.c_page_from),
      pageTo: toNullableNum(row.c_page_to),
    },
  };
}

export function toLlmCallDto(row: LlmCallRow): LlmCallDto {
  return {
    cacheKey: row.cache_key,
    stage: row.stage,
    provider: row.provider,
    model: row.model,
    promptVersion: row.prompt_version,
    response: parseJson(row.response_json, null),
    inputTokens: toNullableNum(row.input_tokens),
    cachedTokens: toNullableNum(row.cached_tokens),
    outputTokens: toNullableNum(row.output_tokens),
    costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
    latencyMs: toNullableNum(row.latency_ms),
    createdAt: row.created_at,
  };
}

/**
 * Колонки finding-запиту з денормалізованою вимогою.
 * Тримаємо в мапері, щоб SELECT-и findings і coverage не розповзалися.
 */
export const FINDING_CLAUSE_COLUMNS =
  'c.clause_no AS c_clause_no, c.section_no AS c_section_no, c.section_title AS c_section_title, ' +
  'c.topic AS c_topic, c.obligation AS c_obligation, ' +
  // Сторінки оригіналу: без них у findings немає переходу до тексту стандарту.
  'c.page_from AS c_page_from, c.page_to AS c_page_to';
