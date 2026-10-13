import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@/lib/pdfRenderer";
import * as pdfjsLib from "pdfjs-dist";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MousePointer2, Type, Highlighter, Underline, Strikethrough, Minus, MoveUpRight, Square, Circle, Spline, Pentagon, Cloud, MessageSquareQuote, StickyNote, Stamp, ImagePlus, Eraser, Undo2, Redo2, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, Trash2, Copy, BringToFront, SendToBack, ArrowUp, ArrowDown, Download, Save, Loader2, Info } from "lucide-react";
import { writeMarkups, readMarkups, boxCorners, BOX_TYPES, type Markup, type MarkupType, type Pt, type RGB } from "@/lib/pdf-markup/markups";

type Tool = "select" | MarkupType;
const TOOLS: { id: Tool; label: string; icon: any; key: string }[] = [
  { id: "select", label: "Select / move", icon: MousePointer2, key: "v" }, { id: "text", label: "Text box", icon: Type, key: "t" },
  { id: "highlight", label: "Highlight", icon: Highlighter, key: "h" }, { id: "underline", label: "Underline", icon: Underline, key: "u" }, { id: "strikeout", label: "Strike through", icon: Strikethrough, key: "k" },
  { id: "line", label: "Line", icon: Minus, key: "l" }, { id: "arrow", label: "Arrow", icon: MoveUpRight, key: "a" }, { id: "rect", label: "Rectangle", icon: Square, key: "r" }, { id: "ellipse", label: "Circle / ellipse", icon: Circle, key: "e" },
  { id: "polyline", label: "Polyline (double-click to finish)", icon: Spline, key: "p" }, { id: "polygon", label: "Polygon (double-click to finish)", icon: Pentagon, key: "g" }, { id: "cloud", label: "Revision cloud (double-click to finish)", icon: Cloud, key: "c" },
  { id: "callout", label: "Callout (drag from the point to the box)", icon: MessageSquareQuote, key: "o" }, { id: "note", label: "Sticky note / comment", icon: StickyNote, key: "n" },
  { id: "stamp", label: "Stamp", icon: Stamp, key: "m" }, { id: "image", label: "Image / logo", icon: ImagePlus, key: "i" }, { id: "cover", label: "Cover & retype (overlay)", icon: Eraser, key: "w" },
];
const STAMPS = ["Approved", "Approved as noted", "Revise & resubmit", "Rejected", "Reviewed", "For construction", "Not for construction", "Void", "Draft"];
const hex = (c: RGB) => "#" + c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
const rgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const css = (c: RGB) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;
const uid = () => (crypto as any).randomUUID?.() ?? `m${Date.now()}${Math.random()}`;
const AUTHOR_KEY = "pitch.markupAuthor";

interface Props { bytes?: Uint8Array | null; name?: string; onSaveVersion?: (out: Uint8Array, summary: string) => Promise<void> }

function cloudSvg(pts: [number, number][], r: number) {
  if (pts.length < 2) return "";
  const area = pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
  const sgn = area > 0 ? 1 : -1; // view space has y down
  let d = `M${pts[0][0]},${pts[0][1]}`;
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length]; const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; const k = Math.max(1, Math.round(len / (r * 2)));
    const nx = (-(b[1] - a[1]) / len) * sgn, ny = ((b[0] - a[0]) / len) * sgn; const h = (len / k) * 0.6;
    for (let j = 0; j < k; j++) {
      const s = [a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k], e = [a[0] + ((b[0] - a[0]) * (j + 1)) / k, a[1] + ((b[1] - a[1]) * (j + 1)) / k];
      d += ` C${s[0] - nx * h},${s[1] - ny * h} ${e[0] - nx * h},${e[1] - ny * h} ${e[0]},${e[1]}`;
    }
  });
  return d + " Z";
}

