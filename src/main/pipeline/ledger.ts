import type { Db } from '@main/db';
import type { CompleteRequest, CompleteResult, LlmProvider } from '@main/llm';

/**
 * Обгортка, що записує КОЖЕН фактичний виклик моделі в журнал витрат.
 *
 * Навіщо окремо від обліку в `audit_run`: побудова реєстру вимог і профілювання
 * документа коштують грошей, але не належать жодному прогону. Без журналу
 * питання «скільки цей застосунок витратив» не має відповіді — а саме воно
 * найближче до того, що користувач хоче бачити замість недоступного балансу.
 *
 * Запис у журнал НІКОЛИ не валить сам виклик: якщо облік зламався, це не
 * причина втрачати вже оплачений результат.
 */

export interface LedgerContext {
  /** Заповнюється після створення прогону — до того виклики поза ним. */
  runId?: number | null;
  specVersionId?: number | null;
}

export function withSpendLedger(
  provider: LlmProvider,
  db: Db,
  context: LedgerContext = {},
): LlmProvider {
  const wrapped: LlmProvider = {
    id: provider.id,
    label: provider.label,
    caps: provider.caps,
    models: provider.models,
    isConfigured: () => provider.isConfigured(),
    // Ціни знає лише сам провайдер (каталог OpenRouter тощо). Обгортка, що
    // загубила б метод, тихо перетворила б оцінку вартості на «ціна невідома».
    ...(provider.pricingFor ? { pricingFor: provider.pricingFor.bind(provider) } : {}),
    async complete<T>(req: CompleteRequest<T>, signal: AbortSignal): Promise<CompleteResult<T>> {
      const result = await provider.complete(req, signal);

      try {
        db.spend.record({
          stage: req.stage,
          provider: result.providerId,
          model: result.modelId,
          promptVersion: req.promptVersion ?? null,
          inputTokens: result.usage.input,
          cachedTokens: result.usage.cachedInput,
          outputTokens: result.usage.output,
          costUsd: result.costUsd,
          latencyMs: result.latencyMs,
          runId: context.runId ?? null,
          specVersionId: context.specVersionId ?? null,
          fromCache: result.fromCache,
        });
      } catch (error) {
        // Облік — допоміжна функція. Його поломка не має коштувати результату.
        console.error('[spend] не вдалося записати виклик:', error);
      }

      return result;
    },
  };

  return wrapped;
}
