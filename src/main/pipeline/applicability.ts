import type { ClauseDto, Module, SiteProfileDto } from '@shared/domain';

/**
 * Stage 3 — детермінований фільтр застосовності вимог (ADR-4 в architecture.md).
 *
 * Принцип: `not_applicable` НІКОЛИ не вирішує модель. Якщо вимога не стосується
 * виробництва, вона взагалі не потрапляє в LLM — це і ріже вартість, і прибирає цілий
 * клас хибних невідповідностей.
 *
 * Правила декларативні й впорядковані: перше, що висловилось, — те й вирішує.
 * Користувач може перекрити будь-яке рішення вручну (`overriddenByUser` у БД).
 */

export interface ApplicabilityDecision {
  applicable: boolean;
  /** Людиночитне пояснення — показується в UI поруч із вимогою. */
  reason: string;
  /** id правила, що ухвалило рішення; `null` — рішення за замовчуванням. */
  ruleId: string | null;
}

export interface ApplicabilityRule {
  id: string;
  describe: string;
  /** `null` — правило не має думки щодо цієї вимоги. */
  evaluate(clause: ClauseDto, site: SiteProfileDto): ApplicabilityDecision | null;
}

// ─── Правило 1: модулі стандарту ─────────────────────────────────────────────

const MODULE_LABELS: Record<Module, string> = {
  P: 'Product Assurance',
  R: 'Responsible Sourcing',
  O: 'Operational',
};

/**
 * Вимога позначена набором модулів (колонки P/R/O у таблиці Tesco).
 * Якщо жоден із них не входить у scope виробництва — вимога не застосовна.
 *
 * Порожній список модулів означає «застосовно завжди» (Core-вимоги), а не «ніколи».
 */
export const moduleScopeRule: ApplicabilityRule = {
  id: 'module-scope',
  describe: 'Вимога поза модулями, які входять у scope виробництва',
  evaluate(clause, site) {
    if (clause.modules.length === 0) return null;
    if (clause.modules.some((m) => site.modules.includes(m))) return null;

    const required = clause.modules.map((m) => `${m} (${MODULE_LABELS[m]})`).join(', ');
    return {
      applicable: false,
      reason: `Вимога належить до модулів ${required}; scope виробництва — ${site.modules.join('/') || '—'}`,
      ruleId: 'module-scope',
    };
  },
};

// ─── Правило 2: звільнення за сертифікацією ──────────────────────────────────

/**
 * Стандарт прямо дозволяє пропускати окремі секції за наявності стороннього
 * сертифіката (див. «Clause Scope Definitions» у Tesco 20405 V5.0):
 *   • ISO 14001 → секція про Environment / water / waste management
 *   • SMETA / SIZA → секція Responsible Sourcing
 *
 * Свідомо матчимо за НАЗВОЮ секції, а не за номером: номери відрізняються між
 * стандартами й між версіями одного стандарту, назви — значно стабільніші.
 */
export interface CertificationExemption {
  id: string;
  /** Достатньо будь-якого з цих сертифікатів. */
  certifications: string[];
  /** Патерн на назву секції (регістронезалежно). */
  sectionPattern: RegExp;
  label: string;
}

export const CERTIFICATION_EXEMPTIONS: CertificationExemption[] = [
  {
    id: 'iso14001-environment',
    certifications: ['ISO14001', 'ISO 14001'],
    sectionPattern: /environment|water|waste/i,
    label: 'Environment, water and waste management',
  },
  {
    id: 'ethical-responsible-sourcing',
    certifications: ['SMETA', 'SIZA', 'SEDEX'],
    sectionPattern: /responsible\s+sourcing/i,
    label: 'Responsible Sourcing',
  },
];

const normalizeCert = (s: string): string => s.toUpperCase().replace(/[\s._-]/g, '');

export function certificationExemptionRule(
  exemptions: CertificationExemption[] = CERTIFICATION_EXEMPTIONS,
): ApplicabilityRule {
  return {
    id: 'certification-exemption',
    describe: 'Секція покрита стороннім сертифікатом виробництва',
    evaluate(clause, site) {
      const title = clause.sectionTitle;
      if (!title) return null;

      const siteCerts = new Set(site.certifications.map(normalizeCert));

      for (const exemption of exemptions) {
        if (!exemption.sectionPattern.test(title)) continue;

        const matched = exemption.certifications.find((c) => siteCerts.has(normalizeCert(c)));
        if (!matched) continue;

        return {
          applicable: false,
          reason: `Секція «${exemption.label}» покрита сертифікатом ${matched}`,
          ruleId: `certification-exemption:${exemption.id}`,
        };
      }
      return null;
    },
  };
}

// ─── Двигун ──────────────────────────────────────────────────────────────────

export const DEFAULT_RULES: ApplicabilityRule[] = [
  moduleScopeRule,
  certificationExemptionRule(),
];

const APPLICABLE_BY_DEFAULT: ApplicabilityDecision = {
  applicable: true,
  reason: 'У scope виробництва',
  ruleId: null,
};

/**
 * Рішення по одній вимозі. Перше правило, що висловилось, — вирішує.
 *
 * Умисно немає правила, яке б робило вимогу застосовною всупереч попередньому
 * рішенню: правила тільки ВИКЛЮЧАЮТЬ. Повернути вимогу в scope може лише
 * людина через override — інакше порядок правил став би прихованою логікою.
 */
export function decideApplicability(
  clause: ClauseDto,
  site: SiteProfileDto,
  rules: ApplicabilityRule[] = DEFAULT_RULES,
): ApplicabilityDecision {
  for (const rule of rules) {
    const decision = rule.evaluate(clause, site);
    if (decision) return decision;
  }
  return APPLICABLE_BY_DEFAULT;
}

export interface ApplicabilityReport {
  decisions: Map<number, ApplicabilityDecision>;
  applicable: number;
  notApplicable: number;
  /** Скільки вимог виключило кожне правило — для пояснення в UI. */
  byRule: Record<string, number>;
}

export function computeApplicability(
  clauses: readonly ClauseDto[],
  site: SiteProfileDto,
  rules: ApplicabilityRule[] = DEFAULT_RULES,
): ApplicabilityReport {
  const decisions = new Map<number, ApplicabilityDecision>();
  const byRule: Record<string, number> = {};
  let applicable = 0;

  for (const clause of clauses) {
    const decision = decideApplicability(clause, site, rules);
    decisions.set(clause.id, decision);

    if (decision.applicable) {
      applicable += 1;
    } else if (decision.ruleId) {
      byRule[decision.ruleId] = (byRule[decision.ruleId] ?? 0) + 1;
    }
  }

  return {
    decisions,
    applicable,
    notApplicable: clauses.length - applicable,
    byRule,
  };
}
