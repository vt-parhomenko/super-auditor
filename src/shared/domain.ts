/**
 * Спільна доменна модель. Використовується в main, preload і renderer.
 * НЕ імпортувати сюди нічого з node/electron/react — файл має бути ізоморфним.
 *
 * Відповідає розділу 5 (модель даних) в architecture.md.
 * Правило іменування: у БД snake_case, тут camelCase. Мапінг — у репозиторіях.
 */

// ─── Перелічення ─────────────────────────────────────────────────────────────

export const VERDICTS = [
  'compliant',
  'partial',
  'non_compliant',
  'not_applicable',
  'not_addressed',
  'needs_human_review',
] as const;
export type Verdict = (typeof VERDICTS)[number];

/** Вердикти, які може повернути модель. `not_applicable` вирішується детерміновано (ADR-4). */
export const MODEL_VERDICTS = [
  'compliant',
  'partial',
  'non_compliant',
  'not_addressed',
  'needs_human_review',
] as const;
export type ModelVerdict = (typeof MODEL_VERDICTS)[number];

export const SEVERITIES = ['critical', 'major', 'minor', 'recommendation'] as const;
export type Severity = (typeof SEVERITIES)[number];

/**
 * Застаріле: прапорці P/R/O стандарту Tesco, колись прочитані як «модулі
 * застосовності». Насправді це тип доказу (політика / записи / огляд), і їх
 * заступили позначки стандарту (`ClauseDto.markers`). Лишаються лише для
 * прихованих профілів виробництва, які ще чекають переосмислення.
 */
export const MODULES = ['P', 'R', 'O'] as const;
export type Module = (typeof MODULES)[number];

/**
 * Межі позначок стандарту біля вимоги. Позначка — короткий код («P»,
 * «Major Must», «Fundamental»); довший рядок — це вже не позначка, а шматок
 * тексту вимоги, що потрапив не в те поле.
 */
export const MARKER_MAX_COUNT = 8;
export const MARKER_MAX_LENGTH = 40;

export const OBLIGATIONS = ['must', 'should', 'may'] as const;
export type Obligation = (typeof OBLIGATIONS)[number];

export const EXTRACTION_METHODS = ['pdfjs', 'mammoth', 'ocr', 'vision'] as const;
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number];

