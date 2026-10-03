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
    runs: 'Documentkeuringen',
    settings: 'Instellingen',
    mainNav: 'Hoofdnavigatie',
    theme: 'Thema',
    themeGroup: 'Kleurthema',
    themeLight: 'Licht thema',
    themeSystem: 'Systeem volgen',
    themeDark: 'Donker thema',
    runProgress: (runId, done, total) =>
      `Run #${runId}: ${done} van ${total} ${n(total, 'taak', 'taken')}`,
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
      not_addressed: 'Niet beh.',
      needs_human_review: 'Mens',
    },

    verdictHint: {
      compliant: 'De eis wordt onderbouwd met bewijs uit het document.',
      partial: 'Deels afgedekt — voor een deel van de eis ontbreekt bewijs.',
      non_compliant: 'Het document is rechtstreeks in strijd met de eis, of voldoet er niet aan.',
      not_applicable: 'Niet van toepassing op deze locatie volgens het profiel — bepaald door regels, niet door het model.',
      not_addressed:
        'Geen enkel document zegt iets over deze eis. Geen tekortkoming — het document gaat gewoon over iets anders.',
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

  help: {
    more: 'Uitleg',
    about: (term) => `Wat betekent “${term}”?`,
  },

  badges: {
    verified: 'geverifieerd',
    unverified: 'niet geverifieerd',
    verifiedHint: 'Het citaat is mechanisch teruggevonden in de brontekst van het document',
    unverifiedHint: 'Het citaat is niet gevonden in de brontekst — het is niet betrouwbaar',
    runStatusHint: {
      queued: 'Aangemaakt en wacht op de start.',
      running: 'Het model werkt de taken af; bevindingen verschijnen zodra ze klaar zijn.',
      paused: 'Gepauzeerd — er gaat niets verloren. Met “Hervatten” gaat de run verder waar hij stopte.',
      done: 'Voltooid: alle taken zijn verwerkt.',
      failed: 'Gestopt met een fout — de oorzaak staat op de pagina van de run. Resultaten van daarvoor blijven bewaard.',
      cancelled: 'Handmatig gestopt. Resultaten van daarvoor blijven bewaard.',
    },
  },

  meters: {
    costTitle: (input, cached, share, output) =>
      `Kosten van de modelaanroepen. Tokens — invoer: ${input}, waarvan uit cache: ${cached} (${share}%, goedkoper gefactureerd) · uitvoer: ${output}`,
    cacheShare: (share) => `${share}% cache`,
    inShort: 'in',
    outShort: 'uit',
  },

  heatmap: {
    section: 'Sectie',
    sectionClauses: (count) => `${count} ${n(count, 'eis', 'eisen')}`,
    stateIssues: (count) => `${count} ${n(count, 'afwijking', 'afwijkingen')}`,
    stateReview: (count) => `${count} te beoordelen`,
    stateOk: 'Conform',
    stateNotCovered: 'Niet gedekt',
    stateEmpty: 'Geen bevindingen',
    addressed: (addressed, total) => `${addressed} van ${total} ${n(total, 'eis', 'eisen')}`,
    cellTitle: (section, document) => `${section} — ${document}`,
    breakdown: (verdict, count) => `${verdict}: ${count}`,
    openHint: 'Klik om deze bevindingen te openen.',
    notCoveredHint:
      'Het document gaat niet over deze sectie. Dat is normaal wanneer één document tegen de hele norm wordt getoetst.',
    docCovered: (covered, total) => `dekt ${covered} van ${total} secties`,
    docIssues: (count) => (count === 0 ? 'geen afwijkingen' : `${count} ${n(count, 'afwijking', 'afwijkingen')}`),
    hideUncovered: (count) => `Secties verbergen waar geen enkel document over gaat (${count})`,
    howToTitle: 'Zo leest u de matrix',
    howToRows:
      'Rijen zijn secties van de norm, kolommen zijn uw documenten. Een cel beantwoordt: wat zegt dit document over deze sectie?',
    howToStates:
      '“2 afwijkingen” — eisen met het oordeel gedeeltelijk of niet-conform: open de cel om te zien wat ontbreekt. “Te beoordelen” — het model twijfelde of een controle sloeg aan; bekijk het zelf. “Conform” — alle eisen waar het document over gaat, zijn vervuld.',
    howToNotCovered:
      '“Niet gedekt” — het document noemt deze sectie niet (de eisen kregen het oordeel “Niet behandeld”). Bij één document is dat normaal en geen tekortkoming: zulke secties moeten door andere documenten worden gedekt (zie het tabblad Hiaten).',
    howToSecond:
      'De tweede regel toont hoeveel eisen van de sectie het document echt behandelt; de balk toont de verdeling van de oordelen.',
    legendTitle: 'Kleuren van de balk:',
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
    fieldTitle: 'Titel',
    fieldDocNumber: 'Documentnummer',
    fieldOwner: 'Proceseigenaar',
    ownerPlaceholder: 'bijv. Kwaliteitsmanager',
    fieldKind: 'Type',
    kindUnset: 'niet ingesteld',
    versionsCallout:
      'Versies wijzigt u door een nieuw bestand te importeren: elk bestand met een nieuwe SHA-256 wordt een nieuwe versie.',
    versionHash:
      'Vingerafdruk van het bestand (SHA-256). Daaraan herkent de app hetzelfde bestand bij een nieuwe import, zodat er geen nieuwe versie ontstaat.',
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
    statusHint: {
      pending:
        'Het eisenregister is nog niet geëxtraheerd. Open het en start de extractie — zonder register kan er niet aan deze versie worden getoetst.',
      extracted:
        'Het model heeft de eisen geëxtraheerd, maar niemand heeft ze nog gecontroleerd. Open het register en controleer het: tot dan zijn auditruns voor deze versie geblokkeerd.',
      reviewed: 'Het register is door een mens gecontroleerd — deze versie kan in auditruns worden gebruikt.',
    },
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
    modulesHint:
      'Eisen uit niet-aangevinkte modules krijgen direct “Niet van toepassing” — het model ziet ze niet.',
    modulesList: (modules) => `modules ${modules}`,
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
    recomputeTitle: 'Toepasselijkheid van de eisen voor dit profiel',
    noSpecs: 'geen normen',
    recomputing: 'Berekenen…',
    recompute: 'Herberekenen',
    saveFirst: 'Sla eerst het profiel op',
    resultApplicable: 'van toepassing:',
    resultOf: 'van',
    resultOutOfScope: (count) => ` · buiten het profiel ${count}`,
    resultExplain: (applicable, notApplicable) =>
      `In runs met dit profiel toetst het model ${applicable} ${n(applicable, 'eis', 'eisen')}; ${notApplicable} ${n(notApplicable, 'eis krijgt', 'eisen krijgen')} direct “Niet van toepassing”, zonder modelaanroep.`,
    recomputeHint:
      'De berekening is deterministisch — zonder AI. Elke uitzondering kunt u handmatig overschrijven in het eisenregister.',
  },

  runs: {
    title: 'Documentkeuringen',
    subtitle:
      'Deelresultaten worden direct in de database vastgelegd — een onderbroken run kan worden hervat.',
    newRun: '+ Nieuwe run',
    colLabel: 'Naam',
    unnamed: 'naamloos',
    colStatus: 'Status',
    colDocs: 'Documenten',
    colModel: 'Model',
    colModelHint:
      'Het model dat de eisen heeft getoetst (de stap toetsing). Wijs een rij aan om ook het model van de criticus te zien.',
    modelTitle: (judge, critic) =>
      `toetsing: ${judge}${critic ? ` · criticus: ${critic}` : ' · zonder criticus'}`,
    colStarted: 'Gestart',
    colDuration: 'Duur',
    colDurationHint:
      'Van start tot einde. Voor een run die nog niet klaar is — tot nu, pauzes inbegrepen.',
    colCost: 'Kosten',
    colCostHint:
      'Wat de modelaanroepen van deze run werkelijk hebben gekost, in USD. Wijs een rij aan voor het aantal tokens.',
    colActions: 'Acties',
    costTitle: (input, output) => `${input} invoer / ${output} uitvoer`,
    runTitle: (runId) => `Run #${runId}`,
    preparing: 'voorbereiden',
    running: 'bezig',
    progressRight: (done, total, failed) =>
      `${done} van ${total} ${n(total, 'taak', 'taken')}${failed ? ` · mislukt ${failed}` : ''}`,
    pause: '⏸ Pauzeren',
    resume: '▶ Hervatten',
    cancel: '✕ Annuleren',
    openDetails: 'Details openen →',
    emptyTitle: 'Nog geen runs',
    emptyDesc:
      'Kies een gecontroleerde normversie, een locatieprofiel en de documenten — en start de eerste audit.',
    emptyAction: 'Run aanmaken',
    tableLabel: 'Documentkeuringen',
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
    specReadyHint:
      '✔ — het eisenregister van die versie is gecontroleerd. Een versie zonder ✔ kan pas worden geaudit als het register is gecontroleerd.',
    fieldSite: 'Locatieprofiel',
    noSite: 'geen profiel — alle eisen zijn van toepassing',
    blockedCallout:
      'Het eisenregister van deze versie is nog niet gecontroleerd. De run is geblokkeerd: foutieve eisen maken elke bevinding die erop volgt zinloos.',
    fieldDocuments: (selected) => `Documenten (${selected} geselecteerd)`,
    documentsHint: 'Elke rij is één versie van een document; meestal wilt u de nieuwste.',
    latestTag: 'nieuwste',
    libraryEmpty: 'Nog geen documenten',
    selectAll: 'Alles selecteren',
    clearSelection: 'Wissen',
    skipCritic: 'Criticusronde overslaan',
    skipCriticHint:
      'De criticus is een tweede ronde die de oordelen “Conform” opnieuw controleert. Overslaan is sneller en goedkoper, maar de kans op een gemiste afwijking stijgt — en dat is de duurste fout die er is.',
    estimateTasks: 'Taken',
    estimateTasksHint:
      'Eén taak is één modelaanroep die één sectie van de norm toetst aan één document. Secties waar een document niet over gaat, worden zonder aanroep afgesloten.',
    estimateInput: 'Invoertokens',
    estimateInputHint:
      'Ongeveer hoeveel tekst het model leest: de eisen van de sectie plus het document, voor elke taak. 1k = duizend, 1M = een miljoen tokens.',
    estimateCost: 'Geschatte kosten',
    estimateCostSub: 'zonder cachekorting — in de praktijk meestal lager',
    estimateModel: (model) => `Berekend met de prijzen van ${model}`,
    estimatePriceUnknown: 'prijs onbekend',
    estimatePriceUnknownSub: 'de catalogus kent geen prijs voor dit model',

    modelOverrideTitle: 'Analysemodel',
    modelOverrideGroup: 'Welk model de documenten in deze run analyseert',
    modelOverrideSettings: 'Zoals in Instellingen',
    modelOverrideCustom: 'Kiezen voor deze run',
    modelOverrideCurrent: (judge, critic) => `Toetsing: ${judge} · criticus: ${critic}`,
    modelOverrideDefault: 'ingebouwde standaard',
    modelOverrideHint:
      'Geldt alleen voor de toetsing en de criticus van deze run. De instellingen blijven ongewijzigd.',
  },

  runDetail: {
    tabCoverage: 'Dekkingsmatrix',
    tabFindings: 'Bevindingen',
    tabGaps: 'Hiaten',
    tabSummary: 'Samenvatting',
    tabHint: {
      coverage: 'Secties van de norm × documenten: wat elk document over elke sectie zegt.',
      findings: 'Eén rij per eis × document: oordeel, citaten als bewijs en onderbouwing.',
      gaps: 'Toepasselijke eisen die door geen enkel document van de run worden gedekt.',
      summary: 'Aantallen per oordeel en ernst, kosten en de modellen van de run.',
    },
    notFound: (runId) => `Run #${runId} niet gevonden`,
    reviewMode: 'Beoordelingsmodus',
    exportPlaceholder: 'Exporteren…',
    exportSaved: (path) => `Opgeslagen: ${path}`,
  },

  coverage: {
    emptyTitle: 'De matrix is leeg',
    emptyDesc: 'De run heeft nog geen enkele bevinding opgeleverd. Wacht tot de toetsing klaar is.',
    hint: 'Klik op een cel om de bevindingen van die sectie in dat document te openen.',
  },

  findings: {
    searchPlaceholder: 'Zoeken in de onderbouwing…',
    allSections: 'alle secties',
    allDocuments: 'alle documenten',
    unreviewedOnly: 'alleen onbeoordeeld',
    reset: 'Wissen',
    emptyTitle: 'Niets gevonden',
    emptyDesc: 'Pas de filters aan of wis ze.',
    filterVerdict: 'Oordeel:',
    filterSeverity: 'Ernst:',
    noiseHint:
      '“Niet behandeld” betekent dat het document niet over deze eis gaat — dat is geen tekortkoming. Als één document aan de hele norm wordt getoetst, geldt dat voor de meeste eisen.',
    noiseAction: 'Alleen tonen waar de documenten over gaan',
    colClause: 'Eis',
    colTopic: 'Onderwerp',
    colDocument: 'Document',
    colDocumentHint:
      'Op welk document het oordeel slaat. “hele set” — een oordeel over alle documenten van de run samen; daaruit worden de hiaten opgebouwd.',
    aggregateDoc: 'hele set',
    colVerdict: 'Oordeel',
    colVerdictHint:
      'Het oordeel van het model; wijs een badge aan om te zien wat die betekent. Een menselijk besluit, als dat er is, staat in de kolom Beoordeling.',
    colSeverity: 'Ernst',
    colSeverityHint:
      'Hoe ernstig de bevinding is op de eigen schaal van de norm: Critical, Major, Minor, Recommendation. Bij “Niet behandeld” is dat alleen de mogelijke ernst — hoe erg het zou zijn als geen enkel document de eis dekt — en daarom grijs weergegeven.',
    potentialSeverity: (severity) =>
      `Alleen mogelijk: zo ernstig zou het zijn als geen enkel document de eis dekt — ${severity}`,
    colConfidence: 'Zekerh.',
    colConfidenceHint:
      'Hoe zeker het model is van zijn oordeel, 0–100%. “—” — geen schatting, bijv. als de sectie zonder modelaanroep is afgesloten omdat het document er niet over gaat.',
    colEvidence: 'Bewijs',
    colEvidenceHint:
      'Geverifieerde citaten / alle citaten. Geverifieerd betekent dat het citaat woordelijk in de documenttekst is teruggevonden; een niet-geverifieerd citaat is niet betrouwbaar.',
    evidenceTitle: (verified, total) => `${verified} van ${total} geverifieerd`,
    colPages: 'Blz.',
    colPagesHint: 'De pagina van de norm waarop de eis staat. Klik om de PDF daar te openen.',
    colRationale: 'Onderbouwing',
    outsideEvidenceTag: 'bij audit',
    outsideEvidenceTitle: (text) =>
      `Buiten het document te controleren — met registraties of observatie op de locatie; dit is voor de audit, geen opmerking over het document: ${text}`,
    colReview: 'Beoordeling',
    colReviewHint:
      'Het besluit van een mens: “ok” — eens met het model; een andere code — het oordeel dat de mens in plaats daarvan gaf; “—” — nog niet beoordeeld.',
    reviewAgreed: 'ok',
    tableLabel: 'Bevindingen',
  },

  gaps: {
    colClause: 'Eis',
    colSection: 'Sectie',
    colTopic: 'Onderwerp',
    colObligation: 'Verpl.',
    colObligationHint:
      'Hoe bindend de eis is volgens de formulering van de norm: must — verplicht, should — verwacht, may — aanbevolen.',
    colPages: 'Blz.',
    colSeverity: 'Indien ontbrekend',
    colSeverityHint:
      'De ernst die dit hiaat bij een audit krijgt als het bewijs blijft ontbreken.',
    colRequirement: 'Tekst van de eis',
    emptyTitle: 'Geen hiaten',
    emptyDesc: 'Elke toepasselijke eis heeft ten minste één bewijsstuk in de documenten.',
    summaryLead: 'Toepasselijke eisen zonder enig bewijs: ',
    summaryTail: '. Elke rij is een kandidaat voor het plan van corrigerende maatregelen (CAP).',
    summaryNote:
      'Hiaten tonen wat de hele documentenset mist. In een run met één of twee documenten zijn het er vanzelfsprekend veel — ze worden zinvol zodra alle procedures van de locatie samen worden getoetst.',
    tableLabel: 'Hiaten',
  },

  summary: {
    coverage: 'Dekking',
    clausesApplicable: 'Toepasselijke eisen',
    clausesApplicableSub: 'na het toepasselijkheidsfilter',
    clausesApplicableHint:
      'Eisen van de norm die in deze keuring zijn beoordeeld. Eisen die als niet van toepassing zijn gemarkeerd, tellen niet mee.',
    assessed: 'Getoetst',
    assessedSub: (share) => `${share} van de toepasselijke`,
    assessedHint: 'Hoeveel toepasselijke eisen in deze run een oordeel hebben gekregen.',
    gaps: 'Hiaten',
    gapsSub: 'zonder enig bewijs',
    gapsHint: 'Toepasselijke eisen die geen enkel document van de run dekt. De lijst staat op het tabblad Hiaten.',
    grade: 'Score op de schaal',
    gradeSub: 'nog niet berekend',
    gradeHint:
      'De score op de eigen classificatieschaal van de norm (5 is het best), afgeleid uit het aantal Critical / Major / Minor. Toont “—” zolang de classificatieregels niet zijn uitgelezen.',
    verdicts: 'Oordelen',
    verdictsHint:
      'Elke bevinding telt één keer. Waar een mens heeft beslist, telt zijn oordeel in plaats van dat van het model.',
    notAddressedNote: 'Wordt één document getoetst, dan belanden de meeste eisen van de norm hier.',
    severity: 'Ernst',
    severityHint:
      'Alleen de oordelen “Gedeeltelijk” en “Niet-conform” tellen mee, menselijke besluiten inbegrepen. Critical / Major / Minor zijn de eigen niveaus van de norm; Recommendation is een advies, geen afwijking.',
    spend: 'Kosten',
    runCost: 'Kosten van de run',
    cacheLabel: 'aandeel invoertokens uit de cache',
    input: 'Invoertokens',
    cached: 'waarvan uit cache',
    output: 'Uitvoertokens',
    cacheNote:
      'De cache maakt het opnieuw versturen van dezelfde tekst (de norm, een document) goedkoper. Toont een herhaalde run een cache-aandeel van nul, dan verandert er steeds iets in het vaste deel van het verzoek — meld dat aan de ontwikkelaar.',
    models: 'Modellen',
    modelJudge: 'Toetsing',
    modelCritic: 'Criticus',
    noCritic: 'overgeslagen',
  },

  clauseRegistry: {
    crumb: (versionLabel) => `Eisenregister · v${versionLabel}`,
    reviewTitle: 'Controle van het register',
    reviewHint:
      'Controleer of elke eis juist is geëxtraheerd: nummer en tekst. Enter bevestigt, F markeert een probleem. Zolang er onbesliste of gemarkeerde eisen zijn, blijven auditruns voor deze versie geblokkeerd. Het belangrijkste signaal is een gat in de nummering (10.1 → 10.4): dan heeft het model hele eisen gemist.',
    progressLabel: (done, total) => `gecontroleerd ${done} van ${total}`,
    progressRight: (pending, flagged) => `${pending} onbeslist · ${flagged} gemarkeerd`,
    summaryBtn: 'Samenvatting en classificatieregels',
    summaryBtnTitle:
      'Een korte samenvatting van de norm en haar classificatieregels Critical / Major / Minor — die gaan mee in elke toetsing.',
    extractBtn: 'Register extraheren (Stage 1)',
    extractTitle:
      'Stage 1: het model leest de eisen van de norm pagina voor pagina uit — een tabel of genummerde tekst — en vult het register. Inhoudsopgave, inleiding en verklarende woordenlijst worden overgeslagen.',
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
    filterPendingHint: 'Eisen die nog niemand heeft bevestigd, bewerkt of gemarkeerd.',
    filterFlaggedHint:
      'Eisen die als problematisch zijn gemarkeerd — door de automatische controle (bijv. een gat in de nummering) of door een mens. Corrigeer ze en bevestig ze daarna.',
    legendMarkers: 'Markeringen van de norm:',
    legendMarkersHint:
      'Deze markeringen staan in de norm zelf bij de eisen afgedrukt; de namen en de uitleg zijn de eigen woorden van de norm.',
    markersUnexplained: 'de uitleg van deze markeringen is niet in de tekst van de norm gevonden',
    legendStatus: 'Stip — controlestatus:',
    emptyRegistry: 'Het register is leeg',
    emptyRegistryDesc:
      'Start de extractie van het register — die leest de eisen van de norm pagina voor pagina uit.',
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
    fieldMarkers: 'Markeringen van de norm',
    markersCheckboxHint: 'Vink de markeringen aan die de norm bij deze eis afdrukt.',
    markersInputHint: 'Codes precies zoals ze bij de eis staan afgedrukt, gescheiden door komma’s.',
    fieldObligation: 'Verplichting',
    obligationUnset: 'niet ingesteld',
    fieldRequirement: 'Tekst van de eis',
    requirementHint:
      'Opsommingen (`•`) moeten opsommingen blijven: juist die vormen de afzonderlijk toetsbare punten.',
    pages: 'Pagina’s',
    sortKey: 'Sorteervolgorde',
    sortKeyHint:
      'Afgeleid van het nummer van de eis, zodat 10.2 vóór 10.10 komt. Wordt automatisch herberekend als het nummer verandert.',
    textHash: 'Vingerafdruk van de tekst',
    textHashHint:
      'SHA-256 van de tekst van de eis. Verandert bij elke bewerking van de tekst; versies van de norm worden erop vergeleken.',
    confirm: '✔ Bevestigen',
    confirmTitle: 'De eis bevestigen zoals ze is en naar de volgende gaan (Enter)',
    saveEdits: '✎ Wijzigingen opslaan',
    saveEditsTitle: 'Wijzigingen opslaan en de eis markeren als bewerkt',
    noChanges: 'Geen wijzigingen',
    flag: '⚑ Markeren',
    flagTitle:
      'De eis als problematisch markeren (F). Auditruns blijven geblokkeerd tot ze is gecorrigeerd en bevestigd.',
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
    outsideEvidence: 'Buiten het document te controleren',
    outsideEvidenceHint:
      'Wat de norm controleert aan de hand van registraties of door observatie op de locatie. Een document kan dit niet aantonen — het is voor de audit, geen opmerking over het document.',
    markers: 'markeringen van de norm:',
    markersHint:
      'Deze markeringen staan in de norm zelf bij de eis: ze geven aan waarmee naleving wordt aangetoond. De uitleg is in de eigen woorden van de norm.',
    markerUnexplained: (code) => `${code} — de norm licht deze markering niet toe`,
    prev: '← Vorige',
    next: 'Volgende →',
    position: (index, total) => `${index} van ${total}`,
    evidence: 'Bewijs',
    verifiedCount: (verified, total) => `${verified} / ${total} geverifieerd`,
    evidenceHint:
      'Citaten uit het document waarop het oordeel steunt. “Geverifieerd” betekent dat de app het citaat woordelijk in de documenttekst heeft teruggevonden. Een oordeel “Conform” zonder één geverifieerd citaat wordt automatisch teruggezet naar “Beoordeling nodig”.',
    sourceCitationsHint:
      'Teruggegeven door de Citations API van de provider: het citaat komt rechtstreeks uit de documenttekst, dus het model kan het niet verzinnen.',
    sourceModelHint:
      'Door het model zelf geschreven; de app zoekt het daarna op in de documenttekst — vandaar “geverifieerd” of “niet geverifieerd”.',
    noEvidenceLead: 'Geen enkel bewijs. Bij het oordeel ',
    noEvidenceTail: ' is dat alleen te verwachten als de eis werkelijk nergens wordt genoemd.',
    pageShort: 'blz.',
    hintBetween: 'tussen bevindingen',
    hintBack: 'terug naar de lijst',
    treeTitle: 'Eisen in de run',
    treeHintLead: 'Symbool en kleur links tonen het oordeel:',
    treeHintReviewed: 'Een groene stip rechts — een mens heeft de bevinding al beoordeeld.',
    reviewedDot: 'beoordeeld',
    decisionTitle: 'Menselijk besluit',
    decisionUpdated: (when) => `bijgewerkt ${when}`,
    decisionNote:
      'Het oordeel van het model wordt nooit overschreven — het uwe wordt ernaast bewaard. Elk verschil wordt een testgeval om de kwaliteit van het model te meten (eval).',
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
    position: (index, total) => `huidige ${index} van ${total}`,
    howTo:
      'Loop de bevindingen één voor één door en geef aan of het model gelijk heeft. Uw besluit wordt apart bewaard — het oordeel van het model wordt nooit overschreven. “Beoordeeld” telt de bevindingen die al een besluit hebben.',
    whichVerdict: 'Welk oordeel is juist?',
    cancelEsc: 'Annuleren (Esc)',
    accept: 'Accepteren',
    acceptTitle:
      'Het oordeel van het model klopt (A). Het wordt als uw besluit bewaard en de volgende onbeoordeelde bevinding opent.',
    reject: 'Afwijzen',
    rejectTitle: 'Het oordeel van het model klopt niet (R): kies het juiste met de toetsen 1–6.',
    edit: 'Bewerken',
    editTitle: 'Het oordeel of de ernst wijzigen, of een notitie toevoegen (E).',
    hintNav: 'navigeren',
    hintNextUnreviewed: 'volgende onbeoordeelde',
    hintExit: 'afsluiten',
    requirement: 'Eis uit de norm',
    modelRationale: 'Onderbouwing van het model',
    gap: 'Hiaat',
    recommendation: 'Aanbeveling',
    outsideEvidence: 'Buiten het document te controleren',
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
    colEffortHint:
      'Hoe lang het model nadenkt voordat het antwoordt. Hoger is grondiger, maar trager en duurder (meer uitvoertokens). “—” — het model kent deze instelling niet.',
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
    hintIsDefault: 'standaard',
    executionTitle: 'Uitvoering',
    fieldConcurrency: 'Gelijktijdigheid',
    concurrencyHint:
      'Hoeveel modelaanroepen een run tegelijk doet. Te veel, en de provider gaat verzoeken weigeren (fout 429, “too many requests”).',
    localOnly: 'Alleen lokale modellen',
    localOnlyHint:
      'Verbiedt elke verzending naar de cloud, ook voor normen waarvoor die is toegestaan. Een algemene veiligheidspal bovenop de schakelaar “Cloudproviders toestaan” van elke norm.',
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
    spendColCallsHint: 'Hoeveel verzoeken er naar de API van het model zijn gestuurd.',
    spendColInput: 'Invoer',
    spendColInputHint:
      'Invoertokens: de tekst die naar het model gaat — instructies, eisen van de norm en uw documenten. 1k = duizend, 1M = een miljoen tokens.',
    spendColCached: 'Uit cache',
    spendColCachedHint:
      'Het deel van de invoertokens dat de provider uit zijn promptcache haalde — veel goedkoper gefactureerd. Zit al in Invoer.',
    spendColOutput: 'Uitvoer',
    spendColOutputHint:
      'Uitvoertokens: de tekst die het model schreef, inclusief zijn redenering. Per token zijn die het duurst.',
    spendColCost: 'Kosten',
    spendColCostHint: 'In USD, volgens de eigen boekhouding van de app per aanroep.',
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
    chipKeyRemaining: (amount) => `limiet ${amount}`,
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
    relevantHint:
      'Eisen waarover het document werkelijk iets zegt (elk oordeel behalve “Niet behandeld”), van alle eisen waaraan het is getoetst. Een laag aandeel is normaal: één procedure dekt alleen haar eigen onderwerp.',
    relevantOf: (relevant, assessed) => `${relevant} van ${assessed} getoetst`,
    relevantSub: (share) => `${share} van getoetst`,
    issues: 'Afwijkingen',
    noIssues: 'geen afwijkingen',
    issuesHint:
      'Eisen met het oordeel “Gedeeltelijk” of “Niet-conform”, naar ernst: CRIT — Critical, MAJ — Major, MIN — Minor, REC — Recommendation.',
    chipLabel: (name, count) => `${name}: ${count}`,
    reviewed: 'Beoordeeld',
    reviewedHint:
      'Hoeveel bevindingen van dit document een mens al heeft beoordeeld — in de beoordelingsmodus of op de pagina van de bevinding.',
    reviewedSub: (share) => `${share} klaar`,
    reviewedOf: (reviewed, assessed) => `${reviewed} van ${assessed}`,
    openRuns: 'Runs',
    viewFindings: 'Bevindingen voor dit document',
  },

  docRuns: {
    crumb: 'Documentkeuringen',
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

  deleteLibrary: {
    action: 'Verwijderen…',
    actionTitle: {
      specification: (name) => `Norm “${name}” met alle versies verwijderen`,
      specVersion: (name) => `Versie “${name}” verwijderen`,
      document: (name) => `Document “${name}” met alle versies verwijderen`,
      documentVersion: (name) => `Versie “${name}” verwijderen`,
    },
    title: {
      specification: 'Norm verwijderen?',
      specVersion: 'Deze normversie verwijderen?',
      document: 'Document verwijderen?',
      documentVersion: 'Deze documentversie verwijderen?',
    },
    loading: 'Berekenen wat er wordt verwijderd…',
    lead: 'Dit wordt verwijderd:',
    target: {
      specification: (title) => `de norm “${title}” met alle versies`,
      specVersion: (title) => `de normversie “${title}”`,
      document: (title) => `het document “${title}” met alle versies`,
      documentVersion: (title) => `de documentversie “${title}”`,
    },
    versions: (count) => `${count} ${n(count, 'versie', 'versies')}`,
    clauses: (count) => `${count} ${n(count, 'eis', 'eisen')} in het eisenregister`,
    profiles: (count) => `${count} ${n(count, 'documentprofiel', 'documentprofielen')}`,
    lastVersion: {
      specVersion: 'De norm heeft geen andere versies, dus de norm zelf verdwijnt ook.',
      documentVersion: 'Het document heeft geen andere versies, dus het document zelf verdwijnt ook.',
    },
    runs: (count) => `${count} ${n(count, 'documentkeuring', 'documentkeuringen')}`,
    findings: (count) => `${count} ${n(count, 'bevinding', 'bevindingen')}`,
    reviewed: (count) =>
      `waarvan ${count} handmatig ${n(count, 'is', 'zijn')} beoordeeld — het waardevolste deel, en dat gaat verloren`,
    files: (count, size) => `${count} ${n(count, 'bestand', 'bestanden')} van de schijf (${size})`,
    sharedKept: (count) =>
      `${count} ${n(count, 'bestand blijft', 'bestanden blijven')} op de schijf: een ander document of een andere norm gebruikt ${n(count, 'het', 'ze')}.`,
    nothingElse: 'Verder wordt er niets geraakt: er zijn geen documentkeuringen op gebaseerd.',
    spendKept: 'De kostenhistorie blijft bewaard.',
    irreversible: 'Dit kan niet ongedaan worden gemaakt.',
    runsTitle: 'Documentkeuringen die worden verwijderd',
    runUnnamed: 'zonder naam',
    runOtherDocuments: (count) =>
      `omvat ook ${count} ${n(count, 'ander document', 'andere documenten')} — de hele keuring wordt verwijderd`,
    runLive: 'loopt nog — wordt eerst gestopt',
    acknowledge: 'Ik begrijp dat de handmatig beoordeelde oordelen verloren gaan',
    confirm: {
      specification: (runs) =>
        runs > 0 ? `Norm en ${runs} ${n(runs, 'keuring', 'keuringen')} verwijderen` : 'Norm verwijderen',
      specVersion: (runs) =>
        runs > 0 ? `Versie en ${runs} ${n(runs, 'keuring', 'keuringen')} verwijderen` : 'Versie verwijderen',
      document: (runs) =>
        runs > 0 ? `Document en ${runs} ${n(runs, 'keuring', 'keuringen')} verwijderen` : 'Document verwijderen',
      documentVersion: (runs) =>
        runs > 0 ? `Versie en ${runs} ${n(runs, 'keuring', 'keuringen')} verwijderen` : 'Versie verwijderen',
    },
    deleting: 'Verwijderen…',
    done: (title, runs) =>
      runs > 0
        ? `“${title}” en ${runs} ${n(runs, 'documentkeuring', 'documentkeuringen')} verwijderd`
        : `“${title}” verwijderd`,
  },

  notFound: {
    title: 'Pagina niet gevonden',
    desc: 'Deze route bestaat niet. Gebruik de navigatie links.',
    toLibrary: 'Naar documenten',
  },

  tour: {
    sidebar: 'Aan de slag',
    sidebarTitle: (done, total) =>
      `Eerste analyse: ${done} van ${total} verplichte ${n(total, 'stap', 'stappen')} gedaan`,
    sidebarComplete: 'Alles wat een analyse nodig heeft, is ingesteld',
    checklistTitle: 'Eerste analyse',
    checklistIntro:
      'Wat er klaar moet staan voordat u het eerste document aan een norm kunt toetsen. De vinkjes volgen vanzelf uit uw gegevens; alleen optionele stappen kunt u zelf afvinken.',
    progress: (done, total) => `${done} van ${total} verplichte ${n(total, 'stap', 'stappen')} gedaan`,
    groupSetup: 'Eenmalig per norm',
    groupPerDocument: 'Voor elk document',
    stateDone: 'Gedaan',
    stateCurrent: 'Volgende',
    statePending: 'Nog niet',
    optional: 'optioneel',
    showMe: 'Laat zien',
    startTour: 'Rondleiding starten',
    restartTour: 'Rondleiding opnieuw volgen',
    openChecklist: 'Stappenlijst openen',
    allDone:
      'Alles wat verplicht is, staat klaar. Voortaan: importeer een nieuw document en start een auditrun wanneer u een toetsing nodig hebt.',
    markDone: 'Markeren als gedaan',
    markUndone: 'Nog niet gedaan',
    dialogLabel: 'Rondleiding',
    stepCounter: (index, total) => `Stap ${index} van ${total}`,
    announce: (index, total, title) => `Stap ${index} van ${total}: ${title}`,
    back: 'Vorige',
    next: 'Volgende',
    finish: 'Klaar',
    skip: 'Rondleiding overslaan',
    close: 'Rondleiding sluiten',
    lookFor: 'Zoek naar',
    seeking: 'Wordt op het scherm gezocht…',
    missingTitle: 'Nog niet op dit scherm',
    missingBody: 'Dit deel van het scherm verschijnt pas als er iets te tonen is.',
    firstDo: (title) => `Eerst: ${title}`,
    goToStep: 'Naar die stap',
    retry: 'Opnieuw tonen',
    doneNote: 'Al gedaan — de stap blijft staan ter naslag.',
    keysHint: '← → tussen stappen · Esc sluit',
    offerTitle: 'Voor het eerst hier?',
    offerBody:
      'Er is nog niets ingesteld. Een korte rondleiding toont de schermen en de instellingen die de eerste documentanalyse nodig heeft — ongeveer twee minuten.',
    offerStart: 'Rondleiding starten',
    offerLater: 'Later',
    settingsTitle: 'Aan de slag',
    settingsHint:
      'Een rondleiding langs de schermen: alles wat de eerste documentanalyse nodig heeft, op volgorde.',
    steps: {
      language: {
        title: 'Taal van de interface en de resultaten',
        why: 'De interfacetaal is alleen voor u. De taal van de resultaten bepaalt in welke taal het model zijn conclusies schrijft; citaten blijven altijd in de oorspronkelijke taal.',
        action: 'Kies hier een taal. De taal van de resultaten is een aparte kaart verderop in Instellingen.',
      },
      apiKey: {
        title: 'API-sleutel van een provider',
        why: 'Elke stap van de analyse is een aanroep van een taalmodel. Standaard loopt alles via OpenRouter — één sleutel voor modellen van veel leveranciers; Anthropic levert Claude rechtstreeks.',
        action: 'Plak de sleutel en sla hem op. Het besturingssysteem versleutelt hem en hij wordt nooit meer getoond; de test verbruikt geen tokens.',
      },
      routing: {
        title: 'Modellen per stap',
        why: 'De standaardmodellen werken al, allemaal via OpenRouter: Sonnet 5.5 bouwt het register, Haiku 4.5 profileert documenten, Opus 5.5 toetst en controleert. Wijzig ze alleen om te besparen of om een ander model te proberen.',
        action: 'Met een OpenRouter-sleutel kiest u hier ook modellen van andere leveranciers. Met de herstelknop krijgt u de standaardtabel terug.',
      },
      importSpec: {
        title: 'Norm importeren',
        why: 'De klantnorm — bijvoorbeeld de Tesco Ornamental Plant Standard — is waaraan uw documenten worden getoetst.',
        action: 'Importeer de PDF hier of sleep hem op de pagina. Code en versie worden uit de bestandsnaam gehaald.',
      },
      cloudAllowed: {
        title: 'Cloudproviders toestaan voor de norm',
        why: 'Standaard verlaat een klantnorm deze computer nooit, dus weigert elke cloudstap te werken. Dit is de meest voorkomende reden dat „niets werkt”.',
        action: 'Zet de schakelaar aan op de kaart van de norm — of laat hem uit en stel een lokaal model in.',
      },
      extractClauses: {
        title: 'Eisen extraheren',
        why: 'Het model leest de norm pagina voor pagina en bouwt een register van genummerde eisen. De hele toetsing gaat daarna eis voor eis.',
        action: 'Klik op de knop en wacht: zo’n 180 eisen kosten een paar minuten. De voortgang ziet u per pagina.',
      },
      reviewClauses: {
        title: 'Eisenregister controleren',
        why: 'Is het register fout, dan is elk resultaat daarna ook fout — en dat ziet u er niet meer aan af. Daarom blijven auditruns geblokkeerd tot het register gecontroleerd is.',
        action: 'J / K om te bladeren, Enter om te bevestigen, F om te markeren. Begin met de gemarkeerde eisen. Is de teller vol, markeer het register dan als gecontroleerd.',
      },
      siteProfile: {
        title: 'Locatieprofiel',
        why: 'Modules en certificaten van de locatie schrappen de eisen die niet van toepassing zijn. Zonder profiel wordt elke eis getoetst, ook duidelijk irrelevante.',
        action: 'Maak een profiel aan en herbereken daarna de toepasselijkheid voor de norm.',
      },
      importDocument: {
        title: 'Uw document importeren',
        why: 'Uw SOP, beleid of werkinstructie — wat er getoetst wordt. Nummer en versie worden uit de kop gehaald.',
        action: 'Importeer het bestand of sleep het op de pagina. Hetzelfde bestand nogmaals importeren maakt niets nieuws aan.',
      },
      startRun: {
        title: 'Een auditrun starten',
        why: 'Een auditrun toetst de gekozen documenten aan één versie van de norm. De schatting toont de kosten voordat er iets wordt uitgegeven.',
        action: 'Maak een keuring aan: kies de norm en uw document, schat de kosten en start.',
      },
      readResults: {
        title: 'De resultaten lezen',
        why: 'Eén document dekt nooit de hele norm, dus krijgen de meeste eisen „Niet behandeld”. Dat is normaal en geen overtreding.',
        action: 'Kies in het oordeelfilter „Niet-conform” en „Gedeeltelijk” — dan verdwijnt „Niet behandeld”. Open daarna een bevinding om het citaat te zien waarop het oordeel rust.',
      },
    },
  },
};
