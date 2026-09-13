import type { RunStatus } from '@shared/domain';
import { Modal } from '@renderer/components/Modal';
import { useDeleteRun, useRunDeletionFacts } from '@renderer/hooks/useRuns';
import { useT } from '@renderer/i18n';
import { toast } from '@renderer/store/ui';

export interface DeleteRunTarget {
  runId: number;
  status: RunStatus;
}

/**
 * Підтвердження видалення прогону.
 *
 * Показуємо не саме питання, а ціну: скільки findings і — головне — скільки
 * вердиктів уже опрацьовано людиною. Автоматичне рев'ю можна перерахувати,
 * людське — ні, тому коли воно є, попередження стає помітнішим.
 */
export function DeleteRunDialog({
  target,
  onClose,
  onDeleted,
}: {
  target: DeleteRunTarget;
  onClose: () => void;
  onDeleted?: (runId: number) => void;
}) {
  const t = useT();
  const facts = useRunDeletionFacts(target.runId);
  const remove = useDeleteRun();

  const live = target.status === 'running' || target.status === 'queued';
  const hasReviewed = facts.reviewed > 0;

  return (
    <Modal
      title={t.deleteRun.title}
      onClose={onClose}
      width={560}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={remove.isPending}>
            {t.common.cancel}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-destructive"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(target.runId, {
                onSuccess: () => {
                  toast('info', t.deleteRun.done(target.runId));
                  onClose();
                  onDeleted?.(target.runId);
                },
                onError: (error) => toast('error', error.message),
              })
            }
          >
            {remove.isPending ? t.deleteRun.deleting : t.deleteRun.confirm}
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 'var(--sp-3)' }}>
        <p className="delete-facts">
          {facts.isPending
            ? t.deleteRun.factsLoading
            : t.deleteRun.facts(target.runId, facts.findings, facts.reviewed)}
        </p>

        <div className={hasReviewed ? 'callout callout-danger' : 'callout callout-warn'}>
          {t.deleteRun.irreversible}
        </div>

        {hasReviewed && (
          <div className="callout callout-danger">
            <strong>{t.deleteRun.reviewedWarning(facts.reviewed)}</strong>
          </div>
        )}

        {live && <div className="callout callout-warn">{t.deleteRun.liveWarning}</div>}

        <p className="xsmall dim" style={{ margin: 0 }}>
          {t.deleteRun.spendNote}
        </p>
      </div>
    </Modal>
  );
}

/** Кнопка-дія в рядку таблиці. Клік не має відкривати сам рядок. */
export function DeleteRunButton({ runId, onClick }: { runId: number; onClick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      className="btn btn-sm btn-ghost btn-danger"
      title={t.deleteRun.actionTitle(runId)}
      aria-label={t.deleteRun.actionTitle(runId)}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      ✕
    </button>
  );
}
