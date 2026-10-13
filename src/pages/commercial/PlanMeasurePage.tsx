/**
 * Plan Measurement workspace for commercial drawing sets.
 * - Original PDFs are never modified; measurements and scales live in plan_* tables,
 *   and "Save measured copy" writes a new versioned PDF with ISO measurement annotations.
 * - No quantity is produced without a calibrated scale on the same sheet/viewport, and
 *   nothing can be approved or exported until that scale passes a known-dimension check.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import "@/lib/pdfRenderer";
import * as pdfjsLib from "pdfjs-dist";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, RotateCw, ZoomIn, ZoomOut, Ruler, Spline, Square, Home, Crosshair, CheckCircle2, Save, Loader2, Hand, Frame } from "lucide-react";
import { loadMeasureEngine } from "@/lib/plan-measure/pdfcraftEngine";
import { snapToGeometry, pitchFactor, scaleFromRatio, verifyError, VERIFY_TOLERANCE, parseFeet } from "@/lib/plan-measure/geometry";
import { isPlanMeasureEnabled } from "@/lib/plan-measure/featureGate";
import type { MeasureEngine, PageBox, Pt, Scale, VectorGeometry, Kind } from "@/lib/plan-measure/types";
import { DRIVERS } from "@/lib/commercial/engine";

const db = supabase as any;
type Tool = "pan" | "viewport" | "calibrate" | "verify" | "distance" | "perimeter" | "area" | "roof_area";
const KIND_OF: Record<string, Kind> = { distance: "distance", perimeter: "perimeter", area: "area", roof_area: "area" };
const SOURCE_LABEL: Record<string, string> = { manual_calibrated: "Measured (calibrated)", vector_snapped: "Vector-snapped", ocr_derived: "OCR-derived", ai_estimated: "AI estimate" };

interface ScaleRow { id: string; page_index: number; name: string; viewport_bbox: [number, number, number, number] | null; units_per_user_unit: number; unit: string; method: string; verified: boolean; verification: any; calibration: any; engine: string }
interface MRow { id: string; page_index: number; kind: string; points: Pt[]; value: number; unit: string; pitch_rise: number | null; label: string | null; driver: string | null; source: string; status: string; scale_id: string; revision: number; engine: string; takeoff_quantity_id: string | null }

const toScale = (r: ScaleRow): Scale => ({ x: Number(r.units_per_user_unit), y: Number(r.units_per_user_unit), unit: r.unit, area_unit: `${r.unit}^2`, precision: 2, ratio: r.method });
const inBox = (b: number[], p: Pt) => p[0] >= Math.min(b[0], b[2]) && p[0] <= Math.max(b[0], b[2]) && p[1] >= Math.min(b[1], b[3]) && p[1] <= Math.max(b[1], b[3]);
function scaleFor(scales: ScaleRow[], page: number, pts: Pt[]): ScaleRow | null {
  const own = scales.filter((s) => s.page_index === page);
  return own.find((s) => s.viewport_bbox && pts.every((p) => inBox(s.viewport_bbox!, p))) || own.find((s) => !s.viewport_bbox) || null;
}

export default function PlanMeasurePage() {
  const { id: projectId, documentId } = useParams();
  const tenantId = useEffectiveTenantId();
  const [doc, setDoc] = useState<any>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [pdf, setPdf] = useState<any>(null);
  const [engine, setEngine] = useState<MeasureEngine | null>(null);
  const [fallback, setFallback] = useState<string | undefined>();
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [viewRot, setViewRot] = useState(0);
  const [pageInfo, setPageInfo] = useState<{ view: number[]; rotate: number; userUnit: number } | null>(null);
  const [tool, setTool] = useState<Tool>("pan");
  const [draft, setDraft] = useState<{ pts: Pt[]; snapped: boolean[] }>({ pts: [], snapped: [] });
  const [hover, setHover] = useState<{ p: Pt; kind?: string } | null>(null);
  const [snapOn, setSnapOn] = useState(true);
  const [geom, setGeom] = useState<Record<number, VectorGeometry | null | "loading">>({});
  const [scales, setScales] = useState<ScaleRow[]>([]);
  const [ms, setMs] = useState<MRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [revs, setRevs] = useState<any[]>([]);
  const [pendingViewport, setPendingViewport] = useState<[number, number, number, number] | null>(null);
  const [dialog, setDialog] = useState<null | { mode: "calibrate" | "verify"; pts: Pt[] }>(null);
  const [dimText, setDimText] = useState("");
  const [ratioOpen, setRatioOpen] = useState(false);
  const [ratio, setRatio] = useState({ paper: "0.125", real: "1" });
  const [pitch, setPitch] = useState("");
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const drag = useRef<{ id: string; i: number } | null>(null);
  const enabled = isPlanMeasureEnabled();

  // ---------- load ----------
  useEffect(() => { loadMeasureEngine().then(({ engine, fallbackReason }) => { setEngine(engine); setFallback(fallbackReason); }); }, []);
  useEffect(() => {
    if (!documentId || !tenantId) return;
    (async () => {
      const { data: d, error } = await db.from("documents").select("id, filename, file_path, tenant_id, metadata").eq("id", documentId).eq("tenant_id", tenantId).maybeSingle();
      if (error || !d) { toast.error("Drawing not found for this company"); return; }
      setDoc(d);
      const { data: blob, error: dErr } = await supabase.storage.from("documents").download(d.file_path);
      if (dErr || !blob) { toast.error("Could not open the drawing file"); return; }
      const b = new Uint8Array(await blob.arrayBuffer());
      setBytes(b);
      setPdf(await pdfjsLib.getDocument({ data: b.slice() }).promise);
    })();
  }, [documentId, tenantId]);
  const reload = useCallback(async () => {
    if (!documentId || !tenantId) return;
    const [{ data: s }, { data: m }] = await Promise.all([
      db.from("plan_sheet_scales").select("*").eq("tenant_id", tenantId).eq("document_id", documentId).order("created_at"),
      db.from("plan_measurements").select("*").eq("tenant_id", tenantId).eq("document_id", documentId).is("deleted_at", null).order("created_at"),
    ]);
    setScales(s || []); setMs(m || []);
  }, [documentId, tenantId]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (!selected || !tenantId) { setRevs([]); return; }
    db.from("plan_measurement_revisions").select("*").eq("tenant_id", tenantId).eq("measurement_id", selected).order("revision", { ascending: false }).then(({ data }: any) => setRevs(data || []));
  }, [selected, ms, tenantId]);

  // ---------- render page ----------
  useEffect(() => {
    if (!pdf) return;
    let task: any; let cancelled = false;
    (async () => {
      const page = await pdf.getPage(pageIndex + 1);
      const rotation = (page.rotate + viewRot) % 360;
      const vp = page.getViewport({ scale: zoom * (window.devicePixelRatio || 1), rotation });
      const css = page.getViewport({ scale: zoom, rotation });
      const c = canvasRef.current; if (!c || cancelled) return;
      c.width = vp.width; c.height = vp.height; c.style.width = `${css.width}px`; c.style.height = `${css.height}px`;
      setCanvasSize({ w: css.width, h: css.height });
      setPageInfo({ view: page.view, rotate: page.rotate, userUnit: (page as any).userUnit || 1 });
      task = page.render({ canvasContext: c.getContext("2d")!, viewport: vp });
      await task.promise.catch(() => {});
    })();
    return () => { cancelled = true; task?.cancel?.(); };
  }, [pdf, pageIndex, zoom, viewRot]);

  // vector geometry for snapping (PdfCraft only)
  useEffect(() => {
    if (!engine || !bytes || geom[pageIndex] !== undefined) return;
    setGeom((g) => ({ ...g, [pageIndex]: "loading" }));
    setTimeout(() => {
      let g: VectorGeometry | null = null;
      try { g = engine.geometry(bytes, pageIndex); } catch (e) { console.warn("vector geometry unavailable", e); }
      setGeom((x) => ({ ...x, [pageIndex]: g }));
    }, 0);
  }, [engine, bytes, pageIndex, geom]);

  const box: PageBox | null = useMemo(() => pageInfo && ({ rotate: (pageInfo.rotate + viewRot) % 360, crop: pageInfo.view as any, userUnit: pageInfo.userUnit }), [pageInfo, viewRot]);
  const uu = pageInfo?.userUnit || 1;
  const toUser = (cx: number, cy: number): Pt => engine!.viewToUser(box!, [(cx / zoom) * uu, (cy / zoom) * uu]);
  const toCss = (p: Pt): Pt => { const v = engine!.userToView(box!, p); return [(v[0] / uu) * zoom, (v[1] / uu) * zoom]; };
  const pageGeom = geom[pageIndex];
  const pageScales = scales.filter((s) => s.page_index === pageIndex);
  const pageMs = ms.filter((m) => m.page_index === pageIndex);

  const pick = (e: React.MouseEvent): { p: Pt; snapped: boolean; kind?: string } => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const raw = toUser(e.clientX - r.left, e.clientY - r.top);
    if (snapOn && pageGeom && pageGeom !== "loading" && tool !== "pan") {
      const hit = snapToGeometry(pageGeom, raw, 10 / zoom);
      if (hit) return { p: hit.point, snapped: true, kind: hit.kind };
    }
    return { p: raw, snapped: false };
  };

  // ---------- measurement math ----------
  const compute = (kind: string, pts: Pt[], s: ScaleRow, rise: number | null) => {
    const r = engine!.reading(KIND_OF[kind], pts, toScale(s));
    const value = kind === "roof_area" ? r.value * pitchFactor(rise ?? 0) : r.value;
    return { value, unit: KIND_OF[kind] === "area" ? "SF" : "LF" };
  };

  const finish = async (pts: Pt[], snapped: boolean[]) => {
    setDraft({ pts: [], snapped: [] });
    if (!engine || !tenantId) return;
    if (tool === "viewport") { setPendingViewport([pts[0][0], pts[0][1], pts[1][0], pts[1][1]]); setTool("calibrate"); toast.message("Viewport set. Now click two ends of a known dimension inside it."); return; }
    if (tool === "calibrate" || tool === "verify") { setDimText(""); setDialog({ mode: tool, pts }); return; }
    const s = scaleFor(scales, pageIndex, pts);
    if (!s) { toast.error("Set the scale for this sheet (or viewport) first. Nothing was measured."); return; }
    const rise = tool === "roof_area" ? Number(pitch) : null;
    if (tool === "roof_area" && !(pitch !== "" && rise! >= 0 && rise! <= 24)) { toast.error("Enter the roof pitch (rise per 12) before measuring roof area"); return; }
    let v;
    try { v = compute(tool, pts, s, rise); } catch (e: any) { toast.error(e.message); return; }
    const { error } = await db.from("plan_measurements").insert({
      tenant_id: tenantId, project_id: projectId, document_id: documentId, page_index: pageIndex, scale_id: s.id, kind: tool, points: pts,
      value: v.value, unit: v.unit, pitch_rise: rise, driver: KIND_OF[tool] === "area" ? "roof_area" : "perimeter",
      label: `${tool.replace("_", " ")} ${pageMs.length + 1}`, source: snapped.every(Boolean) ? "vector_snapped" : "manual_calibrated", engine: engine.id,
      created_by: (await supabase.auth.getUser()).data.user?.id,
    });
    if (error) toast.error(error.message); else reload();
  };

  const needPts = tool === "distance" || tool === "calibrate" || tool === "verify" || tool === "viewport" ? 2 : Infinity;
  const onClick = (e: React.MouseEvent) => {
    if (tool === "pan" || !engine || !box || drag.current) return;
    const { p, snapped } = pick(e);
    const pts = [...draft.pts, p], sn = [...draft.snapped, snapped];
    if (pts.length >= needPts) finish(pts, sn); else setDraft({ pts, snapped: sn });
  };
  const completeDraft = () => {
    const min = tool === "perimeter" ? 2 : 3;
    if (draft.pts.length >= min) finish(draft.pts, draft.snapped);
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setDraft({ pts: [], snapped: [] }); if (e.key === "Enter") completeDraft(); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  });

  // ---------- scale ----------
  const saveCalibration = async () => {
    if (!dialog || !engine || !tenantId) return;
    const ft = parseFeet(dimText);
    if (!(ft > 0)) return toast.error("Enter a dimension like 40'-0\" or 12.5");
    const [a, b] = dialog.pts;
    try {
      if (dialog.mode === "calibrate") {
        const sc = engine.calibrate(a, b, ft, "ft");
        const { error } = await db.from("plan_sheet_scales").insert({ tenant_id: tenantId, project_id: projectId, document_id: documentId, page_index: pageIndex,
          name: pendingViewport ? `Viewport ${pageScales.length + 1}` : "Sheet", viewport_bbox: pendingViewport, units_per_user_unit: sc.x, unit: "ft", method: "calibrated",
          calibration: { a, b, real_ft: ft, entered: dimText }, verified: false, engine: engine.id, created_by: (await supabase.auth.getUser()).data.user?.id });
        if (error) throw error;
        setPendingViewport(null); toast.success("Scale set. Now verify it against a second known dimension.");
        setTool("verify");
      } else {
        const s = scaleFor(scales, pageIndex, [a, b]);
        if (!s) throw new Error("No scale covers that dimension yet");
        const measured = engine.reading("distance", [a, b], toScale(s)).value;
        const err = verifyError(measured, ft);
        const ok = err <= VERIFY_TOLERANCE;
        const { error } = await db.from("plan_sheet_scales").update({ verified: ok, verification: { a, b, expected_ft: ft, measured_ft: measured, error_pct: err * 100, passed: ok, at: new Date().toISOString() } }).eq("id", s.id).eq("tenant_id", tenantId);
        if (error) throw error;
        ok ? toast.success(`Scale verified: measured ${measured.toFixed(2)} ft vs ${ft.toFixed(2)} ft (${(err * 100).toFixed(2)}% error)`)
          : toast.error(`Scale failed verification: measured ${measured.toFixed(2)} ft vs ${ft.toFixed(2)} ft (${(err * 100).toFixed(2)}% > 1%). Re-calibrate.`);
        setTool("pan");
      }
      setDialog(null); reload();
    } catch (e: any) { toast.error(e.message || String(e)); }
  };
  const saveRatio = async () => {
    if (!engine || !tenantId) return;
    try {
      const sc = scaleFromRatio(Number(ratio.paper), Number(ratio.real), "ft", uu);
      const { error } = await db.from("plan_sheet_scales").insert({ tenant_id: tenantId, project_id: projectId, document_id: documentId, page_index: pageIndex,
        name: pendingViewport ? `Viewport ${pageScales.length + 1}` : "Sheet", viewport_bbox: pendingViewport, units_per_user_unit: sc.x, unit: "ft", method: "stated_ratio",
        calibration: { paper_in: Number(ratio.paper), real_ft: Number(ratio.real), user_unit: uu }, verified: false, engine: engine.id, created_by: (await supabase.auth.getUser()).data.user?.id });
      if (error) throw error;
      setRatioOpen(false); setPendingViewport(null); setTool("verify"); toast.success("Stated scale saved. Verify it against a known dimension before approving anything."); reload();
    } catch (e: any) { toast.error(e.message); }
  };
  const removeScale = async (s: ScaleRow) => {
    if (ms.some((m) => m.scale_id === s.id)) return toast.error("Measurements use this scale. Delete them first.");
    await db.from("plan_sheet_scales").delete().eq("id", s.id).eq("tenant_id", tenantId); reload();
  };

  // ---------- measurement actions ----------
  const update = async (m: MRow, patch: any) => {
    const { error } = await db.from("plan_measurements").update(patch).eq("id", m.id).eq("tenant_id", tenantId);
    if (error) toast.error(error.message); reload();
  };
  const approve = async (m: MRow) => update(m, { status: "approved", approved_by: (await supabase.auth.getUser()).data.user?.id, approved_at: new Date().toISOString() });
  const exportOne = async (m: MRow) => {
    const d = DRIVERS.find((x) => x.key === m.driver);
    if (!d) return toast.error("Pick a takeoff item first");
    if (d.uom !== m.unit) return toast.error(`${d.label} is measured in ${d.uom}; this measurement is ${m.unit}`);
    const uid = (await supabase.auth.getUser()).data.user?.id;
    const { data: q, error } = await db.from("commercial_takeoff_quantities").insert({ tenant_id: tenantId, project_id: projectId, driver: d.key, label: m.label || d.label, uom: d.uom,
      value: Math.round(Number(m.value) * 100) / 100, source_sheet: `${doc?.filename} · p${m.page_index + 1}`, source: "plan_measured", confidence: 1, scale_status: "verified",
      review_status: "verified", verified_by: uid, verified_at: new Date().toISOString() }).select("id").single();
    if (error) return toast.error(error.message);
    await update(m, { status: "exported", takeoff_quantity_id: q.id });
    toast.success(`Sent ${Number(m.value).toFixed(2)} ${m.unit} to the project takeoff`);
  };
  const onVertexDown = (m: MRow, i: number) => (e: React.MouseEvent) => { if (m.status === "exported") return; e.stopPropagation(); drag.current = { id: m.id, i }; };
  const onMove = (e: React.MouseEvent) => {
    if (!engine || !box) return;
    const h = pick(e); setHover({ p: h.p, kind: h.kind });
    if (drag.current) setMs((list) => list.map((m) => m.id === drag.current!.id ? { ...m, points: m.points.map((p, j) => j === drag.current!.i ? h.p : p) } : m));
  };
  const onUp = async () => {
    const d = drag.current; if (!d) return;
    setTimeout(() => { drag.current = null; }, 0);
    const m = ms.find((x) => x.id === d.id)!; const s = scales.find((x) => x.id === m.scale_id)!;
    try { const v = compute(m.kind, m.points, s, m.pitch_rise); await update(m, { points: m.points, value: v.value, source: "manual_calibrated", status: m.status === "approved" ? "draft" : m.status }); }
    catch (e: any) { toast.error(e.message); reload(); }
  };

  // ---------- save measured copy (PdfCraft) ----------
  const saveMeasuredCopy = async () => {
    if (!engine || !bytes || !doc || !tenantId) return;
    if (engine.id !== "pdfcraft-wasm") return toast.error("Saving annotations into the PDF needs the PdfCraft engine, which isn't loaded.");
    const items = ms.filter((m) => m.status !== "rejected").map((m) => {
      const s = scales.find((x) => x.id === m.scale_id)!;
      return { page: m.page_index, kind: KIND_OF[m.kind], points: m.points, scale: toScale(s), label: `${m.label ?? ""} ${Number(m.value).toFixed(2)} ${m.unit}${m.pitch_rise != null ? ` @ ${m.pitch_rise}/12` : ""}`.trim(), author: "PITCH", id: m.id, color: [0.85, 0.1, 0.1] as [number, number, number] };
    });
    if (!items.length) return toast.error("No measurements to save");
    setSaving(true);
    try {
      const out = engine.embed(bytes, items)!;
      const embedded = engine.listEmbedded(out)!;
      if (embedded.length < items.length) throw new Error(`Only ${embedded.length} of ${items.length} measurements could be read back from the saved PDF`);
      const { count } = await db.from("documents").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).contains("metadata", { measured_from_document_id: doc.id });
      const version = (count || 0) + 1;
      const base = doc.filename.replace(/\.pdf$/i, "");
      const path = `${tenantId}/commercial/${projectId}/drawings/measured/${doc.id}-v${version}.pdf`;
      const { error: up } = await supabase.storage.from("documents").upload(path, new Blob([out as BlobPart], { type: "application/pdf" }), { contentType: "application/pdf", upsert: false });
      if (up) throw up;
      const { error } = await db.from("documents").insert({ tenant_id: tenantId, filename: `${base} (measured v${version}).pdf`, file_path: path, file_size: out.byteLength, mime_type: "application/pdf", document_type: "commercial_drawings",
        description: `Measured copy v${version}`, metadata: { commercial_project_id: projectId, category: "drawings", measured_from_document_id: doc.id, measured_version: version, measurement_ids: items.map((i) => i.id), engine: engine.version } });
      if (error) throw error;
      toast.success(`Saved measured copy v${version} with ${embedded.length} measurements. The original drawing is unchanged.`);
    } catch (e: any) { toast.error(e.message || String(e)); } finally { setSaving(false); }
  };

  if (!enabled) return <div className="p-10 text-center text-muted-foreground">Plan measurement is still being verified and isn't switched on for this site yet.</div>;

  const activeScale = scaleFor(scales, pageIndex, draft.pts.length ? draft.pts : []) || pageScales[0];
  const tools: { id: Tool; label: string; icon: any; needsScale?: boolean }[] = [
    { id: "pan", label: "Select", icon: Hand }, { id: "viewport", label: "Viewport", icon: Frame }, { id: "calibrate", label: "Calibrate", icon: Crosshair }, { id: "verify", label: "Verify", icon: CheckCircle2, needsScale: true },
    { id: "distance", label: "Distance", icon: Ruler, needsScale: true }, { id: "perimeter", label: "Perimeter", icon: Spline, needsScale: true }, { id: "area", label: "Area", icon: Square, needsScale: true }, { id: "roof_area", label: "Roof area", icon: Home, needsScale: true },
  ];
  const draftReading = (() => {
    if (!engine || draft.pts.length < 1 || !hover || !["distance", "perimeter", "area", "roof_area"].includes(tool)) return null;
    const s = scaleFor(scales, pageIndex, [...draft.pts, hover.p]); if (!s) return null;
    try { const pts = [...draft.pts, hover.p]; return compute(tool, pts, s, tool === "roof_area" ? Number(pitch || 0) : null); } catch { return null; }
  })();

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="flex items-center gap-2 border-b px-3 py-2 flex-wrap">
        <Button variant="ghost" size="sm" asChild><Link to={`/commercial/${projectId}`}><ArrowLeft className="h-4 w-4 mr-1" />Project</Link></Button>
        <span className="font-medium truncate max-w-[30ch]">{doc?.filename || "Loading…"}</span>
        <div className="flex items-center gap-1 ml-2">
          {tools.map((t) => <Button key={t.id} size="sm" variant={tool === t.id ? "default" : "outline"} disabled={t.needsScale && !pageScales.length} onClick={() => { setTool(t.id); setDraft({ pts: [], snapped: [] }); }}><t.icon className="h-4 w-4 mr-1" />{t.label}</Button>)}
          <Button size="sm" variant="outline" onClick={() => setRatioOpen(true)}>Stated scale…</Button>
        </div>
        {tool === "roof_area" && <div className="flex items-center gap-1"><Label className="text-xs">Pitch</Label><Input className="h-8 w-16" value={pitch} onChange={(e) => setPitch(e.target.value)} placeholder="rise" /><span className="text-xs">/12</span></div>}
        <div className="flex items-center gap-1 ml-auto">
          <div className="flex items-center gap-1 mr-2"><Switch checked={snapOn} onCheckedChange={setSnapOn} id="snap" /><Label htmlFor="snap" className="text-xs">Snap</Label></div>
          <Button size="icon" variant="outline" onClick={() => setZoom((z) => Math.max(0.1, z / 1.25))}><ZoomOut className="h-4 w-4" /></Button>
          <span className="text-xs w-12 text-center">{Math.round(zoom * 100)}%</span>
          <Button size="icon" variant="outline" onClick={() => setZoom((z) => Math.min(8, z * 1.25))}><ZoomIn className="h-4 w-4" /></Button>
          <Button size="icon" variant="outline" onClick={() => setViewRot((r) => (r + 90) % 360)}><RotateCw className="h-4 w-4" /></Button>
          <Button size="sm" onClick={saveMeasuredCopy} disabled={saving || !ms.length}>{saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}Save measured copy</Button>
        </div>
      </header>
      <div className="flex flex-1 min-h-0">
        <aside className="w-40 border-r overflow-y-auto p-2 space-y-2">
          {pdf && Array.from({ length: pdf.numPages }, (_, i) => <Thumb key={i} pdf={pdf} index={i} active={i === pageIndex} count={ms.filter((m) => m.page_index === i).length} scaled={scales.some((s) => s.page_index === i && s.verified)} onClick={() => { setPageIndex(i); setDraft({ pts: [], snapped: [] }); }} />)}
        </aside>
        <main className="flex-1 overflow-auto bg-muted/40 p-4">
          {!pdf && <div className="p-10 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline mr-2" />Opening drawing…</div>}
          <div className="relative inline-block shadow" style={{ width: canvasSize.w, height: canvasSize.h }}>
            <canvas ref={canvasRef} className="block bg-card" />
            {engine && box && (
              <svg className="absolute inset-0" width={canvasSize.w} height={canvasSize.h} style={{ cursor: tool === "pan" ? "default" : "crosshair" }}
                onClick={onClick} onMouseMove={onMove} onMouseUp={onUp} onDoubleClick={(e) => { e.preventDefault(); completeDraft(); }}>
                {pageScales.filter((s) => s.viewport_bbox).map((s) => { const [a, b] = [toCss([s.viewport_bbox![0], s.viewport_bbox![1]]), toCss([s.viewport_bbox![2], s.viewport_bbox![3]])];
                  return <rect key={s.id} x={Math.min(a[0], b[0])} y={Math.min(a[1], b[1])} width={Math.abs(a[0] - b[0])} height={Math.abs(a[1] - b[1])} className="fill-none stroke-muted-foreground" strokeDasharray="6 4" />; })}
                {pageMs.map((m) => { const c = m.points.map(toCss); const closed = KIND_OF[m.kind] === "area"; const sel = selected === m.id;
                  return <g key={m.id} onClick={(e) => { if (tool === "pan") { e.stopPropagation(); setSelected(m.id); } }}>
                    <polyline points={[...c, ...(closed ? [c[0]] : [])].map((p) => p.join(",")).join(" ")} className={`${m.status === "exported" ? "stroke-primary" : m.status === "rejected" ? "stroke-muted-foreground" : "stroke-destructive"} ${closed ? "fill-destructive/10" : "fill-none"}`} strokeWidth={sel ? 3 : 2} />
                    {tool === "pan" && c.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={sel ? 5 : 3} className="fill-background stroke-destructive" onMouseDown={onVertexDown(m, i)} style={{ cursor: m.status === "exported" ? "not-allowed" : "move" }} />)}
                    <text x={c[0][0] + 6} y={c[0][1] - 6} className="fill-destructive text-[11px] font-semibold">{Number(m.value).toFixed(2)} {m.unit}</text>
                  </g>; })}
                {draft.pts.length > 0 && hover && <polyline points={[...draft.pts, hover.p].map(toCss).map((p) => p.join(",")).join(" ")} className="fill-none stroke-primary" strokeWidth={2} strokeDasharray="4 3" />}
                {draft.pts.map((p, i) => { const c = toCss(p); return <circle key={i} cx={c[0]} cy={c[1]} r={4} className="fill-primary" />; })}
                {hover && tool !== "pan" && (() => { const c = toCss(hover.p); return <g><circle cx={c[0]} cy={c[1]} r={hover.kind ? 6 : 3} className={hover.kind ? "fill-none stroke-primary" : "fill-primary"} strokeWidth={2} />
                  {draftReading && <text x={c[0] + 10} y={c[1] + 16} className="fill-primary text-[12px] font-semibold">{draftReading.value.toFixed(2)} {draftReading.unit}</text>}
                  {hover.kind && <text x={c[0] + 10} y={c[1] - 8} className="fill-primary text-[10px]">{hover.kind}</text>}</g>; })()}
              </svg>)}
          </div>
        </main>
        <aside className="w-96 border-l overflow-y-auto p-3 space-y-4 text-sm">
          <section className="space-y-1">
            <div className="text-xs text-muted-foreground">Engine</div>
            <div className="flex items-center gap-2"><Badge variant={engine?.id === "pdfcraft-wasm" ? "default" : "secondary"}>{engine ? (engine.id === "pdfcraft-wasm" ? "PdfCraft (WASM)" : "PITCH JS fallback") : "Loading…"}</Badge><span className="text-xs text-muted-foreground truncate">{engine?.version}</span></div>
            {fallback && <p className="text-xs text-destructive">PdfCraft failed to load ({fallback}); snapping and saving measured copies are off.</p>}
            <p className="text-xs text-muted-foreground">Snapping: {pageGeom === "loading" ? "reading vector lines…" : pageGeom ? `${pageGeom.segments.length.toLocaleString()} vector segments${pageGeom.truncated ? " (truncated — large sheet)" : ""}` : "no vector lines on this sheet (scanned or unsupported)"}</p>
          </section>
          <section className="space-y-2">
            <div className="font-medium">Sheet {pageIndex + 1} scale</div>
            {!pageScales.length && <p className="text-xs text-destructive">No scale. Measuring is blocked on this sheet until you calibrate from a known dimension or enter the drawing's stated scale.</p>}
            {pendingViewport && <p className="text-xs">Viewport drawn — next calibration applies only inside it.</p>}
            {pageScales.map((s) => <div key={s.id} className="border rounded p-2 space-y-1">
              <div className="flex items-center justify-between"><span>{s.name}{s.viewport_bbox ? " (viewport)" : ""}</span>{s.verified ? <Badge>Verified</Badge> : <Badge variant="destructive">Not verified</Badge>}</div>
              <div className="text-xs text-muted-foreground">{s.method === "calibrated" ? `Calibrated: ${s.calibration?.entered ?? s.calibration?.real_ft + " ft"}` : `Stated ${s.calibration?.paper_in}" = ${s.calibration?.real_ft} ft`} · {(1 / Number(s.units_per_user_unit) / 72).toFixed(5)} in/ft on paper</div>
              {s.verification && <div className="text-xs">Check: {Number(s.verification.measured_ft).toFixed(2)} ft vs {Number(s.verification.expected_ft).toFixed(2)} ft · {Number(s.verification.error_pct).toFixed(2)}% {s.verification.passed ? "pass" : "fail"}</div>}
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => removeScale(s)}>Remove</Button>
            </div>)}
          </section>
          <section className="space-y-2">
            <div className="font-medium">Measurements on this sheet</div>
            {!pageMs.length && <p className="text-xs text-muted-foreground">None yet.</p>}
            {pageMs.map((m) => { const s = scales.find((x) => x.id === m.scale_id); const opts = DRIVERS.filter((d) => d.uom === m.unit);
              return <div key={m.id} className={`border rounded p-2 space-y-1 ${selected === m.id ? "ring-2 ring-primary" : ""}`} onClick={() => setSelected(m.id)}>
                <div className="flex items-center justify-between gap-2"><Input className="h-7" defaultValue={m.label ?? ""} disabled={m.status === "exported"} onBlur={(e) => e.target.value !== m.label && update(m, { label: e.target.value })} /><span className="font-semibold whitespace-nowrap">{Number(m.value).toFixed(2)} {m.unit}</span></div>
                <div className="flex flex-wrap gap-1 text-xs"><Badge variant="outline">{m.kind.replace("_", " ")}{m.pitch_rise != null ? ` @ ${m.pitch_rise}/12` : ""}</Badge><Badge variant="outline">{SOURCE_LABEL[m.source]}</Badge><Badge variant={m.status === "exported" ? "default" : m.status === "approved" ? "secondary" : "outline"}>{m.status}</Badge><span className="text-muted-foreground">rev {m.revision}</span></div>
                {m.status !== "exported" && <div className="flex gap-1 items-center">
                  <Select value={m.driver ?? undefined} onValueChange={(v) => update(m, { driver: v })}><SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Takeoff item" /></SelectTrigger><SelectContent>{opts.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}</SelectContent></Select>
                  {m.status === "draft" && <Button size="sm" className="h-7" disabled={!s?.verified} title={!s?.verified ? "Verify the scale first" : ""} onClick={(e) => { e.stopPropagation(); approve(m); }}>Approve</Button>}
                  {m.status === "approved" && <Button size="sm" className="h-7" onClick={(e) => { e.stopPropagation(); exportOne(m); }}>Send to takeoff</Button>}
                  <Button size="sm" variant="ghost" className="h-7" onClick={(e) => { e.stopPropagation(); update(m, { deleted_at: new Date().toISOString() }); }}>Delete</Button>
                </div>}
                {!s?.verified && m.status === "draft" && <p className="text-xs text-destructive">Scale not verified — can't approve.</p>}
              </div>; })}
          </section>
          {selected && <section className="space-y-1">
            <div className="font-medium">Revision history</div>
            {revs.map((r) => <div key={r.id} className="text-xs border-b py-1">rev {r.revision} · {r.action} · {new Date(r.changed_at).toLocaleString()} · {Number(r.snapshot?.value).toFixed(2)} {r.snapshot?.unit} · {r.snapshot?.status}</div>)}
          </section>}
          <section className="text-xs text-muted-foreground space-y-1">
            <p>Click to place points. Distance finishes at 2 points; perimeter and areas finish with double-click or Enter. Esc cancels. In Select mode, drag a point to correct it.</p>
            <p>Calibrate from a dimension you trust, then Verify against a different one. Measurements can only be approved once the check is within 1%.</p>
          </section>
        </aside>
      </div>

      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent><DialogHeader><DialogTitle>{dialog?.mode === "calibrate" ? "Known dimension" : "Check against a known dimension"}</DialogTitle></DialogHeader>
          <Label>What is the real length between the two points?</Label>
          <Input autoFocus value={dimText} onChange={(e) => setDimText(e.target.value)} placeholder={`e.g. 40'-0" or 12.5`} onKeyDown={(e) => e.key === "Enter" && saveCalibration()} />
          <DialogFooter><Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button><Button onClick={saveCalibration}>{dialog?.mode === "calibrate" ? "Set scale" : "Check scale"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={ratioOpen} onOpenChange={setRatioOpen}>
        <DialogContent><DialogHeader><DialogTitle>Drawing's stated scale</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Enter the scale printed on the sheet, e.g. 1/8" = 1'-0". It still has to pass a known-dimension check before anything can be approved.</p>
          <div className="flex items-center gap-2"><Input value={ratio.paper} onChange={(e) => setRatio({ ...ratio, paper: e.target.value })} className="w-24" /><span>inch on paper =</span><Input value={ratio.real} onChange={(e) => setRatio({ ...ratio, real: e.target.value })} className="w-24" /><span>ft</span></div>
          <DialogFooter><Button variant="outline" onClick={() => setRatioOpen(false)}>Cancel</Button><Button onClick={saveRatio}>Save scale</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Thumb({ pdf, index, active, onClick, count, scaled }: { pdf: any; index: number; active: boolean; onClick: () => void; count: number; scaled: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { rootMargin: "200px" });
    io.observe(el); return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!seen) return;
    (async () => {
      const page = await pdf.getPage(index + 1);
      const vp0 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 130 / vp0.width });
      const c = ref.current; if (!c) return;
      c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext("2d")!, viewport: vp }).promise.catch(() => {});
    })();
  }, [seen, pdf, index]);
  return <button onClick={onClick} className={`block w-full border rounded p-1 text-left ${active ? "ring-2 ring-primary" : ""}`}>
    <canvas ref={ref} className="w-full bg-card min-h-[80px]" />
    <div className="flex justify-between text-[10px] mt-1"><span>p{index + 1}</span><span>{scaled ? "✓ scale" : ""} {count ? `${count} m` : ""}</span></div>
  </button>;
}
