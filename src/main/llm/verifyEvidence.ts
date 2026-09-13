/**
 * Механічна верифікація цитат (architecture.md §6 Stage 5, §10).
 *
 * Citations API робить вигадані цитати неможливими на рівні API, але
 * `model_quote` від провайдерів без citations — ні. Тому кожна цитата
 * перевіряється пошуком у вихідному тексті, а `compliant` без жодної
 * verified-цитати примусово знижується до `needs_human_review`.
 */

import type { ModelVerdict, Verdict } from '@shared/domain';

/**
 * Нормалізація під пошук: регістр, пробіли, типографіка.
 *
 * Друкарські лапки/тире й нерозривні пробіли з PDF регулярно не збігаються
 * з тим, що повертає модель, — без згортання перевірка дає хибні негативи.
 */
export function normalizeForMatch(input: string): string {
  return input
    .normalize('NFC')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[   ]/g, ' ')
    .replace(/…/g, '...')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Порожня цитата ніколи не вважається знайденою. */
export function verifyQuote(quote: string, sourceText: string): boolean {
  const needle = normalizeForMatch(quote);
  if (needle.length === 0) return false;
  return normalizeForMatch(sourceText).includes(needle);
}

export interface QuoteLike {
  quote: string;
}

export type Verified<E extends QuoteLike> = E & { verified: boolean };

export function verifyEvidence<E extends QuoteLike>(items: readonly E[], sourceText: string): Array<Verified<E>> {
  const haystack = normalizeForMatch(sourceText);
  return items.map((item) => {
    const needle = normalizeForMatch(item.quote);
    return { ...item, verified: needle.length > 0 && haystack.includes(needle) };
  });
}

export interface VerdictAdjustment {
  verdict: Verdict;
  /** true → вердикт знижено правилом «compliant без доказу». */
  downgraded: boolean;
  reason: string | null;
}

/**
 * ADR-5: вердикт `compliant` без жодної verified-цитати → `needs_human_review`.
 *
 * Свідомо застосовується ТІЛЬКИ до `compliant`. Оптимістичний вердикт —
 * найдорожча помилка; решта вердиктів або вже вимагають людини, або
 * консервативні за побудовою.
 */
export function applyEvidenceRule(
  verdict: ModelVerdict,
  evidence: readonly { verified: boolean }[],
): VerdictAdjustment {
  if (verdict !== 'compliant') {
    return { verdict, downgraded: false, reason: null };
  }
  const hasVerified = evidence.some((item) => item.verified);
  if (hasVerified) {
    return { verdict, downgraded: false, reason: null };
  }
  return {
    verdict: 'needs_human_review',
    downgraded: true,
    reason:
      evidence.length === 0
        ? 'compliant verdict without any evidence quote'
        : 'compliant verdict without a single quote verifiable in the source text',
  };
}

/** Зручна обгортка: верифікувати цитати й одразу застосувати правило. */
export function verifyAndAdjust<E extends QuoteLike>(
  verdict: ModelVerdict,
  evidence: readonly E[],
  sourceText: string,
): { verdict: Verdict; downgraded: boolean; reason: string | null; evidence: Array<Verified<E>> } {
  const verified = verifyEvidence(evidence, sourceText);
  const adjustment = applyEvidenceRule(verdict, verified);
  return { ...adjustment, evidence: verified };
}
