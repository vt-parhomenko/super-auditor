/** Український каталог. Форма перевіряється типом `Messages` з англійського каталогу. */

import type { Messages } from './en';

const pr = new Intl.PluralRules('uk');

/** Українська має форми one / few / many — вибір віддаємо Intl, а не власній арифметиці. */
function n(count: number, one: string, few: string, many: string): string {
  const form = pr.select(count);
  if (form === 'one') return one;
  if (form === 'few') return few;
  return many;
}

export const uk: Messages = {
  common: {
    cancel: 'Скасувати',
    save: 'Зберегти',
    saving: 'Збереження…',
    delete: 'Видалити',
    close: 'Закрити',
    retry: 'Спробувати ще раз',
    empty: 'Порожньо',
    loading: 'завантаження…',
  },

  nav: {
    library: 'Документи',
    specs: 'Специфікації',
    sites: 'Профілі виробництва',
    runs: 'Перевірки документів',
    settings: 'Налаштування',
    mainNav: 'Головна навігація',
    theme: 'Тема',
    themeGroup: 'Тема оформлення',
    themeLight: 'Світла тема',
    themeSystem: 'Як у системі',
    themeDark: 'Темна тема',
    runProgress: (runId, done, total) =>
      `Перевірка #${runId}: ${done} з ${total} ${n(total, 'завдання', 'завдань', 'завдань')}`,
    mockTitle: 'Дані підмінено фікстурами (?mock=1)',
  },

  labels: {
    verdict: {
      compliant: 'Відповідає',
      partial: 'Часткова',
      non_compliant: 'Не відповідає',
      not_applicable: 'Не застосовна',
      not_addressed: 'Не розглянуто',
      needs_human_review: 'Потрібна людина',
    },

    /** Короткі — для щільної таблиці findings; без англійських NC/N/A і двозначного «Немає». */
    verdictShort: {
      compliant: 'OK',
      partial: 'Частк.',
      non_compliant: 'Не відп.',
      not_applicable: 'Не заст.',
      not_addressed: 'Не розгл.',
      needs_human_review: 'Людина',
    },

    verdictHint: {
      compliant: 'Вимогу покрито доказами з документа.',
      partial: 'Покрито частково — частина вимоги без доказу.',
      non_compliant: 'Документ прямо суперечить вимозі або її не виконує.',
      not_applicable: 'Не стосується цього виробництва за профілем — вирішено правилами, не моделлю.',
      not_addressed: 'Жоден документ нічого не каже про цю вимогу. Це не порушення — документ просто про інше.',
      needs_human_review: 'Модель і критик не зійшлись або немає перевіреної цитати.',
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
      must: 'must — обовʼязково',
      should: 'should — очікувано',
      may: 'may — рекомендовано',
    },

    documentKind: {
      sop: 'SOP',
      policy: 'Політика',
      form: 'Форма',
      record: 'Запис',
      manual: 'Настанова',
      other: 'Інше',
    },

    runStatus: {
      queued: 'У черзі',
      running: 'Виконується',
      paused: 'Призупинено',
      done: 'Завершено',
      failed: 'Помилка',
      cancelled: 'Скасовано',
    },

    clauseReview: {
      auto: 'Не вичитано',
      confirmed: 'Підтверджено',
      edited: 'Відредаговано',
      flagged: 'Позначено',
    },

    clausesStatus: {
      pending: 'Реєстр не витягнуто',
      extracted: 'Витягнуто, потребує вичитки',
      reviewed: 'Вичитано',
    },

    stage: {
      clause_extract: 'Реєстр вимог',
      spec_summary: 'Конспект специфікації',
      doc_profile: 'Профіль документа',
      judge: 'Судження',
      critic: 'Критик',
    },

    stageHint: {
      clause_extract: 'Посторінковий розбір таблиці вимог. Потрібна точна модель.',
      spec_summary: 'Конспект + правила градації Critical/Major/Minor.',
      doc_profile: 'Один дешевий виклик на версію документа.',
      judge: 'Основна вартість перевірки: секція × документ.',
      critic: 'Перепровірка тільки compliant. Можна пропустити.',
    },

    /** Узгоджено з «глибиною роздумів» — так називається колонка в налаштуваннях. */
    effort: {
      low: 'низька',
      medium: 'середня',
      high: 'висока',
      xhigh: 'дуже висока',
      max: 'максимальна',
    },

    modelTier: {
      top: 'топ-клас',
      balanced: 'збалансована',
      budget: 'бюджетна',
    },
  },

  format: {
    intlLocale: 'uk-UA',
    hours: 'год',
    minutes: 'хв',
    seconds: 'с',
    bytes: 'Б',
    kilobytes: 'КБ',
    megabytes: 'МБ',
    gigabytes: 'ГБ',
  },

  states: {
    backendTitle: 'Модуль ще не підключено',
    backendDesc:
      'Обробник цього каналу IPC ще не реалізований у головному процесі. Інтерфейс готовий — дані з’являться щойно бекенд відповість.',
    mockHintLead: 'Щоб побачити екран із реалістичними даними, відкрийте застосунок з ',
    mockHintMid: ' в адресі або запустіть із ',
    mockHintTail: '.',
    unknownError: 'Невідома помилка',
    loadFailed: 'Не вдалося завантажити',
  },

  api: {
    backendNotReady: (channel) =>
      `Модуль ще не підключено: канал «${channel}» не зареєстровано в main-процесі.`,
    bridgeMissing: 'Міст window.api недоступний. Відкрийте застосунок в Electron або додайте ?mock=1.',
    channelFailed: (channel) => `Помилка каналу «${channel}»`,
  },

  table: {
    empty: 'Немає рядків',
    range: (from, to, total) => `${from}–${to} з ${total}`,
    prev: '← Попередні',
    next: 'Наступні →',
  },

  help: {
    more: 'Пояснення',
    about: (term) => `Що означає «${term}»?`,
  },

  badges: {
    verified: 'звірено',
    unverified: 'не звірено',
    verifiedHint: 'Цитату механічно знайдено у вихідному тексті документа',
    unverifiedHint: 'Цитату не знайдено у вихідному тексті — довіри немає',
    runStatusHint: {
      queued: 'Створено, чекає на старт.',
      running: 'Модель проходить завдання; findings з’являються в міру готовності.',
      paused: 'Призупинено — нічого не втрачено. «Продовжити» доробить із місця зупинки.',
      done: 'Завершено: усі завдання опрацьовано.',
      failed: 'Зупинилась з помилкою — причина на сторінці перевірки. Отримані до неї результати збережено.',
      cancelled: 'Зупинено вручну. Отримані до того результати збережено.',
    },
  },

  meters: {
    costTitle: (input, cached, share, output) =>
      `Вартість викликів моделей. Токени — вхідні: ${input}, з них із кешу: ${cached} (${share}%, тарифікуються дешевше) · вихідні: ${output}`,
    cacheShare: (share) => `${share}% кеш`,
    inShort: 'вх.',
    outShort: 'вих.',
  },

  heatmap: {
    section: 'Секція',
    sectionClauses: (count) => `${count} ${n(count, 'вимога', 'вимоги', 'вимог')}`,
    stateIssues: (count) => `${count} ${n(count, 'зауваження', 'зауваження', 'зауважень')}`,
    stateReview: (count) => `${count} на перевірку`,
    stateOk: 'Відповідає',
    stateNotCovered: 'Не охоплено',
    stateEmpty: 'Без findings',
    addressed: (addressed, total) => `${addressed} з ${total} ${n(total, 'вимоги', 'вимог', 'вимог')}`,
    cellTitle: (section, document) => `${section} — ${document}`,
    breakdown: (verdict, count) => `${verdict}: ${count}`,
    openHint: 'Клік — відкрити ці findings.',
    notCoveredHint:
      'Документ не говорить про цю секцію. Коли один документ перевіряють проти всього стандарту, це нормально.',
    docCovered: (covered, total) => `охоплює ${covered} з ${total} секцій`,
    docIssues: (count) =>
      count === 0 ? 'без зауважень' : `${count} ${n(count, 'зауваження', 'зауваження', 'зауважень')}`,
    hideUncovered: (count) => `Сховати секції, про які не говорить жоден документ (${count})`,
    howToTitle: 'Як читати матрицю',
    howToRows:
      'Рядки — секції стандарту, стовпці — ваші документи. Клітинка відповідає на питання: що цей документ каже про цю секцію?',
    howToStates:
      '«2 зауваження» — вимоги з вердиктом «частково» або «не відповідає»: відкрийте клітинку, щоб побачити, чого бракує. «На перевірку» — модель не впевнена або спрацював запобіжник, треба глянути очима. «Відповідає» — усі вимоги, яких документ стосується, виконано.',
    howToNotCovered:
      '«Не охоплено» — документ про цю секцію не говорить (її вимоги отримали вердикт «Не розглянуто»). Для одного документа це нормально, а не порушення: такі секції мають покривати інші документи (див. вкладку «Прогалини»).',
    howToSecond:
      'Другий рядок — скільки вимог секції документ справді стосується; смужка — як розподілились вердикти.',
    legendTitle: 'Кольори смужки:',
  },

  evidenceViewer: {
    title: 'Перегляд документа',
    pickQuote: 'Оберіть цитату ліворуч, щоб побачити її прив’язку до сторінки.',
    soon: 'незабаром',
    document: 'Документ',
    page: 'Сторінка',
    range: 'Діапазон',
    source: 'Джерело',
    sourceCitations: 'Citations API',
    sourceModel: 'цитата моделі',
    footnote: 'Тут з’явиться сторінка PDF із підсвіченою цитатою й переходом за кліком.',
  },

  tagInput: {
    remove: (value) => `Прибрати ${value}`,
  },

  library: {
    title: 'Документи',
    subtitle: 'SOP, політики, форми й записи, які перевіряються на відповідність специфікаціям.',
    picking: 'Вибір файлів…',
    import: '+ Імпортувати',
    importing: 'Імпортуємо…',
    dropLabel: 'Перетягніть сюди PDF або DOCX',
    dropHint:
      'Кожен файл стає новою версією документа. Дублікат за SHA-256 нової версії не створює.',
    searchPlaceholder: 'Пошук за назвою, номером, власником…',
    allKinds: 'Усі типи',
    documentsCount: (count) => `Документів: ${count}`,
    emptyTitle: 'Документів ще немає',
    emptyDesc: 'Імпортуйте перший SOP — далі можна буде перевірити його проти специфікації.',
    emptyAction: 'Імпортувати документи',
    importResult: (imported, duplicates, failed) =>
      `Імпортовано ${imported}, дублікатів ${duplicates}, помилок ${failed}`,
    dropPathUnavailable: (name) =>
      `Шлях до «${name}» недоступний із перетягування — скористайтесь кнопкою імпорту.`,
    dropUnreadable: 'Не вдалося прочитати перетягнуті файли.',
    dropSkipped: (count) =>
      `Пропущено ${n(count, 'файл', 'файли', 'файлів')} без доступного шляху: ${count}`,
    kindNotSet: 'тип не вказано',
    ownerNotSet: 'власник не вказаний',
    owner: (name) => `власник: ${name}`,
    versionsCount: (count) => `версій: ${count}`,
    latestVersion: (label) => ` · остання ${label}`,
    toggleVersions: 'Показати версії',
    metadata: 'Метадані',
    noVersions: 'Версій ще немає',
    pagesSuffix: 'стор.',
    importedAt: (when) => `Імпортовано ${when}`,
    effectiveFrom: (date) => `чинна з ${date}`,
    modalTitle: 'Метадані документа',
    fieldTitle: 'Назва',
    fieldDocNumber: 'Номер документа',
    fieldOwner: 'Власник процесу',
    ownerPlaceholder: 'напр. менеджер з якості',
    fieldKind: 'Тип',
    kindUnset: 'не вказано',
    versionsCallout:
      'Версії правляться імпортом нового файлу: кожен файл із новим SHA-256 стає новою версією.',
    versionHash:
      'Відбиток файлу (SHA-256). За ним застосунок упізнає той самий файл при повторному імпорті й не створює нову версію.',
  },

  specs: {
    title: 'Специфікації',
    subtitle:
      'Стандарти, проти яких перевіряються документи. Одна версія стандарту — один реєстр вимог.',
    import: '+ Імпортувати стандарт',
    dropLabel: 'Перетягніть PDF стандарту',
    dropHint: 'Після імпорту потрібно витягнути реєстр вимог і вичитати його вручну.',
    emptyTitle: 'Специфікацій немає',
    emptyDesc: 'Імпортуйте стандарт замовника — наприклад Tesco Ornamental Plant Standard.',
    importedVersions: (count) => `Імпортовано версій: ${count}`,
    issuerUnknown: 'видавець не вказаний',
    versionsCount: (count) => `версій: ${count}`,
    cloudAllowed: 'Дозволити хмарних провайдерів',
    cloudAllowedOn:
      'Повний текст стандарту та документів надсилатиметься зовнішньому API. Стандарт часто постачається «for use of the immediate recipient» — переконайтесь, що це прийнятно.',
    cloudAllowedOff:
      'Вміст оброблятиметься лише локальними моделями. Якість суджень нижча, зате нічого не залишає машину.',
    noVersions: 'Версій ще немає',
    effectiveFrom: (date) => `чинна з ${date}`,
    reviewedLabel: 'вичитано',
    reviewedRight: (done, total) => `${done} з ${total}`,
    registryEmpty: 'реєстр порожній',
    openRegistry: 'Реєстр вимог →',
    statusHint: {
      pending:
        'Реєстр вимог ще не витягнуто. Відкрийте його й запустіть витягування — без реєстру перевіряти документи проти цієї версії нема з чим.',
      extracted:
        'Модель витягла вимоги, але людина їх ще не перевірила. Відкрийте реєстр і вичитайте: доти аудит цієї версії не запуститься.',
      reviewed: 'Реєстр перевірено людиною — цю версію можна використовувати в перевірках документів.',
    },
  },

  sites: {
    title: 'Профілі виробництва',
    subtitle:
      'Модулі, сертифікати, продукти й процеси виробництва. Визначають, які вимоги застосовні.',
    newProfile: '+ Новий профіль',
    emptyTitle: 'Профілів немає',
    emptyDesc: 'Створіть перший профіль виробництва.',
    certificationsCount: (count) =>
      `${count} ${n(count, 'сертифікат', 'сертифікати', 'сертифікатів')}`,
    clausesCount: (count) => `${count} ${n(count, 'вимога', 'вимоги', 'вимог')}`,
    pickProfile: 'Оберіть профіль',
    fieldName: 'Назва профілю',
    namePlaceholder: 'Lisse — пакування цибулин',
    fieldModules: 'Модулі стандарту',
    modulesHint:
      'Вимоги з невідмічених модулів одразу отримують «Не застосовна» — до моделі вони не потрапляють.',
    modulesList: (modules) => `модулі ${modules}`,
    fieldCertifications: 'Сертифікати',
    certificationsPlaceholder: 'ISO14001, SMETA…',
    certificationsHint: 'ISO14001 знімає секцію Environment, SMETA/SIZA — Responsible Sourcing.',
    fieldProducts: 'Продукти',
    productsPlaceholder: 'Цибулини тюльпанів…',
    fieldProcesses: 'Процеси',
    processesPlaceholder: 'Приймання, Пакування…',
    fieldNotes: 'Нотатки',
    saveProfile: 'Зберегти профіль',
    confirmDelete: (name) => `Видалити профіль «${name}»?`,
    recomputeTitle: 'Застосовність вимог для цього профілю',
    noSpecs: 'специфікацій немає',
    recomputing: 'Рахуємо…',
    recompute: 'Перерахувати',
    saveFirst: 'Спершу збережіть профіль',
    resultApplicable: 'застосовно',
    resultOf: 'з',
    resultOutOfScope: (count) => ` · поза профілем ${count}`,
    resultExplain: (applicable, notApplicable) =>
      `У перевірках із цим профілем модель перевірятиме ${applicable} ${n(applicable, 'вимогу', 'вимоги', 'вимог')}; ще ${notApplicable} одразу отримають «Не застосовна» без виклику моделі.`,
    recomputeHint:
      'Розрахунок детермінований — без AI. Кожен виняток можна перевизначити вручну на екрані реєстру.',
  },

  runs: {
    title: 'Перевірки документів',
    subtitle: 'Часткові результати пишуться в БД одразу — перервану перевірку можна відновити.',
    newRun: '+ Нова перевірка',
    colLabel: 'Назва',
    unnamed: 'без назви',
    colStatus: 'Статус',
    colDocs: 'Документів',
    colModel: 'Модель',
    colModelHint:
      'Модель, яка виносила вердикти (етап судження). Наведіть на рядок, щоб побачити й модель критика.',
    modelTitle: (judge, critic) =>
      `судження: ${judge}${critic ? ` · критик: ${critic}` : ' · без критика'}`,
    colStarted: 'Старт',
    colDuration: 'Тривалість',
    colDurationHint:
      'Від старту до завершення. Для незавершеної перевірки — до цієї миті, разом із паузами.',
    colCost: 'Вартість',
    colCostHint:
      'Скільки фактично коштували виклики моделей у цій перевірці, у доларах США. Наведіть на рядок — побачите кількість токенів.',
    colActions: 'Дії',
    costTitle: (input, output) => `вхід ${input} / вихід ${output}`,
    runTitle: (runId) => `Перевірка #${runId}`,
    preparing: 'підготовка',
    running: 'виконується',
    progressRight: (done, total, failed) =>
      `${done} з ${total} ${n(total, 'завдання', 'завдань', 'завдань')}${failed ? ` · збоїв ${failed}` : ''}`,
    pause: '⏸ Пауза',
    resume: '▶ Продовжити',
    cancel: '✕ Скасувати',
    openDetails: 'Відкрити деталі →',
    emptyTitle: 'Перевірок ще не було',
    emptyDesc:
      'Оберіть вичитану версію специфікації, профіль виробництва й документи — і запустіть перший аудит.',
    emptyAction: 'Створити перевірку',
    tableLabel: 'Перевірки документів',
    modalTitle: 'Нова перевірка документів',
    estimating: 'Оцінюємо…',
    estimate: 'Оцінити вартість',
    starting: 'Запуск…',
    start: 'Запустити',
    blockedTitle: 'Реєстр вимог цієї версії не вичитаний',
    fieldLabel: "Назва перевірки (необов'язково)",
    labelPlaceholder: 'Tesco v5.0 × 3 SOP',
    fieldSpecVersion: 'Версія специфікації',
    noSpecs: 'специфікацій немає',
    specReviewed: (reviewed, total) => `— вичитано ${reviewed}/${total}`,
    specReadyHint:
      '✔ — реєстр вимог цієї версії вичитано. Версію без ✔ не можна використати в аудиті, доки реєстр не вичитають.',
    fieldSite: 'Профіль виробництва',
    noSite: 'без профілю — усі вимоги застосовні',
    blockedCallout:
      'Реєстр вимог цієї версії ще не вичитаний. Перевірку заблоковано: криві вимоги роблять безглуздими всі подальші findings.',
    fieldDocuments: (selected) => `Документи (${selected} обрано)`,
    documentsHint: 'Кожен рядок — окрема версія документа; зазвичай потрібна остання.',
    latestTag: 'остання',
    libraryEmpty: 'Документів ще немає',
    selectAll: 'Обрати всі',
    clearSelection: 'Зняти',
    skipCritic: 'Пропустити прохід критика',
    skipCriticHint:
      'Критик — другий прохід, який перепровіряє вердикти «Відповідає». Без нього швидше й дешевше, але зростає ризик пропущеної невідповідності — а це найдорожча помилка.',
    estimateTasks: 'Завдань',
    estimateTasksHint:
      'Одне завдання — один виклик моделі, що оцінює одну секцію стандарту проти одного документа. Секції, про які документ не говорить, закриваються без виклику.',
    estimateInput: 'Вхідних токенів',
    estimateInputHint:
      'Приблизний обсяг тексту, який прочитає модель: вимоги секції плюс документ, для кожного завдання. 1k — тисяча, 1M — мільйон токенів.',
    estimateCost: 'Оцінка вартості',
    estimateCostSub: 'без знижки за кеш — фактично зазвичай менше',
    estimateModel: (model) => `За цінами ${model}`,
    estimatePriceUnknown: 'ціна невідома',
    estimatePriceUnknownSub: 'у каталозі немає ціни цієї моделі',

    modelOverrideTitle: 'Модель аналізу',
    modelOverrideGroup: 'Яка модель аналізує документи в цій перевірці',
    modelOverrideSettings: 'Як у налаштуваннях',
    modelOverrideCustom: 'Обрати для цієї перевірки',
    modelOverrideCurrent: (judge, critic) => `Судження: ${judge} · критик: ${critic}`,
    modelOverrideDefault: 'вбудована типова модель',
    modelOverrideHint:
      'Діє лише на судження й критика цієї перевірки. Налаштування не змінюються.',
  },

  runDetail: {
    tabCoverage: 'Матриця покриття',
    tabFindings: 'Findings',
    tabGaps: 'Прогалини',
    tabSummary: 'Підсумок',
    tabHint: {
      coverage: 'Секції стандарту × документи: що кожен документ каже про кожну секцію.',
      findings: 'Рядок на кожну пару «вимога × документ»: вердикт, цитати-докази й обґрунтування.',
      gaps: 'Застосовні вимоги, яких не покриває жоден документ перевірки.',
      summary: 'Лічильники вердиктів і критичності, витрати й моделі перевірки.',
    },
    notFound: (runId) => `Перевірку #${runId} не знайдено`,
    reviewMode: "Режим рев'ю",
    exportPlaceholder: 'Експорт…',
    exportSaved: (path) => `Збережено: ${path}`,
  },

  coverage: {
    emptyTitle: 'Матриця порожня',
    emptyDesc: 'Перевірка ще не дала жодного finding. Дочекайтесь завершення етапу судження.',
    hint: 'Клік по клітинці відкриває findings цієї секції в цьому документі.',
  },

  findings: {
    searchPlaceholder: 'Пошук у тексті обґрунтування…',
    allSections: 'усі секції',
    allDocuments: 'усі документи',
    unreviewedOnly: 'тільки неопрацьовані',
    reset: 'Скинути',
    emptyTitle: 'Нічого не знайдено',
    emptyDesc: 'Змініть фільтри або скиньте їх.',
    filterVerdict: 'Вердикт:',
    filterSeverity: 'Severity:',
    noiseHint:
      '«Не розглянуто» означає, що документ про цю вимогу не говорить, — це не порушення. Коли один документ перевіряють проти всього стандарту, таких вимог більшість.',
    noiseAction: 'Показати лише те, про що говорять документи',
    colClause: 'Вимога',
    colTopic: 'Тема',
    colDocument: 'Документ',
    colDocumentHint:
      'Якого документа стосується вердикт. «увесь набір» — зведений вердикт по всіх документах перевірки разом; з таких будуються прогалини.',
    aggregateDoc: 'увесь набір',
    colVerdict: 'Вердикт',
    colVerdictHint:
      'Вердикт моделі; наведіть на бейдж, щоб побачити, що він означає. Рішення людини, якщо воно є, — у колонці «Ревʼю».',
    colSeverity: 'Severity',
    colSeverityHint:
      'Наскільки серйозне зауваження за шкалою самого стандарту: Critical, Major, Minor, Recommendation. Для рядків «Не розглянуто» це лише потенційна оцінка — наскільки погано було б, якби вимогу не покрив жоден документ, — тому вона приглушена.',
    potentialSeverity: (severity) =>
      `Лише потенційно: так оцінювалося б, якби вимогу не покрив жоден документ, — ${severity}`,
    colConfidence: 'Впевн.',
    colConfidenceHint:
      'Наскільки модель упевнена у вердикті, 0–100 %. «—» — оцінки немає, напр. коли секцію закрито без виклику моделі, бо документ про неї не говорить.',
    colEvidence: 'Докази',
    colEvidenceHint:
      'Звірені цитати / усі цитати. Звірена — цитату дослівно знайдено в тексті документа; незвіреній цитаті довіряти не можна.',
    evidenceTitle: (verified, total) => `${verified} перевірених з ${total}`,
    colPages: 'Стор.',
    colPagesHint: 'Сторінка стандарту, де надрукована вимога. Клік відкриває PDF на ній.',
    colRationale: 'Обґрунтування',
    outsideEvidenceTag: 'на аудит',
    outsideEvidenceTitle: (text) =>
      `Перевірити поза документом — записами чи оглядом на місці; це для аудиту, а не зауваження до документа: ${text}`,
    colReview: 'Ревʼю',
    colReviewHint:
      'Рішення людини: «ok» — погодилась із моделлю; інший код — вердикт, який людина поставила замість модельного; «—» — ще не опрацьовано.',
    reviewAgreed: 'ok',
    tableLabel: 'Findings',
  },

  gaps: {
    colClause: 'Вимога',
    colSection: 'Секція',
    colTopic: 'Тема',
    colObligation: 'Обов.',
    colObligationHint:
      'Наскільки вимога обов’язкова за формулюванням стандарту: must — обов’язково, should — очікувано, may — рекомендовано.',
    colPages: 'Стор.',
    colSeverity: 'Якщо бракує',
    colSeverityHint:
      'Яку критичність отримає ця прогалина на аудиті, якщо доказу так і не буде.',
    colRequirement: 'Текст вимоги',
    emptyTitle: 'Прогалин немає',
    emptyDesc: 'Кожна застосовна вимога має принаймні один доказ у документах.',
    summaryLead: 'Застосовних вимог без жодного доказу: ',
    summaryTail: '. Кожен рядок — кандидат до плану коригувальних дій (CAP).',
    summaryNote:
      'Прогалини показують, чого бракує всьому набору документів. У перевірці з одним-двома документами їх закономірно багато — осмисленими вони стають, коли перевірено всі інструкції підприємства разом.',
    tableLabel: 'Прогалини',
  },

  summary: {
    coverage: 'Охоплення',
    clausesApplicable: 'Застосовних вимог',
    clausesApplicableSub: 'після фільтра застосовності',
    clausesApplicableHint:
      'Вимоги стандарту, які підлягали перевірці. Вимоги, позначені як незастосовні, сюди не входять.',
    assessed: 'Оцінено',
    assessedSub: (share) => `${share} застосовних`,
    assessedHint: 'Скільки застосовних вимог отримали вердикт у цій перевірці.',
    gaps: 'Прогалин',
    gapsSub: 'без жодного доказу',
    gapsHint: 'Застосовні вимоги, яких не покриває жоден документ перевірки. Список — на вкладці «Прогалини».',
    grade: 'Оцінка за шкалою',
    gradeSub: 'ще не рахується',
    gradeHint:
      'Рейтинг за шкалою градації самого стандарту (5 — найкраще), виведений із кількості Critical / Major / Minor. Показує «—», поки правила градації не розібрано.',
    verdicts: 'Вердикти',
    verdictsHint:
      'Кожен finding рахується один раз. Якщо людина ухвалила рішення, рахується її вердикт замість модельного.',
    notAddressedNote: 'Коли перевіряють один документ, сюди потрапляє більшість вимог стандарту.',
    severity: 'Severity',
    severityHint:
      'Рахуються лише вердикти «Часткова» й «Не відповідає», з урахуванням рішень людини. Critical / Major / Minor — рівні самого стандарту; Recommendation — порада, а не невідповідність.',
    spend: 'Витрати',
    runCost: 'Вартість перевірки',
    cacheLabel: 'частка вхідних токенів із кешу',
    input: 'Вхідні токени',
    cached: 'з них із кешу',
    output: 'Вихідні токени',
    cacheNote:
      'Кеш здешевлює повторне надсилання того самого тексту (стандарту, документа). Якщо на повторних перевірках частка кешу нульова, у незмінній частині запиту щось постійно змінюється — варто сказати розробнику.',
    models: 'Моделі',
    modelJudge: 'Судження',
    modelCritic: 'Критик',
    noCritic: 'пропущено',
  },

  clauseRegistry: {
    crumb: (versionLabel) => `Реєстр вимог · v${versionLabel}`,
    reviewTitle: 'Вичитка реєстру',
    reviewHint:
      'Перевірте, що кожну вимогу витягнуто правильно: номер і текст. Enter — підтвердити, F — позначити проблемною. Поки є вимоги без рішення або позначені, аудит цієї версії заблоковано. Найважливіший сигнал — пропуск у нумерації (10.1 → 10.4): це означає, що модель проґавила цілі вимоги.',
    progressLabel: (done, total) => `вичитано ${done} з ${total}`,
    progressRight: (pending, flagged) => `${pending} без рішення · ${flagged} позначено`,
    summaryBtn: 'Конспект і правила градації',
    summaryBtnTitle:
      'Короткий конспект стандарту і його правила градації Critical / Major / Minor — вони йдуть у кожне судження.',
    extractBtn: 'Витягнути реєстр (Stage 1)',
    extractTitle:
      'Stage 1: модель посторінково читає вимоги стандарту — таблицю чи нумерований текст — і заповнює реєстр. Сторінки змісту, вступу й глосарію пропускаються.',
    markReviewed: 'Позначити вичитаним',
    blockedTitle: (pending, flagged) =>
      `Залишилось ${pending} без рішення і ${flagged} позначених`,
    unlockTitle: 'Розблокувати запуск аудиту для цієї версії',
    markedReviewed: 'Реєстр позначено вичитаним',
    extractProgress: (page, pageCount) => `Екстракція: сторінка ${page} з ${pageCount}`,
    extractFound: (count) => `знайдено вимог: ${count}`,
    extractFailed: (message) => `Екстракція завершилась помилкою: ${message}`,
    searchPlaceholder: 'Пошук: номер, тема, текст вимоги…',
    filterAll: (count) => `Усі ${count}`,
    filterPending: (count) => `Без рішення ${count}`,
    filterFlagged: (count) => `Позначені ${count}`,
    filterPendingHint: 'Вимоги, які ще ніхто не підтвердив, не відредагував і не позначив.',
    filterFlaggedHint:
      'Вимоги, позначені проблемними — автоматичною перевіркою (напр. пропуск у нумерації) або людиною. Виправте їх і підтвердіть.',
    legendMarkers: 'Позначки стандарту:',
    legendMarkersHint:
      'Ці позначки друкує біля вимог сам стандарт; назви й пояснення — його власні слова.',
    markersUnexplained: 'розшифровку цих позначок у тексті стандарту не знайдено',
    legendStatus: 'Крапка — стан вичитки:',
    emptyRegistry: 'Реєстр порожній',
    emptyRegistryDesc: 'Запустіть екстракцію реєстру — вона посторінково читає вимоги стандарту.',
    emptySearch: 'Нічого не знайдено',
    emptySearchDesc: 'Спробуйте змінити фільтр або запит.',
    listLabel: 'Вимоги',
    hintNav: 'навігація',
    hintConfirm: 'підтвердити й далі',
    hintFlag: 'позначити проблемною',
    pickClause: 'Оберіть вимогу',
    pickClauseDesc: 'Список ліворуч, навігація J / K.',
    summaryModalTitle: 'Конспект специфікації',
    summaryEmptyTitle: 'Конспекту ще немає',
    summaryEmptyDesc: 'Він будується на Stage 1 разом із реєстром вимог.',
    summaryDescription: 'Опис',
    summaryScope: 'Scope',
    summaryGrading: 'Правила градації',
    summaryModelUnknown: 'модель невідома',
    fieldClauseNo: 'Номер вимоги',
    fieldTopic: 'Тема',
    fieldSection: 'Секція',
    fieldSectionTitle: 'Назва секції',
    fieldMarkers: 'Позначки стандарту',
    markersCheckboxHint: 'Позначте ті позначки, які стандарт друкує біля цієї вимоги.',
    markersInputHint: 'Коди так, як вони надруковані біля вимоги, через кому.',
    fieldObligation: "Обов'язковість",
    obligationUnset: 'не визначено',
    fieldRequirement: 'Текст вимоги',
    requirementHint:
      'Буліт-списки (`•`) мають лишатись списками: саме вони формують окремі перевірювані пункти.',
    pages: 'Сторінки',
    sortKey: 'Порядок сортування',
    sortKeyHint:
      'Виводиться з номера вимоги, щоб 10.2 стояла перед 10.10. Перераховується автоматично, коли змінюється номер.',
    textHash: 'Відбиток тексту',
    textHashHint:
      'SHA-256 тексту вимоги. Змінюється з кожною правкою тексту; за ним порівнюються версії стандарту.',
    confirm: '✔ Підтвердити',
    confirmTitle: 'Підтвердити вимогу як є й перейти до наступної (Enter)',
    saveEdits: '✎ Зберегти правки',
    saveEditsTitle: 'Зберегти правки й позначити вимогу як відредаговану',
    noChanges: 'Змін немає',
    flag: '⚑ Позначити',
    flagTitle:
      'Позначити вимогу проблемною (F). Аудит лишатиметься заблокованим, доки її не виправлять і не підтвердять.',
    unsaved: 'є незбережені правки',
  },

  findingDetail: {
    crumb: 'Finding',
    crumbClause: (clauseNo) => `Вимога ${clauseNo}`,
    notFound: (findingId) => `Finding #${findingId} не знайдено`,
    aggregate: 'зведений по набору',
    requirement: 'Вимога стандарту',
    requirementUnavailable: 'Текст вимоги недоступний.',
    section: (sectionNo, sectionTitle) => `секція ${sectionNo} · ${sectionTitle}`,
    document: (title) => `документ: ${title}`,
    confidence: (value) => `впевненість: ${value}`,
    rationale: 'Обґрунтування',
    gap: 'Прогалина',
    recommendation: 'Рекомендація',
    outsideEvidence: 'Перевірити поза документом',
    outsideEvidenceHint:
      'Що стандарт перевіряє записами чи оглядом на місці. Документ цього довести не може — це для аудиту, а не зауваження до документа.',
    markers: 'позначки стандарту:',
    markersHint:
      'Ці позначки друкує біля вимоги сам стандарт: вони кажуть, чим доводиться відповідність. Пояснення — його власні слова.',
    markerUnexplained: (code) => `${code} — стандарт цю позначку не пояснює`,
    prev: '← Попередній',
    next: 'Наступний →',
    position: (index, total) => `${index} з ${total}`,
    evidence: 'Докази',
    verifiedCount: (verified, total) => `звірено ${verified} з ${total}`,
    evidenceHint:
      'Цитати з документа, на яких тримається вердикт. «Звірено» — застосунок знайшов цитату дослівно в тексті документа. Вердикт «Відповідає» без жодної звіреної цитати автоматично понижується до «Потрібна людина».',
    sourceCitationsHint:
      'Повернуто через Citations API провайдера: цитату вирізано з тексту самого документа, тож модель не може її вигадати.',
    sourceModelHint:
      'Цитату написала сама модель; застосунок потім шукає її в тексті документа — звідси «звірено» чи «не звірено».',
    noEvidenceLead: 'Жодного доказу. Для вердикту ',
    noEvidenceTail: ' це очікувано лише тоді, коли вимога справді ніде не згадана.',
    pageShort: 'стор.',
    hintBetween: 'між findings',
    hintBack: 'до списку',
    treeTitle: 'Вимоги перевірки',
    treeHintLead: 'Значок і колір ліворуч — вердикт:',
    treeHintReviewed: 'Зелена крапка праворуч — finding уже опрацьовано людиною.',
    reviewedDot: 'опрацьовано',
    decisionTitle: 'Рішення людини',
    decisionUpdated: (when) => `оновлено ${when}`,
    decisionNote:
      'Вердикт моделі не перезаписується — ваш зберігається поруч. Кожна розбіжність стає прикладом для перевірки якості моделі (eval).',
    fieldHumanVerdict: 'Людський вердикт',
    agreeWithModel: 'погоджуюсь із моделлю',
    fieldSeverity: 'Severity',
    asModel: 'як у моделі',
    fieldNote: 'Нотатка',
    saveDecision: 'Зберегти рішення',
    decisionSaved: 'Рішення збережено',
    clearDecision: 'Прибрати рішення',
  },

  review: {
    crumb: "Режим рев'ю",
    allReviewed: 'Неопрацьованих findings не залишилось',
    rejectNote: 'відхилено вердикт моделі',
    emptyTitle: "Немає findings для рев'ю",
    emptyDesc: 'Ця перевірка ще не дала результатів.',
    confidence: (value) => `впевненість ${value}`,
    progressLabel: (done, total) => `опрацьовано ${done} з ${total}`,
    position: (index, total) => `поточний ${index} з ${total}`,
    howTo:
      'Пройдіть findings по черзі й скажіть, чи права модель. Ваше рішення зберігається окремо — вердикт моделі не перезаписується ніколи. «Опрацьовано» — скільки findings уже мають рішення.',
    whichVerdict: 'Який вердикт правильний?',
    cancelEsc: 'Скасувати (Esc)',
    accept: 'Прийняти',
    acceptTitle:
      'Вердикт моделі правильний (A). Він зберігається як ваше рішення, і відкривається наступний неопрацьований.',
    reject: 'Відхилити',
    rejectTitle: 'Вердикт моделі неправильний (R): оберіть правильний клавішами 1–6.',
    edit: 'Редагувати',
    editTitle: 'Змінити вердикт чи критичність або додати нотатку (E).',
    hintNav: 'навігація',
    hintNextUnreviewed: 'наступний неопрацьований',
    hintExit: 'вийти',
    requirement: 'Вимога стандарту',
    modelRationale: 'Обґрунтування моделі',
    gap: 'Прогалина',
    recommendation: 'Рекомендація',
    outsideEvidence: 'Перевірити поза документом',
    alreadyReviewed: 'Уже опрацьовано: ',
    agreedWithModel: 'погоджено з моделлю',
    evidence: 'Докази',
    noEvidence: 'Жодного доказу.',
    pageShort: 'стор.',
    fieldVerdict: 'Вердикт',
    agreeWithModel: 'погоджуюсь із моделлю',
    fieldSeverity: 'Severity',
    asModel: 'як у моделі',
    fieldNote: 'Нотатка',
    saveAndNext: 'Зберегти й далі',
  },

  settings: {
    title: 'Налаштування',
    subtitle: 'Маршрутизація моделей по етапах, конкурентність і доступ до провайдерів.',
    themeTitle: 'Тема оформлення',
    themeGroup: 'Тема',
    themeSystem: 'Як у системі',
    themeLight: 'Світла',
    themeDark: 'Темна',
    themeHint:
      'Вибір зберігається локально й застосовується миттєво, навіть якщо бекенд недоступний.',
    languageTitle: 'Мова інтерфейсу',
    languageGroup: 'Мова',
    languageSystem: 'Системна',
    languageHint:
      'Зберігається локально й застосовується миттєво. «Системна» бере мову ОС, а якщо вона не підтримується — англійську.',
    routingTitle: 'Маршрутизація моделей по етапах',
    routingHint:
      'Дорога модель потрібна там, де помилка коштує найдорожче: реєстр вимог і судження. Профілі документів можна віддати дешевій.',
    routingReset: 'Скинути до типових',
    routingResetTitle: 'Прибрати вибір для всіх етапів і повернутися до вбудованої маршрутизації',
    routingResetDone: 'Маршрутизацію скинуто до вбудованої',
    colStage: 'Етап',
    colProvider: 'Провайдер',
    colModel: 'Модель',
    colEffort: 'Глибина',
    colEffortHint:
      'Глибина роздумів (effort): скільки модель міркує перед відповіддю. Вища — ретельніше, але повільніше й дорожче (більше вихідних токенів). «—» — модель такого налаштування не має.',
    providerNone: 'немає',
    providerCloud: ' (хмара)',
    providerLocal: ' (локально)',
    providerNoKey: ' — без ключа',
    providerUnavailable: (id) => `${id} (недоступний)`,
    modelDefault: 'за замовчуванням',
    modelCustom: 'Інша модель…',
    modelCustomPlaceholder: 'розробник/id-моделі',
    modelNotListed: (id) => `${id} (немає в списку)`,
    vendorOther: 'Інші',
    ariaProvider: (stage) => `${stage}: провайдер`,
    ariaModel: (stage) => `${stage}: модель`,
    ariaCustomModel: (stage) => `${stage}: id моделі`,
    ariaEffort: (stage) => `${stage}: глибина роздумів`,
    effortUnset: 'Не задано: діє типове значення етапу.',
    effortUnsupported: 'Ця модель не має налаштування глибини роздумів.',
    effortStale: (effort) => `${effort} — ця модель не підтримує`,
    hintContext: (size) => `контекст ${size}`,
    hintPrice: (input, output) => `${input} вхід / ${output} вихід за 1M токенів`,
    hintCacheRead: (price) => `читання з кешу ${price}`,
    hintPriceUnknown: 'ціна невідома',
    hintNotInCatalogue: 'Немає в каталозі моделей — контекст і ціна невідомі.',
    hintDefault: 'Вбудована типова модель цього етапу.',
    hintIsDefault: 'типово',
    executionTitle: 'Виконання',
    fieldConcurrency: 'Конкурентність',
    concurrencyHint:
      'Скільки викликів моделі перевірка робить одночасно. Забагато — і провайдер почне відхиляти запити (помилка 429 «забагато запитів»).',
    localOnly: 'Тільки локальні моделі',
    localOnlyHint:
      'Забороняє відправку в хмару навіть тим специфікаціям, де це дозволено. Глобальний запобіжник поверх перемикача «Дозволити хмарних провайдерів» на картці специфікації.',
    providersTitle: 'Провайдери',
    chipCloud: 'хмарний',
    chipLocal: 'локальний',
    keySaved: 'ключ збережено',
    keyMissing: 'ключ не задано',
    modelsUnknown: 'моделі невідомі',
    newKeyPlaceholder: 'новий ключ (не показується)',
    keyPlaceholder: 'API-ключ',
    saveKey: 'Зберегти ключ',
    removeKey: 'Прибрати',
    keyHint:
      'Ключ шифрується через safeStorage у головному процесі й ніколи не повертається в інтерфейс.',
    modelsCount: (count) => `${count} ${n(count, 'модель', 'моделі', 'моделей')}`,
    modelsMore: (count) => `і ще ${count}`,
    catalogueUpdated: (when) => `список оновлено ${when}`,
    catalogueBuiltIn: 'вбудований список',
    refreshModels: 'Оновити список моделей',
    refreshingModels: 'Оновлюємо…',
    refreshModelsHint: 'Завантажує живий каталог моделей провайдера. Токенів не витрачає.',
    refreshModelsDone: (provider, count) =>
      `${provider}: у списку ${count} ${n(count, 'модель', 'моделі', 'моделей')}`,
    linkGetKey: 'Створити ключ',
    linkCredits: 'Кредити',
    linkBilling: 'Оплата',
    cloudHintOpenRouter:
      'OpenRouter пересилає документи розробнику обраної моделі (Anthropic, OpenAI, DeepSeek, Google…). Перемикач специфікації «Дозволити хмарних провайдерів» діє і на нього.',
    cloudHintDirect: (provider) =>
      `Документи йдуть в API ${provider}. Діє перемикач специфікації «Дозволити хмарних провайдерів».`,
    localHint: 'Працює на цьому комп’ютері: документи його не залишають.',
    resultsLanguageTitle: 'Мова результатів',
    resultsLanguageLabel: 'Писати висновки',
    resultsLanguageSpec: 'Мовою стандарту',
    resultsLanguageHint:
      'Діє лише на нові перевірки й лише на тексти висновків: обґрунтування, чого бракує, рекомендація.',
    resultsLanguageQuotes:
      'Цитати-докази завжди лишаються мовою оригіналу. Перекладена цитата не знайшлася б у документі при механічній перевірці, і кожен вердикт «відповідає» був би понижений до «потрібна людина».',

    spendTitle: 'Витрати застосунку',
    spendSubtitle: 'Скільки цей застосунок витратив на виклики моделей — за нашим власним обліком.',
    spendToday: 'Сьогодні',
    spendMonth: 'Цей місяць',
    spendTotal: 'Усього',
    spendEmptyTitle: 'Викликів ще не було',
    spendEmptyDesc: 'Цифри з’являться після першої перевірки, яка звернеться до моделі.',
    spendColStage: 'Етап',
    spendColModel: 'Модель',
    spendColCalls: 'Викликів',
    spendColCallsHint: 'Скільки запитів надіслано до API моделі.',
    spendColInput: 'Вхідні',
    spendColInputHint:
      'Вхідні токени — текст, надісланий моделі: інструкції, вимоги стандарту й ваші документи. 1k — тисяча, 1M — мільйон токенів.',
    spendColCached: 'З кешу',
    spendColCachedHint:
      'Частина вхідних токенів, яку провайдер узяв зі свого кешу промптів, — тарифікується значно дешевше. Уже входить у «Вхідні».',
    spendColOutput: 'Вихідні',
    spendColOutputHint:
      'Вихідні токени — текст, який написала модель, разом із її міркуваннями. За токен вони найдорожчі.',
    spendColCost: 'Вартість',
    spendColCostHint: 'У доларах США, за власним обліком застосунку по кожному виклику.',
    spendBalanceNote:
      'Ці суми — власний облік викликів моделей у застосунку, а не залишок на рахунку. У Anthropic немає ендпоінта залишку коштів, тож справжній баланс видно лише в консолі Anthropic. OpenRouter повідомляє свої цифри сам: щойно його ключ збережено, вони з’являються тут окремо.',
    spendOpenConsole: 'Відкрити консоль Anthropic',
    spendOpenOpenRouter: 'Кредити OpenRouter',
    spendCounted: 'Пораховано застосунком',
    spendReported: (provider) => `За даними ${provider}`,
    spendReportedHint:
      'Витрати API-ключа, збереженого в застосунку, як їх повідомляє провайдер, — разом із викликами цим самим ключем поза застосунком.',

    testing: 'Перевірка…',
    test: 'Перевірити',
    testOk: 'працює',
    testFail: 'помилка',
  },

  balance: {
    chipKeyRemaining: (amount) => `ліміт ${amount}`,
    chipKeyMonth: (amount) => `${amount} за місяць`,
    chipKeyTotal: (amount) => `витрачено ${amount}`,
    tipAccount: (provider, when) => `${provider}: залишок коштів на рахунку. Оновлено ${when}.`,
    tipKeyRemaining: (provider, when) =>
      `${provider}: залишок ліміту цього API-ключа — не баланс рахунку (для нього потрібен management-ключ у налаштуваннях). Оновлено ${when}.`,
    tipKeyMonth: (provider, when) =>
      `${provider}: витрати цього API-ключа за місяць — не баланс рахунку (для нього потрібен management-ключ у налаштуваннях). Оновлено ${when}.`,
    tipKeyTotal: (provider, when) =>
      `${provider}: усі витрати цього API-ключа — не баланс рахунку. Оновлено ${when}.`,
    tipLow: 'Коштів залишається мало.',
    tipOpenSettings: 'Клацніть, щоб відкрити налаштування.',
    tipUnavailable: (provider) => `${provider}: баланс зараз недоступний.`,
    tipFailed: (provider, message) => `${provider}: не вдалося отримати баланс — ${message}`,

    panelTitle: (provider) => `Баланс за даними ${provider}`,
    refresh: 'Оновити',
    refreshing: 'Оновлюємо…',
    fetchedAt: (when) => `оновлено ${when}`,
    accountTitle: 'Рахунок',
    accountRemaining: 'Залишок',
    accountTotal: 'Куплено кредитів',
    accountUsed: 'Витрачено',
    keyTitle: 'Цей API-ключ',
    keyToday: 'Сьогодні',
    keyWeek: 'Цей тиждень',
    keyMonth: 'Цей місяць',
    keyTotal: 'Усього',
    keyLimit: 'Ліміт',
    keyNoLimit: 'без ліміту',
    keyLimitLeft: 'Залишок ліміту',
    limitReset: (period) =>
      period === 'daily'
        ? 'скидається щодня'
        : period === 'weekly'
          ? 'скидається щотижня'
          : period === 'monthly'
            ? 'скидається щомісяця'
            : period
              ? `скидання: ${period}`
              : 'не скидається',
    freeTier: 'безкоштовний тариф',
    accountNeedsKey:
      'Залишок на рахунку доступний лише з management-ключем. Без нього застосунок бачить, скільки витратив цей API-ключ, але не скільки коштів лишилось.',
    accountKeyRejected: (provider) =>
      `${provider} відхилив management-ключ. Створіть новий і збережіть його тут.`,
    accountError: 'Не вдалося отримати залишок на рахунку. Спробуйте пізніше.',
    unavailable: 'Провайдер не повернув баланс — перевірте ключ і з’єднання.',
    managementKeyLabel: 'Management-ключ (необов’язково)',
    managementKeyPlaceholder: 'management-ключ',
    managementKeyNewPlaceholder: 'новий management-ключ (не показується)',
    managementKeySaved: 'management-ключ збережено',
    managementKeySave: 'Зберегти',
    managementKeyRemove: 'Прибрати',
    managementKeySavedToast: 'Management-ключ збережено',
    managementKeyHint:
      'Management-ключ може створювати, змінювати й видаляти ваші API-ключі. Застосунок використовує його лише для одного — щоб прочитати залишок на рахунку. Ключ шифрується так само, як API-ключ, і більше ніколи не показується.',
    managementKeyCreate: 'Створити management-ключ',
    openCredits: (provider) => `Кредити в ${provider}`,
  },

  pdf: {
    /** 'стор. 41' / 'стор. 41–42' — сторінка оригіналу, де надрукована вимога. */
    pageRef: (from, to) => (to != null && to !== from ? `стор. ${from}–${to}` : `стор. ${from}`),
    openTitle: (from, to) =>
      to != null && to !== from
        ? `Відкрити стандарт на сторінках ${from}–${to}`
        : `Відкрити стандарт на сторінці ${from}`,
    noPage: 'сторінка невідома',
    viewerTitle: 'Оригінал',
    loading: 'Завантаження PDF…',
    pageOf: (page, total) => `${page} з ${total}`,
    prev: 'Попередня сторінка',
    next: 'Наступна сторінка',
    zoomOut: 'Зменшити',
    zoomIn: 'Збільшити',
    fitWidth: 'За шириною',
    renderFailed: 'Не вдалося намалювати сторінку',
    unavailableTitle: 'Файл недоступний',
    unavailableDesc: 'Не вдалося прочитати вихідний файл зі сховища.',
    noHashTitle: 'Немає вихідного файлу',
    noHashDesc: 'Для цієї версії не імпортовано файл, тож показувати нічого.',
  },

  runStats: {
    never: 'Ще не перевірявся',
    neverDesc: 'Документ не входив у жодну перевірку.',
    against: (spec, version) => `${spec} v${version}`,
    lastRun: 'Остання перевірка',
    relevant: 'Покриває',
    relevantHint:
      'Вимоги, про які документ справді говорить (будь-який вердикт, крім «Не розглянуто»), з усіх, проти яких його перевіряли. Невелика частка — норма: одна інструкція покриває лише свою тему.',
    relevantOf: (relevant, assessed) => `${relevant} з ${assessed} оцінених`,
    relevantSub: (share) => `${share} оцінених`,
    issues: 'Невідповідності',
    noIssues: 'без невідповідностей',
    issuesHint:
      'Вимоги з вердиктом «Часткова» або «Не відповідає», за рівнем критичності: CRIT — Critical, MAJ — Major, MIN — Minor, REC — Recommendation.',
    chipLabel: (name, count) => `${name}: ${count}`,
    reviewed: 'Опрацьовано',
    reviewedHint:
      'Скільки findings цього документа людина вже переглянула — у режимі рев’ю або на сторінці finding.',
    reviewedSub: (share) => `${share} готово`,
    reviewedOf: (reviewed, assessed) => `${reviewed} з ${assessed}`,
    openRuns: 'Перевірки',
    viewFindings: 'Findings по цьому документу',
  },

  docRuns: {
    crumb: 'Перевірки документів',
    title: (doc) => `Перевірки документа «${doc}»`,
    subtitle: 'Усі перевірки, що торкались цього документа, від найновішої.',
    emptyTitle: 'Перевірок для цього документа немає',
    emptyDesc: 'Запустіть аудит, який включає цей документ, — результати з’являться тут.',
    toLibrary: 'До документів',
    startRun: 'Створити перевірку',
    colRun: 'Перевірка',
    colSpec: 'Стандарт',
    colVersion: 'Версія',
    colFinished: 'Завершено',
    colRelevant: 'Покриває',
    colIssues: 'Невідповідності',
    colReviewed: 'Опрацьовано',
    unnamed: 'без назви',
  },

  deleteRun: {
    action: 'Видалити',
    actionTitle: (runId) => `Видалити перевірку #${runId}`,
    title: 'Видалити перевірку?',
    facts: (runId, findings, reviewed) =>
      `Перевірка #${runId} · ${findings} findings · ${reviewed} опрацьовано вручну`,
    factsLoading: 'Рахуємо, що буде втрачено…',
    irreversible:
      'Перевірка зникне разом з усіма findings, доказами й людськими рев’ю. Дію не можна скасувати.',
    reviewedWarning: (reviewed) =>
      `${reviewed} вердиктів уже опрацьовано людиною. Це найдорожче, що тут є, — воно зникне разом із перевіркою.`,
    liveWarning:
      'Перевірка ще виконується. Її буде зупинено автоматично — скасовувати окремо не треба.',
    spendNote:
      'Записи витрат лишаються в журналі: гроші витрачені незалежно від того, чи потрібен результат.',
    confirm: 'Видалити перевірку',
    deleting: 'Видалення…',
    done: (runId) => `Перевірку #${runId} видалено`,
  },

  deleteLibrary: {
    action: 'Видалити…',
    actionTitle: {
      specification: (name) => `Видалити специфікацію «${name}» з усіма версіями`,
      specVersion: (name) => `Видалити версію «${name}»`,
      document: (name) => `Видалити документ «${name}» з усіма версіями`,
      documentVersion: (name) => `Видалити версію «${name}»`,
    },
    title: {
      specification: 'Видалити специфікацію?',
      specVersion: 'Видалити версію специфікації?',
      document: 'Видалити документ?',
      documentVersion: 'Видалити версію документа?',
    },
    loading: 'Рахуємо, що буде видалено…',
    lead: 'Буде видалено:',
    target: {
      specification: (title) => `специфікацію «${title}» з усіма версіями`,
      specVersion: (title) => `версію специфікації «${title}»`,
      document: (title) => `документ «${title}» з усіма версіями`,
      documentVersion: (title) => `версію документа «${title}»`,
    },
    versions: (count) => `${count} ${n(count, 'версія', 'версії', 'версій')}`,
    clauses: (count) => `${count} ${n(count, 'вимога', 'вимоги', 'вимог')} у реєстрі`,
    profiles: (count) =>
      `${count} ${n(count, 'профіль документа', 'профілі документа', 'профілів документа')}`,
    lastVersion: {
      specVersion: 'Інших версій у специфікації немає — тож зникне й сама специфікація.',
      documentVersion: 'Інших версій у документа немає — тож зникне й сам документ.',
    },
    runs: (count) =>
      `${count} ${n(count, 'перевірку документів', 'перевірки документів', 'перевірок документів')}`,
    findings: (count) => `${count} findings`,
    reviewed: (count) => `з них ${count} опрацьовано вручну — це найцінніше, і воно зникне`,
    files: (count, size) => `${count} ${n(count, 'файл', 'файли', 'файлів')} з диска (${size})`,
    sharedKept: (count) =>
      `${count} ${n(count, 'файл лишається', 'файли лишаються', 'файлів лишаються')} на диску: ${n(count, 'його', 'їх', 'їх')} використовує інший документ чи специфікація.`,
    nothingElse: 'Більше нічого не зачіпає: перевірок документів на цій основі немає.',
    spendKept: 'Журнал витрат лишається.',
    irreversible: 'Дію не можна скасувати.',
    runsTitle: 'Перевірки документів, які буде видалено',
    runUnnamed: 'без назви',
    runOtherDocuments: (count) =>
      `також містить ще ${count} ${n(count, 'документ', 'документи', 'документів')} — буде видалена повністю`,
    runLive: 'ще виконується — спершу буде зупинена',
    acknowledge: 'Розумію, що опрацьовані вручну вердикти зникнуть',
    confirm: {
      specification: (runs) =>
        runs > 0
          ? `Видалити специфікацію і ${runs} ${n(runs, 'перевірку', 'перевірки', 'перевірок')}`
          : 'Видалити специфікацію',
      specVersion: (runs) =>
        runs > 0
          ? `Видалити версію і ${runs} ${n(runs, 'перевірку', 'перевірки', 'перевірок')}`
          : 'Видалити версію',
      document: (runs) =>
        runs > 0
          ? `Видалити документ і ${runs} ${n(runs, 'перевірку', 'перевірки', 'перевірок')}`
          : 'Видалити документ',
      documentVersion: (runs) =>
        runs > 0
          ? `Видалити версію і ${runs} ${n(runs, 'перевірку', 'перевірки', 'перевірок')}`
          : 'Видалити версію',
    },
    deleting: 'Видалення…',
    done: (title, runs) =>
      runs > 0
        ? `«${title}» видалено разом із ${runs} ${n(runs, 'перевіркою', 'перевірками', 'перевірками')}`
        : `«${title}» видалено`,
  },

  notFound: {
    title: 'Сторінку не знайдено',
    desc: 'Такого маршруту немає. Скористайтесь навігацією ліворуч.',
    toLibrary: 'До документів',
  },

  tour: {
    sidebar: 'Як почати',
    sidebarTitle: (done, total) =>
      `Перший аналіз: виконано ${done} з ${total} ${n(total, 'обов’язкового кроку', 'обов’язкових кроків', 'обов’язкових кроків')}`,
    sidebarComplete: 'Усе потрібне для аналізу налаштовано',
    checklistTitle: 'Перший аналіз',
    checklistIntro:
      'Що має бути готове, щоб перевірити перший документ на відповідність стандарту. Позначки ставляться самі, за вашими даними; вручну можна відмітити лише необов’язкові кроки.',
    progress: (done, total) =>
      `Виконано ${done} з ${total} ${n(total, 'обов’язкового кроку', 'обов’язкових кроків', 'обов’язкових кроків')}`,
    groupSetup: 'Один раз на стандарт',
    groupPerDocument: 'Для кожного документа',
    stateDone: 'Зроблено',
    stateCurrent: 'Наступний',
    statePending: 'Ще ні',
    optional: 'необов’язково',
    showMe: 'Показати',
    startTour: 'Почати тур',
    restartTour: 'Пройти тур ще раз',
    openChecklist: 'Відкрити список кроків',
    allDone:
      'Усе обов’язкове на місці. Далі — імпортуйте новий документ і запускайте перевірку щоразу, коли це потрібно.',
    markDone: 'Позначити зробленим',
    markUndone: 'Ще не зроблено',
    dialogLabel: 'Екскурсія інтерфейсом',
    stepCounter: (index, total) => `Крок ${index} з ${total}`,
    announce: (index, total, title) => `Крок ${index} з ${total}: ${title}`,
    back: 'Назад',
    next: 'Далі',
    finish: 'Готово',
    skip: 'Пропустити тур',
    close: 'Закрити тур',
    lookFor: 'Шукайте',
    seeking: 'Шукаю на екрані…',
    missingTitle: 'На цьому екрані цього ще немає',
    missingBody: 'Ця частина екрана з’являється, лише коли є що показати.',
    firstDo: (title) => `Спершу: ${title}`,
    goToStep: 'Перейти до цього кроку',
    retry: 'Показати знову',
    doneNote: 'Уже зроблено — крок лишається для довідки.',
    keysHint: '← → — між кроками · Esc — закрити',
    offerTitle: 'Уперше тут?',
    offerBody:
      'Ще нічого не налаштовано. Короткий тур проведе екранами й покаже, що потрібно для першого аналізу документа, — це хвилини дві.',
    offerStart: 'Почати тур',
    offerLater: 'Пізніше',
    settingsTitle: 'Як почати',
    settingsHint: 'Екскурсія екранами: усе, що потрібно для першого аналізу документа, по порядку.',
    steps: {
      language: {
        title: 'Мова інтерфейсу й результатів',
        why: 'Мова інтерфейсу — лише для вас. Мова результатів визначає, якою мовою модель пише висновки; цитати завжди лишаються мовою оригіналу.',
        action: 'Оберіть мову тут. Мова результатів — окрема картка нижче в налаштуваннях.',
      },
      apiKey: {
        title: 'Ключ API провайдера',
        why: 'Кожен етап аналізу — це виклик мовної моделі. Типово все йде через OpenRouter — один ключ на моделі різних розробників; Anthropic дає Claude напряму.',
        action: 'Вставте ключ і збережіть. ОС його шифрує, і більше він ніде не показується; перевірка ключа токенів не витрачає.',
      },
      routing: {
        title: 'Моделі по етапах',
        why: 'Типові моделі вже працюють, усі через OpenRouter: Sonnet 5.5 будує реєстр, Haiku 4.5 профілює документи, Opus 5.5 судить і критикує. Міняйте їх, лише щоб заощадити чи спробувати іншу модель.',
        action: 'З ключем OpenRouter тут можна обрати й моделі інших розробників. Кнопка скидання повертає типову таблицю.',
      },
      importSpec: {
        title: 'Імпортувати стандарт',
        why: 'Стандарт замовника — наприклад, Tesco Ornamental Plant Standard — це те, на відповідність чому перевіряються ваші документи.',
        action: 'Імпортуйте його PDF тут або перетягніть на сторінку. Код і версія підтягнуться з назви файлу.',
      },
      cloudAllowed: {
        title: 'Дозволити хмару для стандарту',
        why: 'За замовчуванням чужий стандарт не покидає цей комп’ютер, і кожен хмарний етап відмовляється працювати. Це найчастіша причина «нічого не працює».',
        action: 'Увімкніть перемикач на картці стандарту — або лишіть вимкненим і налаштуйте локальну модель.',
      },
      extractClauses: {
        title: 'Витягти вимоги',
        why: 'Модель посторінково читає стандарт і будує реєстр пронумерованих вимог. Уся перевірка далі йде вимога за вимогою.',
        action: 'Натисніть кнопку й зачекайте: ~180 вимог — це кілька хвилин. Прогрес видно посторінково.',
      },
      reviewClauses: {
        title: 'Вичитати реєстр вимог',
        why: 'Якщо реєстр кривий, усе далі теж криве — і в результатах цього не видно. Тому перевірки заблоковані, доки реєстр не вичитано.',
        action: 'J / K — навігація, Enter — підтвердити, F — позначити проблемною. Починайте з позначених. Коли лічильник заповниться, позначте реєстр вичитаним.',
      },
      siteProfile: {
        title: 'Профіль виробництва',
        why: 'Модулі й сертифікати об’єкта відсікають незастосовні вимоги. Без профілю перевірятимуться всі вимоги, зокрема явно зайві.',
        action: 'Створіть профіль, а потім перерахуйте застосовність для стандарту.',
      },
      importDocument: {
        title: 'Імпортувати свій документ',
        why: 'Ваша SOP, політика чи інструкція — те, що перевіряємо. Номер і версія підтягнуться з шапки документа.',
        action: 'Імпортуйте файл або перетягніть його на сторінку. Повторний імпорт того самого файлу нічого не створить.',
      },
      startRun: {
        title: 'Запустити перевірку',
        why: 'Перевірка звіряє вибрані документи з однією версією стандарту. Оцінка показує вартість ще до того, як щось витрачено.',
        action: 'Створіть перевірку: оберіть стандарт і свій документ, оцініть вартість і запустіть.',
      },
      readResults: {
        title: 'Прочитати результати',
        why: 'Один документ ніколи не покриває весь стандарт, тож більшість вимог отримає «Не розглянуто». Це нормально, а не порушення.',
        action: 'У фільтрі вердиктів оберіть «Не відповідає» і «Часткова» — так «Не розглянуто» зникне. Потім відкрийте finding: праворуч цитата, на якій тримається вердикт.',
      },
    },
  },
};
