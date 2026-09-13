import { Modal } from '@renderer/components/Modal';
import { PdfViewer } from '@renderer/components/PdfViewer';
import { EmptyState } from '@renderer/components/States';
import { useT } from '@renderer/i18n';

/**
 * Посилання на сторінку оригіналу: `стор. 41` або `стор. 41–42`.
 *
 * Коли хеш блоба відомий — це кнопка, що відкриває стандарт саме там;
 * коли ні (файл не імпортовано) — просто текст, без мертвого клікабельного елемента.
 */
export function ClausePages({
  pageFrom,
  pageTo,
  onOpen,
  compact = false,
}: {
  pageFrom: number | null;
  pageTo: number | null;
  onOpen?: ((pageNo: number) => void) | undefined;
  compact?: boolean;
}) {
  const t = useT();
  if (pageFrom == null) return <span className="dim">—</span>;

  const label = t.pdf.pageRef(pageFrom, pageTo);
  if (!onOpen) return <span className={`pages-ref ${compact ? 'xsmall' : ''}`}>{label}</span>;

  return (
    <button
      type="button"
      className={`pages-btn ${compact ? 'xsmall' : ''}`}
      title={t.pdf.openTitle(pageFrom, pageTo)}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(pageFrom);
      }}
    >
      {label}
    </button>
  );
}

export interface PdfTarget {
  blobHash: string;
  pageNo: number;
  title?: string;
}

/** Модалка з перегляданням PDF. Тримається на рівні екрана — одна на весь список. */
export function PdfModal({ target, onClose }: { target: PdfTarget | null; onClose: () => void }) {
  const t = useT();
  if (!target) return null;
  return (
    <Modal title={target.title ?? t.pdf.viewerTitle} onClose={onClose} width={1000}>
      <PdfViewer blobHash={target.blobHash} pageNo={target.pageNo} minHeight={520} />
    </Modal>
  );
}

/** Немає що показувати — версія без імпортованого файлу. */
export function NoSourceState() {
  const t = useT();
  return <EmptyState icon="▤" title={t.pdf.noHashTitle} description={t.pdf.noHashDesc} />;
}
