/**
 * Чиста логіка вибору моделі: групування каталогу, сумісність effort, ціни.
 *
 * Без React і без каталогів i18n — щоб покрити юніт-тестами й використати
 * однаково в Налаштуваннях і в діалозі нового прогону. Підписи (назви рівнів,
 * класів моделей) підставляє компонент.
 */

import { EFFORTS, isEffort, type Effort, type ModelInfo, type ModelRef } from '@shared/domain';
import type { ProviderStatus } from '@shared/ipc';

/**
 * Вибір для одного етапу у формі `AppSettings.routing[stage]`. `effort` — рядок,
 * бо так його зберігає контракт налаштувань; у `RunConfig` іде через `toModelRef`.
 * Порожній `model` — «типова модель провайдера».
 */
export interface ModelChoice {
  provider: string;
  model: string;
  effort?: string;
}

/** Значення пункту «Інша модель…» у списку — не може збігтися з id моделі. */
export const CUSTOM_MODEL_VALUE = '\u0000custom';

// ─── Каталог ─────────────────────────────────────────────────────────────────

export interface ModelGroup {
  /** null — розробник невідомий (локальні моделі, сирі id). */
  vendor: string | null;
  models: ModelInfo[];
}

/**
 * Групує моделі за розробником для `<optgroup>`.
 *
 * Порядок має сенс: спершу розробники з рекомендованими моделями — у тому
 * порядку, в якому main їх курує (найкращі для аудиту вгорі), далі решта за
 * абеткою; «невідомий» розробник завжди останній. Усередині групи рекомендовані
 * йдуть першими у кураторському порядку, решта — за назвою.
 */
export function groupModels(models: readonly ModelInfo[]): ModelGroup[] {
  const groups = new Map<string | null, ModelInfo[]>();
  const vendorOrder: Array<string | null> = [];

  const add = (model: ModelInfo) => {
    const key = model.vendor?.trim() || null;
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
      vendorOrder.push(key);
    }
    list.push(model);
  };

  for (const model of models) if (model.recommended) add(model);

  const rest = models
    .filter((m) => !m.recommended)
    .slice()
    .sort((a, b) => compareVendors(a.vendor, b.vendor) || a.label.localeCompare(b.label));
  for (const model of rest) add(model);

  // Розробники лише з нерекомендованими моделями вже додані в абетковому порядку,
  // але «невідомого» треба витягти в самий кінець, навіть якщо він мав рекомендовані.
  const ordered: Array<string | null> = vendorOrder.filter((v) => v !== null);
  if (groups.has(null)) ordered.push(null);
  return ordered.map((vendor) => ({ vendor, models: groups.get(vendor) ?? [] }));
}

function compareVendors(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a.localeCompare(b);
}

/**
 * Статус провайдера від старішого main може не мати нових полів (`modelInfo` тощо).
 * Добудовуємо їх зі списку id, щоб екран не падав на `undefined.filter` під час
 * оновлення бекенда.
 */
export function normalizeProviderStatus(raw: ProviderStatus): ProviderStatus {
  const models = Array.isArray(raw.models) ? raw.models : [];
  const modelInfo: ModelInfo[] = Array.isArray(raw.modelInfo)
    ? raw.modelInfo
    : models.map((id) => ({
        id,
        label: id,
        vendor: null,
        contextWindow: null,
        maxOutputTokens: null,
        inputPerMTok: null,
        outputPerMTok: null,
        cacheReadPerMTok: null,
        efforts: null,
        recommended: false,
        tier: null,
      }));
  return {
    ...raw,
    models,
    modelInfo,
    allowCustomModel: raw.allowCustomModel === true,
    catalogueUpdatedAt: raw.catalogueUpdatedAt ?? null,
  };
}

/**
 * Провайдер вбудованої маршрутизації (`DEFAULT_ROUTING` у main — усі етапи на
 * Anthropic). Порожня модель означає різне: для цього провайдера — типову модель
 * ЕТАПУ, для будь-якого іншого — типову модель самого провайдера.
 */
export const STAGE_DEFAULT_PROVIDER = 'anthropic';

export function findModel(
  provider: ProviderStatus | undefined,
  modelId: string,
): ModelInfo | undefined {
  if (!provider || !modelId) return undefined;
  return provider.modelInfo.find((m) => m.id === modelId);
}

/** Більший каталог без кураторського списку у випадний список не викладаємо. */
export const LISTED_MODELS_MAX = 40;

/**
 * Що показувати у випадному списку. Для OpenRouter каталог — сотні моделей, і
 * список на 450 пунктів клавіатурою не пройти: показуємо куровані, решта
 * доступна через «Інша модель…» з автодоповненням по всьому каталогу.
 * Локальний сервер кураторського списку не має, зате моделей у нього кілька —
 * їх показуємо всі.
 */
export function listedModels(provider: ProviderStatus | undefined): ModelInfo[] {
  if (!provider) return [];
  if (!provider.allowCustomModel) return provider.modelInfo;
  const recommended = provider.modelInfo.filter((m) => m.recommended);
  if (recommended.length > 0) return recommended;
  return provider.modelInfo.length <= LISTED_MODELS_MAX ? provider.modelInfo : [];
}

