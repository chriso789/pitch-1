import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@/lib/pdfRenderer";
import * as pdfjsLib from "pdfjs-dist";
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable, arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Undo2, Redo2, RotateCw, RotateCcw, Copy, Trash2, FilePlus2, FileStack, ArrowDownUp, Scissors, Download, Save, Loader2, ZoomIn, ZoomOut, Eye, AlertTriangle, Crop } from "lucide-react";
import { compilePlan, inspectPdf, newKey, pageMap, parseRange, planFromSource, planWarnings, splitPlan, readBookmarks, type Bookmark, type Inspection, type PlanPage, type SourcePdf, type Stamp } from "@/lib/pdf-pages/pageOps";
import { PDFDocument } from "pdf-lib";

type Thumbs = Record<string, string>; // `${sourceId}:${index}` -> dataURL

export interface SaveResult { bytes: Uint8Array; pageMap: ReturnType<typeof pageMap>; summary: string }

interface Props {
  initial?: SourcePdf | null;
  onSaveVersion?: (r: SaveResult) => Promise<void>; // omitted => download only
  saveLabel?: string;
}

const dl = (bytes: Uint8Array, name: string) => {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};

async function renderThumbs(src: SourcePdf, width: number): Promise<Thumbs> {
  const pdf = await pdfjsLib.getDocument({ data: src.bytes.slice() }).promise;
  const out: Thumbs = {};
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp0 = page.getViewport({ scale: 1, rotation: 0 });
    const vp = page.getViewport({ scale: width / Math.max(vp0.width, vp0.height), rotation: 0 });
    const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext("2d")!, viewport: vp }).promise;
    out[`${src.id}:${i - 1}`] = c.toDataURL("image/jpeg", 0.7);
  }
  pdf.destroy();
  return out;
}

function Tile({ p, idx, thumb, selected, onClick, size, baseRotation }: { p: PlanPage; idx: number; thumb?: string; selected: boolean; onClick: (e: React.MouseEvent) => void; size: number; baseRotation: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.key });
  const rot = (baseRotation + p.rotate) % 360;
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, width: size }} {...attributes} {...listeners}
      onClick={onClick} className={`relative cursor-grab select-none rounded-md border-2 bg-card p-1 ${selected ? "border-primary ring-2 ring-primary/30" : "border-border"} ${isDragging ? "opacity-60 z-10" : ""}`}
      aria-label={`Page ${idx + 1}`} aria-selected={selected}>
      <div className="flex items-center justify-center bg-muted overflow-hidden" style={{ height: size }}>
        {p.sourceId ? (thumb ? <img src={thumb} alt="" draggable={false} style={{ transform: `rotate(${rot}deg)`, maxWidth: "100%", maxHeight: "100%",
          clipPath: p.crop ? `inset(${(1 - p.crop.y - p.crop.h) * 100}% ${(1 - p.crop.x - p.crop.w) * 100}% ${p.crop.y * 100}% ${p.crop.x * 100}%)` : undefined }} />
          : <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />)
          : <div className="bg-background border w-2/3 h-5/6 text-xs text-muted-foreground flex items-center justify-center">Blank</div>}
      </div>
      <div className="flex justify-between items-center text-[11px] mt-1 px-0.5"><span className="font-medium">{idx + 1}</span>
        <span className="text-muted-foreground flex gap-1">{p.rotate ? `${p.rotate}°` : ""}{p.crop ? " crop" : ""}{p.size && p.sourceId ? " resized" : ""}</span></div>
    </div>
  );
}

