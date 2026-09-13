import { useState, type KeyboardEvent } from 'react';

import { useT } from '@renderer/i18n';

/** Простий редактор списку рядків: Enter або кома додає, Backspace на порожньому — прибирає. */
export function TagInput({
  values,
  onChange,
  placeholder,
  id,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  id?: string;
}) {
  const t = useT();
  const [draft, setDraft] = useState('');

  const commit = (raw: string) => {
    const value = raw.trim().replace(/,$/, '').trim();
    if (!value || values.includes(value)) {
      setDraft('');
      return;
    }
    onChange([...values, value]);
    setDraft('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && draft === '' && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div className="tag-editor">
      {values.map((value) => (
        <span key={value} className="tag">
          {value}
          <button
            type="button"
            aria-label={t.tagInput.remove(value)}
            onClick={() => onChange(values.filter((v) => v !== value))}
          >
            ✕
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(draft)}
      />
    </div>
  );
}
