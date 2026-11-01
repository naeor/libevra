import { useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useI18n } from "../i18n/index.js";

/** 仅绘制当前页，不执行 PDF 动作或脚本；关闭时终止读取并释放文档。 */
export function AttachmentPdf({ url }: { url: string }): React.JSX.Element {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1), [width, setWidth] = useState(0), [zoom, setZoom] = useState(1);
  const [error, setError] = useState(false), [loading, setLoading] = useState(true), [text, setText] = useState("");
  useEffect(() => {
    let active = true, task: PDFDocumentLoadingTask | undefined;
    setDocument(null); setPage(1); setError(false); setLoading(true);
    void import("pdfjs-dist").then(pdf => {
      if (!active) return;
      pdf.GlobalWorkerOptions.workerSrc = workerUrl;
      task = pdf.getDocument({ url, withCredentials: true, disableAutoFetch: true, disableStream: true, rangeChunkSize: 1024 * 1024,
        cMapUrl: "/pdfjs-assets/cmaps/", standardFontDataUrl: "/pdfjs-assets/standard_fonts/", wasmUrl: "/pdfjs-assets/wasm/", useWasm: false, enableXfa: false });
      return task.promise.then(doc => { if (active) setDocument(doc); });
    }).catch(() => { if (active) { setError(true); setLoading(false); } });
    return () => { active = false; void task?.destroy(); };
  }, [url]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(0, entries[0]!.contentRect.width - 16)));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!document || !width || !canvas.current) return;
    let active = true, render: RenderTask | undefined;
    setError(false); setLoading(true); setText("");
    void document.getPage(page).then(async pdfPage => {
      if (!active || !canvas.current) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const cssScale = width / base.width * zoom;
      const scale = Math.min(cssScale * Math.min(window.devicePixelRatio || 1, 2), Math.sqrt(6_000_000 / (base.width * base.height)));
      const viewport = pdfPage.getViewport({ scale });
      const target = canvas.current;
      target.width = Math.ceil(viewport.width); target.height = Math.ceil(viewport.height);
      target.style.width = `${base.width * cssScale}px`; target.style.height = `${base.height * cssScale}px`;
      render = pdfPage.render({ canvas: target, viewport, annotationMode: 0 });
      await render.promise;
      const content = await pdfPage.getTextContent();
      if (active) { setText(content.items.map(item => "str" in item ? item.str : "").join(" ")); setLoading(false); }
    }).catch(() => { if (active) { setError(true); setLoading(false); } });
    return () => { active = false; render?.cancel(); };
  }, [document, page, width, zoom]);
  return <section className="lv-attachment-pdf" aria-label={t("attachments.pdf")}>
    <div className="flex flex-wrap items-center gap-2 text-helper">
      <button className="lv-desk-btn" disabled={!document || page <= 1} onClick={() => setPage(n => n - 1)}>{t("attachments.previousPage")}</button>
      <span>{document ? t("attachments.page", { page, total: document.numPages }) : t("attachments.loadingPreview")}</span>
      <button className="lv-desk-btn" disabled={!document || page >= document.numPages} onClick={() => setPage(n => n + 1)}>{t("attachments.nextPage")}</button>
      <div className="lv-attachment-zoom" role="group" aria-label={t("attachments.zoom")}>
        {[1, 1.5, 2].map(value => <button type="button" key={value} aria-pressed={zoom === value} onClick={() => setZoom(value)}>{value === 1 ? t("attachments.fitWidth") : `${value * 100}%`}</button>)}
      </div>
    </div>
    {error ? <p role="alert" className="text-helper text-danger">{t("attachments.previewFailed")}</p> : null}
    <div className="lv-attachment-pdf-page" ref={host} aria-busy={loading}>
      <canvas ref={canvas} role="img" aria-label={t("attachments.page", { page, total: document?.numPages ?? "—" })} />
      <p className="sr-only">{text}</p>
    </div>
  </section>;
}
