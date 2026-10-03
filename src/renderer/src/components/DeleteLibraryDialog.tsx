import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import type { LibraryDeleteImpact, LibraryDeleteTarget } from '@shared/ipc';
import { RunStatusBadge } from '@renderer/components/Badges';
import { Modal } from '@renderer/components/Modal';
import { ErrorState } from '@renderer/components/States';
import { useLibraryDelete, useLibraryDeleteImpact } from '@renderer/hooks/useLibrary';
import { useT } from '@renderer/i18n';
import { formatBytes } from '@renderer/lib/format';
import {
  confirmLabel,
  impactLines,
  impactRuns,
  needsAcknowledgement,
  routeAfterDeletion,
} from '@renderer/lib/libraryDeletion';
import { toast } from '@renderer/store/ui';

/**
 * Підтвердження видалення специфікації, документа або однієї їхньої версії.
 *
 * Як і `DeleteRunDialog`, показує не питання, а ціну — і рахує її main, а не
 * UI: перевірки за стандартом, перевірки, що охоплюють документ, людські рев'ю,
 * файли на диску. Поки ціну не пораховано, кнопка вимкнена: «видалити наосліп»
 * тут не можна. Якщо зникнуть людські вердикти, кнопку розблоковує лише окрема
 * явна згода — це єдина робота, яку не відтворить жодна модель.
 */
export function DeleteLibraryDialog({
  target,
  onClose,
  onDeleted,
}: {
  target: LibraryDeleteTarget;
  onClose: () => void;
  onDeleted?: (impact: LibraryDeleteImpact) => void;
}) {
  const t = useT();
  const m = t.deleteLibrary;
  const impact = useLibraryDeleteImpact(target);
  const remove = useLibraryDelete();
  const navigate = useNavigate();
  const location = useLocation();
  const [acknowledged, setAcknowledged] = useState(false);

  const data = impact.data;
  const mustAcknowledge = data ? needsAcknowledgement(data) : false;
  const ready = data != null && !remove.isPending && (!mustAcknowledge || acknowledged);

  // Під час видалення вікно не закриваємо: результат (тост, перехід) має дійти до людини.
  const close = () => {
    if (!remove.isPending) onClose();
  };

  const confirm = () => {
    if (!data) return;
    remove.mutate(target, {
      onSuccess: (deleted) => {
        toast('info', m.done(deleted.title, deleted.runs.length));
        onClose();
        const next = routeAfterDeletion(location.pathname, deleted);
        if (next) navigate(next, { replace: true });
        onDeleted?.(deleted);
      },
      onError: (error) => toast('error', error.message),
    });
  };

  return (
    <Modal
      title={m.title[target.kind]}
      onClose={close}
      width={600}
      footer={
        <>
          <button type="button" className="btn" onClick={close} disabled={remove.isPending}>
            {t.common.cancel}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-destructive"
            disabled={!ready}
            onClick={confirm}
          >
            {remove.isPending ? m.deleting : data ? confirmLabel(data, m) : t.common.delete}
          </button>
        </>
      }
    >
      {impact.isPending ? (
        <div className="col" style={{ gap: 'var(--sp-2)' }} aria-busy="true" aria-live="polite">
          <span className="small muted">{m.loading}</span>
          <div className="progress indeterminate" role="progressbar" aria-label={m.loading}>
            <div className="progress-bar" />
          </div>
        </div>
      ) : impact.error || !data ? (
        <ErrorState error={impact.error} onRetry={() => void impact.refetch()} />
      ) : (
        <ImpactSummary
          impact={data}
          acknowledged={acknowledged}
          onAcknowledge={setAcknowledged}
          busy={remove.isPending}
        />
      )}
    </Modal>
  );
}

function ImpactSummary({
  impact,
  acknowledged,
  onAcknowledge,
  busy,
}: {
  impact: LibraryDeleteImpact;
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
  busy: boolean;
}) {
  const t = useT();
  const m = t.deleteLibrary;
  const lines = impactLines(impact, m, formatBytes);
  const items = lines.filter((line) => line.tone !== 'note');
  const notes = lines.filter((line) => line.tone === 'note');
  const runs = impactRuns(impact, m);
  const mustAcknowledge = needsAcknowledgement(impact);

  return (
    <div className="col" style={{ gap: 'var(--sp-3)' }}>
      <div className="delete-impact">
        <div className="delete-impact-lead">{m.lead}</div>
        <ul className="delete-impact-list">
          {items.map((line) => (
            <li key={line.key} className={line.tone === 'danger' ? 'is-danger' : undefined}>
              {line.text}
            </li>
          ))}
        </ul>
      </div>

      {notes.map((line) => (
        <p key={line.key} className="small muted" style={{ margin: 0 }}>
          {line.text}
        </p>
      ))}

      {runs.length > 0 && (
        <div className="field">
          <span className="label">{m.runsTitle}</span>
          <ul className="delete-runs">
            {runs.map((run) => (
              <li key={run.id}>
                <span className="mono dim">#{run.id}</span>
                <span className="truncate grow" title={run.name}>
                  {run.name}
                </span>
                <RunStatusBadge status={run.status} />
                {run.notes.length > 0 && (
                  <span className="delete-run-notes">{run.notes.join(' · ')}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={mustAcknowledge ? 'callout callout-danger' : 'callout callout-warn'}>
        {m.irreversible} <span className="dim">{m.spendKept}</span>
      </div>

      {mustAcknowledge && (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={acknowledged}
            disabled={busy}
            onChange={(e) => onAcknowledge(e.target.checked)}
          />
          <span style={{ fontWeight: 600 }}>{m.acknowledge}</span>
        </label>
      )}
    </div>
  );
}

/**
 * Вторинна дія «Видалити…»: тиха, доки на неї не наведуть. Червоних кнопок на
 * кожній картці не треба — небезпека пояснюється у вікні, а не кольором списку.
 */
export function DeleteLibraryButton({ title, onClick }: { title: string; onClick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      className="btn btn-sm btn-ghost btn-quiet-danger"
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {t.deleteLibrary.action}
    </button>
  );
}
