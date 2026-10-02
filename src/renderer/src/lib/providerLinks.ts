/**
 * Зовнішні сторінки провайдерів. Відкриваються в системному браузері —
 * це робить `setWindowOpenHandler` у main, renderer лише ставить `target="_blank"`.
 */

export interface ProviderLinks {
  /** Де створити API-ключ. */
  keys?: string;
  /** Де поповнити рахунок / подивитись кредити. */
  credits?: string;
  /** Оплата й справжній залишок, коли API його не віддає (Anthropic). */
  billing?: string;
  /** Де створити management-ключ — лише для читання балансу. */
  managementKeys?: string;
}

export const PROVIDER_LINKS: Readonly<Record<string, ProviderLinks>> = {
  anthropic: {
    billing: 'https://console.anthropic.com/settings/billing',
  },
  openrouter: {
    keys: 'https://openrouter.ai/keys',
    credits: 'https://openrouter.ai/settings/credits',
    managementKeys: 'https://openrouter.ai/settings/management-keys',
  },
};

export function providerLinks(providerId: string): ProviderLinks {
  return PROVIDER_LINKS[providerId] ?? {};
}

export const ANTHROPIC_BILLING_URL = PROVIDER_LINKS.anthropic?.billing ?? '';
export const OPENROUTER_CREDITS_URL = PROVIDER_LINKS.openrouter?.credits ?? '';