export const DOCUMENT_KINDS = ['sop', 'policy', 'form', 'record', 'manual', 'other'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const STAGES = [
  'clause_extract',
  'spec_summary',
  'doc_profile',
  'judge',
  'critic',
] as const;
export type Stage = (typeof STAGES)[number];

export const RUN_STATUSES = [
  'queued',
  'running',
  'paused',
  'done',
  'failed',
  'cancelled',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const TASK_STATUSES = ['pending', 'running', 'done', 'failed', 'skipped'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const CLAUSE_REVIEW_STATUSES = ['auto', 'confirmed', 'edited', 'flagged'] as const;
export type ClauseReviewStatus = (typeof CLAUSE_REVIEW_STATUSES)[number];

export const CLAUSES_STATUSES = ['pending', 'extracted', 'reviewed'] as const;
export type ClausesStatus = (typeof CLAUSES_STATUSES)[number];

export const EVIDENCE_SOURCES = ['citations_api', 'model_quote'] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

/** Глибина роздумів моделі, від найдешевшої до найретельнішої. */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

export function isEffort(value: unknown): value is Effort {
  return typeof value === 'string' && (EFFORTS as readonly string[]).includes(value);
}

/**
 * Мови застосунку. Один список на дві речі: мову інтерфейсу і мову, якою
 * модель пише висновки. Коди — ISO 639-1.
 */
export const LANGUAGES = ['en', 'nl', 'uk'] as const;
export type Language = (typeof LANGUAGES)[number];

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * Мова висновків: одна з `LANGUAGES` або `''` — модель пише мовою стандарту
 * (без інструкції про мову). Цитати-докази лишаються мовою оригіналу завжди.
 */
export type ResultsLanguage = '' | Language;

/** Ціновий клас моделі — для підказки в списку вибору. */
export const MODEL_TIERS = ['top', 'balanced', 'budget'] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

/**
 * Опис моделі для вибору в маршрутизації етапів. Будується в main із вбудованого
 * знімка або з живого каталогу провайдера; в renderer лише відображається.
 */
export interface ModelInfo {
  /** Ідентифікатор, що йде в API провайдера: 'claude-opus-5-5', 'openai/gpt-6-luna'. */
  id: string;
  /** Людська назва: 'Claude Opus 5.5', 'GPT-6 Luna'. */
  label: string;
  /** Розробник моделі для групування списку: 'Anthropic', 'OpenAI', 'DeepSeek'… */
  vendor: string | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  /** USD за 1M токенів. null — ціна невідома (не вигадуємо). */
  inputPerMTok: number | null;
  outputPerMTok: number | null;
  cacheReadPerMTok: number | null;
  /**
   * Рівні effort, які модель приймає. null — невідомо (UI показує всі);
   * [] — модель не керується effort (поле в UI вимикається).
   */
  efforts: Effort[] | null;
  /** Входить у курований список для аудиту — показується першим. */
  recommended: boolean;
  tier: ModelTier | null;
}

/** ISO-8601 UTC, напр. '2026-08-30T12:00:00.000Z'. Усі дати в системі — такі. */
export type IsoDate = string;

// ─── Сховище ─────────────────────────────────────────────────────────────────

export interface BlobDto {
  hash: string; // sha256 hex, нижній регістр
  relPath: string; // відносно blobs/, напр. 'ab/cd/abcd….pdf'
  byteSize: number;
  mime: string;
  createdAt: IsoDate;
}

/** Прив'язка діапазону символів до сторінки. Без неї немає клікабельних цитат. */
export interface PageRange {
  pageNo: number; // 1-індексовано
  charStart: number; // включно
  charEnd: number; // виключно
}

export interface ExtractionDto {
  id: number;
  blobHash: string;
  method: ExtractionMethod;
  toolVersion: string;
  text: string;
  pageCount: number | null;
  charCount: number;
  /** 0..1. Щільність тексту для PDF, впевненість для OCR. < 0.3 → потрібен OCR. */
  quality: number | null;
  pages: PageRange[];
  createdAt: IsoDate;
}

/** Екстракція без важкого поля `text` — для списків. */
export type ExtractionMetaDto = Omit<ExtractionDto, 'text' | 'pages'>;

// ─── Документи ───────────────────────────────────────────────────────────────

export interface DocumentDto {
  id: number;
  title: string;
  docNumber: string | null; // '0068'
  processOwner: string | null;
  kind: DocumentKind | null;
  createdAt: IsoDate;
  versions: DocumentVersionDto[];
  /** Підсумок останнього прогону, що торкався цього документа. */
  lastRun: DocumentRunStats | null;
}

/**
 * Метрики прогону в розрізі ОДНОГО документа.
 *
 * Прогін охоплює набір документів, але користувач мислить файлами: «що з моєю
 * інструкцією». Тому лічильники тут — лише по findings цієї версії документа,
 * а не по всьому прогону.
 */
export interface DocumentRunStats {
  runId: number;
  label: string | null;
  status: RunStatus;
  startedAt: IsoDate | null;
  finishedAt: IsoDate | null;
  specName: string;
  specVersionLabel: string;
  documentVersionId: number;
  documentVersionLabel: string;
  counts: Record<Verdict, number>;
  /** Лише справжні невідповідності (partial / non_compliant). */
  severityCounts: Record<Severity, number>;
  /** Вимог, по яких є висновок. */
  assessed: number;
  /** Вимог, яких документ реально стосується (вердикт ≠ not_addressed). */
  relevant: number;
  /** Опрацьовано людиною. */
  reviewed: number;
}

export interface DocumentVersionDto {
  id: number;
  documentId: number;
  versionLabel: string; // '002'
  blobHash: string;
  extractionId: number | null;
  lang: string | null; // 'en', 'nl'
  effectiveFrom: IsoDate | null;
  importedAt: IsoDate;
  byteSize: number;
  pageCount: number | null;
}

// ─── Специфікації ────────────────────────────────────────────────────────────

export interface SpecificationDto {
  id: number;
  name: string;
  issuer: string | null;
  code: string | null;
  /** ADR-8. false → заборонено слати вміст у хмарний провайдер. */
  cloudAllowed: boolean;
  versions: SpecVersionDto[];
}

export interface SpecVersionDto {
  id: number;
  specificationId: number;
  versionLabel: string; // '5.0'
  blobHash: string;
  extractionId: number | null;
  effectiveFrom: IsoDate | null;
  clausesStatus: ClausesStatus;
  clauseCount: number;
  reviewedClauseCount: number;
  /**
   * Розшифровка позначок біля вимог — власними словами стандарту.
   * null — стандарт позначок не має або їхньої легенди не знайдено.
   */
  markerLegend: MarkerLegendItem[] | null;
}

/**
 * Один пункт легенди позначок стандарту. Береться з самого стандарту (Tesco,
 * стор. 10 «Clause Layout»: «P — the site must have a documented policy…»),
 * мовою стандарту, — а не вигадується застосунком чи моделлю.
 */
export interface MarkerLegendItem {
  /** Позначка так, як вона надрукована біля вимоги: 'P', 'Major Must', 'Fundamental'. */
  code: string;
  /** Коротка назва зі стандарту: 'Policy / procedure'. Якщо назви немає — сам код. */
  label: string;
  /** Пояснення стандарту майже дослівно; null — стандарт позначку не пояснює. */
  meaning: string | null;
}

export interface ClauseDto {
  id: number;
  specVersionId: number;
  clauseNo: string; // '10.3'
  /** Нормалізований ключ сортування, напр. '010.003'. Будується з clauseNo. */
  sortKey: string;
  sectionNo: string | null; // '10'
  sectionTitle: string | null; // 'Pest management'
  topic: string | null;
  requirementText: string;
  /** Застаріле, лише для прихованих профілів виробництва. Див. `MODULES`. */
  modules: Module[];
  /**
   * Позначки, які стандарт друкує біля цієї вимоги, дослівно: ['P','R'],
   * ['Major Must'], ['Fundamental']. [] — позначок немає. Розшифровка —
   * у `SpecVersionDto.markerLegend`.
   */
  markers: string[];
  obligation: Obligation | null;
  pageFrom: number | null;
  pageTo: number | null;
  /** sha256 від нормалізованого requirementText. Основа діфу між версіями спеки. */
  textHash: string;
  reviewStatus: ClauseReviewStatus;
}

/** Поля, які користувач може правити під час вичитки реєстру (Stage 1 review). */
export interface ClausePatch {
  clauseNo?: string;
  sectionNo?: string | null;
  sectionTitle?: string | null;
  topic?: string | null;
  requirementText?: string;
  modules?: Module[];
  markers?: string[];
  obligation?: Obligation | null;
  reviewStatus?: ClauseReviewStatus;
}

export interface SpecSummaryDto {
  specVersionId: number;
  summary: string;
  scope: string | null;
  /** Витяг розділу «Auditing of Standard»: означення Critical/Major/Minor + таблиця рейтингів. */
  gradingRules: string | null;
  sectionSummaries: Record<string, string>; // { '10': '…' }
  model: string | null;
  promptVersion: string | null;
  createdAt: IsoDate;
}

// ─── Профіль виробництва й застосовність ───────────────────────────────────────────

export interface SiteProfileDto {
  id: number;
  name: string;
  modules: Module[];
  certifications: string[]; // ['ISO14001', 'SMETA']
  products: string[];
  processes: string[];
  notes: string | null;
}

export interface ClauseApplicabilityDto {
  siteProfileId: number;
  clauseId: number;
  applicable: boolean;
  reason: string;
  overriddenByUser: boolean;
}

// ─── Профіль документа ───────────────────────────────────────────────────────

export interface DocProfileDto {
  id: number;
  documentVersionId: number;
  summary: string;
  docType: DocumentKind | null;
  processes: string[];
  /** Вимоги-кандидати — пріоритезація, НЕ фільтр (див. Stage 2 в architecture.md). */
  candidateClauses: string[];
  model: string;
  promptVersion: string;
  createdAt: IsoDate;
}

// ─── Прогони ─────────────────────────────────────────────────────────────────

export interface RunConfig {
  label?: string;
  specVersionId: number;
  siteProfileId: number | null;
  documentVersionIds: number[];
  /** Перевизначення маршрутизації моделей; якщо не задано — DEFAULT_ROUTING. */
  routing?: Partial<Record<Stage, ModelRef>>;
  /** Пропустити прохід критика (швидше й дешевше, нижча довіра). */
  skipCritic?: boolean;
  /**
   * `profile` (типово) — у модель ідуть лише секції, яких документ стосується;
   * решта одразу отримує `not_addressed`. `all` — перевіряти всі секції.
   *
   * Різниця не лише в ціні: на дотичних секціях модель схильна ставити `partial`
   * там, де правильна відповідь `not_addressed` (див. `scoping.ts`).
   */
  scope?: 'profile' | 'all';
}

export interface ModelRef {
  provider: string; // 'anthropic' | 'openrouter' | 'openai-compatible'
  model: string; // 'claude-opus-5', 'openai/gpt-6-luna'
  effort?: Effort;
}

/** Провайдер вбудованої маршрутизації: один ключ — і доступні моделі всіх розробників. */
export const DEFAULT_PROVIDER = 'openrouter';

/**
 * Типова модель кожного етапу в кожного провайдера. Потрібна, коли вибрано
 * лише провайдера: «Anthropic, модель за замовчуванням» для судження має
 * означати Opus, а не одну модель провайдера на всі етапи. Розподіл той самий
 * усюди: Sonnet будує реєстр, Haiku профілює документи, Opus 5.5 судить і критикує.
 *
 * Sonnet 5.5 — лише через OpenRouter: id прямого API Anthropic для нього ще не
 * підтверджений (вгаданий id дав би «модель не знайдено»), тож напряму — Sonnet 5.
 */
export const STAGE_MODEL_DEFAULTS: Readonly<Record<string, Readonly<Record<Stage, string>>>> = {
  openrouter: {
    clause_extract: 'anthropic/claude-sonnet-5.5',
    spec_summary: 'anthropic/claude-sonnet-5.5',
    doc_profile: 'anthropic/claude-haiku-4.5',
    judge: 'anthropic/claude-opus-5.5',
    critic: 'anthropic/claude-opus-5.5',
  },
  anthropic: {
    clause_extract: 'claude-sonnet-5',
    spec_summary: 'claude-sonnet-5',
    doc_profile: 'claude-haiku-4-5',
    judge: 'claude-opus-5-5',
    critic: 'claude-opus-5-5',
  },
};

/** Типова модель етапу в провайдера; null — для провайдера типових моделей немає. */
export function stageDefaultModel(providerId: string, stage: Stage): string | null {
  return STAGE_MODEL_DEFAULTS[providerId]?.[stage] ?? null;
}

/**
 * Маршрутизація за замовчуванням. Переозначається через `AppSettings.routing`
 * і конфігурацію прогону. Тут, а не в main, — щоб інтерфейс показував ті самі
 * моделі, якими реально піде робота, а не «за замовчуванням».
 */
export const DEFAULT_ROUTING: Record<Stage, ModelRef> = {
  clause_extract: { provider: DEFAULT_PROVIDER, model: 'anthropic/claude-sonnet-5.5', effort: 'medium' },
  spec_summary: { provider: DEFAULT_PROVIDER, model: 'anthropic/claude-sonnet-5.5', effort: 'medium' },
  doc_profile: { provider: DEFAULT_PROVIDER, model: 'anthropic/claude-haiku-4.5' },
  // Opus 5.5 за замовчуванням думає на medium — для судження ставимо high явно.
  judge: { provider: DEFAULT_PROVIDER, model: 'anthropic/claude-opus-5.5', effort: 'high' },
  critic: { provider: DEFAULT_PROVIDER, model: 'anthropic/claude-opus-5.5', effort: 'high' },
};

export interface AuditRunDto {
  id: number;
  label: string | null;
  specVersionId: number;
  siteProfileId: number | null;
  status: RunStatus;
  modelJudge: string;
  modelCritic: string | null;
  promptVersion: string;
  startedAt: IsoDate | null;
  finishedAt: IsoDate | null;
  usage: UsageTotals;
  error: string | null;
  documentVersionIds: number[];
}

export interface UsageTotals {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface RunProgress {
  runId: number;
  status: RunStatus;
  stage: Stage | null;
  tasksTotal: number;
  tasksDone: number;
  tasksFailed: number;
  /** Людиночитний опис поточної дії, напр. 'Секція 10 · Pest Management 0068'. */
  currentLabel: string | null;
  usage: UsageTotals;
}

// ─── Результати ──────────────────────────────────────────────────────────────

export interface EvidenceDto {
  id: number;
  findingId: number;
  documentVersionId: number;
  quote: string;
  pageNo: number | null;
  charStart: number | null;
  charEnd: number | null;
  source: EvidenceSource;
  /** Цитата механічно знайдена у вихідному тексті. false → довіри немає. */
  verified: boolean;
}

export interface FindingDto {
  id: number;
  runId: number;
  clauseId: number;
  /** null — зведений finding по всьому набору документів (для gap-аналізу). */
  documentVersionId: number | null;
  verdict: Verdict;
  severity: Severity | null;
  confidence: number | null;
  rationale: string;
  gap: string | null;
  recommendation: string | null;
  /**
   * Що аудитор має перевірити ПОЗА документом — записи, огляд на місці, — бо
   * так каже легенда позначок стандарту (Tesco: R — записи, O — огляд). Це не
   * зауваження до документа: документ цього довести не може за природою.
   * null — нічого (стандарт без позначок або прогін до `judge.v2`).
   */
  outsideEvidence: string | null;
  createdAt: IsoDate;
  evidence: EvidenceDto[];
  review: HumanReviewDto | null;
  /**
   * Денормалізовано для UI, щоб не тягнути clause окремим запитом.
   * `pageFrom`/`pageTo` — сторінки оригіналу стандарту: дозволяють відкрити
   * PDF саме там, де надрукована вимога.
   */
  clause: Pick<
    ClauseDto,
    'clauseNo' | 'sectionNo' | 'sectionTitle' | 'topic' | 'obligation' | 'pageFrom' | 'pageTo'
  >;
}

export interface HumanReviewDto {
  findingId: number;
  humanVerdict: Verdict | null;
  humanSeverity: Severity | null;
  note: string | null;
  reviewedAt: IsoDate;
}

export interface FindingQuery {
  runId: number;
  verdicts?: Verdict[];
  severities?: Severity[];
  sectionNo?: string;
  documentVersionId?: number;
  /** true — тільки без finding_review; false — тільки з ним. */
  unreviewed?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

// ─── Агрегація ───────────────────────────────────────────────────────────────

export interface CoverageCell {
  sectionNo: string;
  documentVersionId: number;
  /** Найгірший вердикт у клітинці. */
  worstVerdict: Verdict;
  counts: Record<Verdict, number>;
}

export interface CoverageMatrix {
  runId: number;
  sections: Array<{ sectionNo: string; sectionTitle: string | null; clauseCount: number }>;
  documents: Array<{ documentVersionId: number; title: string; versionLabel: string }>;
  cells: CoverageCell[];
}

/** Застосовна вимога, яку не покрив жоден документ. Головний вихід продукту. */
export interface GapItem {
  clauseId: number;
  clauseNo: string;
  sectionNo: string | null;
  sectionTitle: string | null;
  topic: string | null;
  obligation: Obligation | null;
  requirementText: string;
  severityIfMissing: Severity | null;
  /** Сторінки оригіналу стандарту — щоб перевірити формулювання в PDF. */
  pageFrom: number | null;
  pageTo: number | null;
}

export interface RunSummary {
  runId: number;
  clausesApplicable: number;
  clausesAssessed: number;
  counts: Record<Verdict, number>;
  severityCounts: Record<Severity, number>;
  gaps: number;
  /** Рейтинг за шкалою стандарту (5..0), якщо gradingRules розібрано. */
  grade: { value: number; label: string } | null;
  usage: UsageTotals;
}

// ─── Витрати ─────────────────────────────────────────────────────────────────

/**
 * Один фактичний виклик моделі. Записується і для прогонів, і для викликів
 * поза ними (побудова реєстру вимог, профілювання документа) — інакше облік
 * не сходиться з рахунком провайдера.
 */
export interface SpendEntry {
  id: number;
  stage: string;
  provider: string;
  model: string;
  promptVersion: string | null;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number | null;
  runId: number | null;
  specVersionId: number | null;
  fromCache: boolean;
  createdAt: IsoDate;
}

export interface SpendByStage {
  stage: string;
  model: string;
  calls: number;
  costUsd: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
}

export interface SpendSummary {
  today: number;
  month: number;
  total: number;
  byStage: SpendByStage[];
}

// ─── Імпорт ──────────────────────────────────────────────────────────────────

export interface ImportRequest {
  paths: string[];
  target:
    | { kind: 'document'; documentId?: number; versionLabel?: string }
    | { kind: 'specification'; specificationId?: number; versionLabel?: string };
}

export interface ImportedItem {
  path: string;
  blobHash: string;
  /** Блоб із таким хешем уже був — нову версію не створено. */
  duplicate: boolean;
  documentVersionId?: number;
  specVersionId?: number;
}

export interface ImportResult {
  imported: ImportedItem[];
  failed: Array<{ path: string; error: string }>;
}

// ─── Утиліти ─────────────────────────────────────────────────────────────────

/**
 * Ключ сортування вимог: '10.3' → '010.003', '1.12' → '001.012'.
 * Потрібен, бо лексикографічно '10.3' < '2.1', що ламає порядок у UI.
 *
 * Номери не лише числові: 'A.5.1' (додаток ISO 27001) → 'A.005.001',
 * 'AF 1.2.3' (GlobalG.A.P.) → 'AF 001.002.003'. Кожна група цифр
 * доповнюється нулями окремо — інакше 'AF 10' стояло б між 'AF 1' і 'AF 2'.
 * Літери не доповнюються: так розділи додатків ('A.…') ідуть після числових.
 */
export function clauseSortKey(clauseNo: string): string {
  return clauseNo
    .trim()
    .split('.')
    .map((part) => {
      const trimmed = part.trim();
      if (/^\d+$/.test(trimmed)) return String(parseInt(trimmed, 10)).padStart(3, '0');
      return trimmed.replace(/\d+/g, (digits) => String(parseInt(digits, 10)).padStart(3, '0'));
    })
    .join('.');
}

/**
 * Нормалізація позначок вимоги: обрізані пробіли, без порожніх, без дублів
 * (порядок першої появи зберігається), не довші за `MARKER_MAX_LENGTH`
 * і не більше `MARKER_MAX_COUNT`. Сміття (не рядки) відкидається.
 *
 * Однакова для відповіді моделі, БД і поля вводу в UI — щоб «P» і « P »
 * ніде не стали двома різними позначками.
 */
export function normalizeMarkers(values: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const marker = value.replace(/\s+/g, ' ').trim();
    if (marker.length === 0 || marker.length > MARKER_MAX_LENGTH) continue;
    if (out.includes(marker)) continue;
    out.push(marker);
    if (out.length >= MARKER_MAX_COUNT) break;
  }
  return out;
}

/**
 * Ключ порівняння позначок: без різниці в регістрі й пробілах — модель могла
 * написати «MAJOR MUST», а в реєстрі стоїть «Major Must».
 */
export function markerKey(code: string): string {
  return code.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Пункти легенди, що пояснюють позначки ОДНІЄЇ вимоги, у порядку її позначок.
 * Позначки, яких легенда не знає, пропускаються: вигадувати їм значення не можна.
 */
export function legendEntriesFor(
  markers: readonly string[],
  legend: readonly MarkerLegendItem[] | null | undefined,
): MarkerLegendItem[] {
  if (!legend || legend.length === 0) return [];
  const out: MarkerLegendItem[] = [];
  for (const code of markers) {
    const item = legend.find((entry) => markerKey(entry.code) === markerKey(code));
    if (item && !out.includes(item)) out.push(item);
  }
  return out;
}

/** Порядок «поганості» вердикту для агрегації в клітинці матриці покриття. */
const VERDICT_RANK: Record<Verdict, number> = {
  not_applicable: 0,
  compliant: 1,
  not_addressed: 2,
  needs_human_review: 3,
  partial: 4,
  non_compliant: 5,
};

export function worstVerdict(verdicts: readonly Verdict[]): Verdict {
  if (verdicts.length === 0) return 'not_addressed';
  return verdicts.reduce((worst, v) => (VERDICT_RANK[v] > VERDICT_RANK[worst] ? v : worst));
}

export function emptyVerdictCounts(): Record<Verdict, number> {
  return Object.fromEntries(VERDICTS.map((v) => [v, 0])) as Record<Verdict, number>;
}

export function emptyUsage(): UsageTotals {
  return { inputTokens: 0, cachedTokens: 0, outputTokens: 0, costUsd: 0 };
}
