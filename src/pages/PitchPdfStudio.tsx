import { useState } from "react";
import { PDFDocument, degrees } from "pdf-lib";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { PageOrganizer } from "@/components/pdf-pages/PageOrganizer";
import { isPageToolsEnabled } from "@/lib/pdf-pages/featureGate";

type Action = "merge" | "split" | "rotate" | "reverse" | "number" | "watermark" | "metadata";
const download = (bytes: Uint8Array, name: string) => {
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
};
const load = async (file: File) => PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
export default function PitchPdfStudio() {
  if (isPageToolsEnabled()) return <GlobalLayout><main className="p-4 space-y-4"><header><h1 className="text-2xl font-bold">PITCH PDF Studio · Page Organizer</h1><p className="text-sm text-muted-foreground">Merge, split, reorder, rotate, crop, resize, number, stamp and watermark PDFs in your browser. Originals stay unchanged.</p></header><PageOrganizer /></main></GlobalLayout>;
  return <LegacyPdfStudio />;
}
function LegacyPdfStudio() {
  const [files, setFiles] = useState<File[]>([]);
  const [action, setAction] = useState<Action>("merge");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pageRange, setPageRange] = useState("1");
  const [angle, setAngle] = useState("90");
  const [label, setLabel] = useState("DRAFT");
  const execute = async () => {
    if (!files.length) return;
    setBusy(true); setError("");
    try {
      if (action === "merge") {
        const result = await PDFDocument.create();
        for (const file of files) {
          const source = await load(file);
          const pages = await result.copyPages(source, source.getPageIndices());
          pages.forEach(page => result.addPage(page));
        }
        download(await result.save(), "pitch-merged.pdf");
      } else if (action === "split") {
        const source = await load(files[0]);
        const indices = pageRange.split(",").flatMap(part => {
          const match = part.trim().match(/^(\d+)(?:-(\d+))?$/);
          if (!match) throw new Error("Use page numbers like 1,3-5");
          const start = Number(match[1]), end = Number(match[2] ?? match[1]);
          if (start < 1 || end < start || end > source.getPageCount()) throw new Error("Page range exceeds document");
          return Array.from({ length: end - start + 1 }, (_, i) => start + i - 1);
        });
        const result = await PDFDocument.create();
        (await result.copyPages(source, indices)).forEach(page => result.addPage(page));
        download(await result.save(), "pitch-extracted.pdf");
      } else if (action === "reverse") {
        const source = await load(files[0]);
        const result = await PDFDocument.create();
        (await result.copyPages(source, source.getPageIndices().reverse())).forEach(page => result.addPage(page));
        download(await result.save(), "pitch-reversed.pdf");
      } else if (action === "number" || action === "watermark" || action === "metadata") {
        const source = await load(files[0]);
        if (action === "metadata") {
          source.setTitle(label); source.setProducer("PITCH PDF Studio");
        } else {
          const pages = source.getPages();
          pages.forEach((page, i) => {
            const { width, height } = page.getSize();
            if (action === "number") page.drawText(`${i + 1} / ${pages.length}`, { x: width / 2 - 15, y: 18, size: 10 });
            else page.drawText(label, { x: 35, y: height / 2, size: 35, opacity: 0.28, rotate: degrees(35) });
          });
        }
        download(await source.save(), `pitch-${action}.pdf`);
      } else {
        const source = await load(files[0]);
        const rotation = Number(angle);
        for (const page of source.getPages()) page.setRotation(degrees((page.getRotation().angle + rotation) % 360));
        download(await source.save(), "pitch-rotated.pdf");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to process PDF");
    } finally { setBusy(false); }
  };
  return <GlobalLayout>
    <main className="mx-auto max-w-4xl p-6 space-y-6">
      <header><h1 className="text-3xl font-bold">PITCH PDF Studio</h1><p className="text-muted-foreground">Process PDF documents locally in your browser. Originals remain unchanged.</p></header>
      <section className="rounded-xl border p-6 space-y-4">
        <label className="block font-medium" htmlFor="pitch-pdf-upload">Choose PDF documents</label>
        <input id="pitch-pdf-upload" aria-label="Choose PDF documents" type="file" accept="application/pdf,.pdf" multiple
          onChange={e => { setFiles(Array.from(e.target.files ?? [])); setError(""); }} />
        <p className="text-sm text-muted-foreground">{files.length} file(s) selected. Merge respects selection order.</p>
        <label className="block font-medium" htmlFor="pitch-pdf-operation">Operation</label>
        <select id="pitch-pdf-operation" className="w-full rounded border bg-background p-2" value={action} onChange={e => setAction(e.target.value as Action)}>
          <option value="merge">Merge PDFs</option><option value="split">Extract pages</option><option value="rotate">Rotate all pages</option><option value="reverse">Reverse page order</option><option value="number">Add page numbers</option><option value="watermark">Add watermark</option><option value="metadata">Set PDF title metadata</option>
        </select>
        {action === "split" && <label className="block">Pages (example: 1,3-5)<input className="block w-full rounded border bg-background p-2" value={pageRange} onChange={e=>setPageRange(e.target.value)}/></label>}
        {action === "rotate" && <label className="block">Rotation<select className="block w-full rounded border bg-background p-2" value={angle} onChange={e=>setAngle(e.target.value)}><option value="90">90° clockwise</option><option value="180">180°</option><option value="270">270° clockwise</option></select></label>}
        {(action === "watermark" || action === "metadata") && <label className="block">{action === "metadata" ? "Document title" : "Watermark text"}<input className="block w-full rounded border bg-background p-2" value={label} onChange={e=>setLabel(e.target.value.slice(0,120))}/></label>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <button className="rounded bg-primary px-5 py-2 text-primary-foreground disabled:opacity-50" onClick={execute} disabled={busy || !files.length}>{busy ? "Processing…" : "Process and download PDF"}</button>
      </section>
      <p className="text-sm text-muted-foreground">The advanced PdfCraft Rust/WASM engine is not enabled yet. Existing PITCH editor, OCR, signature and blueprint tools remain available separately.</p>
    </main>
  </GlobalLayout>;
}
