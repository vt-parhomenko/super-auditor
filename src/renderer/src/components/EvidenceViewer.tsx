import type { EvidenceDto } from '@shared/domain';
import { PdfViewer } from '@renderer/components/PdfViewer';
import { EmptyState } from '@renderer/components/States';
import { useDocumentVersionBlob } from '@renderer/hooks/useDocuments';
import { useT } from '@renderer/i18n';

/**
 * Показує документ, з якого взято цитату, відкритий на її сторінці.
 *
 * Це той самий `PdfViewer`, що й для стандарту — різниця лише в хеші блоба.
 *
 * Підсвічування самої цитати ще немає: `evidence.pageNo` часто приходить `null`,
 * і поки прив'язка не стане надійною, підсвітка вводила б в оману, показуючи
 * «не знайдено» там, де проблема в даних, а не в документі.
 */
export function EvidenceViewer({
  evidence,
  documentTitle,
}: {
  evidence: EvidenceDto | null;
  documentTitle?: string;
}) {
  const t = useT();
  const { blobHash, title } = useDocumentVersionBlob(evidence?.documentVersionId ?? null);

  if (!evidence) {
    return (
      <div className="viewer-stub">
        <div style={{ fontWeight: 650, marginBottom: 4 }}>{t.evidenceViewer.title}</div>
        <div>{t.evidenceViewer.pickQuote}</div>
      </div>
    );
  }

  if (!blobHash) {
    return (
      <div className="viewer-stub">
        <EmptyState icon="▤" title={t.pdf.noHashTitle} description={t.pdf.noHashDesc} />
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: 'var(--sp-2)' }}>
      <div className="row-between xsmall dim">
        <span className="truncate">{documentTitle ?? title ?? t.evidenceViewer.document}</span>
        <span className="nowrap tabnum">
          {evidence.pageNo != null ? t.pdf.pageRef(evidence.pageNo, null) : t.pdf.noPage}
        </span>
      </div>
      <PdfViewer blobHash={blobHash} pageNo={evidence.pageNo ?? 1} minHeight={320} />
    </div>
  );
}
