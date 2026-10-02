/**
 * Нідерландський каталог. Форма перевіряється типом `Messages` з англійського каталогу.
 *
 * Термінологія — аудиторська, як її вживають у нідерландських QA-відділах:
 * специфікація/стандарт → norm, вимога → eis, finding → bevinding, прогалина →
 * hiaat, профіль виробництва → locatieprofiel, вердикт → oordeel, судження
 * (етап) → toetsing («toetsen aan de norm»), людське рев'ю → beoordeling,
 * вичитка реєстру → controle. Звертання — ввічливе «u», як «ви» в українському
 * каталозі. Коди вердиктів у тексті (not_applicable…) і градації стандарту
 * (Critical/Major/Minor) лишаються англійськими — так, як в українському каталозі.
 */

import type { Messages } from './en';

const pr = new Intl.PluralRules('nl');

/** Нідерландська, як і англійська, має дві форми: `one` і `other`. */
function n(count: number, one: string, other: string): string {
  return pr.select(count) === 'one' ? one : other;
}

export const nl: Messages = {
  common: {
    cancel: 'Annuleren',
    save: 'Opslaan',
    saving: 'Opslaan…',
    delete: 'Verwijderen',
    close: 'Sluiten',
    retry: 'Opnieuw proberen',
    empty: 'Niets te tonen',
    loading: 'laden…',
  },

  nav: {
    library: 'Documenten',
    specs: 'Normen',
    sites: 'Locatieprofielen',
    runs: 'Auditruns',
    settings: 'Instellingen',
    mainNav: 'Hoofdnavigatie',
    theme: 'Thema',
    themeGroup: 'Kleurthema',
    themeLight: 'Licht thema',
    themeSystem: 'Systeem volgen',
    themeDark: 'Donker thema',
    runProgress: (runId, done, total) => `Run #${runId}: ${done}/${total}`,
    mockTitle: 'Gegevens vervangen door fixtures (?mock=1)',
  },

  labels: {
    verdict: {
      compliant: 'Conform',
      partial: 'Gedeeltelijk',
      non_compliant: 'Niet-conform',
      not_applicable: 'Niet van toepassing',
      not_addressed: 'Niet behandeld',
      needs_human_review: 'Beoordeling nodig',
    },

    verdictShort: {
      compliant: 'OK',
      partial: 'Deels',
      non_compliant: 'NC',
      not_applicable: 'n.v.t.',
      not_addressed: 'Geen',
      needs_human_review: 'Mens',
    },

    verdictHint: {
      compliant: 'De eis wordt onderbouwd met bewijs uit het document.',
      partial: 'Deels afgedekt — voor een deel van de eis ontbreekt bewijs.',
      non_compliant: 'Het document is rechtstreeks in strijd met de eis, of voldoet er niet aan.',
      not_applicable: 'Buiten de scope van de locatie — deterministisch bepaald, niet door het model.',
      not_addressed: 'Geen enkel document zegt iets over deze eis.',
      needs_human_review: 'Het model en de criticus waren het oneens, of er is geen geverifieerd citaat.',
    },

    severity: {
      critical: 'Critical',
      major: 'Major',
      minor: 'Minor',
      recommendation: 'Recommendation',
    },

    severityShort: {
      critical: 'CRIT',
      major: 'MAJ',
      minor: 'MIN',
      recommendation: 'REC',
    },

    module: {
      P: 'Product',
      R: 'Responsible sourcing',
      O: 'Operational',
    },

    obligation: {
      must: 'must — verplicht',
      should: 'should — verwacht',
      may: 'may — aanbevolen',
    },

    documentKind: {
      sop: 'SOP',
      policy: 'Beleid',
      form: 'Formulier',
      record: 'Registratie',
      manual: 'Handboek',
      other: 'Overig',
    },

    runStatus: {
      queued: 'In wachtrij',
      running: 'Bezig',
      paused: 'Gepauzeerd',
      done: 'Voltooid',
      failed: 'Mislukt',
      cancelled: 'Geannuleerd',
    },

    clauseReview: {
      auto: 'Niet gecontroleerd',
      confirmed: 'Bevestigd',
      edited: 'Bewerkt',
      flagged: 'Gemarkeerd',
    },

    clausesStatus: {
      pending: 'Eisenregister niet geëxtraheerd',
      extracted: 'Geëxtraheerd, controle nodig',
      reviewed: 'Gecontroleerd',
    },

    stage: {
      clause_extract: 'Eisenregister',
      spec_summary: 'Samenvatting van de norm',
      doc_profile: 'Documentprofiel',
      judge: 'Toetsing',
      critic: 'Criticus',
    },

    stageHint: {
      clause_extract: 'De eisentabel pagina voor pagina uitlezen. Vraagt om een nauwkeurig model.',
      spec_summary: 'Samenvatting plus de classificatieregels Critical/Major/Minor.',
      doc_profile: 'Eén goedkope aanroep per documentversie.',
      judge: 'Het grootste deel van de kosten van een run: sectie × document.',
      critic: 'Controleert alleen conforme oordelen opnieuw. Kan worden overgeslagen.',
    },

    effort: {
      low: 'laag',
      medium: 'gemiddeld',
      high: 'hoog',
      xhigh: 'zeer hoog',
      max: 'maximaal',
    },

    modelTier: {
      top: 'topklasse',
      balanced: 'gebalanceerd',
      budget: 'budget',
    },
  },

  format: {
    intlLocale: 'nl-NL',
    hours: 'u',
    minutes: 'min',
    seconds: 's',
    bytes: 'B',
    kilobytes: 'kB',
    megabytes: 'MB',
    gigabytes: 'GB',
  },

  states: {
    backendTitle: 'Module nog niet aangesloten',
    backendDesc:
      'De handler voor dit IPC-kanaal is nog niet geïmplementeerd in het hoofdproces. De interface is klaar — de gegevens verschijnen zodra de backend antwoordt.',
    mockHintLead: 'Om dit scherm met realistische gegevens te zien, opent u de app met ',
    mockHintMid: ' in het adres, of start u de app met ',
    mockHintTail: '.',
    unknownError: 'Onbekende fout',
    loadFailed: 'Laden mislukt',
  },

  api: {
    backendNotReady: (channel) =>
      `Module nog niet aangesloten: kanaal “${channel}” is niet geregistreerd in het hoofdproces.`,
    bridgeMissing: 'De brug window.api is niet beschikbaar. Open de app in Electron of voeg ?mock=1 toe.',
    channelFailed: (channel) => `Fout in kanaal “${channel}”`,
  },

  table: {
    empty: 'Geen rijen',
    range: (from, to, total) => `${from}–${to} van ${total}`,
    prev: '← Vorige',
    next: 'Volgende →',
  },

  badges: {
    outOfScopeSuffix: ' (buiten de scope van de eis)',
    verified: 'geverifieerd',
    unverified: 'niet geverifieerd',
    verifiedHint: 'Het citaat is mechanisch teruggevonden in de brontekst van het document',
    unverifiedHint: 'Het citaat is niet gevonden in de brontekst — het is niet betrouwbaar',
  },

  meters: {
    costTitle: (input, cached, share, output) =>
      `Invoer: ${input} · uit cache: ${cached} (${share}%) · uitvoer: ${output}`,
    cacheShare: (share) => `${share}% cache`,
    inShort: 'in',
    outShort: 'uit',
  },

  heatmap: {
    section: 'Sectie',
    cell: (sectionNo, document, verdict, total) =>
      `${sectionNo} · ${document}: ${verdict}, ${total} ${n(total, 'bevinding', 'bevindingen')}`,
    cellEmpty: (sectionNo, document) => `${sectionNo} · ${document}: geen bevindingen`,
  },

  evidenceViewer: {
    title: 'Documentviewer',
    pickQuote: 'Kies links een citaat om te zien waar het op de pagina staat.',
    soon: 'binnenkort',
    document: 'Document',
    page: 'Pagina',
    range: 'Bereik',
    source: 'Bron',
    sourceCitations: 'Citations API',
    sourceModel: 'citaat van het model',
    footnote: 'Hier verschijnt de PDF-pagina met het citaat gemarkeerd, met doorspringen via een klik.',
  },

  tagInput: {
    remove: (value) => `${value} verwijderen`,
  },

  library: {
    title: 'Documenten',
    subtitle: 'SOP’s, beleid, formulieren en registraties die worden getoetst op conformiteit met normen.',
    picking: 'Bestanden kiezen…',
    import: '+ Importeren',
    importing: 'Importeren…',
    dropLabel: 'Sleep PDF- of DOCX-bestanden hierheen',
    dropHint:
      'Elk bestand wordt een nieuwe documentversie. Een duplicaat (dezelfde SHA-256) levert geen nieuwe versie op.',
    searchPlaceholder: 'Zoeken op titel, nummer, eigenaar…',
    allKinds: 'Alle typen',
    documentsCount: (count) => `${n(count, 'Document', 'Documenten')}: ${count}`,
    emptyTitle: 'Nog geen documenten',
    emptyDesc: 'Importeer uw eerste SOP — daarna kunt u het toetsen aan een norm.',
    emptyAction: 'Documenten importeren',
    importResult: (imported, duplicates, failed) =>
      `Geïmporteerd: ${imported}, duplicaten: ${duplicates}, mislukt: ${failed}`,
    dropPathUnavailable: (name) =>
      `Het pad naar “${name}” is bij slepen niet beschikbaar — gebruik de importknop.`,
    dropUnreadable: 'De gesleepte bestanden konden niet worden gelezen.',
    dropSkipped: (count) =>
      `${n(count, 'Bestand', 'Bestanden')} overgeslagen omdat het pad niet beschikbaar is: ${count}`,
    kindNotSet: 'type niet ingesteld',
    ownerNotSet: 'eigenaar niet ingesteld',
    owner: (name) => `eigenaar: ${name}`,
    versionsCount: (count) => `${n(count, 'versie', 'versies')}: ${count}`,
    latestVersion: (label) => ` · nieuwste ${label}`,
    toggleVersions: 'Versies tonen',
    metadata: 'Metadata',
    noVersions: 'Nog geen versies',
    pagesSuffix: 'blz.',
    importedAt: (when) => `Geïmporteerd op ${when}`,
    effectiveFrom: (date) => `geldig vanaf ${date}`,
    modalTitle: 'Metadata van het document',
    confirmDelete: (title) => `“${title}” met alle versies verwijderen?`,
    fieldTitle: 'Titel',
    fieldDocNumber: 'Documentnummer',
    fieldOwner: 'Proceseigenaar',
    ownerPlaceholder: 'bijv. Kwaliteitsmanager',
    fieldKind: 'Type',
    kindUnset: 'niet ingesteld',
    versionsCallout:
      'Versies wijzigt u door een nieuw bestand te importeren: elk bestand met een nieuwe SHA-256 wordt een nieuwe versie.',
  },

  specs: {
    title: 'Normen',
    subtitle: 'Normen waaraan de documenten worden getoetst. Eén normversie — één eisenregister.',
    import: '+ Norm importeren',
    dropLabel: 'Sleep de PDF van de norm hierheen',
    dropHint: 'Na het importeren moet u het eisenregister nog extraheren en handmatig controleren.',
    emptyTitle: 'Geen normen',
    emptyDesc: 'Importeer een klantnorm — bijvoorbeeld de Tesco Ornamental Plant Standard.',
    importedVersions: (count) => `${n(count, 'Versie', 'Versies')} geïmporteerd: ${count}`,
    issuerUnknown: 'uitgever niet ingesteld',
    versionsCount: (count) => `${n(count, 'versie', 'versies')}: ${count}`,
    cloudAllowed: 'Cloudproviders toestaan',
    cloudAllowedOn:
      'De volledige tekst van de norm en van de documenten wordt naar een externe API gestuurd. Normen worden vaak geleverd “for use of the immediate recipient” — ga na of dat aanvaardbaar is.',
    cloudAllowedOff:
      'De inhoud wordt alleen door lokale modellen verwerkt. De toetsing is minder nauwkeurig, maar er verlaat niets deze computer.',
    noVersions: 'Nog geen versies',
    effectiveFrom: (date) => `geldig vanaf ${date}`,
    reviewedLabel: 'gecontroleerd',
    reviewedRight: (done, total) => `${done} van ${total}`,
    registryEmpty: 'register is leeg',
    openRegistry: 'Eisenregister →',
  },

  sites: {
    title: 'Locatieprofielen',
    subtitle:
      'Modules, certificeringen, producten en processen van de locatie. Ze bepalen welke eisen van toepassing zijn.',
    newProfile: '+ Nieuw profiel',
    emptyTitle: 'Geen profielen',
    emptyDesc: 'Maak het eerste locatieprofiel aan.',
    certificationsCount: (count) => `${count} ${n(count, 'certificering', 'certificeringen')}`,
    clausesCount: (count) => `${count} ${n(count, 'eis', 'eisen')}`,
    pickProfile: 'Kies een profiel',
    fieldName: 'Profielnaam',
    namePlaceholder: 'Lisse — bollen verpakken',
    fieldModules: 'Modules van de norm',
    modulesHint: 'Eisen buiten deze modules worden not_applicable.',
    fieldCertifications: 'Certificeringen',
    certificationsPlaceholder: 'ISO14001, SMETA…',
    certificationsHint: 'ISO14001 dekt de sectie Environment af; SMETA/SIZA — Responsible Sourcing.',
    fieldProducts: 'Producten',
    productsPlaceholder: 'Tulpenbollen…',
    fieldProcesses: 'Processen',
    processesPlaceholder: 'Ontvangst, Verpakken…',
    fieldNotes: 'Notities',
    saveProfile: 'Profiel opslaan',
    confirmDelete: (name) => `Profiel “${name}” verwijderen?`,
    recomputeTitle: 'Toepasselijkheid herberekenen (Stage 3)',
    noSpecs: 'geen normen',
    recomputing: 'Berekenen…',
    recompute: 'Herberekenen',
    saveFirst: 'Sla eerst het profiel op',
    resultApplicable: 'van toepassing:',
    resultOf: 'van',
    resultOutOfScope: (count) => ` · buiten scope ${count}`,
    recomputeHint:
      'De berekening is deterministisch — zonder AI. Elke uitzondering kunt u handmatig overschrijven in het eisenregister.',
  },

  runs: {
    title: 'Auditruns',
    subtitle:
      'Deelresultaten worden direct in de database vastgelegd — een onderbroken run kan worden hervat.',
    newRun: '+ Nieuwe run',
    colLabel: 'Naam',
    unnamed: 'naamloos',
    colStatus: 'Status',
    colDocs: 'Documenten',
    colModel: 'Model',
    modelTitle: (judge, critic) =>
      `toetsing: ${judge}${critic ? ` · criticus: ${critic}` : ' · zonder criticus'}`,
    colStarted: 'Gestart',
    colDuration: 'Duur',
    colCost: 'Kosten',
    costTitle: (input, output) => `${input} invoer / ${output} uitvoer`,
    runTitle: (runId) => `Run #${runId}`,
    preparing: 'voorbereiden',
    running: 'bezig',
    progressRight: (done, total, failed) =>
      `${done} / ${total}${failed ? ` · mislukt ${failed}` : ''}`,
    pause: '⏸ Pauzeren',
    resume: '▶ Hervatten',
    cancel: '✕ Annuleren',
    openDetails: 'Details openen →',
    emptyTitle: 'Nog geen runs',
    emptyDesc:
      'Kies een gecontroleerde normversie, een locatieprofiel en de documenten — en start de eerste audit.',
    emptyAction: 'Run aanmaken',
    tableLabel: 'Runs',
    modalTitle: 'Nieuwe auditrun',
    estimating: 'Schatten…',
    estimate: 'Kosten schatten',
    starting: 'Starten…',
    start: 'Starten',
    blockedTitle: 'Het eisenregister van deze versie is niet gecontroleerd',
    fieldLabel: 'Naam van de run (optioneel)',
    labelPlaceholder: 'Tesco v5.0 × 3 SOP’s',
    fieldSpecVersion: 'Normversie',
    noSpecs: 'geen normen',
    specReviewed: (reviewed, total) => `— gecontroleerd ${reviewed}/${total}`,
    fieldSite: 'Locatieprofiel',
    noSite: 'geen profiel — alle eisen zijn van toepassing',
    blockedCallout:
      'Het eisenregister van deze versie is nog niet gecontroleerd. De run is geblokkeerd: foutieve eisen maken elke bevinding die erop volgt zinloos.',
    fieldDocuments: (selected) => `Documenten (${selected} geselecteerd)`,
    libraryEmpty: 'Nog geen documenten',
    selectAll: 'Alles selecteren',
    clearSelection: 'Wissen',
    skipCritic: 'Criticusronde overslaan',
    skipCriticHint:
      'Sneller en goedkoper, maar de kans op een gemiste afwijking stijgt — en dat is de duurste fout die er is.',
    estimateTasks: 'Taken',
    estimateInput: 'Invoertokens',
    estimateCost: 'Geschatte kosten',
    estimateCostSub: 'vóór prefix-caching',
    estimateModel: (model) => `Berekend met de prijzen van ${model}`,
    estimatePriceUnknown: 'prijs onbekend',
    estimatePriceUnknownSub: 'de catalogus kent geen prijs voor dit model',

    modelOverrideTitle: 'Analysemodel',
    modelOverrideGroup: 'Welk model de documenten in deze run analyseert',
    modelOverrideSettings: 'Zoals in Instellingen',
    modelOverrideCustom: 'Kiezen voor deze run',
    modelOverrideCurrent: (judge, critic) => `Toetsing: ${judge} · criticus: ${critic}`,
    modelOverrideDefault: 'ingebouwde standaard',
    modelOverrideProviderDefault: (provider) => `standaardmodel van ${provider}`,
    modelOverrideHint:
      'Geldt alleen voor de toetsing en de criticus van deze run. De instellingen blijven ongewijzigd.',
  },

  runDetail: {
    tabCoverage: 'Dekkingsmatrix',
    tabFindings: 'Bevindingen',
    tabGaps: 'Hiaten',
    tabSummary: 'Samenvatting',
    notFound: (runId) => `Run #${runId} niet gevonden`,
    reviewMode: 'Beoordelingsmodus',
    exportPlaceholder: 'Exporteren…',
    exportSaved: (path) => `Opgeslagen: ${path}`,
  },

  coverage: {
    emptyTitle: 'De matrix is leeg',
    emptyDesc: 'De run heeft nog geen enkele bevinding opgeleverd. Wacht tot de toetsing klaar is.',
    hint:
      'Een cel toont het slechtste oordeel voor die sectie in dat document en het aantal bevindingen. Een klik filtert de lijst met bevindingen.',
  },

  findings: {
    searchPlaceholder: 'Zoeken in de onderbouwing…',
    allSections: 'alle secties',
    allDocuments: 'alle documenten',
    unreviewedOnly: 'alleen onbeoordeeld',
    reset: 'Wissen',
    emptyTitle: 'Niets gevonden',
    emptyDesc: 'Pas de filters aan of wis ze.',
    colClause: 'Eis',
    colTopic: 'Onderwerp',
    colDocument: 'Document',
    colVerdict: 'Oordeel',
    colSeverity: 'Ernst',
    colConfidence: 'Zekerh.',
    colEvidence: 'Bewijs',
    evidenceTitle: (verified, total) => `${verified} van ${total} geverifieerd`,
    colPages: 'Blz.',
    colRationale: 'Onderbouwing',
    colReview: 'Beoordeling',
    reviewAgreed: 'ok',
    tableLabel: 'Bevindingen',
  },

  gaps: {
    colClause: 'Eis',
    colSection: 'Sectie',
    colTopic: 'Onderwerp',
    colObligation: 'Verpl.',
    colPages: 'Blz.',
    colSeverity: 'Indien ontbrekend',
    colRequirement: 'Tekst van de eis',
    emptyTitle: 'Geen hiaten',
    emptyDesc: 'Elke toepasselijke eis heeft ten minste één bewijsstuk in de documenten.',
    summaryLead: 'Toepasselijke eisen zonder enig bewijs: ',
    summaryTail: '. Elke rij is een kandidaat voor het plan van corrigerende maatregelen (CAP).',
    tableLabel: 'Hiaten',
  },

  summary: {
    coverage: 'Dekking',
    clausesApplicable: 'Toepasselijke eisen',
    clausesApplicableSub: 'na het toepasselijkheidsfilter',
    assessed: 'Getoetst',
    gaps: 'Hiaten',
    gapsSub: 'zonder enig bewijs',
    grade: 'Score op de schaal',
    gradeSub: 'gradingRules niet uitgelezen',
    verdicts: 'Oordelen',
    severity: 'Ernst',
    spend: 'Kosten',
    runCost: 'Kosten van de run',
    cacheLabel: 'aandeel invoertokens uit de cache',
    input: 'Invoer',
    cached: 'Uit cache',
    output: 'Uitvoer',
    cacheNote:
      'Een cache-aandeel van nul bij herhaalde runs betekent dat er in het stabiele promptprefix iets blijft veranderen (een tijdstempel, ongesorteerde JSON).',
    models: 'Modellen',
    modelJudge: 'Toetsing',
    modelCritic: 'Criticus',
    noCritic: 'overgeslagen',
  },

  clauseRegistry: {
    crumb: (versionLabel) => `Eisenregister · v${versionLabel}`,
    reviewTitle: 'Controle van het register',
    progressLabel: (done, total) => `gecontroleerd ${done} van ${total}`,
    progressRight: (pending, flagged) => `${pending} onbeslist · ${flagged} gemarkeerd`,
    summaryBtn: 'Samenvatting en classificatieregels',
    extractBtn: 'Register extraheren (Stage 1)',
    markReviewed: 'Markeren als gecontroleerd',
    blockedTitle: (pending, flagged) =>
      `Er zijn nog ${pending} onbesliste en ${flagged} gemarkeerde eisen`,
    unlockTitle: 'Auditruns voor deze versie vrijgeven',
    markedReviewed: 'Het register is gemarkeerd als gecontroleerd',
    extractProgress: (page, pageCount) => `Extractie: pagina ${page} van ${pageCount}`,
    extractFound: (count) => `gevonden eisen: ${count}`,
    extractFailed: (message) => `Extractie mislukt: ${message}`,
    searchPlaceholder: 'Zoeken: nummer, onderwerp, tekst van de eis…',
    filterAll: (count) => `Alle ${count}`,
    filterPending: (count) => `Onbeslist ${count}`,
    filterFlagged: (count) => `Gemarkeerd ${count}`,
    emptyRegistry: 'Het register is leeg',
    emptyRegistryDesc:
      'Start de extractie van het register — die leest de eisentabel pagina voor pagina uit.',
    emptySearch: 'Niets gevonden',
    emptySearchDesc: 'Probeer een ander filter of een andere zoekterm.',
    listLabel: 'Eisen',
    hintNav: 'navigeren',
    hintConfirm: 'bevestigen + volgende',
    hintFlag: 'markeren',
    pickClause: 'Kies een eis',
    pickClauseDesc: 'De lijst staat links; navigeer met J / K.',
    summaryModalTitle: 'Samenvatting van de norm',
    summaryEmptyTitle: 'Nog geen samenvatting',
    summaryEmptyDesc: 'Die wordt in Stage 1 opgebouwd, samen met het eisenregister.',
    summaryDescription: 'Beschrijving',
    summaryScope: 'Scope',
    summaryGrading: 'Classificatieregels',
    summaryModelUnknown: 'model onbekend',
    fieldClauseNo: 'Nummer van de eis',
    fieldTopic: 'Onderwerp',
    fieldSection: 'Sectie',
    fieldSectionTitle: 'Titel van de sectie',
    fieldModules: 'Toepasselijkheidsmodules',
    modulesHint: 'Een lege set = de eis is altijd van toepassing, ongeacht het locatieprofiel.',
    fieldObligation: 'Verplichting',
    obligationUnset: 'niet ingesteld',
    fieldRequirement: 'Tekst van de eis',
    requirementHint:
      'Opsommingen (`•`) moeten opsommingen blijven: juist die vormen de afzonderlijk toetsbare punten.',
    pages: 'Pagina’s',
    confirm: '✔ Bevestigen',
    saveEdits: '✎ Wijzigingen opslaan',
    saveEditsTitle: 'Wijzigingen opslaan en de eis markeren als bewerkt',
    noChanges: 'Geen wijzigingen',
    flag: '⚑ Markeren',
    unsaved: 'niet-opgeslagen wijzigingen',
  },

  findingDetail: {
    crumb: 'Bevinding',
    crumbClause: (clauseNo) => `Eis ${clauseNo}`,
    notFound: (findingId) => `Bevinding #${findingId} niet gevonden`,
    aggregate: 'samengevat over de set',
    requirement: 'Eis uit de norm',
    requirementUnavailable: 'De tekst van de eis is niet beschikbaar.',
    section: (sectionNo, sectionTitle) => `sectie ${sectionNo} · ${sectionTitle}`,
    document: (title) => `document: ${title}`,
    confidence: (value) => `zekerheid: ${value}`,
    rationale: 'Onderbouwing',
    gap: 'Hiaat',
    recommendation: 'Aanbeveling',
    prev: '← Vorige',
    next: 'Volgende →',
    position: (index, total) => `${index} van ${total}`,
    evidence: 'Bewijs',
    verifiedCount: (verified, total) => `${verified} / ${total} geverifieerd`,
    noEvidenceLead: 'Geen enkel bewijs. Bij het oordeel ',
    noEvidenceTail: ' is dat alleen te verwachten als de eis werkelijk nergens wordt genoemd.',
    pageShort: 'blz.',
    hintBetween: 'tussen bevindingen',
    hintBack: 'terug naar de lijst',
    treeTitle: 'Eisen in de run',
    reviewedDot: 'beoordeeld',
    decisionTitle: 'Menselijk besluit',
    decisionUpdated: (when) => `bijgewerkt ${when}`,
    decisionNote:
      'Het oordeel van het model wordt nooit overschreven. Een verschil tussen beide wordt automatisch een kandidaat voor de eval.',
    fieldHumanVerdict: 'Menselijk oordeel',
    agreeWithModel: 'Eens met het model',
    fieldSeverity: 'Ernst',
    asModel: 'zoals het model',
    fieldNote: 'Notitie',
    saveDecision: 'Besluit opslaan',
    decisionSaved: 'Besluit opgeslagen',
    clearDecision: 'Besluit wissen',
  },

  review: {
    crumb: 'Beoordelingsmodus',
    allReviewed: 'Er zijn geen onbeoordeelde bevindingen meer',
    rejectNote: 'oordeel van het model afgewezen',
    emptyTitle: 'Niets te beoordelen',
    emptyDesc: 'Deze run heeft nog geen resultaten opgeleverd.',
    confidence: (value) => `zekerheid ${value}`,
    progressLabel: (done, total) => `beoordeeld ${done} van ${total}`,
    whichVerdict: 'Welk oordeel is juist?',
    cancelEsc: 'Annuleren (Esc)',
    accept: 'Accepteren',
    reject: 'Afwijzen',
    edit: 'Bewerken',
    hintNav: 'navigeren',
    hintNextUnreviewed: 'volgende onbeoordeelde',
    hintExit: 'afsluiten',
    requirement: 'Eis uit de norm',
    modelRationale: 'Onderbouwing van het model',
    gap: 'Hiaat',
    recommendation: 'Aanbeveling',
    alreadyReviewed: 'Al beoordeeld: ',
    agreedWithModel: 'eens met het model',
    evidence: 'Bewijs',
    noEvidence: 'Geen enkel bewijs.',
    pageShort: 'blz.',
    fieldVerdict: 'Oordeel',
    agreeWithModel: 'Eens met het model',
    fieldSeverity: 'Ernst',
    asModel: 'zoals het model',
    fieldNote: 'Notitie',
    saveAndNext: 'Opslaan en verder',
  },

  settings: {
    title: 'Instellingen',
    subtitle: 'Modelroutering per stap, gelijktijdigheid en toegang tot providers.',
    themeTitle: 'Kleurthema',
    themeGroup: 'Thema',
    themeSystem: 'Systeem volgen',
    themeLight: 'Licht',
    themeDark: 'Donker',
    themeHint:
      'De keuze wordt lokaal bewaard en direct toegepast, ook als de backend niet beschikbaar is.',
    languageTitle: 'Taal van de interface',
    languageGroup: 'Taal',
    languageSystem: 'Systeem',
    languageHint:
      'Wordt lokaal bewaard en direct toegepast. “Systeem” volgt de taal van het besturingssysteem en valt terug op Engels als die niet wordt ondersteund.',
    routingTitle: 'Modelroutering per stap',
    routingHint:
      'Het dure model hoort daar waar een fout het meest kost: het eisenregister en de toetsing. Documentprofielen kunnen naar een goedkoop model.',
    routingReset: 'Standaard herstellen',
    routingResetTitle: 'Alle keuzes per stap verwijderen en terug naar de ingebouwde routering',
    routingResetDone: 'Routering teruggezet naar de ingebouwde standaard',
    colStage: 'Stap',
    colProvider: 'Provider',
    colModel: 'Model',
    colEffort: 'Denkdiepte',
    providerNone: 'geen',
    providerCloud: ' (cloud)',
    providerLocal: ' (lokaal)',
    providerNoKey: ' — geen sleutel',
    providerUnavailable: (id) => `${id} (niet beschikbaar)`,
    modelDefault: 'standaard',
    modelCustom: 'Ander model…',
    modelCustomPlaceholder: 'leverancier/model-id',
    modelNotListed: (id) => `${id} (niet in de lijst)`,
    vendorOther: 'Overig',
    ariaProvider: (stage) => `${stage}: provider`,
    ariaModel: (stage) => `${stage}: model`,
    ariaCustomModel: (stage) => `${stage}: model-ID`,
    ariaEffort: (stage) => `${stage}: denkdiepte`,
    effortUnset: 'Niet ingesteld: de standaard van de stap geldt.',
    effortUnsupported: 'Dit model kent geen instelling voor denkdiepte.',
    effortStale: (effort) => `${effort} — niet ondersteund door dit model`,
    hintContext: (size) => `context ${size}`,
    hintPrice: (input, output) => `${input} invoer / ${output} uitvoer per 1M tokens`,
    hintCacheRead: (price) => `lezen uit cache ${price}`,
    hintPriceUnknown: 'prijs onbekend',
    hintNotInCatalogue: 'Niet in de modelcatalogus — context en prijs onbekend.',
    hintDefault: 'Het ingebouwde standaardmodel van deze stap.',
    hintProviderDefault: (provider) => `Het standaardmodel van ${provider}.`,
    executionTitle: 'Uitvoering',
    fieldConcurrency: 'Gelijktijdigheid',
    concurrencyHint:
      'Hoeveel LLM-aanroepen een run tegelijk doet. Te veel, en de provider antwoordt met 429.',
    localOnly: 'Alleen lokale modellen',
    localOnlyHint:
      'Verbiedt elke verzending naar de cloud, ook voor normen waarvoor die is toegestaan. Een algemene veiligheidspal bovenop de vlag cloudAllowed.',
    providersTitle: 'Providers',
    chipCloud: 'cloud',
    chipLocal: 'lokaal',
    keySaved: 'sleutel opgeslagen',
    keyMissing: 'geen sleutel ingesteld',
    modelsUnknown: 'modellen onbekend',
    newKeyPlaceholder: 'nieuwe sleutel (wordt nooit getoond)',
    keyPlaceholder: 'API-sleutel',
    saveKey: 'Sleutel opslaan',
    removeKey: 'Verwijderen',
    keyHint:
      'De sleutel wordt in het hoofdproces versleuteld met safeStorage en nooit teruggegeven aan de interface.',
    modelsCount: (count) => `${count} ${n(count, 'model', 'modellen')}`,
    modelsMore: (count) => `+${count} meer`,
    catalogueUpdated: (when) => `lijst bijgewerkt ${when}`,
    catalogueBuiltIn: 'ingebouwde lijst',
    refreshModels: 'Modellijst vernieuwen',
    refreshingModels: 'Vernieuwen…',
    refreshModelsHint: 'Haalt de actuele modelcatalogus van de provider op. Kost geen tokens.',
    refreshModelsDone: (provider, count) =>
      `${provider}: ${count} ${n(count, 'model', 'modellen')} in de lijst`,
    linkGetKey: 'Sleutel aanmaken',
    linkCredits: 'Tegoed',
    linkBilling: 'Facturering',
    cloudHintOpenRouter:
      'OpenRouter stuurt de documenten door naar de leverancier van het gekozen model (Anthropic, OpenAI, DeepSeek, Google…). De schakelaar “Cloudproviders toestaan” van de norm geldt ook hiervoor.',
    cloudHintDirect: (provider) =>
      `De documenten gaan naar de API van ${provider}. De schakelaar “Cloudproviders toestaan” van de norm is van toepassing.`,
    localHint: 'Draait op deze computer: de documenten verlaten hem nooit.',
    resultsLanguageTitle: 'Taal van de resultaten',
    resultsLanguageLabel: 'Conclusies schrijven in',
    resultsLanguageSpec: 'Taal van de norm',
    resultsLanguageHint:
      'Geldt alleen voor nieuwe runs en alleen voor de teksten van de conclusies: onderbouwing, wat ontbreekt, aanbeveling.',
    resultsLanguageQuotes:
      'Citaten als bewijs blijven altijd in de oorspronkelijke taal. Een vertaald citaat zou bij de mechanische controle niet in het document worden teruggevonden, en elk oordeel “Conform” zou worden teruggezet naar “Beoordeling nodig”.',

    spendTitle: 'Kosten van de app',
    spendSubtitle: 'Wat deze app aan modelaanroepen heeft uitgegeven, volgens de eigen boekhouding.',
    spendToday: 'Vandaag',
    spendMonth: 'Deze maand',
    spendTotal: 'Totaal',
    spendEmptyTitle: 'Nog geen aanroepen geregistreerd',
    spendEmptyDesc: 'De cijfers verschijnen na de eerste run die een model aanroept.',
    spendColStage: 'Stap',
    spendColModel: 'Model',
    spendColCalls: 'Aanroepen',
    spendColInput: 'Invoer',
    spendColCached: 'Uit cache',
    spendColOutput: 'Uitvoer',
    spendColCost: 'Kosten',
    spendBalanceNote:
      'Deze totalen zijn de eigen boekhouding van de app over modelaanroepen, geen accountsaldo. Anthropic heeft geen endpoint voor het resterende tegoed, dus het echte saldo staat alleen in de Anthropic-console. OpenRouter rapporteert zijn cijfers zelf: zodra de sleutel is opgeslagen, verschijnen die hier apart.',
    spendOpenConsole: 'Anthropic-console openen',
    spendOpenOpenRouter: 'Tegoed bij OpenRouter openen',
    spendCounted: 'Geteld door deze app',
    spendReported: (provider) => `Gerapporteerd door ${provider}`,
    spendReportedHint:
      'Uitgaven van de API-sleutel die in de app is opgeslagen, zoals de provider ze rapporteert — inclusief aanroepen met dezelfde sleutel buiten deze app.',

    testing: 'Testen…',
    test: 'Testen',
    testOk: 'werkt',
    testFail: 'mislukt',
  },

  balance: {
    chipKeyRemaining: (amount) => `${amount} over`,
    chipKeyMonth: (amount) => `${amount} deze maand`,
    chipKeyTotal: (amount) => `${amount} uitgegeven`,
    tipAccount: (provider, when) => `${provider}: resterend tegoed op het account. Bijgewerkt ${when}.`,
    tipKeyRemaining: (provider, when) =>
      `${provider}: wat er over is van de limiet van deze API-sleutel — niet het accountsaldo (daarvoor is een beheersleutel nodig in Instellingen). Bijgewerkt ${when}.`,
    tipKeyMonth: (provider, when) =>
      `${provider}: deze maand uitgegeven met deze API-sleutel — niet het accountsaldo (daarvoor is een beheersleutel nodig in Instellingen). Bijgewerkt ${when}.`,
    tipKeyTotal: (provider, when) =>
      `${provider}: in totaal uitgegeven met deze API-sleutel — niet het accountsaldo. Bijgewerkt ${when}.`,
    tipLow: 'Het tegoed raakt op.',
    tipOpenSettings: 'Klik om Instellingen te openen.',
    tipUnavailable: (provider) => `${provider}: het saldo is nu niet beschikbaar.`,
    tipFailed: (provider, message) => `${provider}: saldo ophalen mislukt — ${message}`,

    panelTitle: (provider) => `Saldo volgens ${provider}`,
    refresh: 'Vernieuwen',
    refreshing: 'Vernieuwen…',
    fetchedAt: (when) => `bijgewerkt ${when}`,
    accountTitle: 'Account',
    accountRemaining: 'Resterend tegoed',
    accountTotal: 'Gekocht tegoed',
    accountUsed: 'Verbruikt',
    keyTitle: 'Deze API-sleutel',
    keyToday: 'Vandaag',
    keyWeek: 'Deze week',
    keyMonth: 'Deze maand',
    keyTotal: 'Totaal',
    keyLimit: 'Limiet',
    keyNoLimit: 'geen limiet',
    keyLimitLeft: 'Resterende limiet',
    limitReset: (period) =>
      period === 'daily'
        ? 'wordt dagelijks gereset'
        : period === 'weekly'
          ? 'wordt wekelijks gereset'
          : period === 'monthly'
            ? 'wordt maandelijks gereset'
            : period
              ? `reset: ${period}`
              : 'wordt nooit gereset',
    freeTier: 'gratis niveau',
    accountNeedsKey:
      'Het accountsaldo is alleen beschikbaar met een beheersleutel. Zonder die sleutel ziet de app wat deze API-sleutel heeft uitgegeven, maar niet hoeveel tegoed er over is.',
    accountKeyRejected: (provider) =>
      `${provider} heeft de beheersleutel geweigerd. Maak een nieuwe aan en sla die hier op.`,
    accountError: 'Het accountsaldo kon niet worden opgehaald. Probeer het later opnieuw.',
    unavailable: 'De provider gaf geen saldo terug — controleer de sleutel en de verbinding.',
    managementKeyLabel: 'Beheersleutel (optioneel)',
    managementKeyPlaceholder: 'beheersleutel',
    managementKeyNewPlaceholder: 'nieuwe beheersleutel (wordt nooit getoond)',
    managementKeySaved: 'beheersleutel opgeslagen',
    managementKeySave: 'Opslaan',
    managementKeyRemove: 'Verwijderen',
    managementKeySavedToast: 'Beheersleutel opgeslagen',
    managementKeyHint:
      'Met een beheersleutel kunt u uw API-sleutels aanmaken, wijzigen en verwijderen. De app gebruikt hem voor één ding: het accountsaldo uitlezen. Hij wordt versleuteld zoals de API-sleutel en nooit meer getoond.',
    managementKeyCreate: 'Beheersleutel aanmaken',
    openCredits: (provider) => `Tegoed bij ${provider}`,
  },

  pdf: {
    /** 'blz. 41' / 'blz. 41–42' — de pagina van de oorspronkelijke norm waarop de eis staat. */
    pageRef: (from, to) => (to != null && to !== from ? `blz. ${from}–${to}` : `blz. ${from}`),
    openTitle: (from, to) =>
      to != null && to !== from
        ? `De norm openen op pagina ${from}–${to}`
        : `De norm openen op pagina ${from}`,
    noPage: 'pagina onbekend',
    viewerTitle: 'Origineel',
    loading: 'PDF laden…',
    pageOf: (page, total) => `${page} van ${total}`,
    prev: 'Vorige pagina',
    next: 'Volgende pagina',
    zoomOut: 'Uitzoomen',
    zoomIn: 'Inzoomen',
    fitWidth: 'Paginabreedte',
    renderFailed: 'De pagina kon niet worden weergegeven',
    unavailableTitle: 'Het bestand is niet beschikbaar',
    unavailableDesc: 'Het bronbestand kon niet uit de opslag worden gelezen.',
    noHashTitle: 'Geen bronbestand',
    noHashDesc: 'Voor deze versie is geen bestand geïmporteerd, dus er valt niets te tonen.',
  },

  runStats: {
    never: 'Nog niet geaudit',
    neverDesc: 'Dit document heeft nog in geen enkele auditrun gezeten.',
    against: (spec, version) => `${spec} v${version}`,
    lastRun: 'Laatste run',
    relevant: 'Dekt',
    relevantHint: 'Eisen waarover het document werkelijk iets zegt (oordeel anders dan “Niet behandeld”).',
    relevantOf: (relevant, assessed) => `${relevant} van ${assessed} getoetst`,
    issues: 'Afwijkingen',
    noIssues: 'geen afwijkingen',
    issuesHint: 'Gedeeltelijke en niet-conforme oordelen, naar ernst.',
    reviewed: 'Beoordeeld',
    reviewedOf: (reviewed, assessed) => `${reviewed} van ${assessed}`,
    openRuns: 'Runs',
    viewFindings: 'Bevindingen voor dit document',
  },

  docRuns: {
    crumb: 'Runs',
    title: (doc) => `Runs voor “${doc}”`,
    subtitle: 'Elke auditrun waarin dit document zat, de nieuwste eerst.',
    emptyTitle: 'Geen runs voor dit document',
    emptyDesc: 'Start een audit met dit document erin — de resultaten verschijnen hier.',
    toLibrary: 'Terug naar documenten',
    startRun: 'Run aanmaken',
    colRun: 'Run',
    colSpec: 'Norm',
    colVersion: 'Versie',
    colFinished: 'Voltooid',
    colRelevant: 'Dekt',
    colIssues: 'Afwijkingen',
    colReviewed: 'Beoordeeld',
    unnamed: 'naamloos',
  },

  deleteRun: {
    action: 'Verwijderen',
    actionTitle: (runId) => `Run #${runId} verwijderen`,
    title: 'Deze run verwijderen?',
    facts: (runId, findings, reviewed) =>
      `Run #${runId} · ${findings} ${n(findings, 'bevinding', 'bevindingen')} · ${reviewed} handmatig beoordeeld`,
    factsLoading: 'Berekenen wat er verloren gaat…',
    irreversible:
      'De run verdwijnt samen met alle bevindingen, bewijzen en menselijke beoordelingen. Dit kan niet ongedaan worden gemaakt.',
    reviewedWarning: (reviewed) =>
      `${reviewed} ${n(reviewed, 'oordeel is', 'oordelen zijn')} al door een mens beoordeeld. Dat werk is het kostbaarste hier, en het gaat verloren met de run.`,
    liveWarning:
      'De run loopt nog. Hij wordt automatisch gestopt — u hoeft hem niet eerst te annuleren.',
    spendNote:
      'De kostenregels blijven in het logboek: het geld is uitgegeven, of het resultaat nu nog nodig is of niet.',
    confirm: 'Run verwijderen',
    deleting: 'Verwijderen…',
    done: (runId) => `Run #${runId} verwijderd`,
  },

  notFound: {
    title: 'Pagina niet gevonden',
    desc: 'Deze route bestaat niet. Gebruik de navigatie links.',
    toLibrary: 'Naar documenten',
  },
};
