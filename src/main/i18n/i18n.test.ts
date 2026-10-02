import { describe, expect, it } from 'vitest';
import { LlmError } from '@main/llm';
import { LANGUAGES, type Language } from '@shared/domain';
import {
  DEFAULT_LANGUAGE,
  LocalizedError,
  MAIN_CATALOGS,
  describeLlmError,
  errorText,
  isLlmErrorLike,
  mainMessages,
  markerLanguage,
  providerName,
  resultsLanguageOf,
  resultsMessages,
  uiLanguageOf,
  type SettingsSource,
} from './index';

// ─── Повнота каталогів ───────────────────────────────────────────────────────

type Shape = { kind: 'string' } | { kind: 'function'; arity: number } | { kind: 'object'; keys: string[] };

/** Плаский опис форми каталогу: шлях → що там лежить. */
function shapeOf(value: unknown, path = '', out = new Map<string, Shape>()): Map<string, Shape> {
  if (typeof value === 'string') {
    out.set(path, { kind: 'string' });
  } else if (typeof value === 'function') {
    out.set(path, { kind: 'function', arity: value.length });
  } else if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value).sort();
    out.set(path, { kind: 'object', keys });
    for (const key of keys) shapeOf((value as Record<string, unknown>)[key], `${path}.${key}`, out);
  } else {
    throw new Error(`Неочікуване значення в каталозі: ${path} = ${String(value)}`);
  }
  return out;
}

/** Усі рядки каталогу, функції викликані з правдоподібними аргументами. */
function renderAll(value: unknown, path = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]];
  if (typeof value === 'function') {
    const args = Array.from({ length: value.length }, (_, i) => (i % 2 === 0 ? 3 : 'X'));
    const rendered: unknown = (value as (...a: unknown[]) => unknown)(...args);
    return [[path, String(rendered)]];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
    renderAll(item, `${path}.${key}`),
  );
}

describe('каталоги main-процесу', () => {
  const reference = shapeOf(MAIN_CATALOGS.en);

  it('є каталог на кожну мову застосунку', () => {
    expect(Object.keys(MAIN_CATALOGS).sort()).toEqual([...LANGUAGES].sort());
  });

  it.each(LANGUAGES.filter((l) => l !== 'en'))('%s має рівно ту саму форму, що й en', (language) => {
    // Тип `MainMessages` ловить це під час компіляції; тест — другий пояс для
    // арності функцій і для каталогів, зібраних динамічно.
    expect(shapeOf(MAIN_CATALOGS[language])).toEqual(reference);
  });

  it.each(LANGUAGES)('%s: жодного порожнього тексту', (language) => {
    for (const [path, text] of renderAll(MAIN_CATALOGS[language])) {
      expect(text.trim(), path).not.toBe('');
      expect(text, path).not.toContain('undefined');
    }
  });

  it.each(['en', 'nl'] as const)('%s: без кирилиці — нічого не лишилось неперекладеним', (language) => {
    for (const [path, text] of renderAll(MAIN_CATALOGS[language])) {
      expect(text, path).not.toMatch(/[Ѐ-ӿ]/);
    }
  });

  it('uk: множина рахується за правилами мови, а не «1/інше»', () => {
    const uk = mainMessages('uk');
    expect(uk.clauses.flagged(1)).toContain('1 вимогу');
    expect(uk.clauses.flagged(3)).toContain('3 вимоги');
    expect(uk.clauses.flagged(5)).toContain('5 вимог');
    expect(mainMessages('en').clauses.flagged(1)).toContain('1 clause was');
    expect(mainMessages('nl').clauses.flagged(2)).toContain('2 eisen zijn');
  });

  it('providers: ліміт ключа з періодом скидання, невідомий період — без підпису', () => {
    expect(mainMessages('uk').providers.keyLimit('$5.00', '$1.20', 'monthly')).toBe(
      'Ліміт ключа: $5.00, залишок $1.20 (скидається щомісяця).',
    );
    expect(mainMessages('en').providers.keyLimit('$5.00', null, 'hourly')).toBe('Key limit: $5.00.');
    expect(mainMessages('nl').providers.httpError('OpenRouter', 502, 'Bad gateway')).toBe(
      'OpenRouter gaf een fout terug (HTTP 502): Bad gateway',
    );
  });
});

// ─── Звідки береться мова ────────────────────────────────────────────────────

function source(settings: Partial<Record<'uiLanguage' | 'resultsLanguage', unknown>>): SettingsSource {
  return { settings: { get: () => settings as never } };
}

describe('мова з налаштувань', () => {
  it('mainMessages падає на англійську для невідомого', () => {
    expect(mainMessages('nl')).toBe(MAIN_CATALOGS.nl);
    expect(mainMessages(undefined)).toBe(MAIN_CATALOGS.en);
    expect(mainMessages('de' as Language)).toBe(MAIN_CATALOGS.en);
  });

  it('uiLanguageOf читає налаштування й ніколи не кидає', () => {
    expect(uiLanguageOf(source({ uiLanguage: 'uk' }))).toBe('uk');
    expect(uiLanguageOf(source({ uiLanguage: 'uk-UA' }))).toBe(DEFAULT_LANGUAGE);
    const closed: SettingsSource = {
      settings: {
        get: () => {
          throw new Error('The database connection is not open');
        },
      },
    };
    expect(uiLanguageOf(closed)).toBe('en');
    expect(resultsLanguageOf(closed)).toBe('');
  });

  it('resultsLanguageOf: лише мови застосунку або «мовою стандарту»', () => {
    expect(resultsLanguageOf(source({ resultsLanguage: 'nl' }))).toBe('nl');
    expect(resultsLanguageOf(source({ resultsLanguage: '' }))).toBe('');
    expect(resultsLanguageOf(source({ resultsLanguage: 'fr' }))).toBe('');
  });

  it('позначки «мовою стандарту» — англійською: стандарти англомовні', () => {
    expect(markerLanguage('')).toBe('en');
    expect(markerLanguage(null)).toBe('en');
    expect(markerLanguage('uk')).toBe('uk');
    expect(resultsMessages('').results.noConclusion).toBe(MAIN_CATALOGS.en.results.noConclusion);
  });
});

