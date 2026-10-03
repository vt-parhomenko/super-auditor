/** Український каталог main-процесу. Форма перевіряється типом `MainMessages`. */

import type { MainMessages } from './en';

const pr = new Intl.PluralRules('uk');

/** Українська має форми one / few / many — вибір віддаємо Intl, а не власній арифметиці. */
function n(count: number, one: string, few: string, many: string): string {
  const form = pr.select(count);
  if (form === 'one') return one;
  if (form === 'few') return few;
  return many;
}

const KEY_RESET: Readonly<Record<string, string>> = {
  daily: ' (скидається щодня)',
  weekly: ' (скидається щотижня)',
  monthly: ' (скидається щомісяця)',
};

export const uk: MainMessages = {
  results: {
    noConclusion: 'Модель не повернула висновок для цієї вимоги.',
    unverifiedEvidence: '[доказ не підтверджено в тексті документа]',
    criticDisagreed: '[критик не погодився]',
    outOfScope:
      'Документ не стосується цієї секції стандарту — визначено на етапі профілювання документа, ' +
      'без звернення до моделі з текстом вимоги.',
  },

  export: {
    title: (runId) => `Аудит — перевірка ${runId}`,
    summary: 'Підсумок',
    applicable: (count) => `Застосовних вимог: ${count}`,
    assessed: (count) => `Оцінено: ${count}`,
    gaps: (count) => `Прогалин: ${count}`,
    cost: (usd) => `Вартість: ${usd}`,
    colVerdict: 'Вердикт',
    colCount: 'Кількість',
    nonConformities: 'Невідповідності',
    verdictLabel: 'Вердикт',
    gapLabel: 'Чого бракує',
    recommendationLabel: 'Рекомендація',
    outsideEvidenceLabel: 'Перевірити поза документом',
    outsideEvidenceTitle: 'Перевірити на аудиті — поза документами',
    page: (page) => `стор. ${page}`,
    gapsTitle: 'Прогалини — вимоги без жодного доказу',
    colClause: 'Вимога',
    colSection: 'Секція',
    colTopic: 'Тема',
    verdicts: {
      compliant: 'Відповідає',
      partial: 'Відповідає частково',
      non_compliant: 'Не відповідає',
      not_applicable: 'Не застосовна',
      not_addressed: 'Не розглянуто',
      needs_human_review: 'Потрібна перевірка людиною',
    },
    // Рівні градації — терміни самого стандарту; інтерфейс теж лишає їх англійською.
    severities: {
      critical: 'Critical',
      major: 'Major',
      minor: 'Minor',
      recommendation: 'Recommendation',
    },
  },

  run: {
    tasksNotCompleted: (count) => `Не виконано завдань: ${count}`,
    allTasksFailed: (count, first) =>
      `Жодне з ${count} ${n(count, 'завдання', 'завдань', 'завдань')} не виконалось. Перша помилка: ${first}`,
    partial: (count) => `Частково: не виконано завдань ${count}`,
    unknownCause: 'причина невідома',
    crashed: (runId, message) => `Перевірка ${runId} впала: ${message}`,
    notFound: (runId) => `Перевірку ${runId} не знайдено`,
    specVersionNotFound: (specVersionId) => `Версію специфікації ${specVersionId} не знайдено`,
    noDocuments: 'Не вибрано жодного документа',
    emptyRegistry: 'Реєстр вимог порожній — спершу побудуйте його (Stage 1)',
    noExtraction: (documentVersionId) =>
      `Для версії документа ${documentVersionId} немає екстракції тексту`,
    scopeFallback: (count) =>
      `Не вдалося звузити перевірку для документів: ${count}. Їх буде перевірено проти всього стандарту.`,
  },

  clauses: {
    failedPages: (count) => `Не вдалося обробити сторінок: ${count}. Реєстр неповний.`,
    flagged: (count) =>
      `${count} ${n(count, 'вимогу', 'вимоги', 'вимог')} позначено на перевірку — вичитайте їх першими.`,
    noExtraction: 'Для цієї версії специфікації немає екстракції тексту',
    extractionMissing: 'Екстракцію тексту специфікації не знайдено',
    allPagesFailed: (error) =>
      `Не вдалося обробити жодної сторінки стандарту, тож реєстр вимог лишився без змін. Перша помилка: ${error}`,
    reviewedKept: (failed) =>
      `Не вдалося обробити ${failed} ${n(failed, 'сторінку', 'сторінки', 'сторінок')}. Вичитаний реєстр вимог лишився без змін — ` +
      'усуньте причину й запустіть витягування ще раз.',
    markerLegendFailed: (detail) =>
      'Реєстр вимог збережено, але розшифровку позначок стандарту цього разу прочитати не вдалося. ' +
      `Щоб спробувати ще раз, запустіть витягування повторно. (${detail})`,
  },

  llm: {
    insufficientCredit: (provider, topUpUrl, detail) =>
      `Вичерпано баланс ${provider}. Поповніть рахунок ${topUpUrl ? `на ${topUpUrl}` : `у ${provider}`} ` +
      `і натисніть «Продовжити» — перевірка відновиться з місця зупинки. (${detail})`,
    auth: (provider, detail) =>
      `${provider} відхилив ключ API. Перевірте його в Налаштуваннях. (${detail})`,
    notConfigured: (provider) =>
      `Провайдер ${provider} не налаштований: немає ключа API або ендпоінта. Додайте його в Налаштуваннях.`,
    cloudBlockedLocalOnly: (provider) =>
      `У Налаштуваннях увімкнено «Тільки локальні моделі», тож хмарний провайдер ${provider} використати не можна.`,
    cloudBlockedSpec: (provider) =>
      `Ця специфікація не має покидати цей комп'ютер, тож хмарний провайдер ${provider} використати не можна. ` +
      'Увімкніть «Дозволити хмарних провайдерів» на картці специфікації або призначте етапу локальну модель.',
    cloudBlocked: (provider) =>
      `Хмарний провайдер ${provider} тут заборонений: або в Налаштуваннях увімкнено «Тільки локальні моделі», ` +
      'або специфікація не дозволяє хмарних провайдерів.',
    rateLimit: (provider) => `${provider} обмежує частоту запитів — спробуйте за хвилину.`,
    transport: (provider, detail) =>
      `Немає з'єднання з ${provider}: перевірте мережу, проксі або фаєрвол. (${detail})`,
    modelNotFound: (provider, detail) =>
      `${provider} не знає такої моделі — перевірте id моделі в Налаштуваннях → Маршрутизація моделей по етапах. (${detail})`,
    unsupported: (provider, detail) =>
      `Вибрана модель ${provider} не вміє того, що потрібно цьому етапу, — оберіть іншу в ` +
      `Налаштуваннях → Маршрутизація моделей по етапах. (${detail})`,
    noRoutedEndpoint: (provider, detail) =>
      `${provider} не має для цієї моделі ендпоінта, який не збирає ваші дані й повертає структуровані ` +
      'відповіді. Оберіть іншу модель у Налаштуваннях → Маршрутизація моделей по етапах або дозвольте ' +
      `цю модель у налаштуваннях приватності ${provider}. (${detail})`,
    refusal: 'Модель відмовилась відповідати.',
    schema: (detail) => `Відповідь моделі не відповідає очікуваній структурі. (${detail})`,
    aborted: 'Скасовано.',
  },

  ipc: {
    // Знахідний відмінок: «Специфікацію 42 не знайдено».
    entities: {
      run: 'Перевірку',
      specification: 'Специфікацію',
      specVersion: 'Версію специфікації',
      clause: 'Вимогу',
      siteProfile: 'Профіль виробництва',
      document: 'Документ',
      documentVersion: 'Версію документа',
      finding: 'Finding',
      blob: 'Блоб',
      blobFile: 'Файл блоба',
      provider: 'Провайдера',
    },
    notFound: (what) => `${what} не знайдено`,
    invalidId: (label, value) => `${label} має бути цілим додатним числом, отримано ${value}`,
    integrity: (code) =>
      `Дія суперечить цілісності даних (${code}) — можливо, запис уже використано в іншому місці`,
    orchestratorMissing:
      'Оркестратор ще не підключено — операції перевірок недоступні в цій збірці',
  },

  library: {
    invalidTarget: (value) =>
      `Немає що видаляти: очікували специфікацію, версію специфікації, документ або версію документа, отримано ${value}`,
  },

  clauseEditing: {
    numberEmpty: 'Номер вимоги не може бути порожнім',
    textEmpty: 'Текст вимоги не може бути порожнім',
    specNoExtraction:
      'У версії специфікації немає екстракції тексту — спочатку переімпортуйте файл',
    registryEmpty: 'Реєстр порожній — немає чого позначати вичитаним',
    registryNotReviewed: (unconfirmed, flagged) =>
      `Реєстр не вичитано до кінця: ${unconfirmed} без підтвердження, ${flagged} позначено прапорцем`,
    markersInvalid: (maxCount, maxLength) =>
      `Позначки стандарту — це список щонайбільше з ${maxCount} коротких кодів, кожен непорожній і не довший за ${maxLength} символів`,
  },

  docProfiles: {
    noExtraction: 'У версії документа немає екстракції тексту — профіль будувати нема з чого',
  },

  findings: {
    emptyQuery: 'Порожній запит findings',
  },

  exporting: {
    unknownFormat: (format) => `Невідомий формат експорту: ${format}`,
    notImplemented: (format) =>
      `Експорт у ${format} ще не реалізовано — потрібна окрема бібліотека. Доступні формати: JSON, Markdown.`,
  },

  importing: {
    unknownKind: (kind) => `Невідомий тип імпорту: ${kind}`,
    noFiles: 'Немає файлів для імпорту',
    noTarget: 'Не вказано, куди імпортувати: документ чи специфікація',
    invalidBlobHash: 'Некоректний хеш блоба: очікується 64 шістнадцяткові символи',
    blobOutsideStorage: 'Шлях до блоба вийшов за межі сховища',
    dialogTitleDocuments: 'Імпорт документів',
    dialogTitleSpecification: 'Імпорт специфікації',
    dialogButton: 'Імпортувати',
    filterDocuments: 'Документи (PDF, DOCX)',
    filterAll: 'Усі файли',
    failedToast: (failed, total) => `Не вдалось імпортувати файлів: ${failed} із ${total}`,
    unsupportedFormat: (mime) =>
      `Формат «${mime}» не підтримується. Імпортувати можна лише PDF і DOCX — решту спершу конвертуйте.`,
    ocrNotConfigured:
      'Документ схожий на скан, а OCR не налаштовано. Імпортуйте версію з текстовим шаром.',
    fileNotFound: 'Файл не знайдено — можливо, його перемістили або видалили',
  },

  runs: {
    emptyConfig: 'Порожня конфігурація перевірки',
    registryNotReviewed:
      'Реєстр вимог не вичитано — перевірку заблоковано до підтвердження Stage 1',
    noDocuments: 'Не вибрано жодного документа для перевірки',
    siteProfileMissing: (siteProfileId) => `Профіль виробництва ${siteProfileId} не знайдено`,
  },

  sites: {
    nameEmpty: 'Назва профілю виробництва не може бути порожньою',
    noClauses: 'У версії специфікації ще немає вимог — спочатку побудуйте реєстр (Stage 1)',
    overrideReasonRequired: 'Причина перевизначення обовʼязкова',
  },

  settings: {
    emptyPatch: 'Порожній патч налаштувань',
    unknownTheme: (value) => `Невідома тема: ${value}`,
    concurrencyNotNumber: 'concurrency має бути числом',
    localOnlyNotBoolean: 'localOnly має бути булевим',
    invalidResultsLanguage: (value) =>
      `Непідтримувана мова результатів: ${value}. Очікується en, nl, uk або порожньо — мовою стандарту`,
    invalidUiLanguage: (value) =>
      `Непідтримувана мова інтерфейсу: ${value}. Очікується en, nl або uk`,
  },

  secrets: {
    encryptionUnavailable:
      'Системне сховище паролів (safeStorage) недоступне, тож ключ API не збережено — ' +
      'інакше він лежав би на диску відкритим текстом. На Linux потрібен gnome-keyring або KWallet; ' +
      'на Windows і macOS перевірте профіль користувача.',
  },

  providers: {
    idMissing: 'Не вказано провайдера',
    keyEmpty: 'Ключ API не може бути порожнім',
    managementKeyEmpty: 'Management-ключ не може бути порожнім',
    managementKeyUnsupported: (provider) => `Провайдер ${provider} не використовує management-ключ`,
    notConfigured: (provider) =>
      `Провайдер ${provider} не налаштований: немає ключа API або ендпоінта`,
    networkCheckDisabled: 'Мережеву перевірку вимкнено — перевірено лише наявність ключа',
    probeNotImplemented: (provider) =>
      `Провайдер ${provider} налаштований; мережева перевірка для нього не реалізована`,
    keyNotFound: (provider) => `Ключ ${provider} не знайдено в захищеному сховищі`,
    connectionOk: (provider) => `Зʼєднання з ${provider} працює`,
    connectionOkWithModel: (provider, model) =>
      `Зʼєднання з ${provider} працює, доступна модель ${model}`,
    keyValid: (provider, label) => `Ключ ${provider} дійсний${label ? ` («${label}»)` : ''}.`,
    keyUsage: (usd) => `Витрачено цим ключем: ${usd}.`,
    keyLimit: (limit, remaining, reset) =>
      `Ліміт ключа: ${limit}${remaining === null ? '' : `, залишок ${remaining}`}${KEY_RESET[reset ?? ''] ?? ''}.`,
    noKeyLimit: 'Ліміт ключа не задано.',
    freeTier: 'Безкоштовний рівень: доступні лише безкоштовні моделі з обмеженнями.',
    keyRejected:
      'Ключ API відхилено (401): перевірте, що він скопійований повністю і не відкликаний',
    permissionDenied: 'Доступ заборонено (403): ключ вимкнено або в нього немає прав на цей API',
    rateLimited: 'Ключ дійсний, але зараз спрацював ліміт запитів (429) — спробуйте за хвилину',
    noConnection: (host) => `Немає зʼєднання з ${host}: перевірте мережу, проксі або фаєрвол`,
    httpError: (provider, status, message) =>
      `${provider} повернув помилку${status === null ? '' : ` (HTTP ${status})`}: ${message}`,
  },

  app: {
    internalError: (message) => `Внутрішня помилка: ${message}`,
  },

  preload: {
    unknownEvent: (event) => `Невідомий канал події: ${event}`,
  },
};
