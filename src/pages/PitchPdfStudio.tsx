import { useState } from "react";
import { PDFDocument, degrees } from "pdf-lib";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";

type Action = "merge" | "split" | "rotate";
const download = (bytes: Uint8Array, name: string) => {
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
};
const load = async (file: File) => PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
export default function PitchPdfStudio() {
  const [files, setFiles] = useState<File[]>([]);
  const [action, setAction] = useState<Action>("merge");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pageRange, setPageRange] = useState("1");
  const [angle, setAngle] = useState("90");
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
          <option value="merge">Merge PDFs</option><option value="split">Extract pages</option><option value="rotate">Rotate all pages</option>
        </select>
        {action === "split" && <label className="block">Pages (example: 1,3-5)<input className="block w-full rounded border bg-background p-2" value={pageRange} onChange={e=>setPageRange(e.target.value)}/></label>}
        {action === "rotate" && <label className="block">Rotation<select className="block w-full rounded border bg-background p-2" value={angle} onChange={e=>setAngle(e.target.value)}><option value="90">90° clockwise</option><option value="180">180°</option><option value="270">270° clockwise</option></select></label>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <button className="rounded bg-primary px-5 py-2 text-primary-foreground disabled:opacity-50" onClick={execute} disabled={busy || !files.length}>{busy ? "Processing…" : "Process and download PDF"}</button>
      </section>
      <p className="text-sm text-muted-foreground">The advanced PdfCraft Rust/WASM engine is not enabled yet. Existing PITCH editor, OCR, signature and blueprint tools remain available separately.</p>
    </main>
  </GlobalLayout>;
}
