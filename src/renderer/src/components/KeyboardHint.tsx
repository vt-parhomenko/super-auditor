import type { ReactNode } from 'react';

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export interface Hint {
  keys: string[];
  label: string;
}

/**
 * Рядок клавіатурних підказок. Режим рев'ю — клавіатурний за вимогою §13,
 * тому підказки мають бути видимі, а не заховані у довідку.
 */
export function KeyboardHint({ hints }: { hints: Hint[] }) {
  return (
    <div className="kb-hints">
      {hints.map((h) => (
        <span key={h.label} className="kb-hint">
          {h.keys.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
          <span>{h.label}</span>
        </span>
      ))}
    </div>
  );
}
