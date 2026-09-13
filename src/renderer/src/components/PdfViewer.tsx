import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

import { ErrorState } from '@renderer/components/States';
import { useT } from '@renderer/i18n';
import { loadPdfDocument } from '@renderer/lib/pdf';

/**
 * Перегляд PDF із блоба — і для стандарту, і для документів: різниця лише в хеші.
 *
 * Рендеримо одну сторінку в canvas на вимогу, а не весь документ: стандарт має
 * 101 сторінку, і малювати їх усі заради переходу на одну — марна робота.
 */
export function PdfViewer({
  blobHash,
  pageNo,
  minHeight = 420,
}: {
  blobHash: string;
  /** Сторінка, на якій відкритись. Зміна значення перемикає перегляд. */
  pageNo?: number | null;
  minHeight?: number;
}) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  /** Скасовує рендер сторінки, яка вже не актуальна (швидке гортання). */
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [page, setPage] = useState(pageNo ?? 1);
  /** null → вписувати в ширину; число → явний масштаб. */
  const [zoom, setZoom] = useState<number | null>(null);
  const [rendering, setRendering] = useState(false);

  // Завантаження документа (байти кешуються за хешем у lib/pdf)
  useEffect(() => {
    let alive = true;
    setDoc(null);
    setError(null);
    loadPdfDocument(blobHash).then(
      (loaded) => {
        if (alive) setDoc(loaded);
      },
      (err: unknown) => {
        if (alive) setError(err);
      },
    );
    return () => {
      alive = false;
    };
  }, [blobHash]);

  // Зовнішня зміна цільової сторінки (клік по іншій вимозі у відкритому вьюері)
  useEffect(() => {
    if (pageNo != null) setPage(pageNo);
  }, [pageNo]);

  const draw = useCallback(async () => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!doc || !canvas || !box) return;

    const target = Math.min(doc.numPages, Math.max(1, page));
    setRendering(true);
    try {
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;

      const pdfPage = await doc.getPage(target);
      const base = pdfPage.getViewport({ scale: 1 });
      // Ширина контейнера мінус поля; DPR — щоб текст не був мильним на HiDPI.
      const available = Math.max(160, box.clientWidth - 24);
      const scale = zoom ?? available / base.width;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const viewport = pdfPage.getViewport({ scale });

      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, viewport.width, viewport.height);

      const task = pdfPage.render({ canvas, canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      await task.promise;
      renderTaskRef.current = null;
      setError(null);
    } catch (err) {
      // Скасований рендер — не помилка, а наслідок швидкого перемикання сторінок.
      const name = err instanceof Error ? err.name : '';
      if (name !== 'RenderingCancelledException') setError(err);
    } finally {
      setRendering(false);
    }
  }, [doc, page, zoom]);

  useEffect(() => {
    void draw();
  }, [draw]);

  // Перемальовуємо при зміні ширини — лише в режимі «за шириною»
  useEffect(() => {
    const box = boxRef.current;
    if (!box || zoom != null) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => void draw());
    });
    observer.observe(box);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [draw, zoom]);

  useEffect(() => () => renderTaskRef.current?.cancel(), []);

  if (error && !doc) {
    return (
      <div className="pdf-shell" style={{ minHeight }}>
        <ErrorState error={error} />
      </div>
    );
  }

  const total = doc?.numPages ?? 0;
  const current = Math.min(Math.max(1, page), Math.max(1, total));

  return (
    <div className="pdf-shell" style={{ minHeight }}>
      <div className="pdf-toolbar">
        <button
          type="button"
          className="btn btn-sm"
          title={t.pdf.prev}
          aria-label={t.pdf.prev}
          disabled={!doc || current <= 1}
          onClick={() => setPage(current - 1)}
        >
          ‹
        </button>
        <span className="tabnum small nowrap" aria-live="polite">
          {doc ? t.pdf.pageOf(current, total) : t.pdf.loading}
        </span>
        <button
          type="button"
          className="btn btn-sm"
          title={t.pdf.next}
          aria-label={t.pdf.next}
          disabled={!doc || current >= total}
          onClick={() => setPage(current + 1)}
        >
          ›
        </button>

        <span className="spacer" />

        <button
          type="button"
          className="btn btn-sm"
          title={t.pdf.zoomOut}
          aria-label={t.pdf.zoomOut}
          disabled={!doc}
          onClick={() => setZoom((z) => Math.max(0.25, (z ?? 1) - 0.25))}
        >
          −
        </button>
        <button
          type="button"
          className={`btn btn-sm ${zoom == null ? 'btn-primary' : ''}`}
          disabled={!doc}
          onClick={() => setZoom(null)}
        >
          {t.pdf.fitWidth}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          title={t.pdf.zoomIn}
          aria-label={t.pdf.zoomIn}
          disabled={!doc}
          onClick={() => setZoom((z) => Math.min(4, (z ?? 1) + 0.25))}
        >
          +
        </button>
      </div>

      <div className="pdf-canvas-box" ref={boxRef}>
        {!doc && <div className="pdf-placeholder">{t.pdf.loading}</div>}
        <canvas ref={canvasRef} className={`pdf-canvas ${rendering ? 'is-rendering' : ''}`} />
        {error != null && doc != null && (
          <div className="callout callout-danger">{t.pdf.renderFailed}</div>
        )}
      </div>
    </div>
  );
}
