/**
 * Adapter for the real PdfCraft measuring engine (storytold/pdfcraft crates/measure,
 * pinned at 0a0986483378b57d62103a36490bd66166d32c8f) compiled to WebAssembly.
 * Source of the bindings: engines/pdfcraft-measure-wasm. MIT OR Apache-2.0.
 */
import init, * as wasm from '@/lib/wasm/pitch_pdfcraft_measure/pitch_pdfcraft_measure.js';
import type { EmbedInput, EmbeddedMeasurement, Kind, MeasureEngine, PageBox, Pt, Reading, Scale, VectorGeometry } from './types';
import { jsEngine } from './jsEngine';
import { buildBoxPdf } from './boxPdf';

function parse<T>(s: string): T {
  const v = JSON.parse(s);
  if (v && typeof v === 'object' && !Array.isArray(v) && 'error' in v) throw new Error(String(v.error));
  return v as T;
}
const toScaleJson = (s: Scale) => JSON.stringify({ x: s.x, y: s.y, unit: s.unit, area_unit: s.area_unit, precision: s.precision, ratio: s.ratio });

// view<->user in PdfCraft needs a document; a tiny one-page PDF carrying the same
// MediaBox/CropBox/Rotate/UserUnit is cached per page box so clicks stay fast.
const boxCache = new Map<string, Uint8Array>();
function boxDoc(box: PageBox): Uint8Array {
  const k = JSON.stringify(box);
  let d = boxCache.get(k);
  if (!d) { d = buildBoxPdf(box); if (boxCache.size > 64) boxCache.clear(); boxCache.set(k, d); }
  return d;
}

export const pdfcraftEngine: MeasureEngine = {
  id: 'pdfcraft-wasm',
  get version() { return wasm.engine_version(); },
  calibrate(a, b, real, unit, precision = 2) {
    const s = parse<any>(wasm.calibrate(a[0], a[1], b[0], b[1], real, unit, precision));
    return { x: s.x, y: s.y, unit: s.unit, area_unit: s.area_unit, precision: s.precision, ratio: s.ratio };
  },
  reading(kind: Kind, points: Pt[], scale: Scale): Reading {
    const r = parse<any>(wasm.reading(kind, JSON.stringify(points), toScaleJson(scale)));
    return { kind: r.kind, value: r.value, unit: r.unit, label: r.label, length: r.length, area: r.area };
  },
  viewToUser(box, at) { return parse<Pt>(wasm.view_to_user(boxDoc(box), 0, at[0], at[1])); },
  userToView(box, at) { return parse<Pt>(wasm.user_to_view(boxDoc(box), 0, at[0], at[1])); },
  geometry(pdf, page): VectorGeometry { return parse<VectorGeometry>(wasm.page_geometry(pdf, page)); },
  embed(pdf, items: EmbedInput[]) {
    let out = pdf;
    for (const it of items) out = wasm.add_measurement(out, JSON.stringify({ ...it, scale: JSON.parse(toScaleJson(it.scale)) }));
    return out;
  },
  listEmbedded(pdf): EmbeddedMeasurement[] {
    const l = parse<any>(wasm.list(pdf));
    return l.measurements.map((m: any) => ({ page: m.page, id: m.id, label: m.label, points: m.points, reading: m.reading }));
  },
};

let ready: Promise<MeasureEngine> | null = null;
/** Loads the WASM engine; falls back to the JS engine (never silently: callers read `.id`). */
export function loadMeasureEngine(): Promise<{ engine: MeasureEngine; fallbackReason?: string }> {
  return (ready ??= init().then(() => pdfcraftEngine)).then(
    (engine) => ({ engine }),
    (e) => { ready = null; return { engine: jsEngine, fallbackReason: String(e?.message || e) }; },
  );
}