export function MarkupEditor({ bytes: initialBytes, name: initialName, onSaveVersion }: Props) {
  const [bytes, setBytes] = useState<Uint8Array | null>(initialBytes ?? null);
  const [name, setName] = useState(initialName ?? "document.pdf");
  const [pdf, setPdf] = useState<any>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(0);
  const [vp, setVp] = useState<any>(null);
  const [hist, setHist] = useState<{ stack: Markup[][]; i: number }>({ stack: [[]], i: 0 });
  const markups = hist.stack[hist.i];
  const [others, setOthers] = useState(0);
  const [tool, setTool] = useState<Tool>("select");
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ start?: [number, number]; cur?: [number, number]; pts?: [number, number][] } | null>(null);
  const [style, setStyle] = useState({ color: [0.85, 0.12, 0.12] as RGB, fill: null as RGB | null, width: 2, opacity: 1, fontSize: 14 });
  const [stampLabel, setStampLabel] = useState(STAMPS[0]);
  const [pendingImage, setPendingImage] = useState<{ data: string; type: "png" | "jpg"; url: string; ratio: number } | null>(null);
  const [author, setAuthor] = useState(() => { try { return localStorage.getItem(AUTHOR_KEY) || "PITCH user"; } catch { return "PITCH user"; } });
  const [reply, setReply] = useState("");
  const [flatten, setFlatten] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<null | { kind: "move" | "resize" | "rotate" | "vertex"; id: string; idx?: number; start: Pt; orig: Markup; snapshot: Markup[] }>(null);
  const clip = useRef<Markup | null>(null);
  const imgInput = useRef<HTMLInputElement>(null);

  // ---------- load ----------
  useEffect(() => {
    if (!bytes) return;
    let cancelled = false;
    (async () => {
      try {
        const { markups: ms, otherAnnotations } = await readMarkups(bytes);
        const clean = await writeMarkups(bytes, []); // render without PITCH markups; the SVG layer draws them
        const doc = await pdfjsLib.getDocument({ data: clean }).promise;
        if (cancelled) return;
        setHist({ stack: [ms], i: 0 }); setOthers(otherAnnotations.length); setPdf(doc); setPageIndex(0); setZoom(0);
      } catch (e: any) { toast.error(`Could not open PDF: ${e.message ?? e}`); }
    })();
    return () => { cancelled = true; };
  }, [bytes]);

  useEffect(() => {
    if (!pdf) return;
    let task: any; let cancelled = false;
    (async () => {
      const page = await pdf.getPage(pageIndex + 1);
      const base = page.getViewport({ scale: 1 });
      const fit = Math.min(1.5, ((wrapRef.current?.clientWidth ?? 900) - 24) / base.width);
      const z = zoom || fit; if (!zoom) setZoom(Math.round(fit * 100) / 100);
      const v = page.getViewport({ scale: z });
      const c = canvasRef.current!; const dpr = Math.min(2, window.devicePixelRatio || 1);
      const maxPx = 8000; const k = Math.min(dpr, maxPx / Math.max(v.width, v.height));
      c.width = Math.floor(v.width * k); c.height = Math.floor(v.height * k); c.style.width = `${v.width}px`; c.style.height = `${v.height}px`;
      const ctx = c.getContext("2d")!; ctx.setTransform(k, 0, 0, k, 0, 0);
      task = page.render({ canvasContext: ctx, viewport: v });
      await task.promise.catch(() => {});
      if (!cancelled) setVp(v);
    })();
    return () => { cancelled = true; task?.cancel?.(); };
  }, [pdf, pageIndex, zoom]);

  const toView = useCallback((p: Pt): [number, number] => vp.convertToViewportPoint(p[0], p[1]), [vp]);
  const toUser = useCallback((v: [number, number]): Pt => vp.convertToPdfPoint(v[0], v[1]) as Pt, [vp]);
  const pageRot = vp ? ((vp.rotation % 360) + 360) % 360 : 0;

  const commit = useCallback((next: Markup[]) => setHist((h) => ({ stack: [...h.stack.slice(0, h.i + 1), next].slice(-200), i: Math.min(h.i + 1, 199) })), []);
  const undo = () => { setHist((h) => ({ ...h, i: Math.max(0, h.i - 1) })); };
  const redo = () => setHist((h) => ({ ...h, i: Math.min(h.stack.length - 1, h.i + 1) }));
  const update = (id: string, patch: Partial<Markup>) => commit(markups.map((m) => (m.id === id ? { ...m, ...patch, modifiedAt: new Date().toISOString() } : m)));
  const selected = markups.find((m) => m.id === sel) ?? null;
  const pageMarkups = markups.filter((m) => m.page === pageIndex);

  const evPt = (e: React.MouseEvent | MouseEvent): [number, number] => { const r = svgRef.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const baseMarkup = (type: MarkupType): Markup => ({ id: uid(), page: pageIndex, type, color: style.color, fill: style.fill, width: Math.round((style.width / zoom) * 10) / 10, opacity: style.opacity, author, createdAt: new Date().toISOString() });

  const addMarkup = (m: Markup) => { commit([...markups, m]); setSel(m.id); setTool("select"); };
  const boxFromView = (a: [number, number], b: [number, number], minW = 8, minH = 8) => {
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return { center: toUser(mid), w: Math.max(minW, Math.abs(b[0] - a[0]) / zoom), h: Math.max(minH, Math.abs(b[1] - a[1]) / zoom), rotation: pageRot };
  };

  const finishDrag = (a: [number, number], b: [number, number]) => {
    const tiny = Math.hypot(b[0] - a[0], b[1] - a[1]) < 4;
    const t = tool as MarkupType;
    if (t === "highlight" || t === "underline" || t === "strikeout") {
      if (tiny) return;
      const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])], [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
      return addMarkup({ ...baseMarkup(t), color: t === "highlight" ? [1, 0.85, 0.1] : style.color, opacity: t === "highlight" ? 0.6 : style.opacity, fill: null, quads: [[toUser([x0, y0]), toUser([x1, y0]), toUser([x0, y1]), toUser([x1, y1])]] });
    }
    if (t === "line" || t === "arrow") { if (tiny) return; return addMarkup({ ...baseMarkup(t), fill: null, points: [toUser(a), toUser(b)] }); }
    if (t === "callout") {
      const boxV: [number, number] = tiny ? [a[0] + 120, a[1] - 60] : b;
      return addMarkup({ ...baseMarkup(t), ...boxFromView([boxV[0] - 110, boxV[1] - 30], [boxV[0] + 110, boxV[1] + 30]), points: [toUser(a)], fill: [1, 1, 1], text: "Callout", fontSize: Math.round(style.fontSize / zoom), fontColor: [0, 0, 0] });
    }
    if (t === "note") return addMarkup({ ...baseMarkup(t), ...boxFromView([a[0] - 12, a[1] - 12], [a[0] + 12, a[1] + 12]), color: [1, 0.82, 0.2], fill: null, text: "" });
    const defaults: Record<string, [number, number]> = { text: [220, 50], rect: [160, 100], ellipse: [140, 100], stamp: [220, 64], image: [160, 160 / (pendingImage?.ratio || 1)], cover: [160, 30] };
    const d = defaults[t] ?? [100, 60];
    const box = tiny ? boxFromView([a[0] - d[0] / 2, a[1] - d[1] / 2], [a[0] + d[0] / 2, a[1] + d[1] / 2]) : boxFromView(a, b);
    if (t === "image") { if (!pendingImage) { imgInput.current?.click(); return; } return addMarkup({ ...baseMarkup(t), ...box, h: tiny ? box.h : box.w / pendingImage.ratio, image: { data: pendingImage.data, type: pendingImage.type }, fill: null }); }
    if (t === "text") return addMarkup({ ...baseMarkup(t), ...box, text: "Text", fontSize: Math.round(style.fontSize / zoom), fontColor: style.color, width: 0, fill: style.fill });
    if (t === "stamp") return addMarkup({ ...baseMarkup(t), ...box, label: stampLabel, fill: null });
    if (t === "cover") return addMarkup({ ...baseMarkup(t), ...box, fill: [1, 1, 1], color: [0, 0, 0], text: "", fontSize: Math.round(style.fontSize / zoom), fontColor: [0, 0, 0] });
    return addMarkup({ ...baseMarkup(t), ...box });
  };
  const finishPoly = (pts: [number, number][]) => {
    const min = tool === "polyline" ? 2 : 3;
    if (pts.length < min) { toast.info(`Add at least ${min} points.`); return; }
    addMarkup({ ...baseMarkup(tool as MarkupType), points: pts.map(toUser), fill: tool === "polyline" ? null : style.fill });
    setDraft(null);
  };
  const isPoly = tool === "polyline" || tool === "polygon" || tool === "cloud";

  const onDown = (e: React.MouseEvent) => {
    if (!vp || e.button !== 0) return;
    const p = evPt(e);
    if (tool === "select") { setSel(null); return; }
    if (isPoly) { setDraft((d) => ({ pts: [...(d?.pts ?? []), p], cur: p })); return; }
    setDraft({ start: p, cur: p });
  };
  const onMove = (e: React.MouseEvent) => {
    if (!vp) return;
    const p = evPt(e);
    const dg = drag.current;
    if (dg) {
      const u = toUser(p); const o = dg.orig; const dx = u[0] - dg.start[0], dy = u[1] - dg.start[1];
      let m: Markup = o;
      if (dg.kind === "move") m = { ...o, center: o.center ? [o.center[0] + dx, o.center[1] + dy] : undefined, points: o.points?.map((q) => [q[0] + dx, q[1] + dy] as Pt), quads: o.quads?.map((q) => q.map((r) => [r[0] + dx, r[1] + dy] as Pt)) };
      else if (dg.kind === "resize" && o.center) { const a = (-(o.rotation ?? 0) * Math.PI) / 180; const lx = (u[0] - o.center[0]) * Math.cos(a) - (u[1] - o.center[1]) * Math.sin(a), ly = (u[0] - o.center[0]) * Math.sin(a) + (u[1] - o.center[1]) * Math.cos(a); m = { ...o, w: Math.max(6, 2 * Math.abs(lx)), h: o.type === "image" ? Math.max(6, 2 * Math.abs(lx)) * ((o.h ?? 1) / (o.w ?? 1)) : Math.max(6, 2 * Math.abs(ly)) }; }
      else if (dg.kind === "rotate" && o.center) { let deg = (Math.atan2(u[1] - o.center[1], u[0] - o.center[0]) * 180) / Math.PI - 90; if (e.shiftKey) deg = Math.round(deg / 15) * 15; m = { ...o, rotation: Math.round(((deg % 360) + 360) % 360 * 10) / 10 }; }
      else if (dg.kind === "vertex" && o.points) m = { ...o, points: o.points.map((q, i) => (i === dg.idx ? u : q)) };
      setHist((h) => { const st = [...h.stack]; st[h.i] = dg.snapshot.map((x) => (x.id === dg.id ? m : x)); return { ...h, stack: st }; });
      return;
    }
    if (draft) setDraft({ ...draft, cur: p });
  };
  const onUp = (e: React.MouseEvent) => {
    const dg = drag.current;
    if (dg) { drag.current = null; const now = markups; setHist((h) => { const st = h.stack.slice(0, h.i + 1); st[h.i] = dg.snapshot; return { stack: [...st, now].slice(-200), i: Math.min(st.length, 199) }; }); return; }
    if (draft?.start && !isPoly) { const a = draft.start, b = evPt(e); setDraft(null); finishDrag(a, b); }
  };
  const startDrag = (kind: "move" | "resize" | "rotate" | "vertex", m: Markup, idx?: number) => (e: React.MouseEvent) => {
    if (tool !== "select") return;
    e.stopPropagation(); setSel(m.id);
    drag.current = { kind, id: m.id, idx, start: toUser(evPt(e)), orig: m, snapshot: markups };
  };

  // ---------- keyboard ----------
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select,[contenteditable]")) return;
      const mod = e.metaKey || e.ctrlKey; const k = e.key.toLowerCase();
      if (mod && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && k === "y") { e.preventDefault(); redo(); return; }
      if (mod && k === "c" && selected) { clip.current = selected; return; }
      if (mod && k === "v" && clip.current) { e.preventDefault(); const c = clip.current; const off = 12; const m = { ...c, id: uid(), page: pageIndex, createdAt: new Date().toISOString(), replies: [], center: c.center ? [c.center[0] + off, c.center[1] - off] as Pt : undefined, points: c.points?.map((p) => [p[0] + off, p[1] - off] as Pt), quads: c.quads?.map((q) => q.map((p) => [p[0] + off, p[1] - off] as Pt)) }; commit([...markups, m]); setSel(m.id); return; }
      if (mod && k === "d" && selected) { e.preventDefault(); duplicate(); return; }
      if (k === "escape") { setDraft(null); setSel(null); setTool("select"); return; }
      if (k === "enter" && draft?.pts) { finishPoly(draft.pts); return; }
      if ((k === "delete" || k === "backspace") && selected) { e.preventDefault(); remove(); return; }
      if (selected && k.startsWith("arrow")) { e.preventDefault(); const s = (e.shiftKey ? 10 : 1) / zoom; const [vx, vy] = k === "arrowleft" ? [-s, 0] : k === "arrowright" ? [s, 0] : k === "arrowup" ? [0, -s] : [0, s];
        const a = toUser([0, 0]), b = toUser([vx * zoom, vy * zoom]); const dx = b[0] - a[0], dy = b[1] - a[1];
        update(selected.id, { center: selected.center ? [selected.center[0] + dx, selected.center[1] + dy] : undefined, points: selected.points?.map((p) => [p[0] + dx, p[1] + dy] as Pt), quads: selected.quads?.map((q) => q.map((p) => [p[0] + dx, p[1] + dy] as Pt)) }); return; }
      if (selected && (k === "]" || k === "[")) { order(k === "]" ? (e.shiftKey ? "front" : "up") : (e.shiftKey ? "back" : "down")); return; }
      if (!mod) { const t = TOOLS.find((x) => x.key === k); if (t) { setTool(t.id); setDraft(null); } }
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  });

  const remove = () => { if (!selected) return; commit(markups.filter((m) => m.id !== selected.id)); setSel(null); };
  const duplicate = () => { if (!selected) return; const c = selected; const m = { ...c, id: uid(), createdAt: new Date().toISOString(), replies: [], center: c.center ? [c.center[0] + 12, c.center[1] - 12] as Pt : undefined, points: c.points?.map((p) => [p[0] + 12, p[1] - 12] as Pt), quads: c.quads?.map((q) => q.map((p) => [p[0] + 12, p[1] - 12] as Pt)) }; commit([...markups, m]); setSel(m.id); };
  const order = (how: "front" | "back" | "up" | "down") => {
    if (!selected) return; const i = markups.findIndex((m) => m.id === selected.id); const arr = [...markups]; const [m] = arr.splice(i, 1);
    const j = how === "front" ? arr.length : how === "back" ? 0 : how === "up" ? Math.min(arr.length, i + 1) : Math.max(0, i - 1);
    arr.splice(j, 0, m); commit(arr);
  };

  // ---------- output ----------
  const build = async () => {
    if (!bytes) throw new Error("No PDF");
    const out = await writeMarkups(bytes, markups, { flatten });
    const back = await readMarkups(out);
    if (!flatten && back.markups.length !== markups.length) throw new Error(`Verification failed: ${back.markups.length} of ${markups.length} markups read back`);
    if (!flatten) { const missing = markups.find((m) => !back.markups.some((b) => b.id === m.id && b.page === m.page)); if (missing) throw new Error(`Verification failed: markup on page ${missing.page + 1} did not persist`); }
    if (flatten && back.markups.length) throw new Error("Verification failed: flattened PDF still has editable PITCH markups");
    return out;
  };
  const run = async (label: string, fn: () => Promise<void>) => { setBusy(label); try { await fn(); } catch (e: any) { toast.error(e.message ?? String(e)); } finally { setBusy(null); } };
  const download = () => run("dl", async () => { const out = await build(); const url = URL.createObjectURL(new Blob([out as BlobPart], { type: "application/pdf" })); const a = document.createElement("a"); a.href = url; a.download = name.replace(/\.pdf$/i, "") + (flatten ? "-flattened" : "-markup") + ".pdf"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000); toast.success(`Downloaded with ${markups.length} markups (verified).`); });
  const save = () => run("save", async () => { const out = await build(); await onSaveVersion!(out, `${markups.length} markups${flatten ? " (flattened)" : ""}`); });

  const pickImage = async (f: File | undefined) => {
    if (!f) return; if (!/png|jpe?g/i.test(f.type)) return toast.error("Use a PNG or JPG image.");
    if (f.size > 5 * 1024 * 1024) return toast.error("Image is larger than 5 MB.");
    const buf = new Uint8Array(await f.arrayBuffer()); let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const url = URL.createObjectURL(f); const img = new Image(); img.src = url; await img.decode().catch(() => {});
    setPendingImage({ data: btoa(s), type: /png/i.test(f.type) ? "png" : "jpg", url, ratio: img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1 }); setTool("image");
    toast.message("Click or drag on the page to place the image.");
  };

  // ---------- render helpers ----------
  const viewAngle = (m: Markup) => { const c = m.center!; const a = toView(c); const r = ((m.rotation ?? 0) * Math.PI) / 180; const b = toView([c[0] + Math.cos(r), c[1] + Math.sin(r)]); return (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI; };
  const renderMarkup = (m: Markup) => {
    const isSel = m.id === sel; const sw = Math.max(0.5, m.width * zoom); const stroke = css(m.color); const fill = m.fill ? css(m.fill) : "none";
    const common = { onMouseDown: startDrag("move", m), style: { cursor: tool === "select" ? "move" : undefined, opacity: m.opacity }, "data-markup": m.type } as any;
    let body: JSX.Element | null = null;
    if (m.quads) {
      body = <g {...common}>{m.quads.map((q, i) => { const v = q.map(toView); if (m.type === "highlight") return <polygon key={i} points={[v[0], v[1], v[3], v[2]].map((p) => p.join(",")).join(" ")} fill={stroke} style={{ mixBlendMode: "multiply" }} />;
        const t = m.type === "underline" ? 0.92 : 0.5; const a = [v[0][0] + (v[2][0] - v[0][0]) * t, v[0][1] + (v[2][1] - v[0][1]) * t], b = [v[1][0] + (v[3][0] - v[1][0]) * t, v[1][1] + (v[3][1] - v[1][1]) * t];
        return <g key={i}><polygon points={[v[0], v[1], v[3], v[2]].map((p) => p.join(",")).join(" ")} fill="transparent" /><line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={stroke} strokeWidth={Math.max(1, Math.hypot(v[2][0] - v[0][0], v[2][1] - v[0][1]) / 14)} /></g>; })}</g>;
    } else if (m.center) {
      const c = toView(m.center); const w = (m.w ?? 0) * zoom, h = (m.h ?? 0) * zoom; const ang = viewAngle(m);
      const textDiv = (pad = 4) => <foreignObject x={-w / 2} y={-h / 2} width={w} height={h} style={{ pointerEvents: "none" }}><div style={{ fontFamily: "Helvetica, Arial, sans-serif", fontSize: (m.fontSize ?? 12) * zoom, lineHeight: 1.15, color: css(m.fontColor ?? m.color), padding: pad * zoom, textAlign: (["left", "center", "right"] as const)[m.align ?? 0], whiteSpace: "pre-wrap", wordBreak: "break-word", overflow: "hidden", height: "100%" }}>{m.text}</div></foreignObject>;
      const inner = m.type === "ellipse" ? <ellipse rx={w / 2} ry={h / 2} fill={m.fill ? fill : "transparent"} stroke={stroke} strokeWidth={sw} />
        : m.type === "rect" ? <rect x={-w / 2} y={-h / 2} width={w} height={h} fill={m.fill ? fill : "transparent"} stroke={stroke} strokeWidth={sw} />
        : m.type === "text" ? <><rect x={-w / 2} y={-h / 2} width={w} height={h} fill={m.fill ? fill : "transparent"} stroke={m.width > 0 ? stroke : isSel ? "hsl(var(--primary))" : "none"} strokeDasharray={m.width > 0 ? undefined : "4 3"} strokeWidth={m.width > 0 ? sw : 1} />{textDiv()}</>
        : m.type === "cover" ? <><rect x={-w / 2} y={-h / 2} width={w} height={h} fill={css(m.fill ?? [1, 1, 1])} />{textDiv()}</>
        : m.type === "callout" ? <><rect x={-w / 2} y={-h / 2} width={w} height={h} fill={css(m.fill ?? [1, 1, 1])} stroke={stroke} strokeWidth={sw} />{textDiv()}</>
        : m.type === "note" ? <><rect x={-w / 2} y={-h / 2} width={w} height={h} fill={stroke} stroke="black" strokeWidth={0.6 * zoom} rx={2} />{[-0.35, 0, 0.35].map((f) => <line key={f} x1={-w * 0.3} x2={w * 0.3} y1={h * f} y2={h * f} stroke="black" strokeWidth={0.8 * zoom} />)}</>
        : m.type === "stamp" ? <><rect x={-w / 2 + 2 * zoom} y={-h / 2 + 2 * zoom} width={w - 4 * zoom} height={h - 4 * zoom} fill="transparent" stroke={stroke} strokeWidth={Math.max(1.5, m.width) * zoom} /><text textAnchor="middle" dominantBaseline="central" fill={stroke} style={{ fontFamily: "Helvetica, Arial, sans-serif", fontWeight: 700, fontSize: Math.min(h * 0.55, (w * 0.85) / Math.max(1, (m.label ?? "").length * 0.62)) }}>{(m.label ?? "").toUpperCase()}</text></>
        : m.type === "image" && m.image ? <image href={`data:image/${m.image.type === "png" ? "png" : "jpeg"};base64,${m.image.data}`} x={-w / 2} y={-h / 2} width={w} height={h} preserveAspectRatio="none" /> : null;
      let leader: JSX.Element | null = null;
      if (m.type === "callout" && m.points?.[0]) {
        const a = toView(m.points[0]); const cs = boxCorners(m).map(toView); const mids = cs.map((p, i) => [(p[0] + cs[(i + 1) % 4][0]) / 2, (p[1] + cs[(i + 1) % 4][1]) / 2]);
        const near = mids.reduce((b, p) => (Math.hypot(p[0] - a[0], p[1] - a[1]) < Math.hypot(b[0] - a[0], b[1] - a[1]) ? p : b));
        leader = <line x1={near[0]} y1={near[1]} x2={a[0]} y2={a[1]} stroke={stroke} strokeWidth={sw} markerEnd="url(#mk-arrow)" style={{ color: stroke }} />;
      }
      body = <g {...common}>{leader}<g transform={`translate(${c[0]},${c[1]}) rotate(${ang})`}>{inner}</g></g>;
    } else if (m.points) {
      const v = m.points.map(toView); const ptsAttr = v.map((p) => p.join(",")).join(" ");
      body = <g {...common}>
        {(m.type === "line" || m.type === "arrow") && <><line x1={v[0][0]} y1={v[0][1]} x2={v[1][0]} y2={v[1][1]} stroke="transparent" strokeWidth={Math.max(10, sw)} /><line x1={v[0][0]} y1={v[0][1]} x2={v[1][0]} y2={v[1][1]} stroke={stroke} strokeWidth={sw} markerEnd={m.type === "arrow" ? "url(#mk-arrow)" : undefined} style={{ color: stroke }} /></>}
        {m.type === "polyline" && <><polyline points={ptsAttr} fill="none" stroke="transparent" strokeWidth={Math.max(10, sw)} /><polyline points={ptsAttr} fill="none" stroke={stroke} strokeWidth={sw} strokeLinejoin="round" /></>}
        {m.type === "polygon" && <polygon points={ptsAttr} fill={m.fill ? fill : "transparent"} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />}
        {m.type === "cloud" && <path d={cloudSvg(v, Math.max(6, m.width * 4) * zoom)} fill={m.fill ? fill : "transparent"} stroke={stroke} strokeWidth={sw} />}
      </g>;
    }
    return <g key={m.id}>{body}{isSel && tool === "select" && handles(m)}</g>;
  };
  const handles = (m: Markup) => {
    const hs = 7;
    if (m.center && BOX_TYPES.includes(m.type)) {
      const cs = boxCorners(m).map(toView); const c = toView(m.center); const ang = viewAngle(m) * Math.PI / 180;
      const br = cs.reduce((best, p) => { const lx = (p[0] - c[0]) * Math.cos(-ang) - (p[1] - c[1]) * Math.sin(-ang), ly = (p[0] - c[0]) * Math.sin(-ang) + (p[1] - c[1]) * Math.cos(-ang); return lx > 0 && ly > 0 ? p : best; }, cs[2]);
      const top: [number, number] = [c[0] + Math.sin(ang) * ((m.h ?? 0) * zoom / 2 + 22), c[1] - Math.cos(ang) * ((m.h ?? 0) * zoom / 2 + 22)];
      return <g>
        <polygon points={cs.map((p) => p.join(",")).join(" ")} fill="none" stroke="hsl(var(--primary))" strokeDasharray="4 3" pointerEvents="none" />
        {m.type !== "note" && <rect x={br[0] - hs / 2} y={br[1] - hs / 2} width={hs} height={hs} className="fill-background stroke-primary" style={{ cursor: "nwse-resize" }} onMouseDown={startDrag("resize", m)} aria-label="Resize" />}
        {m.type !== "note" && <><line x1={c[0] + Math.sin(ang) * (m.h ?? 0) * zoom / 2} y1={c[1] - Math.cos(ang) * (m.h ?? 0) * zoom / 2} x2={top[0]} y2={top[1]} stroke="hsl(var(--primary))" pointerEvents="none" /><circle cx={top[0]} cy={top[1]} r={5} className="fill-background stroke-primary" style={{ cursor: "grab" }} onMouseDown={startDrag("rotate", m)} aria-label="Rotate" /></>}
        {m.type === "callout" && m.points && (() => { const a = toView(m.points[0]); return <circle cx={a[0]} cy={a[1]} r={5} className="fill-background stroke-primary" onMouseDown={startDrag("vertex", m, 0)} />; })()}
      </g>;
    }
    if (m.points) return <g>{m.points.map((p, i) => { const v = toView(p); return <circle key={i} cx={v[0]} cy={v[1]} r={5} className="fill-background stroke-primary" style={{ cursor: "move" }} onMouseDown={startDrag("vertex", m, i)} />; })}</g>;
    if (m.quads) { const v = m.quads.flat().map(toView); const xs = v.map((p) => p[0]), ys = v.map((p) => p[1]); return <rect x={Math.min(...xs) - 2} y={Math.min(...ys) - 2} width={Math.max(...xs) - Math.min(...xs) + 4} height={Math.max(...ys) - Math.min(...ys) + 4} fill="none" stroke="hsl(var(--primary))" strokeDasharray="4 3" pointerEvents="none" />; }
    return null;
  };

  const counts = useMemo(() => { const c: Record<string, number> = {}; markups.forEach((m) => (c[m.type] = (c[m.type] ?? 0) + 1)); return c; }, [markups]);

  if (!bytes) return (
    <div className="rounded-xl border border-dashed p-10 text-center space-y-3">
      <p className="font-medium">Open a PDF to mark up</p>
      <Input type="file" accept="application/pdf,.pdf" aria-label="Open PDF for markup" className="max-w-sm mx-auto" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setName(f.name); setBytes(new Uint8Array(await f.arrayBuffer())); }} />
      <p className="text-xs text-muted-foreground">Markups are saved into the PDF as standard annotations that open in Acrobat and other PDF viewers.</p>
    </div>
  );

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
      <div className="space-y-2 min-w-0">
        <div className="flex flex-wrap gap-1 items-center rounded-lg border bg-card p-1.5 sticky top-0 z-20">
          {TOOLS.map((t) => <Button key={t.id} size="icon" variant={tool === t.id ? "default" : "ghost"} className="h-8 w-8" title={`${t.label} (${t.key.toUpperCase()})`} aria-label={t.label} aria-pressed={tool === t.id}
            onClick={() => { setDraft(null); if (t.id === "image" && !pendingImage) imgInput.current?.click(); setTool(t.id); }}><t.icon className="h-4 w-4" /></Button>)}
          <input ref={imgInput} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { pickImage(e.target.files?.[0]); e.target.value = ""; }} />
          <span className="mx-1 h-6 w-px bg-border" />
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={undo} disabled={hist.i === 0} title="Undo (Ctrl+Z)" aria-label="Undo"><Undo2 className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={redo} disabled={hist.i >= hist.stack.length - 1} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><Redo2 className="h-4 w-4" /></Button>
          <span className="mx-1 h-6 w-px bg-border" />
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setZoom((z) => Math.max(0.1, Math.round(z / 1.25 * 100) / 100))} aria-label="Zoom out"><ZoomOut className="h-4 w-4" /></Button>
          <span className="text-xs w-12 text-center">{Math.round(zoom * 100)}%</span>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setZoom((z) => Math.min(4, Math.round(z * 1.25 * 100) / 100))} aria-label="Zoom in"><ZoomIn className="h-4 w-4" /></Button>
          <span className="mx-1 h-6 w-px bg-border" />
          <Button size="icon" variant="ghost" className="h-8 w-8" disabled={pageIndex === 0} onClick={() => { setPageIndex((p) => p - 1); setSel(null); }} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-xs">Page {pageIndex + 1} / {pdf?.numPages ?? "…"}</span>
          <Button size="icon" variant="ghost" className="h-8 w-8" disabled={!pdf || pageIndex >= pdf.numPages - 1} onClick={() => { setPageIndex((p) => p + 1); setSel(null); }} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
        </div>
        {(tool === "polyline" || tool === "polygon" || tool === "cloud") && <p className="text-xs text-muted-foreground">Click to add points; double-click or press Enter to finish; Esc to cancel.</p>}
        <div ref={wrapRef} className="overflow-auto rounded-lg border bg-muted/40 p-3 max-h-[78vh]">
          <div className="relative inline-block shadow-sm">
            <canvas ref={canvasRef} className="block bg-background" />
            {vp && <svg ref={svgRef} width={vp.width} height={vp.height} className="absolute inset-0" style={{ cursor: tool === "select" ? "default" : "crosshair" }} data-testid="markup-layer"
              onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={(e) => drag.current && onUp(e)} onDoubleClick={() => draft?.pts && finishPoly(draft.pts.slice(0, -1))}>
              <defs><marker id="mk-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10" fill="none" stroke="currentColor" strokeWidth="1.6" /></marker></defs>
              {pageMarkups.map(renderMarkup)}
              {draft?.start && draft.cur && (() => { const [a, b] = [draft.start, draft.cur];
                return tool === "line" || tool === "arrow" || tool === "callout" ? <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={css(style.color)} strokeDasharray="4 3" /> : <rect x={Math.min(a[0], b[0])} y={Math.min(a[1], b[1])} width={Math.abs(b[0] - a[0])} height={Math.abs(b[1] - a[1])} fill={tool === "highlight" ? "rgba(255,217,26,.4)" : "none"} stroke={css(style.color)} strokeDasharray="4 3" />; })()}
              {draft?.pts && <polyline points={[...draft.pts, ...(draft.cur ? [draft.cur] : [])].map((p) => p.join(",")).join(" ")} fill="none" stroke={css(style.color)} strokeDasharray="4 3" />}
            </svg>}
          </div>
        </div>
      </div>

      <aside className="space-y-3 text-sm">
        <div className="rounded-lg border bg-card p-3 space-y-2">
          <div className="flex items-center justify-between"><Label htmlFor="flatten">Flatten into page content</Label><Switch id="flatten" checked={flatten} onCheckedChange={setFlatten} /></div>
          <p className="text-[11px] text-muted-foreground">{flatten ? "Markups are burned into the page and can no longer be edited or moved by anyone." : "Markups are saved as standard PDF annotations that stay editable here and in Acrobat."}</p>
          <Button className="w-full" variant="outline" onClick={download} disabled={!!busy}>{busy === "dl" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}Download</Button>
          {onSaveVersion && <Button className="w-full" onClick={save} disabled={!!busy}>{busy === "save" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}Save new version</Button>}
          <p className="text-[11px] text-muted-foreground">Each output is re-opened and checked so every markup is confirmed saved.</p>
          <div className="flex flex-wrap gap-1">{Object.entries(counts).map(([k, v]) => <Badge key={k} variant="secondary">{k} {v}</Badge>)}{others > 0 && <Badge variant="outline">{others} other annotations kept</Badge>}</div>
        </div>

        {selected ? <div className="rounded-lg border bg-card p-3 space-y-2" data-testid="markup-properties">
          <div className="flex items-center justify-between"><span className="font-medium capitalize">{selected.type === "cover" ? "Cover (overlay)" : selected.type}</span>
            <div className="flex gap-0.5">
              <Button size="icon" variant="ghost" className="h-7 w-7" title="Bring to front (Shift+])" onClick={() => order("front")}><BringToFront className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" title="Forward (])" onClick={() => order("up")}><ArrowUp className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" title="Backward ([)" onClick={() => order("down")}><ArrowDown className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" title="Send to back (Shift+[)" onClick={() => order("back")}><SendToBack className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" title="Duplicate (Ctrl+D)" onClick={duplicate}><Copy className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" title="Delete (Del)" onClick={remove} aria-label="Delete markup"><Trash2 className="h-4 w-4" /></Button>
            </div></div>
          {selected.type === "cover" && <p className="text-[11px] text-muted-foreground">Overlay only: hides the original page content visually but does not remove it from the file. Not a redaction.</p>}
          {(["text", "callout", "cover", "note"] as MarkupType[]).includes(selected.type) && <div><Label>{selected.type === "note" ? "Comment" : "Text"}</Label><Textarea aria-label="Markup text" rows={3} value={selected.text ?? ""} onChange={(e) => setHist((h) => { const st = [...h.stack]; st[h.i] = markups.map((m) => (m.id === selected.id ? { ...m, text: e.target.value } : m)); return { ...h, stack: st }; })} onBlur={(e) => update(selected.id, { text: e.target.value })} /></div>}
          {selected.type === "stamp" && <div><Label>Stamp text</Label><Input list="stamp-list" value={selected.label ?? ""} onChange={(e) => update(selected.id, { label: e.target.value.slice(0, 40) })} /><datalist id="stamp-list">{STAMPS.map((s) => <option key={s} value={s} />)}</datalist></div>}
          <div className="grid grid-cols-2 gap-2">
            {selected.type !== "image" && <label className="space-y-1"><span className="text-xs">Color</span><Input type="color" className="h-8 p-1" value={hex(selected.color)} onChange={(e) => update(selected.id, { color: rgb(e.target.value) })} /></label>}
            {(["rect", "ellipse", "polygon", "cloud", "text", "callout", "cover"] as MarkupType[]).includes(selected.type) && <label className="space-y-1"><span className="text-xs">Fill</span><div className="flex gap-1 items-center"><Input type="color" className="h-8 p-1" value={hex(selected.fill ?? [1, 1, 1])} onChange={(e) => update(selected.id, { fill: rgb(e.target.value) })} />{selected.type !== "cover" && <Button size="sm" variant="ghost" className="h-8 px-1 text-xs" onClick={() => update(selected.id, { fill: null })}>None</Button>}</div></label>}
            {!["highlight", "image", "note", "cover"].includes(selected.type) && <label className="space-y-1"><span className="text-xs">Line width</span><Input type="number" min={0} max={50} step={0.5} value={selected.width} onChange={(e) => update(selected.id, { width: Math.max(0, Number(e.target.value)) })} /></label>}
            <label className="space-y-1"><span className="text-xs">Opacity</span><Input type="number" min={0.05} max={1} step={0.05} value={selected.opacity} onChange={(e) => update(selected.id, { opacity: Math.min(1, Math.max(0.05, Number(e.target.value))) })} /></label>
            {selected.center && selected.type !== "note" && <label className="space-y-1"><span className="text-xs">Rotation °</span><Input type="number" step={1} value={selected.rotation ?? 0} onChange={(e) => update(selected.id, { rotation: ((Number(e.target.value) % 360) + 360) % 360 })} /></label>}
            {(["text", "callout", "cover"] as MarkupType[]).includes(selected.type) && <>
              <label className="space-y-1"><span className="text-xs">Font size</span><Input type="number" min={4} max={200} value={selected.fontSize ?? 12} onChange={(e) => update(selected.id, { fontSize: Math.max(4, Number(e.target.value)) })} /></label>
              <label className="space-y-1"><span className="text-xs">Font color</span><Input type="color" className="h-8 p-1" value={hex(selected.fontColor ?? selected.color)} onChange={(e) => update(selected.id, { fontColor: rgb(e.target.value) })} /></label>
              <label className="space-y-1 col-span-2"><span className="text-xs">Alignment</span><select className="w-full rounded border bg-background p-1.5" value={selected.align ?? 0} onChange={(e) => update(selected.id, { align: Number(e.target.value) as 0 | 1 | 2 })}><option value={0}>Left</option><option value={1}>Center</option><option value={2}>Right</option></select></label></>}
          </div>
          <p className="text-[11px] text-muted-foreground">Font: Helvetica (standard PDF font). Characters it can't show are saved as "?".</p>
          <div className="border-t pt-2 space-y-1">
            <Label>Comments</Label>
            {(selected.replies ?? []).map((r) => <div key={r.id} className="rounded bg-muted p-1.5"><div className="text-[11px] text-muted-foreground">{r.author} · {new Date(r.createdAt).toLocaleString()}</div><div>{r.text}</div></div>)}
            <div className="flex gap-1"><Input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply…" aria-label="Reply" onKeyDown={(e) => { if (e.key === "Enter" && reply.trim()) { update(selected.id, { replies: [...(selected.replies ?? []), { id: uid(), author, text: reply.trim(), createdAt: new Date().toISOString() }] }); setReply(""); } }} />
              <Button size="sm" variant="outline" disabled={!reply.trim()} onClick={() => { update(selected.id, { replies: [...(selected.replies ?? []), { id: uid(), author, text: reply.trim(), createdAt: new Date().toISOString() }] }); setReply(""); }}>Add</Button></div>
            <p className="text-[11px] text-muted-foreground">By {selected.author}. Replies are saved as PDF comment replies.</p>
          </div>
        </div> : <div className="rounded-lg border bg-card p-3 space-y-2">
          <Label>New markup style</Label>
          <p className="text-[11px] text-muted-foreground">Sizes are as they look on screen now; they are converted to the drawing's real size.</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1"><span className="text-xs">Color</span><Input type="color" className="h-8 p-1" value={hex(style.color)} onChange={(e) => setStyle({ ...style, color: rgb(e.target.value) })} /></label>
            <label className="space-y-1"><span className="text-xs">Fill</span><div className="flex gap-1"><Input type="color" className="h-8 p-1" value={hex(style.fill ?? [1, 1, 1])} onChange={(e) => setStyle({ ...style, fill: rgb(e.target.value) })} /><Button size="sm" variant={style.fill ? "ghost" : "secondary"} className="h-8 px-1 text-xs" onClick={() => setStyle({ ...style, fill: null })}>None</Button></div></label>
            <label className="space-y-1"><span className="text-xs">Line width</span><Input type="number" min={0.5} step={0.5} value={style.width} onChange={(e) => setStyle({ ...style, width: Math.max(0.5, Number(e.target.value)) })} /></label>
            <label className="space-y-1"><span className="text-xs">Opacity</span><Input type="number" min={0.05} max={1} step={0.05} value={style.opacity} onChange={(e) => setStyle({ ...style, opacity: Number(e.target.value) })} /></label>
            <label className="space-y-1"><span className="text-xs">Font size</span><Input type="number" min={4} value={style.fontSize} onChange={(e) => setStyle({ ...style, fontSize: Number(e.target.value) })} /></label>
            <label className="space-y-1"><span className="text-xs">Stamp</span><select className="w-full rounded border bg-background p-1.5" value={stampLabel} onChange={(e) => setStampLabel(e.target.value)}>{STAMPS.map((s) => <option key={s}>{s}</option>)}</select></label>
            <label className="space-y-1 col-span-2"><span className="text-xs">Your name on markups</span><Input value={author} onChange={(e) => { setAuthor(e.target.value); try { localStorage.setItem(AUTHOR_KEY, e.target.value); } catch { /* noop */ } }} /></label>
          </div>
          {pendingImage && <div className="flex items-center gap-2"><img src={pendingImage.url} alt="" className="h-10 w-10 object-contain border rounded" /><span className="text-xs">Image ready to place</span><Button size="sm" variant="ghost" onClick={() => setPendingImage(null)}>Clear</Button></div>}
        </div>}
        <Alert><Info className="h-4 w-4" /><AlertDescription className="text-xs">Editing the original text of a PDF isn't supported safely yet. To change wording, use <b>Cover &amp; retype</b>, which is clearly saved as an overlay, not a change to the original.</AlertDescription></Alert>
        <p className="text-[11px] text-muted-foreground">Shortcuts: V select · T text · H highlight · U underline · K strike · L line · A arrow · R rect · E ellipse · P polyline · G polygon · C cloud · O callout · N note · M stamp · I image · W cover · Del delete · Ctrl+Z/Y undo/redo · Ctrl+C/V/D copy/paste/duplicate · arrows nudge · [ ] layer order</p>
      </aside>
    </div>
  );
}