// ─── Помилки ─────────────────────────────────────────────────────────────────

describe('describeLlmError', () => {
  const error = (kind: LlmError['kind'], providerId = 'anthropic', message = 'raw provider text') =>
    new LlmError(kind, message, { providerId });

  it('назва провайдера — з помилки, а не зашита', () => {
    expect(providerName('anthropic')).toBe('Anthropic');
    expect(providerName('openrouter')).toBe('OpenRouter');
    expect(providerName('my-lab')).toBe('my-lab');

    expect(describeLlmError('en', error('auth', 'openrouter'))).toContain('OpenRouter rejected the API key');
  });

  it('заборону хмари пояснює конкретно, коли відома причина', () => {
    const blocked = error('cloud_blocked');
    expect(describeLlmError('en', blocked, { localOnly: true })).toContain('“Local models only” is on');
    expect(describeLlmError('en', blocked, { cloudAllowed: false })).toContain(
      'This specification must not leave this computer',
    );
    expect(describeLlmError('uk', blocked, { cloudAllowed: false })).toContain(
      'Дозволити хмарних провайдерів',
    );
    // Без контексту — обидві можливі причини.
    expect(describeLlmError('en', blocked)).toContain('either');
  });

  it('сирий текст провайдера лишається для діагностики', () => {
    expect(describeLlmError('nl', error('transport', 'openrouter', 'ECONNRESET'))).toContain('ECONNRESET');
    expect(describeLlmError('uk', error('schema', 'anthropic', 'clause_no: Required'))).toContain(
      'clause_no: Required',
    );
  });

  it('баланс OpenRouter — з адресою, де поповнити', () => {
    const text = describeLlmError('en', error('insufficient_credit', 'openrouter', '402'));
    expect(text).toContain('openrouter.ai/settings/credits');
    expect(describeLlmError('uk', error('insufficient_credit', 'openrouter'))).toContain(
      'на openrouter.ai/settings/credits',
    );
    // Для провайдера без відомої адреси — його назва.
    expect(describeLlmError('nl', error('insufficient_credit', 'anthropic'))).toContain('bij Anthropic');
  });

  it('OpenRouter без ендпоінта під вимоги приватності чи формату — окреме пояснення', () => {
    const routing = error(
      'unsupported',
      'openrouter',
      'OpenRouter has no endpoint for model "x/y" that satisfies the routing constraints (data_collection=deny).',
    );
    expect(describeLlmError('en', routing)).toContain('privacy settings');
    expect(describeLlmError('uk', routing)).toContain('налаштуваннях приватності OpenRouter');
    expect(describeLlmError('en', routing)).toContain('data_collection=deny');
  });

  it('інша непідтримувана можливість і невідома модель — куди йти виправляти', () => {
    const pdf = error('unsupported', 'openrouter', 'Model "x" does not read PDF files natively');
    expect(describeLlmError('en', pdf)).toContain('choose another model');
    expect(describeLlmError('en', pdf)).toContain('does not read PDF files natively');

    const missing = error('model_not_found', 'openrouter', 'OpenRouter 404: not a valid model');
    expect(describeLlmError('en', missing)).toContain('check the model id');
    expect(describeLlmError('nl', missing)).toContain('model-id');
  });

  it('невідомий kind — текст як є', () => {
    expect(describeLlmError('uk', error('api', 'anthropic', 'HTTP 500'))).toBe('HTTP 500');
  });
});

describe('errorText', () => {
  it('розрізняє локалізовані, помилки LLM і решту', () => {
    const localized = new LocalizedError((m) => m.importing.unsupportedFormat('image/tiff'));
    expect(localized.message).toContain('is not supported');
    expect(errorText('uk', localized)).toContain('не підтримується');

    expect(errorText('uk', new LlmError('rate_limit', '429', { providerId: 'openrouter' }))).toContain(
      'OpenRouter обмежує частоту запитів',
    );
    expect(errorText('uk', new Error('як є'))).toBe('як є');
    expect(errorText('uk', 'рядок')).toBe('рядок');
  });

  it('isLlmErrorLike не плутає звичайні помилки з помилками LLM', () => {
    expect(isLlmErrorLike(new LlmError('auth', 'x', { providerId: 'anthropic' }))).toBe(true);
    expect(isLlmErrorLike(Object.assign(new Error('x'), { kind: 'ENOENT', providerId: 'fs' }))).toBe(false);
    expect(isLlmErrorLike({ kind: 'auth', providerId: 'anthropic', message: 'x' })).toBe(false);
  });
});
