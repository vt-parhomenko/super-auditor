/**
 * Англійський каталог main-процесу — джерело правди для типу `MainMessages`.
 *
 * Без `as const`: значення мають бути `string`, інакше інші локалі не пройдуть
 * перевірку типом. Повнота ключів перелічень тримається через `satisfies`.
 *
 * Дві різні мови, і плутати їх не можна:
 *  - `results` і `export` пишуться В РЕЗУЛЬТАТИ (findings, звіт) — мовою
 *    результатів, бо їх читає аудитор разом із висновками моделі;
 *  - усе інше — повідомлення застосунку (тости, помилки, статуси прогону) —
 *    мовою інтерфейсу.
 */

import type { Severity, Verdict } from '@shared/domain';

const pr = new Intl.PluralRules('en');

/** Англійська має дві форми; `other` покриває все, крім одиниці. */
function n(count: number, one: string, other: string): string {
  return pr.select(count) === 'one' ? one : other;
}

/** Як часто скидається ліміт ключа (OpenRouter `limit_reset`); невідоме — без підпису. */
const KEY_RESET: Readonly<Record<string, string>> = {
  daily: ' (resets daily)',
  weekly: ' (resets weekly)',
  monthly: ' (resets monthly)',
};

export const en = {
  /** Службові позначки, що зберігаються у findings. Мова результатів. */
  results: {
    noConclusion: 'The model returned no conclusion for this clause.',
    unverifiedEvidence: '[evidence not confirmed in the document text]',
    criticDisagreed: '[the critic disagreed]',
    outOfScope:
      'The document does not cover this section of the standard. This was decided while profiling ' +
      'the document, without sending the clause text to the model.',
  },

  /** Звіт Markdown. Мова результатів. */
  export: {
    title: (runId: number) => `Audit — run ${runId}`,
    summary: 'Summary',
    applicable: (count: number) => `Applicable clauses: ${count}`,
    assessed: (count: number) => `Assessed: ${count}`,
    gaps: (count: number) => `Gaps: ${count}`,
    cost: (usd: string) => `Cost: ${usd}`,
    colVerdict: 'Verdict',
    colCount: 'Count',
    nonConformities: 'Non-conformities',
    verdictLabel: 'Verdict',
    gapLabel: 'What is missing',
    recommendationLabel: 'Recommendation',
    outsideEvidenceLabel: 'Verify outside the document',
    outsideEvidenceTitle: 'To verify at the audit — outside the documents',
    page: (page: number) => `p. ${page}`,
    gapsTitle: 'Gaps — clauses without any evidence',
    colClause: 'Clause',
    colSection: 'Section',
    colTopic: 'Topic',
    verdicts: {
      compliant: 'Compliant',
      partial: 'Partially compliant',
      non_compliant: 'Non-compliant',
      not_applicable: 'Not applicable',
      not_addressed: 'Not addressed',
      needs_human_review: 'Needs human review',
    } satisfies Record<Verdict, string>,
    severities: {
      critical: 'Critical',
      major: 'Major',
      minor: 'Minor',
      recommendation: 'Recommendation',
    } satisfies Record<Severity, string>,
  },

  /** Стан і помилки прогону: `audit_run.error`, тости, `run:finished`. */
  run: {
    tasksNotCompleted: (count: number) =>
      `${count} ${n(count, 'task was', 'tasks were')} not completed`,
    allTasksFailed: (count: number, first: string) =>
      `None of the ${count} ${n(count, 'task', 'tasks')} completed. First error: ${first}`,
    partial: (count: number) =>
      `Partially completed: ${count} ${n(count, 'task was', 'tasks were')} not completed`,
    unknownCause: 'unknown cause',
    crashed: (runId: number, message: string) => `Run ${runId} failed: ${message}`,
    notFound: (runId: number) => `Run ${runId} not found`,
    specVersionNotFound: (specVersionId: number) =>
      `Specification version ${specVersionId} not found`,
    noDocuments: 'No documents selected',
    emptyRegistry: 'The clause registry is empty — build it first (Stage 1)',
    noExtraction: (documentVersionId: number) =>
      `Document version ${documentVersionId} has no extracted text`,
    scopeFallback: (count: number) =>
      `Could not narrow the check for ${count} ${n(count, 'document', 'documents')}. ` +
      `${n(count, 'It', 'They')} will be checked against the whole standard.`,
  },

  /** Stage 1 — побудова реєстру вимог. */
  clauses: {
    failedPages: (count: number) =>
      `${count} ${n(count, 'page', 'pages')} could not be processed. The clause registry is incomplete.`,
    flagged: (count: number) =>
      `${count} ${n(count, 'clause was', 'clauses were')} flagged for review — check ${n(count, 'it', 'them')} first.`,
    noExtraction: 'This specification version has no extracted text',
    extractionMissing: 'The extracted text of the specification was not found',
    /** Жодна сторінка не оброблена — реєстр не чіпаємо: порожній замість наявного гірший за старий. */
    allPagesFailed: (error: string) =>
      `No page of the standard could be processed, so the clause registry was left unchanged. First error: ${error}`,
    /** Вичитаний вручну реєстр не замінюємо неповним. */
    reviewedKept: (failed: number) =>
      `${failed} ${n(failed, 'page', 'pages')} could not be processed. The reviewed clause registry was kept unchanged — ` +
      'fix the cause and run the extraction again.',
    /**
     * Легенда позначок не прочитана — реєстр уже збережено, тож це лише попередження.
     * Без «показано без пояснень»: відома легенда цієї ж версії могла лишитись.
     */
    markerLegendFailed: (detail: string) =>
      'The clause registry was saved, but the standard’s explanation of its clause markers could not be read this time. ' +
      `Run the extraction again to retry. (${detail})`,
  },

  /**
   * Помилки моделей і провайдерів. `provider` — людська назва (Anthropic,
   * OpenRouter), `detail` — сирий текст провайдера для діагностики.
   */
  llm: {
    /** `topUpUrl` — сторінка поповнення, якщо відома; інакше — назва провайдера. */
    insufficientCredit: (provider: string, topUpUrl: string | null, detail: string) =>
      `The ${provider} balance has run out. Top up the balance at ${topUpUrl ?? provider} and press “Resume” — ` +
      `the run continues where it stopped. (${detail})`,
    auth: (provider: string, detail: string) =>
      `${provider} rejected the API key. Check it in Settings. (${detail})`,
    notConfigured: (provider: string) =>
      `${provider} is not configured: there is no API key or endpoint. Add it in Settings.`,
    cloudBlockedLocalOnly: (provider: string) =>
      `“Local models only” is on in Settings, so the cloud provider ${provider} cannot be used.`,
    cloudBlockedSpec: (provider: string) =>
      `This specification must not leave this computer, so the cloud provider ${provider} cannot be used. ` +
      'Turn on “Allow cloud providers” on the specification card, or route the stage to a local model.',
    cloudBlocked: (provider: string) =>
      `The cloud provider ${provider} is not allowed here: either “Local models only” is on in Settings, ` +
      'or the specification does not allow cloud providers.',
    rateLimit: (provider: string) => `${provider} is rate-limiting requests — try again in a minute.`,
    transport: (provider: string, detail: string) =>
      `No connection to ${provider}: check the network, proxy or firewall. (${detail})`,
    modelNotFound: (provider: string, detail: string) =>
      `${provider} does not recognise the model — check the model id in Settings → Model routing per stage. (${detail})`,
    unsupported: (provider: string, detail: string) =>
      `The selected ${provider} model cannot do what this step needs — choose another model in ` +
      `Settings → Model routing per stage. (${detail})`,
    /** OpenRouter: жоден ендпоінт моделі не відповідає вимогам приватності чи формату відповіді. */
    noRoutedEndpoint: (provider: string, detail: string) =>
      `${provider} has no endpoint for this model that keeps your data private (no data collection) and ` +
      'returns structured answers. Choose another model in Settings → Model routing per stage, or allow ' +
      `the model in your ${provider} privacy settings. (${detail})`,
    refusal: 'The model refused to answer.',
    schema: (detail: string) => `The model's answer did not match the expected structure. (${detail})`,
    aborted: 'Cancelled.',
  },

  /** Загальні помилки межі IPC. */
  ipc: {
    /** Форма сутності для «X 42 not found». */
    entities: {
      run: 'Run',
      specification: 'Specification',
      specVersion: 'Specification version',
      clause: 'Clause',
      siteProfile: 'Site profile',
      document: 'Document',
      documentVersion: 'Document version',
      finding: 'Finding',
      blob: 'Blob',
      blobFile: 'Blob file',
      provider: 'Provider',
    },
    notFound: (what: string) => `${what} not found`,
    invalidId: (label: string, value: string) => `${label} must be a positive integer, got ${value}`,
    integrity: (code: string) =>
      `The action conflicts with data integrity (${code}) — the record may already be used elsewhere`,
    orchestratorMissing:
      'The run orchestrator is not connected — run operations are not available in this build',
  },

  /** Видалення специфікацій і документів (`library:*`). */
  library: {
    invalidTarget: (value: string) =>
      `Nothing to delete: expected a specification, a specification version, a document or a document version, got ${value}`,
  },

  clauseEditing: {
    numberEmpty: 'The clause number cannot be empty',
    textEmpty: 'The clause text cannot be empty',
    specNoExtraction:
      'This specification version has no extracted text — re-import the file first',
    registryEmpty: 'The registry is empty — there is nothing to mark as reviewed',
    registryNotReviewed: (unconfirmed: number, flagged: number) =>
      `The registry is not fully reviewed: ${unconfirmed} unconfirmed, ${flagged} flagged`,
    markersInvalid: (maxCount: number, maxLength: number) =>
      `Standard markers must be a list of at most ${maxCount} short codes, each non-empty and at most ${maxLength} characters long`,
  },

  docProfiles: {
    noExtraction:
      'This document version has no extracted text — there is nothing to build a profile from',
  },

  findings: {
    emptyQuery: 'Empty findings query',
  },

  exporting: {
    unknownFormat: (format: string) => `Unknown export format: ${format}`,
    notImplemented: (format: string) =>
      `Export to ${format} is not implemented yet — it needs a separate library. Available formats: JSON, Markdown.`,
  },

  importing: {
    unknownKind: (kind: string) => `Unknown import type: ${kind}`,
    noFiles: 'There are no files to import',
    noTarget: 'The import target is missing: a document or a specification',
    invalidBlobHash: 'Invalid blob hash: 64 hexadecimal characters expected',
    blobOutsideStorage: 'The blob path points outside the storage folder',
    dialogTitleDocuments: 'Import documents',
    dialogTitleSpecification: 'Import a specification',
    dialogButton: 'Import',
    filterDocuments: 'Documents (PDF, DOCX)',
    filterAll: 'All files',
    failedToast: (failed: number, total: number) =>
      `Could not import ${failed} of ${total} ${n(total, 'file', 'files')}`,
    unsupportedFormat: (mime: string) =>
      `The format “${mime}” is not supported. Only PDF and DOCX can be imported — convert other files first.`,
    ocrNotConfigured:
      'The document looks like a scan, and no OCR engine is set up. Import a version that has a text layer.',
    fileNotFound: 'The file was not found — it may have been moved or deleted',
  },

  runs: {
    emptyConfig: 'The run configuration is empty',
    registryNotReviewed:
      'The clause registry has not been reviewed — runs are blocked until Stage 1 is confirmed',
    noDocuments: 'No documents selected for the run',
    siteProfileMissing: (siteProfileId: number) => `Site profile ${siteProfileId} not found`,
  },

  sites: {
    nameEmpty: 'The site profile name cannot be empty',
    noClauses: 'This specification version has no clauses yet — build the registry first (Stage 1)',
    overrideReasonRequired: 'A reason for the override is required',
  },

  settings: {
    emptyPatch: 'The settings patch is empty',
    unknownTheme: (value: string) => `Unknown theme: ${value}`,
    concurrencyNotNumber: 'concurrency must be a number',
    localOnlyNotBoolean: 'localOnly must be true or false',
    invalidResultsLanguage: (value: string) =>
      `Unsupported results language: ${value}. Expected one of: en, nl, uk, or empty for the language of the standard`,
    invalidUiLanguage: (value: string) =>
      `Unsupported interface language: ${value}. Expected one of: en, nl, uk`,
  },

  secrets: {
    encryptionUnavailable:
      'The system password store (safeStorage) is not available, so the API key was not saved — ' +
      'otherwise it would sit on disk as plain text. On Linux install gnome-keyring or KWallet; ' +
      'on Windows and macOS check the user profile.',
  },

  /**
   * Провайдери й ключі API (хендлери `providers:*`). `provider` — людська назва
   * (`providerName(id)` або `provider.label`), суми — вже відформатовані (`formatUsd`).
   */
  providers: {
    idMissing: 'No provider id given',
    keyEmpty: 'The API key cannot be empty',
    managementKeyEmpty: 'The management key cannot be empty',
    managementKeyUnsupported: (provider: string) => `${provider} does not use a management key`,
    notConfigured: (provider: string) =>
      `${provider} is not configured: there is no API key or endpoint`,
    networkCheckDisabled: 'The network check is off — only the presence of the key was verified',
    probeNotImplemented: (provider: string) =>
      `${provider} is configured; a network check is not implemented for it`,
    keyNotFound: (provider: string) => `No ${provider} key was found in the secure store`,
    connectionOk: (provider: string) => `The connection to ${provider} works`,
    connectionOkWithModel: (provider: string, model: string) =>
      `The connection to ${provider} works; model ${model} is available`,
    /** Перевірка ключа OpenRouter (`GET /key`): label — назва ключа в акаунті. */
    keyValid: (provider: string, label: string | null) =>
      `The ${provider} key is valid${label ? ` (“${label}”)` : ''}.`,
    keyUsage: (usd: string) => `Spent with this key: ${usd}.`,
    /** `reset` — 'daily' | 'weekly' | 'monthly'; інше чи null — ліміт не скидається. */
    keyLimit: (limit: string, remaining: string | null, reset: string | null) =>
      `Key limit: ${limit}${remaining === null ? '' : `, ${remaining} left`}${KEY_RESET[reset ?? ''] ?? ''}.`,
    noKeyLimit: 'No key limit is set.',
    freeTier: 'Free tier: only free models are available, with usage limits.',
    keyRejected: 'The API key was rejected (401): check that it was copied in full and has not been revoked',
    permissionDenied: 'Access denied (403): the key is disabled or has no access to this API',
    rateLimited: 'The key is valid, but the rate limit was hit (429) — try again in a minute',
    noConnection: (host: string) =>
      `No connection to ${host}: check the network, proxy or firewall`,
    httpError: (provider: string, status: number | null, message: string) =>
      `${provider} returned an error${status === null ? '' : ` (HTTP ${status})`}: ${message}`,
  },

  app: {
    internalError: (message: string) => `Internal error: ${message}`,
  },

  preload: {
    unknownEvent: (event: string) => `Unknown event channel: ${event}`,
  },
};

/** Форма каталогу. Будь-який зайвий чи пропущений ключ в іншій локалі — помилка типу. */
export type MainMessages = typeof en;
