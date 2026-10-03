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
import type { LibraryDeleteKind } from '@shared/ipc';

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
    runs: 'Document checks',
    settings: 'Settings',
    mainNav: 'Main navigation',
    theme: 'Theme',
    themeGroup: 'Colour theme',
    themeLight: 'Light theme',
    themeSystem: 'Match the system',
    themeDark: 'Dark theme',
    runProgress: (runId: number, done: number, total: number) =>
      `Run #${runId}: ${done} of ${total} ${n(total, 'task', 'tasks')}`,
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
      not_addressed: 'Not addr.',
      needs_human_review: 'Human',
    } satisfies Record<Verdict, string>,

    verdictHint: {
      compliant: 'The requirement is backed by evidence from the document.',
      partial: 'Partly covered — part of the requirement has no evidence.',
      non_compliant: 'The document contradicts the requirement outright, or fails to meet it.',
      not_applicable: 'Does not apply to this site according to its profile — decided by rules, not by the model.',
      not_addressed:
        'No document says anything about this requirement. Not a violation — the document is simply about something else.',
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

  /** Значок «ⓘ» (InfoTip): як його називає скрінрідер. */
  help: {
    more: 'Explanation',
    about: (term: string) => `What does “${term}” mean?`,
  },

  badges: {
    verified: 'verified',
    unverified: 'unverified',
    verifiedHint: 'The quote was mechanically located in the document source text',
    unverifiedHint: 'The quote was not found in the source text — it cannot be trusted',
    /** Що означає статус прогону і що з ним робити далі. */
    runStatusHint: {
      queued: 'Created and waiting to start.',
      running: 'The model is working through the tasks; findings appear as they arrive.',
      paused: 'Paused — nothing is lost. “Resume” continues from where it stopped.',
      done: 'Finished: every task has been processed.',
      failed: 'Stopped with an error — the reason is on the run page. Results obtained before it are kept.',
      cancelled: 'Stopped by hand. Results obtained before that are kept.',
    } satisfies Record<RunStatus, string>,
  },

  meters: {
    costTitle: (input: string, cached: string, share: number, output: string) =>
      `Cost of the model calls. Tokens — input: ${input}, of which from cache: ${cached} (${share}%, billed cheaper) · output: ${output}`,
    cacheShare: (share: number) => `${share}% cache`,
    inShort: 'in',
    outShort: 'out',
  },

  heatmap: {
    section: 'Section',
    sectionClauses: (count: number) => `${count} ${n(count, 'clause', 'clauses')}`,
    /** Перший рядок клітинки — відповідь словами, а не гліф. */
    stateIssues: (count: number) => `${count} ${n(count, 'issue', 'issues')}`,
    stateReview: (count: number) => `${count} to review`,
    stateOk: 'Compliant',
    stateNotCovered: 'Not covered',
    stateEmpty: 'No findings',
    /** Другий рядок: скільки вимог секції документ справді стосується. */
    addressed: (addressed: number, total: number) => `${addressed} of ${total} ${n(total, 'clause', 'clauses')}`,
    cellTitle: (section: string, document: string) => `${section} — ${document}`,
    breakdown: (verdict: string, count: number) => `${verdict}: ${count}`,
    openHint: 'Click to open these findings.',
    notCoveredHint:
      'The document does not talk about this section. That is expected when one document is checked against the whole standard.',
    docCovered: (covered: number, total: number) => `covers ${covered} of ${total} sections`,
    docIssues: (count: number) => (count === 0 ? 'no issues' : `${count} ${n(count, 'issue', 'issues')}`),
    hideUncovered: (count: number) => `Hide sections no document talks about (${count})`,
    howToTitle: 'How to read the matrix',
    howToRows:
      'Rows are sections of the standard, columns are your documents. A cell answers: what does this document say about this section?',
    howToStates:
      '“2 issues” — clauses judged partial or non-compliant: open the cell to see what is missing. “To review” — the model was unsure or a safeguard fired; check by hand. “Compliant” — every clause the document addresses is met.',
    howToNotCovered:
      '“Not covered” — the document does not mention this section (its clauses got the verdict “Not addressed”). With a single document that is normal, not a violation: such sections have to be covered by other documents (see the Gaps tab).',
    howToSecond:
      'The second line shows how many clauses of the section the document actually addresses; the strip shows the mix of verdicts.',
    legendTitle: 'Strip colours:',
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
    fieldTitle: 'Title',
    fieldDocNumber: 'Document number',
    fieldOwner: 'Process owner',
    ownerPlaceholder: 'e.g. Quality Manager',
    fieldKind: 'Type',
    kindUnset: 'not set',
    versionsCallout:
      'Versions are edited by importing a new file: every file with a new SHA-256 becomes a new version.',
    versionHash:
      'SHA-256 fingerprint of the file. Importing an identical file again is recognised by it and creates no new version.',
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
    /** Що робити з версією в кожному стані реєстру. */
    statusHint: {
      pending:
        'The clause registry has not been extracted yet. Open it and run the extraction — without a registry nothing can be audited against this version.',
      extracted:
        'The model has extracted the clauses, but nobody has checked them yet. Open the registry and review it: until then audit runs for this version are blocked.',
      reviewed: 'A person has checked the registry — this version can be used for audit runs.',
    } satisfies Record<ClausesStatus, string>,
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
    modulesHint:
      'Clauses outside the ticked modules get “Not applicable” straight away — the model never sees them.',
    modulesList: (modules: string) => `modules ${modules}`,
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
    recomputeTitle: 'Clause applicability for this profile',
    noSpecs: 'no specifications',
    recomputing: 'Counting…',
    recompute: 'Recompute',
    saveFirst: 'Save the profile first',
    resultApplicable: 'applicable',
    resultOf: 'of',
    resultOutOfScope: (count: number) => ` · outside the profile ${count}`,
    resultExplain: (applicable: number, notApplicable: number) =>
      `In runs with this profile the model will check ${applicable} ${n(applicable, 'clause', 'clauses')}; ${notApplicable} ${n(notApplicable, 'gets', 'get')} “Not applicable” without a model call.`,
    recomputeHint:
      'The computation is deterministic — no AI involved. Every exception can be overridden by hand on the registry screen.',
  },

  runs: {
    title: 'Document checks',
    subtitle:
      'Partial results are written to the database immediately — an interrupted run can be resumed.',
    newRun: '+ New run',
    colLabel: 'Name',
    unnamed: 'unnamed',
    colStatus: 'Status',
    colDocs: 'Documents',
    colModel: 'Model',
    colModelHint:
      'The model that judged the clauses (the judgement stage). Hover a row to see the critic model too.',
    modelTitle: (judge: string, critic: string | null) =>
      `judge: ${judge}${critic ? ` · critic: ${critic}` : ' · no critic'}`,
    colStarted: 'Started',
    colDuration: 'Duration',
    colDurationHint:
      'From start to finish. For a run that has not finished — up to now, pauses included.',
    colCost: 'Cost',
    colCostHint:
      'What the model calls of this run actually cost, in USD. Hover a row for the token counts.',
    colActions: 'Actions',
    costTitle: (input: string, output: string) => `${input} in / ${output} out`,
    runTitle: (runId: number) => `Run #${runId}`,
    preparing: 'preparing',
    running: 'running',
    progressRight: (done: number, total: number, failed: number) =>
      `${done} of ${total} ${n(total, 'task', 'tasks')}${failed ? ` · failed ${failed}` : ''}`,
    pause: '⏸ Pause',
    resume: '▶ Resume',
    cancel: '✕ Cancel',
    openDetails: 'Open details →',
    emptyTitle: 'No runs yet',
    emptyDesc:
      'Pick a reviewed specification version, a site profile and the documents — then start the first audit.',
    emptyAction: 'Create a run',
    tableLabel: 'Document checks',
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
    specReadyHint:
      '✔ — the clause registry of that version has been reviewed. A version without ✔ cannot be audited until its registry is reviewed.',
    fieldSite: 'Site profile',
    noSite: 'no profile — every clause applies',
    blockedCallout:
      'The clause registry of this version has not been reviewed yet. The run is blocked: broken clauses make every downstream finding meaningless.',
    fieldDocuments: (selected: number) => `Documents (${selected} selected)`,
    documentsHint: 'Each row is one version of a document; usually you want the latest.',
    latestTag: 'latest',
    libraryEmpty: 'No documents yet',
    selectAll: 'Select all',
    clearSelection: 'Clear',
    skipCritic: 'Skip the critic pass',
    skipCriticHint:
      'The critic is a second pass that double-checks “Compliant” verdicts. Skipping it is faster and cheaper, but raises the risk of a missed non-conformity — the most expensive mistake there is.',
    estimateTasks: 'Tasks',
    estimateTasksHint:
      'One task is one model call that judges one section of the standard against one document. Sections a document does not deal with are closed without a call.',
    estimateInput: 'Input tokens',
    estimateInputHint:
      'Roughly how much text the model will read: the clauses of the section plus the document, for every task. 1k = a thousand, 1M = a million tokens.',
    estimateCost: 'Estimated cost',
    estimateCostSub: 'without cache discounts — usually less in practice',
    estimateModel: (model: string) => `Priced as ${model}`,
    estimatePriceUnknown: 'price unknown',
    estimatePriceUnknownSub: 'the catalogue has no price for this model',

    modelOverrideTitle: 'Analysis model',
    modelOverrideGroup: 'Which model analyses the documents in this run',
    modelOverrideSettings: 'As in Settings',
    modelOverrideCustom: 'Choose for this run',
    modelOverrideCurrent: (judge: string, critic: string) => `Judgement: ${judge} · critic: ${critic}`,
    modelOverrideDefault: 'built-in default',
    modelOverrideHint:
      'Applies to the judgement and the critic of this run only. Settings stay as they are.',
  },

  runDetail: {
    tabCoverage: 'Coverage matrix',
    tabFindings: 'Findings',
    tabGaps: 'Gaps',
    tabSummary: 'Summary',
    /** Підказка-title на вкладках: що за кожною з них. */
    tabHint: {
      coverage: 'Sections of the standard × documents: what each document says about each section.',
      findings: 'One row per clause × document: verdict, evidence quotes and rationale.',
      gaps: 'Applicable clauses that no document of the run covers.',
      summary: 'Verdict and severity counts, spend and the models of the run.',
    },
    notFound: (runId: number) => `Run #${runId} not found`,
    reviewMode: 'Review mode',
    exportPlaceholder: 'Export…',
    exportSaved: (path: string) => `Saved: ${path}`,
  },

  coverage: {
    emptyTitle: 'The matrix is empty',
    emptyDesc:
      'The run has not produced a single finding yet. Wait for the judgement stage to finish.',
    hint: 'Click a cell to open the findings of that section in that document.',
  },

  findings: {
    searchPlaceholder: 'Search the rationale text…',
    allSections: 'all sections',
    allDocuments: 'all documents',
    unreviewedOnly: 'unreviewed only',
    reset: 'Reset',
    emptyTitle: 'Nothing found',
    emptyDesc: 'Change the filters or clear them.',
    filterVerdict: 'Verdict:',
    filterSeverity: 'Severity:',
    noiseHint:
      '“Not addressed” means the document does not talk about the clause — it is not a violation. When one document is checked against the whole standard, most clauses look like this.',
    noiseAction: 'Show only what the documents address',
    colClause: 'Clause',
    colTopic: 'Topic',
    colDocument: 'Document',
    colDocumentHint:
      'Which document the verdict is about. “whole set” — a verdict over all documents of the run together; gaps are built from these.',
    aggregateDoc: 'whole set',
    colVerdict: 'Verdict',
    colVerdictHint:
      'The model’s verdict; hover a badge to see what it means. A person’s decision, if there is one, is in the Review column.',
    colSeverity: 'Severity',
    colSeverityHint:
      'How serious the finding is on the standard’s own scale: Critical, Major, Minor, Recommendation. For “Not addressed” rows it is only potential — how serious it would be if no document covered the clause — so it is greyed out.',
    potentialSeverity: (severity: string) =>
      `Potential only: how serious it would be if no document covered the clause — ${severity}`,
    colConfidence: 'Conf.',
    colConfidenceHint:
      'How sure the model is of its verdict, 0–100%. “—” — no estimate, e.g. when the section was closed without a model call because the document does not deal with it.',
    colEvidence: 'Evidence',
    colEvidenceHint:
      'Verified quotes / all quotes. Verified means the quote was found word for word in the document text; an unverified quote cannot be trusted.',
    evidenceTitle: (verified: number, total: number) => `${verified} verified of ${total}`,
    colPages: 'Page',
    colPagesHint: 'The page of the standard where the clause is printed. Click to open the PDF there.',
    colRationale: 'Rationale',
    outsideEvidenceTag: 'audit check',
    outsideEvidenceTitle: (text: string) =>
      `Verify outside the document — with records or on-site observation; this is for the audit, not a remark on the document: ${text}`,
    colReview: 'Review',
    colReviewHint:
      'A person’s decision: “ok” — agreed with the model; another code — the verdict the person set instead; “—” — not reviewed yet.',
    reviewAgreed: 'ok',
    tableLabel: 'Findings',
  },

  gaps: {
    colClause: 'Clause',
    colSection: 'Section',
    colTopic: 'Topic',
    colObligation: 'Oblig.',
    colObligationHint:
      'How binding the clause is, as worded in the standard: must — mandatory, should — expected, may — recommended.',
    colPages: 'Page',
    colSeverity: 'If missing',
    colSeverityHint:
      'The severity this gap would get at an audit if the evidence stays missing.',
    colRequirement: 'Requirement',
    emptyTitle: 'No gaps',
    emptyDesc: 'Every applicable clause has at least one piece of evidence in the documents.',
    summaryLead: 'Applicable clauses with no evidence at all: ',
    summaryTail: '. Every row is a candidate for the corrective action plan (CAP).',
    summaryNote:
      'Gaps show what the whole document set is missing. In a run with one or two documents there are naturally many — they become meaningful once all of the site’s procedures are checked together.',
    tableLabel: 'Gaps',
  },

  summary: {
    coverage: 'Coverage',
    clausesApplicable: 'Applicable clauses',
    clausesApplicableSub: 'after the applicability filter',
    clausesApplicableHint:
      'Clauses of the standard that were subject to this check. Clauses marked as not applicable are not counted.',
    assessed: 'Assessed',
    assessedSub: (share: string) => `${share} of applicable`,
    assessedHint: 'How many applicable clauses received a verdict in this run.',
    gaps: 'Gaps',
    gapsSub: 'with no evidence at all',
    gapsHint: 'Applicable clauses that no document of the run covers. The list is on the Gaps tab.',
    grade: 'Grade on the scale',
    gradeSub: 'not computed yet',
    gradeHint:
      'The rating on the standard’s own grading scale (5 is best), worked out from the Critical / Major / Minor counts. Shows “—” until the grading rules have been parsed.',
    verdicts: 'Verdicts',
    verdictsHint:
      'Each finding is counted once. Where a person has decided, their verdict counts instead of the model’s.',
    notAddressedNote: 'When a single document is checked, most clauses of the standard end up here.',
    severity: 'Severity',
    severityHint:
      'Only “Partial” and “Non-compliant” verdicts are counted, human decisions included. Critical / Major / Minor are the standard’s own levels; Recommendation is advice, not a non-conformity.',
    spend: 'Spend',
    runCost: 'Run cost',
    cacheLabel: 'share of input tokens served from cache',
    input: 'Input tokens',
    cached: 'of which from cache',
    output: 'Output tokens',
    cacheNote:
      'The cache makes re-sending the same text (the standard, a document) cheaper. If repeat runs show a zero cache share, something in the unchanging part of the request keeps changing — worth reporting to the developer.',
    models: 'Models',
    modelJudge: 'Judgement',
    modelCritic: 'Critic',
    noCritic: 'skipped',
  },

  clauseRegistry: {
    crumb: (versionLabel: string) => `Clause registry · v${versionLabel}`,
    reviewTitle: 'Registry review',
    reviewHint:
      'Check that every clause was extracted correctly: number and text. Enter confirms, F flags a problem. Audit runs for this version stay blocked while anything is undecided or flagged. The most important signal is a gap in numbering (10.1 → 10.4): it means whole clauses were missed.',
    progressLabel: (done: number, total: number) => `reviewed ${done} of ${total}`,
    progressRight: (pending: number, flagged: number) =>
      `${pending} undecided · ${flagged} flagged`,
    summaryBtn: 'Digest and grading rules',
    summaryBtnTitle:
      'A short digest of the standard and its Critical / Major / Minor grading rules — they go into every judgement.',
    extractBtn: 'Extract the registry (Stage 1)',
    extractTitle:
      'Stage 1: the model reads the standard’s requirements page by page — a table or numbered text — and fills the registry. Contents, introduction and glossary pages are skipped.',
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
    filterPendingHint: 'Clauses nobody has confirmed, edited or flagged yet.',
    filterFlaggedHint:
      'Clauses marked as problematic — by the automatic check (e.g. a gap in numbering) or by a person. Fix them, then confirm.',
    legendMarkers: 'Standard markers:',
    legendMarkersHint:
      'The standard itself prints these markers next to its clauses; the names and explanations are its own words.',
    markersUnexplained: 'the explanation of these markers was not found in the text of the standard',
    legendStatus: 'Dot — review status:',
    emptyRegistry: 'The registry is empty',
    emptyRegistryDesc:
      'Run the registry extraction — it reads the standard’s requirements page by page.',
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
    fieldMarkers: 'Standard markers',
    markersCheckboxHint: 'Tick the markers the standard prints next to this clause.',
    markersInputHint: 'Codes exactly as printed next to the clause, separated by commas.',
    fieldObligation: 'Obligation',
    obligationUnset: 'not set',
    fieldRequirement: 'Requirement text',
    requirementHint:
      'Bullet lists (`•`) must stay lists: they are what forms the individual checkable points.',
    pages: 'Pages',
    sortKey: 'Sort order',
    sortKeyHint:
      'Derived from the clause number so that 10.2 comes before 10.10. Recomputed automatically when the number changes.',
    textHash: 'Text fingerprint',
    textHashHint:
      'SHA-256 of the requirement text. It changes with every edit of the text; versions of the standard are compared by it.',
    confirm: '✔ Confirm',
    confirmTitle: 'Confirm the clause as it is and go to the next one (Enter)',
    saveEdits: '✎ Save edits',
    saveEditsTitle: 'Save the edits and mark the clause as edited',
    noChanges: 'No changes',
    flag: '⚑ Flag',
    flagTitle:
      'Mark the clause as problematic (F). Audit runs stay blocked until it is fixed and confirmed.',
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
    outsideEvidence: 'Verify outside the document',
    outsideEvidenceHint:
      'What the standard checks through records or by observing the site. A document cannot prove this — it is for the audit, not a remark on the document.',
    markers: 'standard markers:',
    markersHint:
      'The standard itself prints these markers next to the clause: they say how compliance is shown. The explanations are its own words.',
    markerUnexplained: (code: string) => `${code} — the standard does not explain this marker`,
    prev: '← Previous',
    next: 'Next →',
    position: (index: string, total: number) => `${index} of ${total}`,
    evidence: 'Evidence',
    verifiedCount: (verified: number, total: number) => `${verified} / ${total} verified`,
    evidenceHint:
      'Quotes from the document the verdict rests on. “Verified” means the app found the quote word for word in the document text. A “Compliant” verdict without a single verified quote is automatically downgraded to “Needs a human”.',
    sourceCitationsHint:
      'Returned by the provider’s Citations API: the quote is cut from the document text itself, so the model cannot invent it.',
    sourceModelHint:
      'Written by the model itself; the app then searches the document text for it — hence “verified” or “unverified”.',
    noEvidenceLead: 'No evidence at all. For a verdict of ',
    noEvidenceTail: ' that is expected only when the requirement is genuinely mentioned nowhere.',
    pageShort: 'p.',
    hintBetween: 'between findings',
    hintBack: 'back to the list',
    treeTitle: 'Clauses in the run',
    treeHintLead: 'The symbol and colour on the left show the verdict:',
    treeHintReviewed: 'A green dot on the right — a person has already reviewed the finding.',
    reviewedDot: 'reviewed',
    decisionTitle: 'Human decision',
    decisionUpdated: (when: string) => `updated ${when}`,
    decisionNote:
      'The model verdict is never overwritten — yours is stored next to it. Every disagreement becomes a test case for measuring the model’s quality (eval).',
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
    position: (index: number, total: number) => `current ${index} of ${total}`,
    howTo:
      'Go through the findings one by one and say whether the model got it right. Your decision is stored separately — the model’s verdict is never overwritten. “Reviewed” counts the findings that already have a decision.',
    whichVerdict: 'Which verdict is correct?',
    cancelEsc: 'Cancel (Esc)',
    accept: 'Accept',
    acceptTitle:
      'The model’s verdict is right (A). It is saved as your decision and the next unreviewed finding opens.',
    reject: 'Reject',
    rejectTitle: 'The model’s verdict is wrong (R): pick the right one with keys 1–6.',
    edit: 'Edit',
    editTitle: 'Change the verdict or the severity, or add a note (E).',
    hintNav: 'navigate',
    hintNextUnreviewed: 'next unreviewed',
    hintExit: 'exit',
    requirement: 'Standard requirement',
    modelRationale: 'Model rationale',
    gap: 'Gap',
    recommendation: 'Recommendation',
    outsideEvidence: 'Verify outside the document',
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
    colEffortHint:
      'How long the model thinks before answering. Higher is more thorough, but slower and more expensive (more output tokens). “—” — the model has no such setting.',
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
    /** Позначка біля моделі, коли етап нічого не перевизначає. */
    hintIsDefault: 'default',
    executionTitle: 'Execution',
    fieldConcurrency: 'Concurrency',
    concurrencyHint:
      'How many model calls a run makes at the same time. Too many, and the provider starts rejecting requests (error 429, “too many requests”).',
    localOnly: 'Local models only',
    localOnlyHint:
      'Forbids sending anything to the cloud, even for specifications where it is allowed. A global safety catch on top of each specification’s “Allow cloud providers” switch.',
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
    spendColCallsHint: 'How many requests were sent to the model API.',
    spendColInput: 'Input',
    spendColInputHint:
      'Input tokens: the text sent to the model — instructions, clauses of the standard and your documents. 1k = a thousand, 1M = a million tokens.',
    spendColCached: 'Cached',
    spendColCachedHint:
      'The part of the input tokens the provider served from its prompt cache — billed much cheaper. Already included in Input.',
    spendColOutput: 'Output',
    spendColOutputHint:
      'Output tokens: the text the model wrote, its reasoning included. Per token they cost the most.',
    spendColCost: 'Cost',
    spendColCostHint: 'In USD, by the app’s own accounting of every call.',
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
    chipKeyRemaining: (amount: string) => `limit ${amount}`,
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
    relevantHint:
      'Clauses the document actually talks about (any verdict other than “Not addressed”), out of all clauses it was checked against. A low share is normal: one procedure covers only its own topic.',
    relevantOf: (relevant: number, assessed: number) => `${relevant} of ${assessed} assessed`,
    relevantSub: (share: string) => `${share} of assessed`,
    issues: 'Issues',
    noIssues: 'no issues',
    issuesHint:
      'Clauses judged “Partial” or “Non-compliant”, by severity: CRIT — Critical, MAJ — Major, MIN — Minor, REC — Recommendation.',
    chipLabel: (name: string, count: number) => `${name}: ${count}`,
    reviewed: 'Reviewed',
    reviewedHint:
      'How many of the document’s findings a person has already reviewed — in review mode or on the finding page.',
    reviewedSub: (share: string) => `${share} done`,
    reviewedOf: (reviewed: number, assessed: number) => `${reviewed} of ${assessed}`,
    openRuns: 'Runs',
    viewFindings: 'Findings for this document',
  },

  docRuns: {
    crumb: 'Document checks',
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

  /**
   * Видалення специфікації / документа або однієї їхньої версії
   * (components/DeleteLibraryDialog). Терміни — як у навігації: «document check».
   */
  deleteLibrary: {
    /** Мала вторинна дія на картці й у рядку версії. */
    action: 'Delete…',
    actionTitle: {
      specification: (name: string) => `Delete the specification “${name}” with all its versions`,
      specVersion: (name: string) => `Delete version “${name}”`,
      document: (name: string) => `Delete the document “${name}” with all its versions`,
      documentVersion: (name: string) => `Delete version “${name}”`,
    },
    title: {
      specification: 'Delete the specification?',
      specVersion: 'Delete this specification version?',
      document: 'Delete the document?',
      documentVersion: 'Delete this document version?',
    } satisfies Record<LibraryDeleteKind, string>,
    loading: 'Counting what will be deleted…',
    lead: 'This will delete:',
    /** Перший рядок переліку — сама ціль; деталі в дужках додає код. */
    target: {
      specification: (title: string) => `the specification “${title}” with all its versions`,
      specVersion: (title: string) => `the specification version “${title}”`,
      document: (title: string) => `the document “${title}” with all its versions`,
      documentVersion: (title: string) => `the document version “${title}”`,
    },
    versions: (count: number) => `${count} ${n(count, 'version', 'versions')}`,
    clauses: (count: number) => `${count} ${n(count, 'clause', 'clauses')} in the registry`,
    profiles: (count: number) => `${count} ${n(count, 'document profile', 'document profiles')}`,
    lastVersion: {
      specVersion: 'The specification has no other versions, so the specification itself disappears too.',
      documentVersion: 'The document has no other versions, so the document itself disappears too.',
    },
    runs: (count: number) => `${count} ${n(count, 'document check', 'document checks')}`,
    findings: (count: number) => `${count} ${n(count, 'finding', 'findings')}`,
    reviewed: (count: number) =>
      `${count} of those ${n(count, 'finding was', 'findings were')} reviewed by hand — the most valuable part, and it will be lost`,
    files: (count: number, size: string) => `${count} ${n(count, 'file', 'files')} from disk (${size})`,
    sharedKept: (count: number) =>
      `${count} ${n(count, 'file stays', 'files stay')} on disk: another document or specification uses ${n(count, 'it', 'them')}.`,
    nothingElse: 'Nothing else is affected: no document checks are based on it.',
    spendKept: 'Spend history is kept.',
    irreversible: 'This cannot be undone.',
    runsTitle: 'Document checks that will be deleted',
    runUnnamed: 'untitled',
    runOtherDocuments: (count: number) =>
      `also covers ${count} other ${n(count, 'document', 'documents')} — the whole check will be deleted`,
    runLive: 'still running — it will be stopped first',
    acknowledge: 'I understand that the verdicts reviewed by hand will be lost',
    /** Кнопка називає, що саме зникне. */
    confirm: {
      specification: (runs: number) =>
        runs > 0
          ? `Delete the specification and ${runs} ${n(runs, 'check', 'checks')}`
          : 'Delete the specification',
      specVersion: (runs: number) =>
        runs > 0 ? `Delete the version and ${runs} ${n(runs, 'check', 'checks')}` : 'Delete the version',
      document: (runs: number) =>
        runs > 0 ? `Delete the document and ${runs} ${n(runs, 'check', 'checks')}` : 'Delete the document',
      documentVersion: (runs: number) =>
        runs > 0 ? `Delete the version and ${runs} ${n(runs, 'check', 'checks')}` : 'Delete the version',
    },
    deleting: 'Deleting…',
    done: (title: string, runs: number) =>
      runs > 0
        ? `“${title}” and ${runs} ${n(runs, 'document check', 'document checks')} deleted`
        : `“${title}” deleted`,
  },

  notFound: {
    title: 'Page not found',
    desc: 'There is no such route. Use the navigation on the left.',
    toLibrary: 'Go to documents',
  },

  /** Тур інтерфейсом і чек-лист «Перший аналіз» (components/tour). */
  tour: {
    sidebar: 'Getting started',
    sidebarTitle: (done: number, total: number) =>
      `First analysis: ${done} of ${total} required ${n(total, 'step', 'steps')} done`,
    sidebarComplete: 'Everything needed for an analysis is set up',
    checklistTitle: 'First analysis',
    checklistIntro:
      'What has to be in place before the first document can be checked against a standard. The ticks follow your data on their own — only optional steps can be ticked by hand.',
    progress: (done: number, total: number) =>
      `${done} of ${total} required ${n(total, 'step', 'steps')} done`,
    groupSetup: 'Once per standard',
    groupPerDocument: 'For every document',
    stateDone: 'Done',
    stateCurrent: 'Next up',
    statePending: 'Not yet',
    optional: 'optional',
    showMe: 'Show me',
    startTour: 'Start the tour',
    restartTour: 'Run the tour again',
    openChecklist: 'Open the checklist',
    allDone:
      'Everything required is in place. From now on: import a new document and start a run whenever you need a check.',
    markDone: 'Mark as done',
    markUndone: 'Not done yet',
    dialogLabel: 'Guided tour',
    stepCounter: (index: number, total: number) => `Step ${index} of ${total}`,
    announce: (index: number, total: number, title: string) => `Step ${index} of ${total}: ${title}`,
    back: 'Back',
    next: 'Next',
    finish: 'Finish',
    skip: 'Skip the tour',
    close: 'Close the tour',
    lookFor: 'Look for',
    seeking: 'Looking for it on the screen…',
    missingTitle: 'Not on this screen yet',
    missingBody: 'This part of the screen appears only once there is something to show.',
    firstDo: (title: string) => `Do this first: ${title}`,
    goToStep: 'Go to that step',
    retry: 'Show it again',
    doneNote: 'Already done — the step stays here for reference.',
    keysHint: '← → move between steps · Esc closes',
    offerTitle: 'First time here?',
    offerBody:
      'Nothing is set up yet. A short tour walks you through the screens and the settings the first document analysis needs — about two minutes.',
    offerStart: 'Start the tour',
    offerLater: 'Later',
    settingsTitle: 'Getting started',
    settingsHint:
      'A guided walk through the screens: everything the first document analysis needs, in order.',
    steps: {
      language: {
        title: 'Interface and results language',
        why: 'The interface language is just for you. The language of results decides what language the model writes its conclusions in — quotes always stay in the original.',
        action: 'Pick a language here. The language of results is a separate card further down in Settings.',
      },
      apiKey: {
        title: 'API key of a provider',
        why: 'Every analysis stage is a call to a language model. By default everything goes through OpenRouter — one key for models of many vendors; Anthropic gives Claude directly.',
        action: 'Paste the key and save it. The OS encrypts it and it is never shown again; the test button checks it without spending tokens.',
      },
      routing: {
        title: 'Models per stage',
        why: 'The defaults already work, all through OpenRouter: Sonnet 5.5 builds the registry, Haiku 4.5 profiles documents, Opus 5.5 judges and criticises. Change them only to save money or to try another model.',
        action: 'With an OpenRouter key you can pick models of other vendors here too. The reset button brings the default table back.',
      },
      importSpec: {
        title: 'Import the standard',
        why: 'The customer standard — the Tesco Ornamental Plant Standard, for example — is what your documents are checked against.',
        action: 'Import its PDF here or drop it on the page. Code and version are read from the file name.',
      },
      cloudAllowed: {
        title: 'Allow cloud providers for the standard',
        why: 'By default a customer standard never leaves this computer, so every cloud stage refuses to run. It is the most common reason why “nothing works”.',
        action: 'Switch it on in the standard’s card — or leave it off and set up a local model instead.',
      },
      extractClauses: {
        title: 'Extract the clauses',
        why: 'The model reads the standard page by page and builds a registry of numbered clauses. Every check is then done clause by clause.',
        action: 'Press the button and wait: about 180 clauses take a few minutes. Progress is shown page by page.',
      },
      reviewClauses: {
        title: 'Review the clause registry',
        why: 'If the registry is wrong, every result after it is wrong too — and nothing in the results would show it. That is why runs stay blocked until it is reviewed.',
        action: 'J / K move, Enter confirms, F flags. Start with the flagged clauses. When the counter is full, mark the registry as reviewed.',
      },
      siteProfile: {
        title: 'Site profile',
        why: 'The site’s modules and certifications cut the clauses that do not apply. Without a profile every clause is checked, obviously irrelevant ones included.',
        action: 'Create a profile, then recompute applicability against the standard.',
      },
      importDocument: {
        title: 'Import your document',
        why: 'Your SOP, policy or work instruction — the thing being checked. Number and version are read from its header.',
        action: 'Import the file or drop it on the page. Importing the same file twice creates nothing new.',
      },
      startRun: {
        title: 'Start a run',
        why: 'A run checks the selected documents against one version of the standard. The estimate shows the cost before anything is spent.',
        action: 'Create a check: pick the standard and your document, estimate the cost, then start it.',
      },
      readResults: {
        title: 'Read the results',
        why: 'One document never covers the whole standard, so most clauses come out as “Not addressed”. That is normal, not a violation.',
        action: 'In the verdict filter pick “Non-compliant” and “Partial” — that hides “Not addressed”. Then open a finding to see the quote the verdict rests on.',
      },
    },
  },
};

/** Форма каталогу. Будь-який зайвий чи пропущений ключ в іншій локалі — помилка типу. */
export type Messages = typeof en;
