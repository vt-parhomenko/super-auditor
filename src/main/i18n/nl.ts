/**
 * Нідерландський каталог main-процесу. Форма перевіряється типом `MainMessages`.
 *
 * Термінологія — та сама, що в каталозі renderer (`renderer/src/i18n/nl.ts`),
 * аудиторська, як у нідерландських QA-відділах: специфікація/стандарт → norm,
 * вимога → eis, finding → bevinding, невідповідність → afwijking, прогалина →
 * hiaat, профіль виробництва → locatieprofiel, вердикт → oordeel, критик →
 * criticus, вичитка реєстру → controle. Градації стандарту (Critical / Major /
 * Minor / Recommendation) лишаються англійськими — як і в інтерфейсі.
 */

import type { MainMessages } from './en';

const pr = new Intl.PluralRules('nl');

/** Нідерландська, як і англійська, має дві форми. */
function n(count: number, one: string, other: string): string {
  return pr.select(count) === 'one' ? one : other;
}

const KEY_RESET: Readonly<Record<string, string>> = {
  daily: ' (wordt dagelijks gereset)',
  weekly: ' (wordt wekelijks gereset)',
  monthly: ' (wordt maandelijks gereset)',
};

export const nl: MainMessages = {
  results: {
    noConclusion: 'Het model heeft voor deze eis geen conclusie gegeven.',
    unverifiedEvidence: '[bewijs niet bevestigd in de documenttekst]',
    criticDisagreed: '[criticus niet akkoord]',
    outOfScope:
      'Het document heeft geen betrekking op deze sectie van de norm. Dit is bepaald bij het ' +
      'profileren van het document, zonder de eistekst naar het model te sturen.',
  },

  export: {
    title: (runId) => `Auditrapport — run ${runId}`,
    summary: 'Samenvatting',
    applicable: (count) => `Van toepassing zijnde eisen: ${count}`,
    assessed: (count) => `Beoordeeld: ${count}`,
    gaps: (count) => `Hiaten: ${count}`,
    cost: (usd) => `Kosten: ${usd}`,
    colVerdict: 'Oordeel',
    colCount: 'Aantal',
    nonConformities: 'Afwijkingen',
    verdictLabel: 'Oordeel',
    gapLabel: 'Wat ontbreekt',
    recommendationLabel: 'Aanbeveling',
    page: (page) => `blz. ${page}`,
    gapsTitle: 'Hiaten — eisen zonder enig bewijs',
    colClause: 'Eis',
    colSection: 'Sectie',
    colTopic: 'Onderwerp',
    verdicts: {
      compliant: 'Conform',
      partial: 'Gedeeltelijk conform',
      non_compliant: 'Niet-conform',
      not_applicable: 'Niet van toepassing',
      not_addressed: 'Niet behandeld',
      needs_human_review: 'Handmatige beoordeling nodig',
    },
    // Градації — терміни самої норми; інтерфейс теж лишає їх англійськими.
    severities: {
      critical: 'Critical',
      major: 'Major',
      minor: 'Minor',
      recommendation: 'Recommendation',
    },
  },

  run: {
    tasksNotCompleted: (count) => `${count} ${n(count, 'taak', 'taken')} niet uitgevoerd`,
    allTasksFailed: (count, first) =>
      `Geen van de ${count} ${n(count, 'taak', 'taken')} is uitgevoerd. Eerste fout: ${first}`,
    partial: (count) =>
      `Gedeeltelijk voltooid: ${count} ${n(count, 'taak', 'taken')} niet uitgevoerd`,
    unknownCause: 'oorzaak onbekend',
    crashed: (runId, message) => `Run ${runId} is mislukt: ${message}`,
    notFound: (runId) => `Run ${runId} niet gevonden`,
    specVersionNotFound: (specVersionId) => `Normversie ${specVersionId} niet gevonden`,
    noDocuments: 'Geen documenten geselecteerd',
    emptyRegistry: 'Het eisenregister is leeg — stel het eerst op (Stage 1)',
    noExtraction: (documentVersionId) =>
      `Documentversie ${documentVersionId} heeft geen geëxtraheerde tekst`,
    scopeFallback: (count) =>
      `De controle kon voor ${count} ${n(count, 'document', 'documenten')} niet worden afgebakend. ` +
      `${n(count, 'Dit document wordt', 'Deze documenten worden')} getoetst aan de volledige norm.`,
  },

  clauses: {
    failedPages: (count) =>
      `${count} ${n(count, 'pagina kon', 'pagina’s konden')} niet worden verwerkt. Het eisenregister is onvolledig.`,
    flagged: (count) =>
      `${count} ${n(count, 'eis is', 'eisen zijn')} gemarkeerd voor controle — controleer die eerst.`,
    noExtraction: 'Deze normversie heeft geen geëxtraheerde tekst',
    extractionMissing: 'De geëxtraheerde tekst van de norm is niet gevonden',
    allPagesFailed: (error) =>
      `Geen enkele pagina van de norm kon worden verwerkt, dus het eisenregister is ongewijzigd gebleven. Eerste fout: ${error}`,
    reviewedKept: (failed) =>
      `${failed} ${n(failed, 'pagina kon', 'pagina’s konden')} niet worden verwerkt. Het gecontroleerde eisenregister is ongewijzigd gebleven — ` +
      'los de oorzaak op en start de extractie opnieuw.',
  },

  llm: {
    insufficientCredit: (provider, topUpUrl, detail) =>
      `Het tegoed bij ${provider} is op. Vul het tegoed aan ${topUpUrl ? `op ${topUpUrl}` : `bij ${provider}`} ` +
      `en klik op “Hervatten” — de auditrun gaat verder waar hij is gestopt. (${detail})`,
    auth: (provider, detail) =>
      `${provider} heeft de API-sleutel geweigerd. Controleer de sleutel in Instellingen. (${detail})`,
    notConfigured: (provider) =>
      `${provider} is niet geconfigureerd: er is geen API-sleutel of endpoint. Voeg die toe in Instellingen.`,
    cloudBlockedLocalOnly: (provider) =>
      `In Instellingen staat “Alleen lokale modellen” aan, dus de cloudprovider ${provider} kan niet worden gebruikt.`,
    cloudBlockedSpec: (provider) =>
      `Deze norm mag deze computer niet verlaten, dus de cloudprovider ${provider} kan niet worden gebruikt. ` +
      'Zet “Cloudproviders toestaan” aan bij de norm, of wijs de stap toe aan een lokaal model.',
    cloudBlocked: (provider) =>
      `De cloudprovider ${provider} is hier niet toegestaan: in Instellingen staat “Alleen lokale modellen” aan, ` +
      'of de norm staat geen cloudproviders toe.',
    rateLimit: (provider) =>
      `${provider} beperkt het aantal verzoeken — probeer het over een minuut opnieuw.`,
    transport: (provider, detail) =>
      `Geen verbinding met ${provider}: controleer het netwerk, de proxy of de firewall. (${detail})`,
    modelNotFound: (provider, detail) =>
      `${provider} kent dit model niet — controleer de model-id in Instellingen → Modelroutering per stap. (${detail})`,
    unsupported: (provider, detail) =>
      `Het gekozen model bij ${provider} kan niet wat deze stap nodig heeft — kies een ander model in ` +
      `Instellingen → Modelroutering per stap. (${detail})`,
    noRoutedEndpoint: (provider, detail) =>
      `${provider} heeft voor dit model geen endpoint dat uw gegevens niet verzamelt en gestructureerde ` +
      'antwoorden geeft. Kies een ander model in Instellingen → Modelroutering per stap, of sta het model toe ' +
      `in de privacy-instellingen van ${provider}. (${detail})`,
    refusal: 'Het model weigerde te antwoorden.',
    schema: (detail) => `Het antwoord van het model had niet de verwachte structuur. (${detail})`,
    aborted: 'Geannuleerd.',
  },

  ipc: {
    entities: {
      run: 'Run',
      specification: 'Norm',
      specVersion: 'Normversie',
      clause: 'Eis',
      siteProfile: 'Locatieprofiel',
      document: 'Document',
      documentVersion: 'Documentversie',
      finding: 'Bevinding',
      blob: 'Blob',
      blobFile: 'Blobbestand',
      provider: 'Provider',
    },
    notFound: (what) => `${what} niet gevonden`,
    invalidId: (label, value) => `${label} moet een positief geheel getal zijn, ontvangen: ${value}`,
    integrity: (code) =>
      `Deze actie is in strijd met de gegevensintegriteit (${code}) — het record wordt mogelijk elders al gebruikt`,
    orchestratorMissing:
      'De orchestrator voor auditruns is niet aangesloten — auditruns zijn in deze build niet beschikbaar',
  },

  documents: {
    usedInRuns: (count) =>
      `Het document wordt gebruikt in ${count} ${n(count, 'auditrun', 'auditruns')} — verwijder die eerst`,
  },

  clauseEditing: {
    numberEmpty: 'Het eisnummer mag niet leeg zijn',
    textEmpty: 'De eistekst mag niet leeg zijn',
    specNoExtraction:
      'Deze normversie heeft geen geëxtraheerde tekst — importeer het bestand eerst opnieuw',
    registryEmpty: 'Het eisenregister is leeg — er is niets om als gecontroleerd te markeren',
    registryNotReviewed: (unconfirmed, flagged) =>
      `Het eisenregister is niet volledig gecontroleerd: ${unconfirmed} niet bevestigd, ${flagged} gemarkeerd`,
  },

  docProfiles: {
    noExtraction:
      'Deze documentversie heeft geen geëxtraheerde tekst — er is niets om een profiel van te maken',
  },

  findings: {
    emptyQuery: 'Lege zoekopdracht voor bevindingen',
  },

  exporting: {
    unknownFormat: (format) => `Onbekend exportformaat: ${format}`,
    notImplemented: (format) =>
      `Export naar ${format} is nog niet beschikbaar — daarvoor is een aparte bibliotheek nodig. Beschikbare formaten: JSON, Markdown.`,
  },

  importing: {
    unknownKind: (kind) => `Onbekend importtype: ${kind}`,
    noFiles: 'Er zijn geen bestanden om te importeren',
    noTarget: 'Het importdoel ontbreekt: een document of een norm',
    invalidBlobHash: 'Ongeldige blob-hash: 64 hexadecimale tekens verwacht',
    blobOutsideStorage: 'Het blobpad wijst naar een locatie buiten de opslagmap',
    dialogTitleDocuments: 'Documenten importeren',
    dialogTitleSpecification: 'Norm importeren',
    dialogButton: 'Importeren',
    filterDocuments: 'Documenten (PDF, DOCX)',
    filterAll: 'Alle bestanden',
    failedToast: (failed, total) =>
      `${failed} van ${total} ${n(total, 'bestand', 'bestanden')} ${n(failed, 'kon', 'konden')} niet worden geïmporteerd`,
    unsupportedFormat: (mime) =>
      `Het formaat “${mime}” wordt niet ondersteund. Alleen PDF en DOCX kunnen worden geïmporteerd — converteer andere bestanden eerst.`,
    ocrNotConfigured:
      'Het document lijkt een scan en er is geen OCR ingesteld. Importeer een versie met een tekstlaag.',
    fileNotFound: 'Het bestand is niet gevonden — mogelijk is het verplaatst of verwijderd',
  },

  runs: {
    emptyConfig: 'De configuratie van de auditrun is leeg',
    registryNotReviewed:
      'Het eisenregister is nog niet gecontroleerd — auditruns zijn geblokkeerd tot Stage 1 is bevestigd',
    noDocuments: 'Er zijn geen documenten geselecteerd voor de auditrun',
    siteProfileMissing: (siteProfileId) => `Locatieprofiel ${siteProfileId} niet gevonden`,
  },

  sites: {
    nameEmpty: 'De naam van het locatieprofiel mag niet leeg zijn',
    noClauses: 'Deze normversie heeft nog geen eisen — stel eerst het eisenregister op (Stage 1)',
    overrideReasonRequired: 'Een reden voor de handmatige aanpassing is verplicht',
  },

  settings: {
    emptyPatch: 'De wijziging van de instellingen is leeg',
    unknownTheme: (value) => `Onbekend thema: ${value}`,
    concurrencyNotNumber: 'concurrency moet een getal zijn',
    localOnlyNotBoolean: 'localOnly moet true of false zijn',
    invalidResultsLanguage: (value) =>
      `Niet-ondersteunde taal voor resultaten: ${value}. Verwacht: en, nl, uk, of leeg voor de taal van de norm`,
    invalidUiLanguage: (value) =>
      `Niet-ondersteunde interfacetaal: ${value}. Verwacht: en, nl of uk`,
  },

  secrets: {
    encryptionUnavailable:
      'De wachtwoordopslag van het systeem (safeStorage) is niet beschikbaar, dus de API-sleutel is niet ' +
      'opgeslagen — anders zou hij als platte tekst op de schijf staan. Installeer op Linux gnome-keyring ' +
      'of KWallet; controleer op Windows en macOS het gebruikersprofiel.',
  },

  providers: {
    idMissing: 'Geen provider opgegeven',
    keyEmpty: 'De API-sleutel mag niet leeg zijn',
    managementKeyEmpty: 'De management-sleutel mag niet leeg zijn',
    managementKeyUnsupported: (provider) => `${provider} gebruikt geen management-sleutel`,
    notConfigured: (provider) =>
      `${provider} is niet geconfigureerd: er is geen API-sleutel of endpoint`,
    networkCheckDisabled:
      'De netwerkcontrole staat uit — alleen de aanwezigheid van de sleutel is gecontroleerd',
    probeNotImplemented: (provider) =>
      `${provider} is geconfigureerd; een netwerkcontrole is hiervoor niet beschikbaar`,
    keyNotFound: (provider) => `Geen sleutel voor ${provider} gevonden in de beveiligde opslag`,
    connectionOk: (provider) => `De verbinding met ${provider} werkt`,
    connectionOkWithModel: (provider, model) =>
      `De verbinding met ${provider} werkt; model ${model} is beschikbaar`,
    keyValid: (provider, label) => `De sleutel van ${provider} is geldig${label ? ` (“${label}”)` : ''}.`,
    keyUsage: (usd) => `Uitgegeven met deze sleutel: ${usd}.`,
    keyLimit: (limit, remaining, reset) =>
      `Limiet van de sleutel: ${limit}${remaining === null ? '' : `, nog ${remaining} over`}${KEY_RESET[reset ?? ''] ?? ''}.`,
    noKeyLimit: 'Er is geen limiet voor de sleutel ingesteld.',
    freeTier: 'Gratis niveau: alleen gratis modellen zijn beschikbaar, met gebruikslimieten.',
    keyRejected:
      'De API-sleutel is geweigerd (401): controleer of hij volledig is gekopieerd en niet is ingetrokken',
    permissionDenied:
      'Toegang geweigerd (403): de sleutel is uitgeschakeld of heeft geen toegang tot deze API',
    rateLimited:
      'De sleutel is geldig, maar de limiet voor verzoeken is bereikt (429) — probeer het over een minuut opnieuw',
    noConnection: (host) =>
      `Geen verbinding met ${host}: controleer het netwerk, de proxy of de firewall`,
    httpError: (provider, status, message) =>
      `${provider} gaf een fout terug${status === null ? '' : ` (HTTP ${status})`}: ${message}`,
  },

  app: {
    internalError: (message) => `Interne fout: ${message}`,
  },

  preload: {
    unknownEvent: (event) => `Onbekend gebeurteniskanaal: ${event}`,
  },
};