export function PageOrganizer({ initial, onSaveVersion, saveLabel = "Save new version" }: Props) {
  const [sources, setSources] = useState<SourcePdf[]>([]);
  const [info, setInfo] = useState<Record<string, Inspection>>({});
  const [thumbs, setThumbs] = useState<Thumbs>({});
  const [hist, setHist] = useState<{ stack: PlanPage[][]; i: number }>({ stack: [[]], i: 0 });
  const plan = hist.stack[hist.i];
  const [sel, setSel] = useState<Set<string>>(new Set());
  const anchor = useRef<number | null>(null);
  const [size, setSize] = useState(150);
  const [busy, setBusy] = useState<string | null>(null);
  // output options
  const [pn, setPn] = useState({ on: false, format: "Page {n} of {total}", position: "bottom-right" as const, start: 1, size: 10 });
  const [hf, setHf] = useState({ on: false, hl: "", hc: "", hr: "", fl: "", fc: "", fr: "", size: 9 });
  const [wm, setWm] = useState({ on: false, text: "FOR REVIEW", size: 72, opacity: 0.18, angle: 35 });
  const [img, setImg] = useState<{ bytes: Uint8Array; type: "png" | "jpg"; opacity: number; scale: number } | null>(null);
  const [stampRange, setStampRange] = useState("");
  const [meta, setMeta] = useState({ title: "", author: "", subject: "", keywords: "" });
  const [marks, setMarks] = useState<Bookmark[] | null>(null);
  const [splitEvery, setSplitEvery] = useState(1);
  const [rangeText, setRangeText] = useState("");
  const [crop, setCrop] = useState({ l: 0, r: 0, t: 0, b: 0 });
  const [resize, setResize] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const commit = useCallback((next: PlanPage[]) => setHist((h) => ({ stack: [...h.stack.slice(0, h.i + 1), next].slice(-100), i: Math.min(h.i + 1, 99) })), []);
  const undo = () => setHist((h) => ({ ...h, i: Math.max(0, h.i - 1) }));
  const redo = () => setHist((h) => ({ ...h, i: Math.min(h.stack.length - 1, h.i + 1) }));

  const addSource = useCallback(async (src: SourcePdf, append: boolean) => {
    try {
      const ins = await inspectPdf(src.bytes);
      if (ins.encrypted) toast.warning(`"${src.name}" is encrypted; edits may fail or remove protection.`);
      setSources((s) => [...s, src]); setInfo((m) => ({ ...m, [src.id]: ins }));
      const pages = planFromSource(src, ins.pageCount);
      if (!append) {
        setHist({ stack: [pages], i: 0 });
        setMeta({ title: ins.metadata.title ?? "", author: ins.metadata.author ?? "", subject: ins.metadata.subject ?? "", keywords: (ins.metadata.keywords ?? []).join(", ") });
      }
      renderThumbs(src, 220).then((t) => setThumbs((o) => ({ ...o, ...t }))).catch(() => toast.error("Could not draw page previews"));
      return pages;
    } catch (e: any) { toast.error(`Could not open "${src.name}": ${e.message ?? e}`); return []; }
  }, []);

  useEffect(() => { if (initial && !sources.length) addSource(initial, false); }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const readFiles = async (files: FileList | null) => Promise.all(Array.from(files ?? []).filter((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name))
    .map(async (f) => ({ id: crypto.randomUUID(), name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));

  const selectedIdx = useMemo(() => plan.map((p, i) => (sel.has(p.key) ? i : -1)).filter((i) => i >= 0), [plan, sel]);
  const targets = selectedIdx.length ? selectedIdx : [];
  const needSel = () => { if (!targets.length) { toast.info("Select one or more pages first (click, Shift-click, Ctrl/Cmd-click)."); return false; } return true; };

  const onTileClick = (i: number, e: React.MouseEvent) => {
    const key = plan[i].key; const s = new Set(e.metaKey || e.ctrlKey ? sel : []);
    if (e.shiftKey && anchor.current != null) { const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)]; for (let k = a; k <= b; k++) s.add(plan[k].key); }
    else { if (s.has(key) && (e.metaKey || e.ctrlKey)) s.delete(key); else s.add(key); anchor.current = i; }
    setSel(s);
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = plan.findIndex((p) => p.key === e.active.id), to = plan.findIndex((p) => p.key === e.over!.id);
    if (sel.has(String(e.active.id)) && sel.size > 1) { // move the whole selection as a block
      const moving = plan.filter((p) => sel.has(p.key)); const rest = plan.filter((p) => !sel.has(p.key));
      const anchorKey = plan[to].key; let at = rest.findIndex((p) => p.key === anchorKey); if (at < 0) at = rest.length; if (to > from) at += 1;
      commit([...rest.slice(0, at), ...moving, ...rest.slice(at)]);
    } else commit(arrayMove(plan, from, to));
  };

  const rotate = (d: number) => needSel() && commit(plan.map((p, i) => (targets.includes(i) ? { ...p, rotate: (p.rotate + d + 360) % 360 } : p)));
  const remove = () => { if (!needSel()) return; if (targets.length === plan.length) return toast.error("A PDF needs at least one page."); commit(plan.filter((_, i) => !targets.includes(i))); setSel(new Set()); };
  const duplicate = () => { if (!needSel()) return; const out: PlanPage[] = []; plan.forEach((p, i) => { out.push(p); if (targets.includes(i)) out.push({ ...p, key: newKey() }); }); commit(out); };
  const insertBlank = () => {
    const at = targets.length ? Math.max(...targets) + 1 : plan.length;
    const ref = plan[at - 1] ?? plan[0]; const ri = ref?.sourceId ? info[ref.sourceId]?.pages[ref.sourceIndex] : null;
    const sz: [number, number] = ref?.size ?? (ri ? [ri.width, ri.height] : [612, 792]);
    commit([...plan.slice(0, at), { key: newKey(), sourceId: null, sourceIndex: 0, rotate: 0, size: sz }, ...plan.slice(at)]);
  };
  const reverse = () => { if (targets.length > 1) { const rev = [...targets].reverse().map((i) => plan[i]); const out = [...plan]; targets.forEach((i, k) => (out[i] = rev[k])); commit(out); } else commit([...plan].reverse()); };
  const selectRange = () => { try { const nums = parseRange(rangeText, plan.length); setSel(new Set(nums.map((n) => plan[n - 1].key))); } catch (e: any) { toast.error(e.message); } };
  const applyCrop = () => {
    if (!needSel()) return; const { l, r, t, b } = crop;
    if (l + r >= 95 || t + b >= 95) return toast.error("Crop would leave almost nothing visible.");
    const c = l || r || t || b ? { x: l / 100, y: b / 100, w: 1 - (l + r) / 100, h: 1 - (t + b) / 100 } : null;
    commit(plan.map((p, i) => (targets.includes(i) && p.sourceId ? { ...p, crop: c } : p)));
  };
  const SIZES: Record<string, [number, number]> = { letter: [612, 792], legal: [612, 1008], tabloid: [792, 1224], "arch-d": [1728, 2592], "arch-e": [2592, 3456], "ansi-d": [1584, 2448] };
  const applyResize = () => {
    if (!needSel() || !resize) return;
    commit(plan.map((p, i) => {
      if (!targets.includes(i)) return p;
      if (resize === "original") return { ...p, size: p.sourceId ? undefined : p.size };
      const base = SIZES[resize]; const ri = p.sourceId ? info[p.sourceId]?.pages[p.sourceIndex] : null;
      const landscape = ri ? ri.width > ri.height : false; return { ...p, size: (landscape ? [base[1], base[0]] : base) as [number, number] };
    }));
  };

  const stamps = (): Stamp | undefined => {
    let pages: number[] | undefined; if (stampRange.trim()) pages = parseRange(stampRange, plan.length);
    const s: Stamp = { pages };
    if (pn.on) s.pageNumbers = pn;
    if (hf.on) { s.header = { left: hf.hl, center: hf.hc, right: hf.hr, size: hf.size }; s.footer = { left: hf.fl, center: hf.fc, right: hf.fr, size: hf.size }; }
    if (wm.on) s.textWatermark = wm;
    if (img) s.imageWatermark = img;
    return s.pageNumbers || s.header || s.textWatermark || s.imageWatermark ? s : undefined;
  };
  const opts = () => ({ stamps: stamps(), metadata: { title: meta.title, author: meta.author, subject: meta.subject, keywords: meta.keywords.split(",").map((k) => k.trim()).filter(Boolean) }, bookmarks: marks });
  const warnings = useMemo(() => (sources.length ? planWarnings(plan, sources, info, { stamps: pn.on || hf.on || wm.on || img ? {} : undefined }) : []), [plan, sources, info, pn.on, hf.on, wm.on, img]);

  /** Compile, then re-open the result and verify page count/order/sizes/annotations. */
  const build = async (subset?: PlanPage[]) => {
    const p = subset ?? plan;
    const bytes = await compilePlan(p, sources, subset ? {} : opts());
    const check = await PDFDocument.load(bytes, { ignoreEncryption: true });
    if (check.getPageCount() !== p.length) throw new Error(`Verification failed: expected ${p.length} pages, got ${check.getPageCount()}`);
    const pages = check.getPages();
    p.forEach((pp, i) => {
      const src = pp.sourceId ? info[pp.sourceId]?.pages[pp.sourceIndex] : null;
      if (src && !pp.size && !pp.crop && (Math.abs(pages[i].getWidth() - src.width) > 0.5 || Math.abs(pages[i].getHeight() - src.height) > 0.5)) throw new Error(`Verification failed: page ${i + 1} size changed`);
      if (src && (pages[i].node.Annots()?.size() ?? 0) < src.annotations) throw new Error(`Verification failed: page ${i + 1} lost annotations`);
    });
    return bytes;
  };
  const run = async (label: string, fn: () => Promise<void>) => { setBusy(label); try { await fn(); } catch (e: any) { toast.error(e.message ?? String(e)); } finally { setBusy(null); } };
  const baseName = (sources[0]?.name ?? "document").replace(/\.pdf$/i, "");

  const preview = () => run("preview", async () => { const b = await build(); window.open(URL.createObjectURL(new Blob([b as BlobPart], { type: "application/pdf" })), "_blank"); });
  const download = () => run("download", async () => { dl(await build(), `${baseName}-edited.pdf`); toast.success("Downloaded and verified."); });
  const extract = () => run("extract", async () => { if (!needSel()) return; dl(await build(targets.map((i) => plan[i])), `${baseName}-pages.pdf`); });
  const split = () => run("split", async () => { const parts = await splitPlan(plan, sources, splitEvery); parts.forEach((b, i) => dl(b, `${baseName}-part${i + 1}.pdf`)); toast.success(`Split into ${parts.length} files.`); });
  const save = () => run("save", async () => {
    if (!onSaveVersion) return;
    if (warnings.some((w) => /signature/.test(w)) && !window.confirm("Saving will invalidate the digital signatures in this document. Continue?")) return;
    const bytes = await build();
    await onSaveVersion({ bytes, pageMap: pageMap(plan), summary: `${plan.length} pages${stamps() ? ", stamped" : ""}` });
  });
  const loadBookmarks = async () => { if (!sources[0]) return; const d = await PDFDocument.load(sources[0].bytes, { ignoreEncryption: true }); setMarks(readBookmarks(d).map((b) => ({ ...b, page: Math.max(1, plan.findIndex((p) => p.sourceId === sources[0].id && p.sourceIndex === b.page - 1) + 1) }))); };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") { e.preventDefault(); setSel(new Set(plan.map((p) => p.key))); }
      if (e.key === "Delete" || e.key === "Backspace") remove();
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  });

  if (!sources.length) return (
    <div className="rounded-xl border border-dashed p-10 text-center space-y-3">
      <p className="font-medium">Open a PDF to organize its pages</p>
      <Input type="file" accept="application/pdf,.pdf" multiple aria-label="Open PDF" className="max-w-sm mx-auto" onChange={async (e) => { const fs = await readFiles(e.target.files); if (!fs.length) return; await addSource(fs[0], false); for (const f of fs.slice(1)) { const pg = await addSource(f, true); setHist((h) => ({ stack: [[...h.stack[h.i], ...pg]], i: 0 })); } }} />
      <p className="text-xs text-muted-foreground">Selecting several files merges them in the order chosen. Files are processed in your browser; originals are never changed.</p>
    </div>
  );

  const B = ({ icon: I, label, onClick, disabled }: any) => <Button variant="outline" size="sm" onClick={onClick} disabled={disabled || !!busy}><I className="h-4 w-4 mr-1" />{label}</Button>;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-3 min-w-0">
        <div className="flex flex-wrap gap-1.5 items-center rounded-lg border bg-card p-2 sticky top-0 z-20">
          <Button variant="ghost" size="icon" onClick={undo} disabled={hist.i === 0} title="Undo (Ctrl+Z)"><Undo2 className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" onClick={redo} disabled={hist.i >= hist.stack.length - 1} title="Redo (Ctrl+Shift+Z)"><Redo2 className="h-4 w-4" /></Button>
          <B icon={RotateCcw} label="Left" onClick={() => rotate(-90)} /><B icon={RotateCw} label="Right" onClick={() => rotate(90)} />
          <B icon={Copy} label="Duplicate" onClick={duplicate} /><B icon={Trash2} label="Delete" onClick={remove} />
          <B icon={FilePlus2} label="Blank page" onClick={insertBlank} /><B icon={ArrowDownUp} label="Reverse" onClick={reverse} />
          <label className="inline-flex"><span className="sr-only">Insert pages from another PDF</span>
            <Input type="file" accept="application/pdf,.pdf" multiple className="hidden" id="insert-pdf" onChange={async (e) => {
              const fs = await readFiles(e.target.files); e.target.value = "";
              for (const f of fs) { const pg = await addSource(f, true); const at = targets.length ? Math.max(...targets) + 1 : plan.length; setHist((h) => { const cur = h.stack[h.i]; const next = [...cur.slice(0, at), ...pg, ...cur.slice(at)]; return { stack: [...h.stack.slice(0, h.i + 1), next], i: h.i + 1 }; }); }
            }} />
            <Button variant="outline" size="sm" asChild><span onClick={() => document.getElementById("insert-pdf")?.click()} className="cursor-pointer"><FileStack className="h-4 w-4 mr-1" />Insert / merge PDF</span></Button></label>
          <div className="flex-1" />
          <Button variant="ghost" size="icon" onClick={() => setSize((s) => Math.max(90, s - 30))} title="Smaller"><ZoomOut className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" onClick={() => setSize((s) => Math.min(360, s + 30))} title="Larger"><ZoomIn className="h-4 w-4" /></Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{plan.length} pages · {sel.size} selected</span>
          <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setSel(new Set(plan.map((p) => p.key)))}>Select all</Button>
          <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setSel(new Set())}>Clear</Button>
          <Input value={rangeText} onChange={(e) => setRangeText(e.target.value)} placeholder="e.g. 1,3-5" className="h-7 w-28" aria-label="Select pages by range" />
          <Button variant="outline" size="sm" className="h-7" onClick={selectRange}>Select</Button>
          {sources.length > 1 && <span>· {sources.length} files merged</span>}
        </div>
        {warnings.length > 0 && <Alert><AlertTriangle className="h-4 w-4" /><AlertDescription><ul className="list-disc pl-4 text-sm">{warnings.map((w) => <li key={w}>{w}</li>)}</ul></AlertDescription></Alert>}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={plan.map((p) => p.key)} strategy={rectSortingStrategy}>
            <div className="flex flex-wrap gap-3">
              {plan.map((p, i) => <Tile key={p.key} p={p} idx={i} size={size} selected={sel.has(p.key)} onClick={(e) => onTileClick(i, e)}
                thumb={p.sourceId ? thumbs[`${p.sourceId}:${p.sourceIndex}`] : undefined} baseRotation={p.sourceId ? info[p.sourceId]?.pages[p.sourceIndex]?.rotation ?? 0 : 0} />)}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <aside className="space-y-3">
        <div className="rounded-lg border bg-card p-3 space-y-2">
          <Button className="w-full" variant="outline" onClick={preview} disabled={!!busy}>{busy === "preview" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Eye className="h-4 w-4 mr-1" />}Preview final PDF</Button>
          <Button className="w-full" variant="outline" onClick={download} disabled={!!busy}>{busy === "download" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}Download</Button>
          {onSaveVersion && <Button className="w-full" onClick={save} disabled={!!busy}>{busy === "save" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}{saveLabel}</Button>}
          <p className="text-xs text-muted-foreground">Every output is re-opened and checked (page count, sizes, annotations) before it is downloaded or saved.</p>
        </div>
        <Tabs defaultValue="pages">
          <TabsList className="grid grid-cols-4 w-full"><TabsTrigger value="pages">Pages</TabsTrigger><TabsTrigger value="stamp">Stamp</TabsTrigger><TabsTrigger value="split">Split</TabsTrigger><TabsTrigger value="info">Info</TabsTrigger></TabsList>
          <TabsContent value="pages" className="rounded-lg border bg-card p-3 space-y-3">
            <div className="space-y-1"><Label className="flex items-center gap-1"><Crop className="h-3.5 w-3.5" />Crop selected (% trimmed)</Label>
              <div className="grid grid-cols-4 gap-1">{(["l", "r", "t", "b"] as const).map((k) => <Input key={k} type="number" min={0} max={90} value={crop[k]} aria-label={`Trim ${k}`} placeholder={k} onChange={(e) => setCrop({ ...crop, [k]: Math.max(0, Math.min(90, Number(e.target.value))) })} />)}</div>
              <p className="text-[11px] text-muted-foreground">Left · Right · Top · Bottom. Set all to 0 to remove a crop.</p>
              <Button size="sm" variant="outline" onClick={applyCrop}>Apply crop</Button></div>
            <div className="space-y-1"><Label>Resize selected to</Label>
              <select className="w-full rounded border bg-background p-2 text-sm" value={resize} onChange={(e) => setResize(e.target.value)}>
                <option value="">Choose size…</option><option value="original">Original size</option><option value="letter">Letter 8.5×11</option><option value="legal">Legal 8.5×14</option><option value="tabloid">Tabloid 11×17</option><option value="ansi-d">ANSI D 22×34</option><option value="arch-d">ARCH D 24×36</option><option value="arch-e">ARCH E 36×48</option></select>
              <Button size="sm" variant="outline" onClick={applyResize}>Apply size</Button></div>
            <Button size="sm" variant="outline" onClick={extract} disabled={!!busy}><Download className="h-4 w-4 mr-1" />Download selected pages only</Button>
          </TabsContent>
          <TabsContent value="stamp" className="rounded-lg border bg-card p-3 space-y-3 text-sm">
            <div className="flex items-center justify-between"><Label>Page numbers</Label><Switch checked={pn.on} onCheckedChange={(on) => setPn({ ...pn, on })} /></div>
            {pn.on && <div className="grid grid-cols-2 gap-1"><Input value={pn.format} onChange={(e) => setPn({ ...pn, format: e.target.value })} className="col-span-2" aria-label="Number format" />
              <select className="rounded border bg-background p-1" value={pn.position} onChange={(e) => setPn({ ...pn, position: e.target.value as any })}><option value="bottom-right">Bottom right</option><option value="bottom-center">Bottom center</option><option value="bottom-left">Bottom left</option><option value="top-right">Top right</option></select>
              <Input type="number" min={1} value={pn.start} onChange={(e) => setPn({ ...pn, start: Math.max(1, Number(e.target.value)) })} aria-label="Start number" /></div>}
            <div className="flex items-center justify-between"><Label>Header &amp; footer</Label><Switch checked={hf.on} onCheckedChange={(on) => setHf({ ...hf, on })} /></div>
            {hf.on && <div className="grid grid-cols-3 gap-1">{(["hl", "hc", "hr", "fl", "fc", "fr"] as const).map((k) => <Input key={k} value={hf[k]} placeholder={`${k[0] === "h" ? "Header" : "Footer"} ${({ l: "left", c: "center", r: "right" } as any)[k[1]]}`} onChange={(e) => setHf({ ...hf, [k]: e.target.value })} />)}<p className="col-span-3 text-[11px] text-muted-foreground">Use {"{n}"} and {"{total}"} for page numbers.</p></div>}
            <div className="flex items-center justify-between"><Label>Text watermark</Label><Switch checked={wm.on} onCheckedChange={(on) => setWm({ ...wm, on })} /></div>
            {wm.on && <div className="grid grid-cols-3 gap-1"><Input className="col-span-3" value={wm.text} onChange={(e) => setWm({ ...wm, text: e.target.value.slice(0, 80) })} aria-label="Watermark text" />
              <Input type="number" value={wm.size} onChange={(e) => setWm({ ...wm, size: Number(e.target.value) })} aria-label="Size" /><Input type="number" step={0.05} min={0.05} max={1} value={wm.opacity} onChange={(e) => setWm({ ...wm, opacity: Number(e.target.value) })} aria-label="Opacity" /><Input type="number" value={wm.angle} onChange={(e) => setWm({ ...wm, angle: Number(e.target.value) })} aria-label="Angle" /></div>}
            <div className="space-y-1"><Label>Image watermark / logo (PNG or JPG)</Label>
              <Input type="file" accept="image/png,image/jpeg" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return setImg(null); setImg({ bytes: new Uint8Array(await f.arrayBuffer()), type: /png/.test(f.type) ? "png" : "jpg", opacity: 0.15, scale: 0.5 }); }} />
              {img && <div className="grid grid-cols-2 gap-1"><Input type="number" step={0.05} value={img.opacity} onChange={(e) => setImg({ ...img, opacity: Number(e.target.value) })} aria-label="Image opacity" /><Input type="number" step={0.05} value={img.scale} onChange={(e) => setImg({ ...img, scale: Number(e.target.value) })} aria-label="Image scale" /><Button size="sm" variant="ghost" onClick={() => setImg(null)}>Remove image</Button></div>}</div>
            <div className="space-y-1"><Label>Only stamp pages</Label><Input value={stampRange} onChange={(e) => setStampRange(e.target.value)} placeholder="All pages (or e.g. 2-10)" /></div>
            <p className="text-[11px] text-muted-foreground">Stamps are added on top of the page and appear in Preview, Download and saved versions.</p>
          </TabsContent>
          <TabsContent value="split" className="rounded-lg border bg-card p-3 space-y-2 text-sm">
            <Label>Split into files of N pages</Label><Input type="number" min={1} value={splitEvery} onChange={(e) => setSplitEvery(Math.max(1, Number(e.target.value)))} />
            <Button size="sm" variant="outline" onClick={split} disabled={!!busy}><Scissors className="h-4 w-4 mr-1" />Split &amp; download</Button>
            <p className="text-[11px] text-muted-foreground">Uses the current page order. To pull specific pages, select them and use "Download selected pages only".</p>
          </TabsContent>
          <TabsContent value="info" className="rounded-lg border bg-card p-3 space-y-2 text-sm">
            {(["title", "author", "subject", "keywords"] as const).map((k) => <div key={k}><Label className="capitalize">{k}</Label><Input value={meta[k]} onChange={(e) => setMeta({ ...meta, [k]: e.target.value })} /></div>)}
            <div className="flex items-center justify-between pt-2"><Label>Bookmarks</Label>
              {marks === null ? <Button size="sm" variant="outline" onClick={loadBookmarks}>Edit bookmarks</Button> : <Button size="sm" variant="ghost" onClick={() => setMarks(null)}>Keep original</Button>}</div>
            {marks === null ? <p className="text-[11px] text-muted-foreground">Original bookmarks are kept and follow their pages ({info[sources[0].id]?.bookmarkCount ?? 0} found).</p> : <div className="space-y-1">
              {marks.map((m, i) => <div key={i} className="flex gap-1"><Input value={m.title} onChange={(e) => setMarks(marks.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} /><Input type="number" className="w-16" min={1} max={plan.length} value={m.page} onChange={(e) => setMarks(marks.map((x, j) => (j === i ? { ...x, page: Number(e.target.value) } : x)))} /><Button size="icon" variant="ghost" onClick={() => setMarks(marks.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button></div>)}
              <Button size="sm" variant="outline" onClick={() => setMarks([...marks, { title: `Page ${(selectedIdx[0] ?? 0) + 1}`, page: (selectedIdx[0] ?? 0) + 1 }])}>Add bookmark</Button></div>}
            <div className="pt-2 flex flex-wrap gap-1">{sources.map((s) => <Badge key={s.id} variant="secondary">{s.name}: {info[s.id]?.pageCount}p{info[s.id]?.formFieldCount ? `, ${info[s.id].formFieldCount} fields` : ""}{info[s.id]?.hasSignatures ? ", signed" : ""}</Badge>)}</div>
          </TabsContent>
        </Tabs>
      </aside>
    </div>
  );
}