/** Модель за замовчуванням при зміні провайдера: перша рекомендована, інакше перша з каталогу. */
export function defaultModelId(provider: ProviderStatus | undefined): string {
  if (!provider) return '';
  const recommended = provider.modelInfo.find((m) => m.recommended);
  return recommended?.id ?? provider.modelInfo[0]?.id ?? provider.models[0] ?? '';
}

// ─── Effort ──────────────────────────────────────────────────────────────────

export interface EffortChoices {
  efforts: readonly Effort[];
  /** Модель не керується effort — поле вимикається. */
  disabled: boolean;
}

/**
 * Рівні effort, які можна запропонувати. Невідома модель (`efforts: null`,
 * власний id, «за замовчуванням») — усі рівні: краще дати вибір, ніж вигадати
 * обмеження. Порожній список — модель effort не приймає.
 */
export function effortChoices(model: ModelInfo | null | undefined): EffortChoices {
  if (!model || model.efforts == null) return { efforts: EFFORTS, disabled: false };
  if (model.efforts.length === 0) return { efforts: [], disabled: true };
  // Порядок — завжди від дешевшого до ретельнішого, хоч би як його віддав каталог.
  return { efforts: EFFORTS.filter((e) => model.efforts?.includes(e)), disabled: false };
}

/** Збережений effort, якщо модель його приймає; інакше undefined. */
export function supportedEffort(
  effort: string | undefined,
  model: ModelInfo | null | undefined,
): Effort | undefined {
  if (!isEffort(effort)) return undefined;
  return effortChoices(model).efforts.includes(effort) ? effort : undefined;
}

// ─── Переходи стану вибору ───────────────────────────────────────────────────

function withEffortFor(
  base: { provider: string; model: string },
  effort: string | undefined,
  model: ModelInfo | undefined,
): ModelChoice {
  const kept = supportedEffort(effort, model);
  return kept ? { ...base, effort: kept } : base;
}

/**
 * Інший провайдер: одразу підставляємо розумну модель, а не порожнє поле —
 * id моделей у провайдерів різні, і «типова» модель Anthropic для OpenRouter
 * нічого не означає.
 */
export function choiceWithProvider(
  current: ModelChoice | null,
  providers: readonly ProviderStatus[],
  providerId: string,
): ModelChoice {
  const provider = providers.find((p) => p.id === providerId);
  const model = defaultModelId(provider);
  return withEffortFor({ provider: providerId, model }, current?.effort, findModel(provider, model));
}

/** Інша модель того самого провайдера. Effort, якого нова модель не приймає, відкидається. */
export function choiceWithModel(
  current: ModelChoice,
  provider: ProviderStatus | undefined,
  modelId: string,
): ModelChoice {
  return withEffortFor(
    { provider: current.provider, model: modelId },
    current.effort,
    findModel(provider, modelId),
  );
}

export function choiceWithEffort(current: ModelChoice, effort: string): ModelChoice {
  const base = { provider: current.provider, model: current.model };
  return isEffort(effort) ? { ...base, effort } : base;
}

/** Перетворення для `RunConfig.routing`: effort у контракті прогону — строгий тип. */
export function toModelRef(choice: ModelChoice): ModelRef {
  const ref: ModelRef = { provider: choice.provider, model: choice.model };
  if (isEffort(choice.effort)) ref.effort = choice.effort;
  return ref;
}

// ─── Ціни й розміри ──────────────────────────────────────────────────────────

/**
 * Ціна за 1M токенів, коротко: `$4`, `$0.10`, `$0.209`, `$13.50`.
 *
 * Цілі долари — без копійок (так компактніше в списку), дробові — щонайменше
 * дві цифри після крапки, як звикли читати гроші, і не більше трьох: дешеві
 * моделі відрізняються саме в третьому знаку. Крапка, а не кома, свідомо —
 * як і в решті сум у USD у застосунку.
 */
export function formatUsdPerMTok(usd: number | null | undefined): string | null {
  if (usd == null || !Number.isFinite(usd) || usd < 0) return null;
  if (Number.isInteger(usd)) return `$${usd}`;
  if (usd < 0.001) return `$${Number(usd.toPrecision(2))}`;
  let text = usd.toFixed(3).replace(/0+$/, '');
  const fraction = text.split('.')[1] ?? '';
  if (fraction.length < 2) text = usd.toFixed(2);
  return `$${text}`;
}

/** «$4/$20» — вхід/вихід за 1M. null, якщо невідома хоч одна з цін. */
export function formatPricePair(model: Pick<ModelInfo, 'inputPerMTok' | 'outputPerMTok'>): string | null {
  const input = formatUsdPerMTok(model.inputPerMTok);
  const output = formatUsdPerMTok(model.outputPerMTok);
  return input && output ? `${input}/${output}` : null;
}

/** Вікно контексту: 1 000 000 → «1M», 1 048 576 → «1.05M», 200 000 → «200K». */
export function formatContextWindow(tokens: number | null | undefined): string | null {
  if (tokens == null || !Number.isFinite(tokens) || tokens <= 0) return null;
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(2))}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}

/** Підпис пункту списку: «Claude Opus 5.5 · $4/$20 · топ». */
export function modelOptionLabel(model: ModelInfo, tierLabel?: string | null): string {
  const parts = [model.label || model.id];
  const price = formatPricePair(model);
  if (price) parts.push(price);
  if (tierLabel) parts.push(tierLabel);
  return parts.join(' · ');
}
