/**
 * Типізовані помилки шару LLM.
 *
 * Оркестратор конвеєра розрізняє їх, щоб вирішити: ретраїти, позначити
 * `run_task.status='failed'` чи звалити весь прогін.
 */

import type { Stage } from '@shared/domain';

export type LlmErrorKind =
  | 'not_configured'
  | 'refusal'
  | 'schema'
  | 'rate_limit'
  | 'transport'
  | 'model_not_found'
  | 'auth'
  | 'insufficient_credit'
  | 'aborted'
  | 'cloud_blocked'
  | 'unsupported'
  | 'api';

/**
 * Помилки, після яких немає сенсу робити наступний виклик: закінчився баланс,
 * невірний ключ, немає доступу. Прогін має впасти одразу, а не перемолоти всі
 * завдання по черзі, отримавши ту саму відмову 13 разів.
 */
const FATAL_KINDS = new Set<LlmErrorKind>(['insufficient_credit', 'auth', 'not_configured', 'cloud_blocked']);

export function isFatalLlmError(err: unknown): err is LlmError {
  return err instanceof LlmError && FATAL_KINDS.has(err.kind);
}

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly providerId: string;
  readonly stage: Stage | null;
  /** Чи має сенс повторити той самий запит. */
  readonly retryable: boolean;
  override readonly cause?: unknown;

  constructor(
    kind: LlmErrorKind,
    message: string,
    opts: { providerId: string; stage?: Stage | null; retryable?: boolean; cause?: unknown } ,
  ) {
    super(message);
    this.name = 'LlmError';
    this.kind = kind;
    this.providerId = opts.providerId;
    this.stage = opts.stage ?? null;
    this.retryable = opts.retryable ?? false;
    this.cause = opts.cause;
  }
}

/** Ключ API не заданий або локальний ендпоінт не налаштований. */
export class LlmNotConfiguredError extends LlmError {
  constructor(providerId: string, message = `Provider "${providerId}" is not configured`) {
    super('not_configured', message, { providerId });
    this.name = 'LlmNotConfiguredError';
  }
}

/**
 * `stop_reason === 'refusal'`. `content` читати не можна —
 * `stop_details` заповнене тільки в цьому випадку.
 */
export class LlmRefusalError extends LlmError {
  readonly category: string | null;
  readonly explanation: string | null;

  constructor(
    providerId: string,
    opts: { stage?: Stage | null; category?: string | null; explanation?: string | null },
  ) {
    super('refusal', `Model refused to answer${opts.category ? ` (${opts.category})` : ''}`, {
      providerId,
      stage: opts.stage ?? null,
    });
    this.name = 'LlmRefusalError';
    this.category = opts.category ?? null;
    this.explanation = opts.explanation ?? null;
  }
}

/** Відповідь не пройшла zod-валідацію (після всіх спроб repair). */
export class LlmSchemaError extends LlmError {
  readonly issues: string;
  readonly rawText: string;
  readonly attempts: number;

  constructor(
    providerId: string,
    opts: { stage?: Stage | null; issues: string; rawText: string; attempts?: number },
  ) {
    super('schema', `Model response failed schema validation: ${opts.issues}`, {
      providerId,
      stage: opts.stage ?? null,
      retryable: true,
    });
    this.name = 'LlmSchemaError';
    this.issues = opts.issues;
    this.rawText = opts.rawText;
    this.attempts = opts.attempts ?? 1;
  }
}

/** Спека заборонена до відправки в хмару (ADR-8) або ввімкнено localOnly. */
export class LlmCloudBlockedError extends LlmError {
  constructor(providerId: string, message: string) {
    super('cloud_blocked', message, { providerId });
    this.name = 'LlmCloudBlockedError';
  }
}

/** Провайдер не вміє того, що просить запит (напр. citations у локальної моделі). */
export class LlmUnsupportedError extends LlmError {
  constructor(providerId: string, message: string) {
    super('unsupported', message, { providerId });
    this.name = 'LlmUnsupportedError';
  }
}

export function isLlmError(err: unknown): err is LlmError {
  return err instanceof LlmError;
}
