/** Shared types for the plan measurement engines (PdfCraft WASM and the PITCH JS fallback). */
export type Pt = [number, number];
export type Kind = 'distance' | 'perimeter' | 'area';
/** How a quantity was produced. Only calibrated sources can ever be approved. */
export type QuantitySource = 'manual_calibrated' | 'vector_snapped' | 'ocr_derived' | 'ai_estimated';

/** Real-world units per PDF user-space unit (mirrors pdfcraft-measure `Scale`). */
export interface Scale {
  x: number;
  y: number;
  unit: string;
  area_unit: string;
  precision: number;
  ratio: string;
}

export interface Reading {
  kind: Kind;
  value: number;
  unit: string;
  label: string;
  length: number;
  area: number;
}

/** Page geometry needed for view <-> user conversion. crop = [x0, y0, x1, y1] in user space. */
export interface PageBox {
  rotate: number;
  crop: [number, number, number, number];
  userUnit: number;
}

export interface VectorGeometry {
  segments: [Pt, Pt][];
  endpoints: Pt[];
  midpoints: Pt[];
  truncated: boolean;
  unreadable: number;
}

export interface EmbeddedMeasurement {
  page: number;
  id: string;
  label: string;
  points: Pt[];
  reading: Reading;
}

export interface EmbedInput {
  page: number;
  kind: Kind;
  points: Pt[];
  scale: Scale;
  label: string;
  author: string;
  id: string;
  color: [number, number, number];
}

export type EngineId = 'pdfcraft-wasm' | 'pitch-js';

export interface MeasureEngine {
  id: EngineId;
  version: string;
  calibrate(a: Pt, b: Pt, realDistance: number, unit: string, precision?: number): Scale;
  reading(kind: Kind, points: Pt[], scale: Scale): Reading;
  /** Display space (points, origin top-left of the page as shown, after Rotate/UserUnit) -> user space. */
  viewToUser(box: PageBox, at: Pt): Pt;
  userToView(box: PageBox, at: Pt): Pt;
  /** Vector geometry for snapping; null when the engine cannot read PDF content. */
  geometry(pdf: Uint8Array, pageIndex: number): VectorGeometry | null;
  /** Writes ISO 32000 measurement annotations into a copy of the PDF; null when unsupported. */
  embed(pdf: Uint8Array, items: EmbedInput[]): Uint8Array | null;
  listEmbedded(pdf: Uint8Array): EmbeddedMeasurement[] | null;
}
