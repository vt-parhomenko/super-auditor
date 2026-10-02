/**
 * Англійський каталог — джерело правди для типу `Messages`.
 *
 * Без `as const`: значення мають бути `string`, інакше інші локалі не пройдуть
 * перевірку типом. Повнота ключів перелічень тримається через `satisfies`.
 */

import type {
  ClauseReviewStatus,
  ClausesStatus,
  DocumentKind,
  Effort,
  ModelTier,
  Module,
  Obligation,
  RunStatus,
  Severity,
  Stage,
  Verdict,
} from '@shared/domain';

const pr = new Intl.PluralRules('en');

/** Англійська має дві форми; `other` покриває все, крім одиниці. */
function n(count: number, one: string, other: string): string {
  return pr.select(count) === 'one' ? one : other;
}

export const en = {
  common: {
    cancel: 'Cancel',
    save: 'Save',
    saving: 'Saving…',
    delete: 'Delete',
    close: 'Close',
    retry: 'Try again',
    empty: 'Nothing here',
    loading: 'loading…',
  },

  nav: {
    library: 'Documents',
    specs: 'Specifications',
    sites: 'Site profiles',
    runs: 'Runs',
    settings: 'Settings',
    mainNav: 'Main navigation',
    theme: 'Theme',
    themeGroup: 'Colour theme',
    themeLight: 'Light theme',
    themeSystem: 'Match the system',
    themeDark: 'Dark theme',
    runProgress: (runId: number, done: number, total: number) => `Run #${runId}: ${done}/${total}`,
    mockTitle: 'Data replaced with fixtures (?mock=1)',
  },

  labels: {
    verdict: {
      compliant: 'Compliant',
      partial: 'Partial',
      non_compliant: 'Non-compliant',
      not_applicable: 'Not applicable',
      not_addressed: 'Not addressed',
      needs_human_review: 'Needs a human',
    } satisfies Record<Verdict, string>,

    verdictShort: {
      compliant: 'OK',
      partial: 'Part.',
      non_compliant: 'NC',
      not_applicable: 'N/A',
      not_addressed: 'None',
      needs_human_review: 'Human',
    } satisfies Record<Verdict, string>,

    verdictHint: {
      compliant: 'The requirement is backed by evidence from the document.',
      partial: 'Partly covered — part of the requirement has no evidence.',
      non_compliant: 'The document contradicts the requirement outright, or fails to meet it.',
      not_applicable: 'Outside the site scope — decided deterministically, not by the model.',
      not_addressed: 'No document says anything about this requirement.',
      needs_human_review: 'The model and the critic disagreed, or there is no verified quote.',
    } satisfies Record<Verdict, string>,

    severity: {
      critical: 'Critical',
      major: 'Major',
      minor: 'Minor',
      recommendation: 'Recommendation',
    } satisfies Record<Severity, string>,

    severityShort: {
      critical: 'CRIT',
      major: 'MAJ',
      minor: 'MIN',
      recommendation: 'REC',
    } satisfies Record<Severity, string>,

    module: {
      P: 'Product',
      R: 'Responsible sourcing',
      O: 'Operational',
    } satisfies Record<Module, string>,

    obligation: {
      must: 'must — mandatory',
      should: 'should — expected',
      may: 'may — recommended',
    } satisfies Record<Obligation, string>,

    documentKind: {
      sop: 'SOP',
      policy: 'Policy',
      form: 'Form',
      record: 'Record',
      manual: 'Manual',
      other: 'Other',
    } satisfies Record<DocumentKind, string>,

    runStatus: {
      queued: 'Queued',
      running: 'Running',
      paused: 'Paused',
      done: 'Finished',
      failed: 'Failed',
      cancelled: 'Cancelled',
    } satisfies Record<RunStatus, string>,

    clauseReview: {
      auto: 'Not reviewed',
      confirmed: 'Confirmed',
      edited: 'Edited',
      flagged: 'Flagged',
    } satisfies Record<ClauseReviewStatus, string>,

    clausesStatus: {
      pending: 'Registry not extracted',
      extracted: 'Extracted, needs review',
      reviewed: 'Reviewed',
    } satisfies Record<ClausesStatus, string>,

    stage: {
      clause_extract: 'Clause registry',
      spec_summary: 'Specification digest',
      doc_profile: 'Document profile',
      judge: 'Judgement',
      critic: 'Critic',
    } satisfies Record<Stage, string>,

    stageHint: {
      clause_extract: 'Page-by-page parsing of the requirements table. Needs an accurate model.',
      spec_summary: 'Digest plus the Critical/Major/Minor grading rules.',
      doc_profile: 'One cheap call per document version.',
      judge: 'The bulk of a run’s cost: section × document.',
      critic: 'Re-checks compliant verdicts only. Can be skipped.',
    } satisfies Record<Stage, string>,

    /** Глибина роздумів моделі. Значення в API лишаються кодами `low`…`max`. */
    effort: {
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'extra high',
      max: 'max',
    } satisfies Record<Effort, string>,

    modelTier: {
      top: 'top tier',
      balanced: 'balanced',
      budget: 'budget',
    } satisfies Record<ModelTier, string>,
  },

  /** `intlLocale` — регіональний тег для Intl; решта — одиниці, які Intl не дає. */
  format: {
    intlLocale: 'en-GB',
    hours: 'h',
    minutes: 'min',
    seconds: 's',
    bytes: 'B',
    kilobytes: 'KB',
    megabytes: 'MB',
    gigabytes: 'GB',
  },

  states: {
    backendTitle: 'Module not wired up yet',
    backendDesc:
      'The handler for this IPC channel is not implemented in the main process yet. The interface is ready — data will appear as soon as the backend answers.',
    mockHintLead: 'To see this screen with realistic data, open the app with ',
    mockHintMid: ' in the address, or start it with ',
    mockHintTail: '.',
    unknownError: 'Unknown error',
    loadFailed: 'Could not load',
  },

  api: {
    backendNotReady: (channel: string) =>
      `Module not wired up yet: channel “${channel}” is not registered in the main process.`,
    bridgeMissing: 'The window.api bridge is unavailable. Open the app in Electron, or add ?mock=1.',
    channelFailed: (channel: string) => `Channel “${channel}” failed`,
  },

  table: {
    empty: 'No rows',
    range: (from: number, to: number, total: number) => `${from}–${to} of ${total}`,
    prev: '← Previous',
    next: 'Next →',
  },

  badges: {
    outOfScopeSuffix: ' (outside the clause scope)',
    verified: 'verified',
    unverified: 'unverified',
    verifiedHint: 'The quote was mechanically located in the document source text',
    unverifiedHint: 'The quote was not found in the source text — it cannot be trusted',
  },

  meters: {
    costTitle: (input: string, cached: string, share: number, output: string) =>
      `Input: ${input} · from cache: ${cached} (${share}%) · output: ${output}`,
    cacheShare: (share: number) => `${share}% cache`,
    inShort: 'in',
    outShort: 'out',
  },

  heatmap: {
    section: 'Section',
    cell: (sectionNo: string, document: string, verdict: string, total: number) =>
      `${sectionNo} · ${document}: ${verdict}, ${total} findings`,
    cellEmpty: (sectionNo: string, document: string) => `${sectionNo} · ${document}: no findings`,
  },

  evidenceViewer: {
    title: 'Document viewer',
    pickQuote: 'Select a quote on the left to see where it sits on the page.',
    soon: 'coming soon',
    document: 'Document',
    page: 'Page',
    range: 'Range',
    source: 'Source',
    sourceCitations: 'Citations API',
    sourceModel: 'model quote',
    footnote: 'The PDF page with the quote highlighted, and click-to-jump, will appear here.',
  },

  tagInput: {
    remove: (value: string) => `Remove ${value}`,
  },

  library: {
    title: 'Documents',
    subtitle: 'SOPs, policies, forms and records checked for compliance with specifications.',
    picking: 'Choosing files…',
    import: '+ Import',
    importing: 'Importing…',
    dropLabel: 'Drop PDF or DOCX files here',
    dropHint:
      'Every file becomes a new document version. A SHA-256 duplicate does not create one.',
    searchPlaceholder: 'Search by title, number, owner…',
    allKinds: 'All types',
    documentsCount: (count: number) => `${n(count, 'Document', 'Documents')}: ${count}`,
    emptyTitle: 'No documents yet',
    emptyDesc: 'Import your first SOP — then you can check it against a specification.',
    emptyAction: 'Import documents',
    importResult: (imported: number, duplicates: number, failed: number) =>
      `Imported ${imported}, duplicates ${duplicates}, failed ${failed}`,
    dropPathUnavailable: (name: string) =>
      `The path to “${name}” is not available from a drop — use the import button instead.`,
    dropUnreadable: 'Could not read the dropped files.',
    dropSkipped: (count: number) =>
      `${n(count, 'File', 'Files')} skipped because the path is unavailable: ${count}`,
    kindNotSet: 'type not set',
    ownerNotSet: 'owner not set',
    owner: (name: string) => `owner: ${name}`,
    versionsCount: (count: number) => `${n(count, 'version', 'versions')}: ${count}`,
    latestVersion: (label: string) => ` · latest ${label}`,
    toggleVersions: 'Show versions',
    metadata: 'Metadata',
    noVersions: 'No versions yet',
    pagesSuffix: 'pp.',
    importedAt: (when: string) => `Imported ${when}`,
    effectiveFrom: (date: string) => `effective from ${date}`,
    modalTitle: 'Document metadata',
    confirmDelete: (title: string) => `Delete “${title}” together with all its versions?`,
    fieldTitle: 'Title',
    fieldDocNumber: 'Document number',
    fieldOwner: 'Process owner',
    ownerPlaceholder: 'e.g. Quality Manager',
    fieldKind: 'Type',
    kindUnset: 'not set',
    versionsCallout:
      'Versions are edited by importing a new file: every file with a new SHA-256 becomes a new version.',
  },

  specs: {
    title: 'Specifications',
    subtitle:
      'Standards the documents are checked against. One standard version — one clause registry.',
    import: '+ Import a standard',
    dropLabel: 'Drop the standard’s PDF here',
    dropHint: 'After import you still need to extract the clause registry and review it by hand.',
    emptyTitle: 'No specifications',
    emptyDesc: 'Import a customer standard — the Tesco Ornamental Plant Standard, for example.',
    importedVersions: (count: number) => `${n(count, 'Version', 'Versions')} imported: ${count}`,
    issuerUnknown: 'issuer not set',
    versionsCount: (count: number) => `${n(count, 'version', 'versions')}: ${count}`,
    cloudAllowed: 'Allow cloud providers',
    cloudAllowedOn:
      'The full text of the standard and of the documents will be sent to an external API. Standards often ship “for use of the immediate recipient” — make sure that is acceptable.',
    cloudAllowedOff:
      'Content will be processed by local models only. Judgement quality is lower, but nothing leaves the machine.',
    noVersions: 'No versions yet',
    effectiveFrom: (date: string) => `effective from ${date}`,
    reviewedLabel: 'reviewed',
    reviewedRight: (done: number, total: number) => `${done} of ${total}`,
    registryEmpty: 'registry is empty',
    openRegistry: 'Clause registry →',
  },

  sites: {
    title: 'Site profiles',
    subtitle:
      'Modules, certifications, products and processes of the site. They decide which clauses apply.',
    newProfile: '+ New profile',
    emptyTitle: 'No profiles',
    emptyDesc: 'Create the first site profile.',
    certificationsCount: (count: number) =>
      `${count} ${n(count, 'certification', 'certifications')}`,
    clausesCount: (count: number) => `${count} ${n(count, 'clause', 'clauses')}`,
    pickProfile: 'Select a profile',
    fieldName: 'Profile name',
    namePlaceholder: 'Lisse — bulb packing',
    fieldModules: 'Standard modules',
    modulesHint: 'Clauses outside these modules become not_applicable.',
    fieldCertifications: 'Certifications',
    certificationsPlaceholder: 'ISO14001, SMETA…',
    certificationsHint: 'ISO14001 clears the Environment section; SMETA/SIZA — Responsible Sourcing.',
    fieldProducts: 'Products',
    productsPlaceholder: 'Tulip bulbs…',
    fieldProcesses: 'Processes',
    processesPlaceholder: 'Goods-in, Packing…',
    fieldNotes: 'Notes',
    saveProfile: 'Save profile',
    confirmDelete: (name: string) => `Delete the profile “${name}”?`,
    recomputeTitle: 'Recompute applicability (Stage 3)',
    noSpecs: 'no specifications',
    recomputing: 'Counting…',
    recompute: 'Recompute',
    saveFirst: 'Save the profile first',
    resultApplicable: 'applicable',
    resultOf: 'of',
    resultOutOfScope: (count: number) => ` · outside scope ${count}`,
    recomputeHint:
      'The computation is deterministic — no AI involved. Every exception can be overridden by hand on the registry screen.',
  },

  runs: {
    title: 'Audit runs',
    subtitle:
      'Partial results are written to the database immediately — an interrupted run can be resumed.',
    newRun: '+ New run',
    colLabel: 'Name',
    unnamed: 'unnamed',
    colStatus: 'Status',
    colDocs: 'Documents',
    colModel: 'Model',
    modelTitle: (judge: string, critic: string | null) =>
      `judge: ${judge}${critic ? ` · critic: ${critic}` : ' · no critic'}`,
    colStarted: 'Started',
    colDuration: 'Duration',
    colCost: 'Cost',
    costTitle: (input: string, output: string) => `${input} in / ${output} out`,
    runTitle: (runId: number) => `Run #${runId}`,
    preparing: 'preparing',
    running: 'running',
    progressRight: (done: number, total: number, failed: number) =>
      `${done} / ${total}${failed ? ` · failed ${failed}` : ''}`,
    pause: '⏸ Pause',
    resume: '▶ Resume',
    cancel: '✕ Cancel',
    openDetails: 'Open details →',
    emptyTitle: 'No runs yet',
    emptyDesc:
      'Pick a reviewed specification version, a site profile and the documents — then start the first audit.',
    emptyAction: 'Create a run',
    tableLabel: 'Runs',
    modalTitle: 'New audit run',
    estimating: 'Estimating…',
    estimate: 'Estimate the cost',
    starting: 'Starting…',
    start: 'Start',
    blockedTitle: 'The clause registry of this version has not been reviewed',
    fieldLabel: 'Run name (optional)',
    labelPlaceholder: 'Tesco v5.0 × 3 SOPs',
    fieldSpecVersion: 'Specification version',
    noSpecs: 'no specifications',
    specReviewed: (reviewed: number, total: number) => `— reviewed ${reviewed}/${total}`,
    fieldSite: 'Site profile',
    noSite: 'no profile — every clause applies',
    blockedCallout:
      'The clause registry of this version has not been reviewed yet. The run is blocked: broken clauses make every downstream finding meaningless.',
    fieldDocuments: (selected: number) => `Documents (${selected} selected)`,
    libraryEmpty: 'No documents yet',
    selectAll: 'Select all',
    clearSelection: 'Clear',
    skipCritic: 'Skip the critic pass',
    skipCriticHint:
      'Faster and cheaper, but it raises the risk of a missed non-conformity — the most expensive mistake there is.',
    estimateTasks: 'Tasks',
    estimateInput: 'Input tokens',
    estimateCost: 'Estimated cost',
    estimateCostSub: 'before prefix caching',
    estimateModel: (model: string) => `Priced as ${model}`,
    estimatePriceUnknown: 'price unknown',
    estimatePriceUnknownSub: 'the catalogue has no price for this model',

    modelOverrideTitle: 'Analysis model',
    modelOverrideGroup: 'Which model analyses the documents in this run',
    modelOverrideSettings: 'As in Settings',
    modelOverrideCustom: 'Choose for this run',
    modelOverrideCurrent: (judge: string, critic: string) => `Judgement: ${judge} · critic: ${critic}`,
    modelOverrideDefault: 'built-in default',
    modelOverrideProviderDefault: (provider: string) => `default model of ${provider}`,
    modelOverrideHint:
      'Applies to the judgement and the critic of this run only. Settings stay as they are.',
  },

  runDetail: {
    tabCoverage: 'Coverage matrix',
    tabFindings: 'Findings',
    tabGaps: 'Gaps',
    tabSummary: 'Summary',
    notFound: (runId: number) => `Run #${runId} not found`,
    reviewMode: 'Review mode',
    exportPlaceholder: 'Export…',
    exportSaved: (path: string) => `Saved: ${path}`,
  },

  coverage: {
    emptyTitle: 'The matrix is empty',
    emptyDesc:
      'The run has not produced a single finding yet. Wait for the judgement stage to finish.',
    hint:
      'A cell shows the worst verdict for that section in that document and the number of findings. Clicking it filters the findings list.',
  },

  findings: {
    searchPlaceholder: 'Search the rationale text…',
    allSections: 'all sections',
    allDocuments: 'all documents',
    unreviewedOnly: 'unreviewed only',
    reset: 'Reset',
    emptyTitle: 'Nothing found',
    emptyDesc: 'Change the filters or clear them.',
    colClause: 'Clause',
    colTopic: 'Topic',
    colDocument: 'Document',
    colVerdict: 'Verdict',
    colSeverity: 'Severity',
    colConfidence: 'Conf.',
    colEvidence: 'Evidence',
    evidenceTitle: (verified: number, total: number) => `${verified} verified of ${total}`,
    colPages: 'Page',
    colRationale: 'Rationale',
    colReview: 'Review',
    reviewAgreed: 'ok',
    tableLabel: 'Findings',
  },

  gaps: {
    colClause: 'Clause',
    colSection: 'Section',
    colTopic: 'Topic',
    colObligation: 'Oblig.',
    colPages: 'Page',
    colSeverity: 'If missing',
    colRequirement: 'Requirement',
    emptyTitle: 'No gaps',
    emptyDesc: 'Every applicable clause has at least one piece of evidence in the documents.',
    summaryLead: 'Applicable clauses with no evidence at all: ',
    summaryTail: '. Every row is a candidate for the corrective action plan (CAP).',
    tableLabel: 'Gaps',
  },

  summary: {
    coverage: 'Coverage',
    clausesApplicable: 'Applicable clauses',
    clausesApplicableSub: 'after the applicability filter',
    assessed: 'Assessed',
    gaps: 'Gaps',
    gapsSub: 'with no evidence at all',
    grade: 'Grade on the scale',
    gradeSub: 'gradingRules not parsed',
    verdicts: 'Verdicts',
    severity: 'Severity',
    spend: 'Spend',
    runCost: 'Run cost',
    cacheLabel: 'share of input tokens served from cache',
    input: 'Input',
    cached: 'From cache',
    output: 'Output',
    cacheNote:
      'A zero cache share on repeat runs means something in the stable prompt prefix keeps changing (a timestamp, unsorted JSON).',
    models: 'Models',
    modelJudge: 'Judgement',
    modelCritic: 'Critic',
    noCritic: 'skipped',
  },

  clauseRegistry: {
    crumb: (versionLabel: string) => `Clause registry · v${versionLabel}`,
    reviewTitle: 'Registry review',
    progressLabel: (done: number, total: number) => `reviewed ${done} of ${total}`,
    progressRight: (pending: number, flagged: number) =>
      `${pending} undecided · ${flagged} flagged`,
    summaryBtn: 'Digest and grading rules',
    extractBtn: 'Extract the registry (Stage 1)',
    markReviewed: 'Mark as reviewed',
    blockedTitle: (pending: number, flagged: number) =>
      `${pending} undecided and ${flagged} flagged still left`,
    unlockTitle: 'Unlock audit runs for this version',
    markedReviewed: 'The registry is marked as reviewed',
    extractProgress: (page: number, pageCount: number) =>
      `Extraction: page ${page} of ${pageCount}`,
    extractFound: (count: number) => `clauses found: ${count}`,
    extractFailed: (message: string) => `Extraction failed: ${message}`,
    searchPlaceholder: 'Search: number, topic, requirement text…',
    filterAll: (count: number) => `All ${count}`,
    filterPending: (count: number) => `Undecided ${count}`,
    filterFlagged: (count: number) => `Flagged ${count}`,
    emptyRegistry: 'The registry is empty',
    emptyRegistryDesc:
      'Run the registry extraction — it parses the requirements table page by page.',
    emptySearch: 'Nothing found',
    emptySearchDesc: 'Try changing the filter or the query.',
    listLabel: 'Clauses',
    hintNav: 'navigate',
    hintConfirm: 'confirm + next',
    hintFlag: 'flag',
    pickClause: 'Select a clause',
    pickClauseDesc: 'The list is on the left; navigate with J / K.',
    summaryModalTitle: 'Specification digest',
    summaryEmptyTitle: 'No digest yet',
    summaryEmptyDesc: 'It is built during Stage 1, together with the clause registry.',
    summaryDescription: 'Description',
    summaryScope: 'Scope',
    summaryGrading: 'Grading rules',
    summaryModelUnknown: 'model unknown',
    fieldClauseNo: 'Clause number',
    fieldTopic: 'Topic',
    fieldSection: 'Section',
    fieldSectionTitle: 'Section title',
    fieldModules: 'Applicability modules',
    modulesHint: 'An empty set = the clause always applies, whatever the site profile says.',
    fieldObligation: 'Obligation',
    obligationUnset: 'not set',
    fieldRequirement: 'Requirement text',
    requirementHint:
      'Bullet lists (`•`) must stay lists: they are what forms the individual checkable points.',
    pages: 'Pages',
    confirm: '✔ Confirm',
    saveEdits: '✎ Save edits',
    saveEditsTitle: 'Save the edits and mark the clause as edited',
    noChanges: 'No changes',
    flag: '⚑ Flag',
    unsaved: 'unsaved edits',
  },

  findingDetail: {
    crumb: 'Finding',
    crumbClause: (clauseNo: string) => `Clause ${clauseNo}`,
    notFound: (findingId: number) => `Finding #${findingId} not found`,
    aggregate: 'aggregated over the set',
    requirement: 'Standard requirement',
    requirementUnavailable: 'The requirement text is unavailable.',
    section: (sectionNo: string, sectionTitle: string) => `section ${sectionNo} · ${sectionTitle}`,
    document: (title: string) => `document: ${title}`,
    confidence: (value: string) => `confidence: ${value}`,
    rationale: 'Rationale',
    gap: 'Gap',
    recommendation: 'Recommendation',
    prev: '← Previous',
    next: 'Next →',
    position: (index: string, total: number) => `${index} of ${total}`,
    evidence: 'Evidence',
    verifiedCount: (verified: number, total: number) => `${verified} / ${total} verified`,
    noEvidenceLead: 'No evidence at all. For a verdict of ',
    noEvidenceTail: ' that is expected only when the requirement is genuinely mentioned nowhere.',
    pageShort: 'p.',
    hintBetween: 'between findings',
    hintBack: 'back to the list',
    treeTitle: 'Clauses in the run',
    reviewedDot: 'reviewed',
    decisionTitle: 'Human decision',
    decisionUpdated: (when: string) => `updated ${when}`,
    decisionNote:
      'The model verdict is never overwritten. A disagreement between the two automatically becomes an eval candidate.',
    fieldHumanVerdict: 'Human verdict',
    agreeWithModel: 'I agree with the model',
    fieldSeverity: 'Severity',
    asModel: 'as the model says',
    fieldNote: 'Note',
    saveDecision: 'Save the decision',
    decisionSaved: 'Decision saved',
    clearDecision: 'Clear the decision',
  },

  review: {
    crumb: 'Review mode',
    allReviewed: 'No unreviewed findings left',
    rejectNote: 'model verdict rejected',
    emptyTitle: 'Nothing to review',
    emptyDesc: 'This run has not produced any results yet.',
    confidence: (value: string) => `confidence ${value}`,
    progressLabel: (done: number, total: number) => `reviewed ${done} of ${total}`,
    whichVerdict: 'Which verdict is correct?',
    cancelEsc: 'Cancel (Esc)',
    accept: 'Accept',
    reject: 'Reject',
    edit: 'Edit',
    hintNav: 'navigate',
    hintNextUnreviewed: 'next unreviewed',
    hintExit: 'exit',
    requirement: 'Standard requirement',
    modelRationale: 'Model rationale',
    gap: 'Gap',
    recommendation: 'Recommendation',
    alreadyReviewed: 'Already reviewed: ',
    agreedWithModel: 'agreed with the model',
    evidence: 'Evidence',
    noEvidence: 'No evidence at all.',
    pageShort: 'p.',
    fieldVerdict: 'Verdict',
    agreeWithModel: 'I agree with the model',
    fieldSeverity: 'Severity',
    asModel: 'as the model says',
    fieldNote: 'Note',
    saveAndNext: 'Save and continue',
  },

  settings: {
    title: 'Settings',
    subtitle: 'Model routing per stage, concurrency, and provider access.',
    themeTitle: 'Colour theme',
    themeGroup: 'Theme',
    themeSystem: 'Match the system',
    themeLight: 'Light',
    themeDark: 'Dark',
    themeHint:
      'The choice is stored locally and applies instantly, even when the backend is unavailable.',
    languageTitle: 'Interface language',
    languageGroup: 'Language',
    languageSystem: 'System',
    languageHint:
      'Stored locally and applied instantly. “System” follows the OS language and falls back to English when it is not supported.',
    routingTitle: 'Model routing per stage',
    routingHint:
      'The expensive model belongs where a mistake costs the most: the clause registry and the judgement. Document profiles can go to a cheap one.',
    routingReset: 'Reset to defaults',
    routingResetTitle: 'Remove every per-stage choice and go back to the built-in routing',
    routingResetDone: 'Routing reset to the built-in defaults',
    colStage: 'Stage',
    colProvider: 'Provider',
    colModel: 'Model',
    colEffort: 'Effort',
    providerNone: 'none',
    providerCloud: ' (cloud)',
    providerLocal: ' (local)',
    providerNoKey: ' — no key',
    providerUnavailable: (id: string) => `${id} (unavailable)`,
    modelDefault: 'default',
    modelCustom: 'Other model…',
    modelCustomPlaceholder: 'vendor/model-id',
    modelNotListed: (id: string) => `${id} (not in the list)`,
    vendorOther: 'Other',
    ariaProvider: (stage: string) => `${stage}: provider`,
    ariaModel: (stage: string) => `${stage}: model`,
    ariaCustomModel: (stage: string) => `${stage}: model ID`,
    ariaEffort: (stage: string) => `${stage}: effort`,
    effortUnset: 'Not set: the default of the stage applies.',
    effortUnsupported: 'This model takes no effort setting.',
    /** Збережений effort, якого обрана модель не приймає: видно, щоб його можна було скинути. */
    effortStale: (effort: string) => `${effort} — not supported by this model`,
    hintContext: (size: string) => `${size} context`,
    hintPrice: (input: string, output: string) => `${input} in / ${output} out per 1M tokens`,
    hintCacheRead: (price: string) => `cache read ${price}`,
    hintPriceUnknown: 'price unknown',
    hintNotInCatalogue: 'Not in the model catalogue — context and price unknown.',
    hintDefault: 'The built-in default model of this stage.',
    hintProviderDefault: (provider: string) => `The default model of ${provider}.`,
    executionTitle: 'Execution',
    fieldConcurrency: 'Concurrency',
    concurrencyHint:
      'How many simultaneous LLM calls a run makes. Too many, and the provider answers 429.',
    localOnly: 'Local models only',
    localOnlyHint:
      'Forbids sending anything to the cloud, even for specifications where it is allowed. A global safety catch on top of the cloudAllowed flag.',
    providersTitle: 'Providers',
    chipCloud: 'cloud',
    chipLocal: 'local',
    keySaved: 'key saved',
    keyMissing: 'key not set',
    modelsUnknown: 'models unknown',
    newKeyPlaceholder: 'new key (never shown)',
    keyPlaceholder: 'API key',
    saveKey: 'Save the key',
    removeKey: 'Remove',
    keyHint:
      'The key is encrypted with safeStorage in the main process and is never returned to the interface.',
    modelsCount: (count: number) => `${count} ${n(count, 'model', 'models')}`,
    modelsMore: (count: number) => `+${count} more`,
    catalogueUpdated: (when: string) => `list updated ${when}`,
    catalogueBuiltIn: 'built-in list',
    refreshModels: 'Refresh model list',
    refreshingModels: 'Refreshing…',
    refreshModelsHint: 'Fetches the provider’s live model catalogue. Costs no tokens.',
    refreshModelsDone: (provider: string, count: number) =>
      `${provider}: ${count} ${n(count, 'model', 'models')} in the list`,
    linkGetKey: 'Create a key',
    linkCredits: 'Credits',
    linkBilling: 'Billing',
    cloudHintOpenRouter:
      'OpenRouter forwards the documents to the vendor of the chosen model (Anthropic, OpenAI, DeepSeek, Google…). The specification’s “Allow cloud providers” switch applies to it too.',
    cloudHintDirect: (provider: string) =>
      `The documents go to the ${provider} API. The specification’s “Allow cloud providers” switch applies.`,
    localHint: 'Runs on this machine: the documents never leave it.',
    resultsLanguageTitle: 'Language of results',
    resultsLanguageLabel: 'Write conclusions in',
    resultsLanguageSpec: 'Language of the standard',
    resultsLanguageHint:
      'Applies to new runs only, and only to the conclusion texts: rationale, what is missing, recommendation.',
    resultsLanguageQuotes:
      'Evidence quotes always stay in the original language. A translated quote would not be found in the document during the mechanical check, and every “compliant” verdict would be downgraded to “needs human review”.',

    spendTitle: 'Application spend',
    spendSubtitle: 'What this application has spent on model calls, by our own accounting.',
    spendToday: 'Today',
    spendMonth: 'This month',
    spendTotal: 'All time',
    spendEmptyTitle: 'No calls logged yet',
    spendEmptyDesc: 'The figures will appear after the first run that calls a model.',
    spendColStage: 'Stage',
    spendColModel: 'Model',
    spendColCalls: 'Calls',
    spendColInput: 'Input',
    spendColCached: 'Cached',
    spendColOutput: 'Output',
    spendColCost: 'Cost',
    spendBalanceNote:
      'These totals are the app’s own ledger of model calls, not an account balance. Anthropic has no endpoint for remaining credit, so its real balance is only in the Anthropic console. OpenRouter reports its figures itself: once its key is saved, they appear here separately.',
    spendOpenConsole: 'Open the Anthropic console',
    spendOpenOpenRouter: 'Open OpenRouter credits',
    spendCounted: 'Counted by this app',
    spendReported: (provider: string) => `Reported by ${provider}`,
    spendReportedHint:
      'Spend of the API key saved in the app, as the provider reports it — including calls made with the same key outside this app.',

    testing: 'Testing…',
    test: 'Test',
    testOk: 'works',
    testFail: 'failed',
  },

  /** Баланс на боці провайдера (зараз — OpenRouter). Не плутати з власним обліком витрат. */
  balance: {
    chipKeyRemaining: (amount: string) => `${amount} left`,
    chipKeyMonth: (amount: string) => `${amount} this month`,
    chipKeyTotal: (amount: string) => `${amount} spent`,
    tipAccount: (provider: string, when: string) =>
      `${provider}: credit left on the account. Updated ${when}.`,
    tipKeyRemaining: (provider: string, when: string) =>
      `${provider}: what is left of this API key’s limit — not the account balance (that needs a management key in Settings). Updated ${when}.`,
    tipKeyMonth: (provider: string, when: string) =>
      `${provider}: spent by this API key this month — not the account balance (that needs a management key in Settings). Updated ${when}.`,
    tipKeyTotal: (provider: string, when: string) =>
      `${provider}: spent by this API key in total — not the account balance. Updated ${when}.`,
    tipLow: 'Credit is running low.',
    tipOpenSettings: 'Click to open Settings.',
    tipUnavailable: (provider: string) => `${provider}: the balance is unavailable right now.`,
    tipFailed: (provider: string, message: string) =>
      `${provider}: could not fetch the balance — ${message}`,

    panelTitle: (provider: string) => `Balance reported by ${provider}`,
    refresh: 'Refresh',
    refreshing: 'Refreshing…',
    fetchedAt: (when: string) => `updated ${when}`,
    accountTitle: 'Account',
    accountRemaining: 'Credit left',
    accountTotal: 'Credits purchased',
    accountUsed: 'Used',
    keyTitle: 'This API key',
    keyToday: 'Today',
    keyWeek: 'This week',
    keyMonth: 'This month',
    keyTotal: 'All time',
    keyLimit: 'Limit',
    keyNoLimit: 'no limit',
    keyLimitLeft: 'Left of the limit',
    limitReset: (period: string | null) =>
      period === 'daily'
        ? 'resets daily'
        : period === 'weekly'
          ? 'resets weekly'
          : period === 'monthly'
            ? 'resets monthly'
            : period
              ? `resets: ${period}`
              : 'never resets',
    freeTier: 'free tier',
    accountNeedsKey:
      'The account balance is only available with a management key. Without it the app sees what this API key has spent, not how much credit is left.',
    accountKeyRejected: (provider: string) =>
      `${provider} rejected the management key. Create a new one and save it here.`,
    accountError: 'Could not fetch the account balance. Try again later.',
    unavailable: 'The provider returned no balance — check the key and the connection.',
    managementKeyLabel: 'Management key (optional)',
    managementKeyPlaceholder: 'management key',
    managementKeyNewPlaceholder: 'new management key (never shown)',
    managementKeySaved: 'management key saved',
    managementKeySave: 'Save',
    managementKeyRemove: 'Remove',
    managementKeySavedToast: 'Management key saved',
    managementKeyHint:
      'A management key can create, change and delete your API keys. The app uses it for one thing only — reading the account balance. It is encrypted like the API key and never shown again.',
    managementKeyCreate: 'Create a management key',
    openCredits: (provider: string) => `Credits on ${provider}`,
  },

  pdf: {
    /** 'p. 41' / 'pp. 41-42' — the page of the original standard a requirement is printed on. */
    pageRef: (from: number, to: number | null) =>
      to != null && to !== from ? `pp. ${from}–${to}` : `p. ${from}`,
    openTitle: (from: number, to: number | null) =>
      to != null && to !== from
        ? `Open the standard on pages ${from}–${to}`
        : `Open the standard on page ${from}`,
    noPage: 'page unknown',
    viewerTitle: 'Original',
    loading: 'Loading the PDF…',
    pageOf: (page: number, total: number) => `${page} of ${total}`,
    prev: 'Previous page',
    next: 'Next page',
    zoomOut: 'Zoom out',
    zoomIn: 'Zoom in',
    fitWidth: 'Fit width',
    renderFailed: 'Could not render the page',
    unavailableTitle: 'The file is unavailable',
    unavailableDesc: 'The source file could not be read from storage.',
    noHashTitle: 'No source file',
    noHashDesc: 'This version has no imported file, so there is nothing to show.',
  },

  runStats: {
    never: 'Not audited yet',
    neverDesc: 'This document has not been part of any audit run.',
    against: (spec: string, version: string) => `${spec} v${version}`,
    lastRun: 'Last run',
    relevant: 'Covers',
    relevantHint: 'Requirements the document actually speaks to (verdict other than “not addressed”).',
    relevantOf: (relevant: number, assessed: number) => `${relevant} of ${assessed} assessed`,
    issues: 'Issues',
    noIssues: 'no issues',
    issuesHint: 'Partial and non-compliant verdicts, by severity.',
    reviewed: 'Reviewed',
    reviewedOf: (reviewed: number, assessed: number) => `${reviewed} of ${assessed}`,
    openRuns: 'Runs',
    viewFindings: 'Findings for this document',
  },

  docRuns: {
    crumb: 'Runs',
    title: (doc: string) => `Runs for “${doc}”`,
    subtitle: 'Every audit run that touched this document, newest first.',
    emptyTitle: 'No runs for this document',
    emptyDesc: 'Start an audit that includes this document — the results will show up here.',
    toLibrary: 'Back to documents',
    startRun: 'Create a run',
    colRun: 'Run',
    colSpec: 'Standard',
    colVersion: 'Version',
    colFinished: 'Finished',
    colRelevant: 'Covers',
    colIssues: 'Issues',
    colReviewed: 'Reviewed',
    unnamed: 'unnamed',
  },

  deleteRun: {
    action: 'Delete',
    actionTitle: (runId: number) => `Delete run #${runId}`,
    title: 'Delete this run?',
    facts: (runId: number, findings: number, reviewed: number) =>
      `Run #${runId} · ${findings} findings · ${reviewed} reviewed by hand`,
    factsLoading: 'Counting what would be lost…',
    irreversible:
      'The run disappears together with all its findings, evidence and human reviews. This cannot be undone.',
    reviewedWarning: (reviewed: number) =>
      `${reviewed} verdicts have already been reviewed by a person. That work is the most expensive thing here, and it will be lost with the run.`,
    liveWarning:
      'The run is still going. It will be stopped automatically — you do not need to cancel it first.',
    spendNote:
      'Spend records stay in the log: the money was spent regardless of whether the result is still needed.',
    /** Дія у всьому застосунку одна: підтвердження вже показане вище. */
    confirm: 'Delete the run',
    deleting: 'Deleting…',
    done: (runId: number) => `Run #${runId} deleted`,
  },

  notFound: {
    title: 'Page not found',
    desc: 'There is no such route. Use the navigation on the left.',
    toLibrary: 'Go to documents',
  },
};

/** Форма каталогу. Будь-який зайвий чи пропущений ключ в іншій локалі — помилка типу. */
export type Messages = typeof en;
