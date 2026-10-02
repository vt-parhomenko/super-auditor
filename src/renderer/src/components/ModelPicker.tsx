import { useEffect, useId, useState, type ChangeEvent, type KeyboardEvent } from 'react';

import { isEffort } from '@shared/domain';
import type { ProviderStatus } from '@shared/ipc';
import { useT } from '@renderer/i18n';
import { useLabels } from '@renderer/lib/labels';
import {
  CUSTOM_MODEL_VALUE,
  choiceWithEffort,
  choiceWithModel,
  choiceWithProvider,
  effortChoices,
  findModel,
  STAGE_DEFAULT_PROVIDER,
  formatContextWindow,
  formatUsdPerMTok,
  groupModels,
  listedModels,
  modelOptionLabel,
  supportedEffort,
  type ModelChoice,
} from '@renderer/lib/models';

export type { ModelChoice } from '@renderer/lib/models';

interface PickerProps {
  /** null — для етапу нічого не збережено: діє вбудована маршрутизація. */
  value: ModelChoice | null;
  providers: readonly ProviderStatus[];
  onChange: (next: ModelChoice) => void;
  /** Назва етапу чи контексту для aria-label кожного поля: «Судження: модель». */
  label: string;
  /**
   * Чи пропонувати «за замовчуванням» (порожній id). У діалозі прогону — ні:
   * там вибір завжди явний, інакше перевизначення нічого б не перевизначало.
   */
  allowDefault?: boolean;
}

/** Провайдер, яким намальовано рядок: збережений або перший у списку. */
function displayedProviderId(value: ModelChoice | null, providers: readonly ProviderStatus[]): string {
  return value?.provider ?? providers[0]?.id ?? '';
}

/**
 * Три поля вибору — провайдер, модель, глибина роздумів — фрагментом, щоб батько
 * сам розклав їх у свою сітку (рядок таблиці в налаштуваннях, форма в діалозі).
 *
 * Для провайдерів із довільним id (OpenRouter, ~450 моделей) список показує лише
 * куровані моделі, а «Інша модель…» відкриває поле з автодоповненням по всьому
 * каталогу: випадний список на сотні пунктів клавіатурою не пройти.
 */
export function ModelPicker({ value, providers, onChange, label, allowDefault = true }: PickerProps) {
  const t = useT();
  const labels = useLabels();
  const datalistId = useId();

  const providerId = displayedProviderId(value, providers);
  const provider = providers.find((p) => p.id === providerId);
  const modelId = value?.model ?? '';
  const allowCustom = provider?.allowCustomModel ?? false;
  const listed = listedModels(provider);
  const isListed = modelId === '' || listed.some((m) => m.id === modelId);
  const impliedCustom = allowCustom && !isListed;

  const [customMode, setCustomMode] = useState(impliedCustom);
  const [draft, setDraft] = useState(modelId);

  // Значення змінилось ззовні (інший провайдер, скидання, відповідь main) —
  // поле вводу має показувати збережене, а не недописане.
  useEffect(() => {
    setDraft(modelId);
    setCustomMode(impliedCustom);
  }, [providerId, modelId, impliedCustom]);

  const current: ModelChoice = value ?? { provider: providerId, model: '' };
  const info = findModel(provider, modelId);
  const efforts = effortChoices(info);
  const supported = supportedEffort(value?.effort, info);
  // Збережений effort, якого модель не приймає (старі налаштування, звужений
  // каталог), main усе одно отримає. Ховати його за «—» означало б показувати
  // не те, що піде в API, — тож показуємо окремим пунктом, який можна скинути.
  const staleEffort = !supported && isEffort(value?.effort) ? value.effort : undefined;
  const effortValue = supported ?? staleEffort ?? '';

  const commitDraft = (raw: string) => {
    const next = raw.trim();
    if (!next || next === modelId) return;
    onChange(choiceWithModel(current, provider, next));
  };

  const onModelSelect = (e: ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value;
    if (next === CUSTOM_MODEL_VALUE) {
      // Нічого не зберігаємо, доки людина не введе id: порожній вибір зламав би етап.
      setCustomMode(true);
      setDraft(isListed ? '' : modelId);
      return;
    }
    setCustomMode(false);
    onChange(choiceWithModel(current, provider, next));
  };

  const onDraftInput = (e: ChangeEvent<HTMLInputElement>) => {
    setDraft(e.target.value);
    // Вибір пункту з <datalist> приходить як заміна тексту — це вже рішення,
    // а не набір по літері, тож зберігаємо одразу.
    const native = e.nativeEvent;
    const fromList = !(native instanceof InputEvent) || native.inputType === 'insertReplacementText';
    if (fromList && provider?.modelInfo.some((m) => m.id === e.target.value)) commitDraft(e.target.value);
  };

  const onDraftKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitDraft(draft);
    } else if (e.key === 'Escape') {
      // Esc відкочує введене й не закриває діалог, у якому стоїть поле.
      e.stopPropagation();
      setDraft(modelId);
      if (!impliedCustom) setCustomMode(false);
    }
  };

  const tierLabel = (tier: (typeof listed)[number]['tier']) => (tier ? labels.modelTier[tier] : null);

  return (
    <>
      <select
        className="select"
        aria-label={t.settings.ariaProvider(label)}
        value={providerId}
        onChange={(e) => onChange(choiceWithProvider(value, providers, e.target.value))}
      >
        {providers.length === 0 && <option value="">{t.settings.providerNone}</option>}
        {provider == null && providerId !== '' && (
          <option value={providerId}>{t.settings.providerUnavailable(providerId)}</option>
        )}
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
            {p.cloud ? t.settings.providerCloud : t.settings.providerLocal}
            {p.configured ? '' : t.settings.providerNoKey}
          </option>
        ))}
      </select>

      <div className="model-cell">
        <select
          className="select"
          aria-label={t.settings.ariaModel(label)}
          value={customMode ? CUSTOM_MODEL_VALUE : modelId}
          onChange={onModelSelect}
        >
          {(allowDefault || modelId === '') && <option value="">{t.settings.modelDefault}</option>}
          {!isListed && !allowCustom && <option value={modelId}>{t.settings.modelNotListed(modelId)}</option>}
          {groupModels(listed).map((group) => (
            <optgroup key={group.vendor ?? ''} label={group.vendor ?? t.settings.vendorOther}>
              {group.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {modelOptionLabel(m, tierLabel(m.tier))}
                </option>
              ))}
            </optgroup>
          ))}
          {allowCustom && <option value={CUSTOM_MODEL_VALUE}>{t.settings.modelCustom}</option>}
        </select>
        {customMode && provider && (
          <>
            <input
              className="input mono"
              aria-label={t.settings.ariaCustomModel(label)}
              list={datalistId}
              placeholder={t.settings.modelCustomPlaceholder}
              spellCheck={false}
              autoComplete="off"
              autoFocus={!impliedCustom}
              value={draft}
              onChange={onDraftInput}
              onKeyDown={onDraftKey}
              onBlur={() => {
                // Порожнє поле без збереженого власного id — людина передумала:
                // повертаємо список, щоб він знову показував збережену модель.
                if (draft.trim() === '' && !impliedCustom) setCustomMode(false);
                else commitDraft(draft);
              }}
            />
            <datalist id={datalistId}>
              {provider.modelInfo.map((m) => (
                <option key={m.id} value={m.id}>
                  {modelOptionLabel(m)}
                </option>
              ))}
            </datalist>
          </>
        )}
      </div>

      <select
        className="select"
        aria-label={t.settings.ariaEffort(label)}
        value={effortValue}
        disabled={efforts.disabled && !staleEffort}
        title={
          staleEffort
            ? t.settings.effortStale(labels.effort[staleEffort])
            : efforts.disabled
              ? t.settings.effortUnsupported
              : effortValue === ''
                ? t.settings.effortUnset
                : undefined
        }
        onChange={(e) => onChange(choiceWithEffort(current, e.target.value))}
      >
        <option value="">—</option>
        {staleEffort && (
          <option value={staleEffort}>{t.settings.effortStale(labels.effort[staleEffort])}</option>
        )}
        {efforts.efforts.map((effort) => (
          <option key={effort} value={effort}>
            {labels.effort[effort]}
          </option>
        ))}
      </select>
    </>
  );
}

/**
 * Однорядкова довідка під вибором: id, контекст, ціна з кешем, клас моделі.
 * Ціна видна до запуску — саме тут вирішується, скільки коштуватиме прогін.
 */
export function ModelHint({
  value,
  providers,
}: {
  value: ModelChoice | null;
  providers: readonly ProviderStatus[];
}) {
  const t = useT();
  const labels = useLabels();
  const provider = providers.find((p) => p.id === displayedProviderId(value, providers));
  const modelId = value?.model ?? '';

  if (!modelId) {
    const providerDefault = value?.provider && value.provider !== STAGE_DEFAULT_PROVIDER;
    return (
      <div className="model-hint">
        {providerDefault ? t.settings.hintProviderDefault(provider?.label ?? value.provider) : t.settings.hintDefault}
      </div>
    );
  }

  const info = findModel(provider, modelId);
  if (!info) {
    return (
      <div className="model-hint" title={modelId}>
        <span className="mono">{modelId}</span> · {t.settings.hintNotInCatalogue}
      </div>
    );
  }

  const parts: string[] = [];
  const context = formatContextWindow(info.contextWindow);
  if (context) parts.push(t.settings.hintContext(context));
  const input = formatUsdPerMTok(info.inputPerMTok);
  const output = formatUsdPerMTok(info.outputPerMTok);
  parts.push(input && output ? t.settings.hintPrice(input, output) : t.settings.hintPriceUnknown);
  const cacheRead = formatUsdPerMTok(info.cacheReadPerMTok);
  if (cacheRead) parts.push(t.settings.hintCacheRead(cacheRead));
  if (info.tier) parts.push(labels.modelTier[info.tier]);
  const text = parts.join(' · ');

  return (
    <div className="model-hint" title={`${info.id} · ${text}`}>
      <span className="mono">{info.id}</span> · {text}
    </div>
  );
}
