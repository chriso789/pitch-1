// Roof Diagram Renderer — geometry-first, EagleView-style 6-page report.
import {
  computeOverlayTransform,
  transformOverlayPoints,
  type OverlayBBox,
  type OverlayCalibration,
} from "./overlay-transform.ts";

// Inputs come exclusively from real measured geometry stored in
// ai_roof_planes / ai_roof_edges / ai_measurement_results / ai_measurement_images.
//
// Hard rules:
//   1. Never render diagrams from placeholder geometry. Caller is responsible for the
//      quality gate; this renderer assumes inputs are real.
//   2. All pages share the same viewport transform so roof scale, rotation and compass
//      placement are identical across pages.
//   3. Output is an 8.5x11 SVG (850x1100 viewBox) with no UI chrome — clean, vector,
//      printable.

type Point = { x: number; y: number };

export type RendererPlane = {
  plane_index: number;
  plane_label?: string | null;
  polygon_px: Point[];
  pitch?: number | null;            // rise per 12
  pitch_degrees?: number | null;
  area_2d_sqft?: number | null;
  area_pitch_adjusted_sqft?: number | null;
  confidence?: number | null;
};

export type RendererEdge = {
  edge_id?: string | null;
  edge_label?: string | null;
  edge_type: "ridge" | "hip" | "valley" | "eave" | "rake" | "unknown";
  line_px: Point[];
  length_ft?: number | null;
  confidence?: number | null;
};

export type DiagramInput = {
  propertyAddress: string;
  jobId?: string | null;
  generatedAt?: string;
  confidence?: number | null;
  engineVersion?: string;
  planes: RendererPlane[];
  edges: RendererEdge[];
  totals: {
    total_area_2d_sqft?: number | null;
    total_area_pitch_adjusted_sqft?: number | null;
    ridge_length_ft?: number | null;
    hip_length_ft?: number | null;
    valley_length_ft?: number | null;
    eave_length_ft?: number | null;
    rake_length_ft?: number | null;
    roof_square_count?: number | null;
    dominant_pitch?: string | null;
  };
  satelliteImageUrl?: string | null;
  /** Native pixel dimensions of the satellite raster the polygon_px coords were sampled from. */
  sourceImageWidth?: number | null;
  sourceImageHeight?: number | null;
  roofTargetBboxPx?: Partial<OverlayBBox> | null;
  overlayCalibration?: OverlayCalibration | null;
  debugWatermarkText?: string | null;
};

export type GeneratedDiagram = {
  diagram_type: "cover" | "overlay" | "length" | "pitch" | "area" | "notes";
  title: string;
  page_number: number;
  svg_markup: string;
};

// ============================================================================
// Page geometry (8.5 x 11 inches @ 100 DPI)
// ============================================================================

const PAGE_W = 850;
const PAGE_H = 1100;

const MARGIN = { top: 50, left: 55, right: 55, bottom: 55 };
const DRAW_ZONE = { x: 85, y: 210, w: 600, h: 650 };
const DIAGRAM_ZONE = { x: 150, y: 230, w: 455, h: 560 };
const COMPASS = { cx: 710, cy: 850 };

const COLORS = {
  outline: "#111111",
  ridge: "#d71920",
  valley: "#1f77b4",
  hip: "#f58220",
  eave: "#111111",
  rake: "#555555",
  unknown: "#888888",
  planeFill: "#f4f4f4",
  text: "#111111",
  muted: "#666666",
  satelliteFill: "rgba(255,255,255,0.18)",
};

const EDGE_STYLE: Record<RendererEdge["edge_type"], { stroke: string; width: number; dash?: string }> = {
  ridge: { stroke: COLORS.ridge, width: 3 },
  valley: { stroke: COLORS.valley, width: 3 },
  hip: { stroke: COLORS.hip, width: 3 },
  eave: { stroke: COLORS.eave, width: 2 },
  rake: { stroke: COLORS.rake, width: 2, dash: "6 4" },
  unknown: { stroke: COLORS.unknown, width: 2, dash: "3 3" },
};

// ============================================================================
// Public entry point
// ============================================================================

export function generateRoofDiagrams(input: DiagramInput): GeneratedDiagram[] {
  if (!input.planes?.length) return [];

  // ONE shared transform for every page so geometry never drifts between diagrams.
  const transformed = normalizeToDrawZone(input);
  const placedEdges = placeEdgeLabels(transformed.edges);
  const placedPlanes = placePlaneLabels(transformed.planes);
  const overlayEdges = placeEdgeLabels(transformed.overlayEdges || transformed.edges);
  const overlayPlanes = placePlaneLabels(transformed.overlayPlanes || transformed.planes);

  const ctx = {
    input,
    planes: placedPlanes,
    edges: placedEdges,
    overlayPlanes,
    overlayEdges,
    totals: input.totals || {},
    address: input.propertyAddress || "Unknown Address",
    generatedAt: input.generatedAt || new Date().toISOString(),
    engineVersion: input.engineVersion || "geometry_first_v2",
    confidence: input.confidence ?? null,
    jobId: input.jobId ?? null,
  };

  const pages: GeneratedDiagram[] = [
    { diagram_type: "cover", title: "Roof Measurement Report", page_number: 1, svg_markup: renderCoverPage(ctx) },
    { diagram_type: "overlay", title: "Image / Overlay", page_number: 2, svg_markup: renderOverlayPage(ctx) },
    { diagram_type: "length", title: "Length Diagram", page_number: 3, svg_markup: renderLengthPage(ctx) },
    { diagram_type: "pitch", title: "Pitch Diagram", page_number: 4, svg_markup: renderPitchPage(ctx) },
    { diagram_type: "area", title: "Area Diagram", page_number: 5, svg_markup: renderAreaPage(ctx) },
    { diagram_type: "notes", title: "Notes Diagram", page_number: 6, svg_markup: renderNotesPage(ctx) },
  ];

  return pages;
}

// ============================================================================
// Geometry normalization — single transform for ALL pages
// ============================================================================

type NormalizedGeometry = { planes: RendererPlane[]; edges: RendererEdge[]; overlayPlanes?: RendererPlane[]; overlayEdges?: RendererEdge[]; calibration?: OverlayCalibration };

function normalizeToDrawZone(input: DiagramInput): NormalizedGeometry {
  const planes = input.planes || [];
  const edges = input.edges || [];
  const sourceW = Number(input.sourceImageWidth || 0);
  const sourceH = Number(input.sourceImageHeight || 0);

  const geometryPoints = [
    ...planes.flatMap((p) => p.polygon_px || []),
    ...edges.flatMap((e) => e.line_px || []),
  ].filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y));

  if (sourceW > 0 && sourceH > 0) {
    const calibration = input.overlayCalibration?.calibrated
      ? input.overlayCalibration
      : computeOverlayTransform({
        rasterSize: { width: sourceW, height: sourceH },
        geometryPoints,
        roofTargetBboxPx: input.roofTargetBboxPx || null,
      });

    const calibratedPlanes = calibration.calibrated
      ? planes.map((p) => ({ ...p, polygon_px: transformOverlayPoints(p.polygon_px || [], calibration) }))
      : planes;
    const calibratedEdges = calibration.calibrated
      ? edges.map((e) => ({ ...e, line_px: transformOverlayPoints(e.line_px || [], calibration) }))
      : edges;

    const rasterScale = Math.max(DRAW_ZONE.w / sourceW, DRAW_ZONE.h / sourceH);
    const drawnW = sourceW * rasterScale;
    const drawnH = sourceH * rasterScale;
    const offX = DRAW_ZONE.x + (DRAW_ZONE.w - drawnW) / 2;
    const offY = DRAW_ZONE.y + (DRAW_ZONE.h - drawnH) / 2;
    const txRaster = (p: Point): Point => ({ x: p.x * rasterScale + offX, y: p.y * rasterScale + offY });

    const cAll = [
      ...calibratedPlanes.flatMap((p) => p.polygon_px || []),
      ...calibratedEdges.flatMap((e) => e.line_px || []),
    ];
    const cb = bboxFromPoints(cAll);
    const diagramScale = cb ? Math.min(DIAGRAM_ZONE.w / cb.width, DIAGRAM_ZONE.h / cb.height) : 1;
    const diagramOffX = cb ? DIAGRAM_ZONE.x + (DIAGRAM_ZONE.w - cb.width * diagramScale) / 2 : DIAGRAM_ZONE.x;
    const diagramOffY = cb ? DIAGRAM_ZONE.y + (DIAGRAM_ZONE.h - cb.height * diagramScale) / 2 : DIAGRAM_ZONE.y;
    const txDiagram = (p: Point): Point => cb
      ? { x: (p.x - cb.minX) * diagramScale + diagramOffX, y: (p.y - cb.minY) * diagramScale + diagramOffY }
      : p;

    return {
      planes: calibratedPlanes.map((p) => ({ ...p, polygon_px: (p.polygon_px || []).map(txDiagram) })),
      edges: calibratedEdges.map((e) => ({ ...e, line_px: (e.line_px || []).map(txDiagram) })),
      overlayPlanes: calibratedPlanes.map((p) => ({ ...p, polygon_px: (p.polygon_px || []).map(txRaster) })),
      overlayEdges: calibratedEdges.map((e) => ({ ...e, line_px: (e.line_px || []).map(txRaster) })),
      calibration,
    };
  }

  const all = geometryPoints;

  if (all.length === 0) return { planes, edges };

  const minX = Math.min(...all.map((p) => p.x));
  const maxX = Math.max(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y));
  const maxY = Math.max(...all.map((p) => p.y));

  const srcW = Math.max(maxX - minX, 1);
  const srcH = Math.max(maxY - minY, 1);

  // For non-raster diagram pages, use a wider fixed diagram zone so pitch/area
  // labels stay readable instead of rendering as a tiny centered sketch.
  const scale = Math.min(DIAGRAM_ZONE.w / srcW, DIAGRAM_ZONE.h / srcH);
  const drawnW = srcW * scale;
  const drawnH = srcH * scale;
  const offX = DIAGRAM_ZONE.x + (DIAGRAM_ZONE.w - drawnW) / 2;
  const offY = DIAGRAM_ZONE.y + (DIAGRAM_ZONE.h - drawnH) / 2;

  const tx = (p: Point): Point => ({
    x: (p.x - minX) * scale + offX,
    y: (p.y - minY) * scale + offY,
  });

  return {
    planes: planes.map((p) => ({ ...p, polygon_px: (p.polygon_px || []).map(tx) })),
    edges: edges.map((e) => ({ ...e, line_px: (e.line_px || []).map(tx) })),
  };
}

// ============================================================================
// Label placement
// ============================================================================

type PlacedEdge = RendererEdge & { _label: { x: number; y: number; leader?: { x1: number; y1: number; x2: number; y2: number } } };
type PlacedPlane = RendererPlane & { _label: { x: number; y: number } };

const EDGE_ID_PREFIX: Record<RendererEdge["edge_type"], string> = {
  ridge: "R", hip: "H", valley: "V", eave: "E", rake: "K", unknown: "U",
};

function placeEdgeLabels(edges: RendererEdge[]): PlacedEdge[] {
  const placed: PlacedEdge[] = [];
  const counters: Record<string, number> = {};

  for (const e of edges) {
    if (!e.line_px || e.line_px.length < 2) continue;
    const prefix = EDGE_ID_PREFIX[e.edge_type] || "U";
    counters[prefix] = (counters[prefix] || 0) + 1;
    const idLabel = e.edge_label || `${prefix}-${String(counters[prefix]).padStart(2, "0")}`;

    const mid = polylineMidpointByArc(e.line_px);
    const tan = polylineTangentAt(e.line_px, mid.t);
    // Normal vector (perpendicular to tangent), normalized.
    const nLen = Math.hypot(-tan.dy, tan.dx) || 1;
    const nx = -tan.dy / nLen;
    const ny = tan.dx / nLen;

    let offset = 14;
    let attempts = 0;
    let lx = mid.x + nx * offset;
    let ly = mid.y + ny * offset;
    let leader: PlacedEdge["_label"]["leader"] | undefined;

    while (attempts < 5 && labelCollides(lx, ly, placed)) {
      offset += 8;
      attempts += 1;
      lx = mid.x + nx * offset;
      ly = mid.y + ny * offset;
    }
    if (attempts >= 5 && labelCollides(lx, ly, placed)) {
      // Push out farther and draw a leader.
      offset += 18;
      lx = mid.x + nx * offset;
      ly = mid.y + ny * offset;
      leader = { x1: mid.x + nx * 4, y1: mid.y + ny * 4, x2: lx - nx * 6, y2: ly - ny * 6 };
    }

    placed.push({
      ...e,
      edge_label: idLabel,
      _label: { x: lx, y: ly, leader },
    });
  }
  return placed;
}

function labelCollides(x: number, y: number, placed: PlacedEdge[], radius = 16) {
  for (const p of placed) {
    const dx = p._label.x - x;
    const dy = p._label.y - y;
    if (Math.hypot(dx, dy) < radius) return true;
  }
  return false;
}

function placePlaneLabels(planes: RendererPlane[]): PlacedPlane[] {
  // Sort by area desc; only the top 10 + planes ≥100 sqft get labels.
  const ranked = planes
    .map((p, idx) => ({ p, idx, area: p.area_2d_sqft || 0 }))
    .sort((a, b) => b.area - a.area);
  const visibleIdx = new Set<number>(
    ranked.filter((r) => r.area >= 100).slice(0, 10).map((r) => r.idx),
  );
  return planes.map((p, idx) => {
    const c = polygonInteriorPoint(p.polygon_px);
    const showLabel = visibleIdx.has(idx);
    const label = showLabel ? (p.plane_label || `P-${String(idx + 1).padStart(2, "0")}`) : "";
    return { ...p, plane_label: label, _label: { x: c.x, y: c.y } };
  });
}

// ============================================================================
// Page renderers
// ============================================================================

type Ctx = {
  input: DiagramInput;
  planes: PlacedPlane[];
  edges: PlacedEdge[];
  overlayPlanes: PlacedPlane[];
  overlayEdges: PlacedEdge[];
  totals: DiagramInput["totals"];
  address: string;
  generatedAt: string;
  engineVersion: string;
  confidence: number | null;
  jobId: string | null;
};

function renderCoverPage(ctx: Ctx): string {
  const conf = ctx.confidence != null ? `${Math.round(ctx.confidence * 100)}%` : "—";
  const date = formatDate(ctx.generatedAt);
  const sat = ctx.input.satelliteImageUrl
    ? `<image href="${escapeXml(ctx.input.satelliteImageUrl)}" x="${DRAW_ZONE.x}" y="${DRAW_ZONE.y}" width="${DRAW_ZONE.w}" height="${DRAW_ZONE.h}" preserveAspectRatio="xMidYMid slice" />`
    : `<rect x="${DRAW_ZONE.x}" y="${DRAW_ZONE.y}" width="${DRAW_ZONE.w}" height="${DRAW_ZONE.h}" fill="#f0f0f0" stroke="#ccc"/><text x="${PAGE_W / 2}" y="${DRAW_ZONE.y + DRAW_ZONE.h / 2}" font-size="18" text-anchor="middle" fill="#888">Aerial imagery unavailable</text>`;

  const body = `
    <text x="${PAGE_W / 2}" y="160" font-size="16" text-anchor="middle" fill="${COLORS.muted}">PITCH AI Measurement Report</text>
    ${sat}
    <g font-size="13" fill="${COLORS.text}">
      <text x="${MARGIN.left}" y="900"><tspan font-weight="700">Property:</tspan> ${escapeXml(ctx.address)}</text>
      <text x="${MARGIN.left}" y="922"><tspan font-weight="700">Job ID:</tspan> ${escapeXml(ctx.jobId || "—")}</text>
      <text x="${MARGIN.left}" y="944"><tspan font-weight="700">Generated:</tspan> ${escapeXml(date)}</text>
      <text x="${MARGIN.left}" y="966"><tspan font-weight="700">Confidence:</tspan> ${conf}</text>
      <text x="${MARGIN.left}" y="988"><tspan font-weight="700">Engine:</tspan> ${escapeXml(ctx.engineVersion)}</text>
      <text x="${MARGIN.left}" y="1010" fill="${COLORS.muted}">Source: Mapbox satellite imagery + measured roof geometry.</text>
    </g>
  `;
  return svgShell(ctx, "Roof Measurement Report", body, { showCompass: false });
}

function renderOverlayPage(ctx: Ctx): string {
  // Background satellite (best-effort). Geometry is overlaid using the same draw-zone transform.
  const sat = ctx.input.satelliteImageUrl
    ? `<image href="${escapeXml(ctx.input.satelliteImageUrl)}" x="${DRAW_ZONE.x}" y="${DRAW_ZONE.y}" width="${DRAW_ZONE.w}" height="${DRAW_ZONE.h}" preserveAspectRatio="xMidYMid slice" opacity="1" />`
    : `<rect x="${DRAW_ZONE.x}" y="${DRAW_ZONE.y}" width="${DRAW_ZONE.w}" height="${DRAW_ZONE.h}" fill="#f8f8f8" stroke="#ddd"/>`;

  const planeFills = ctx.overlayPlanes
    .map((p) => `<polygon points="${pts(p.polygon_px)}" fill="${COLORS.satelliteFill}" stroke="#ffffff" stroke-width="2"/>`)
    .join("");

  const edgeLines = ctx.overlayEdges
    .map((e) => {
      const st = EDGE_STYLE[e.edge_type] || EDGE_STYLE.unknown;
      const stroke = e.edge_type === "eave" ? "#ffffff" : st.stroke;
      return `<path d="${path(e.line_px)}" fill="none" stroke="${stroke}" stroke-width="${st.width + 1}" ${st.dash ? `stroke-dasharray="${st.dash}"` : ""}/>`;
    })
    .join("");

  const labels = ctx.overlayEdges
    .map((e) => textBadge(e._label.x, e._label.y, `${round(e.length_ft || 0, 0)}`, { onDark: true }))
    .join("");

  const body = `
    ${sat}
    ${planeFills}
    ${edgeLines}
    ${labels}
    <text x="${MARGIN.left}" y="190" font-size="13" fill="${COLORS.muted}">Calibrated satellite overlay with measured geometry.</text>
  `;
  return svgShell(ctx, "Image / Overlay", body, { showCompass: true });
}

function renderLengthPage(ctx: Ctx): string {
  const ridge = round(ctx.totals.ridge_length_ft || 0, 0);
  const valley = round(ctx.totals.valley_length_ft || 0, 0);

  const planeOutlines = ctx.planes
    .map((p) => `<polygon points="${pts(p.polygon_px)}" fill="${COLORS.planeFill}" stroke="${COLORS.outline}" stroke-width="1.5"/>`)
    .join("");

  const edgeLines = ctx.edges
    .map((e) => {
      const st = EDGE_STYLE[e.edge_type] || EDGE_STYLE.unknown;
      return `<path d="${path(e.line_px)}" fill="none" stroke="${st.stroke}" stroke-width="${st.width}" ${st.dash ? `stroke-dasharray="${st.dash}"` : ""}/>`;
    })
    .join("");

  const labels = ctx.edges
    .map((e) => {
      const leader = e._label.leader
        ? `<line x1="${e._label.leader.x1}" y1="${e._label.leader.y1}" x2="${e._label.leader.x2}" y2="${e._label.leader.y2}" stroke="${COLORS.muted}" stroke-width="0.8"/>`
        : "";
      return `${leader}${textBadge(e._label.x, e._label.y, `${round(e.length_ft || 0, 0)}`)}`;
    })
    .join("");

  const body = `
    <text x="${MARGIN.left}" y="135" font-size="20" font-weight="700">Length Diagram</text>
    <text x="${MARGIN.left}" y="158" font-size="12" fill="${COLORS.muted}">All measurements are rounded to the nearest foot.</text>
    <g font-size="13" fill="${COLORS.text}">
      <text x="${MARGIN.left}" y="182"><tspan font-weight="700" fill="${COLORS.ridge}">■</tspan> Ridge Length = ${ridge} ft</text>
      <text x="${MARGIN.left + 220}" y="182"><tspan font-weight="700" fill="${COLORS.valley}">■</tspan> Valley Length = ${valley} ft</text>
    </g>
    ${planeOutlines}
    ${edgeLines}
    ${labels}
    ${edgeLegend(MARGIN.left, 880)}
  `;
  return svgShell(ctx, "Length Diagram", body, { showCompass: true });
}

function renderPitchPage(ctx: Ctx): string {
  const planeOutlines = ctx.planes
    .map((p) => `<polygon points="${pts(p.polygon_px)}" fill="${COLORS.planeFill}" stroke="${COLORS.outline}" stroke-width="1.5"/>`)
    .join("");

  const labels = ctx.planes
    .map((p) => {
      const pitch = p.pitch != null ? `${round(p.pitch, 0)}/12` : "—";
      return `
        <text x="${p._label.x}" y="${p._label.y - 4}" font-size="20" font-weight="700" text-anchor="middle" fill="${COLORS.text}">${pitch}</text>
        <line x1="${p._label.x}" y1="${p._label.y + 6}" x2="${p._label.x}" y2="${p._label.y + 32}" stroke="${COLORS.text}" stroke-width="2" marker-end="url(#arrow)"/>
      `;
    })
    .join("");

  const body = `
    <text x="${MARGIN.left}" y="135" font-size="20" font-weight="700">Pitch Diagram</text>
    <text x="${MARGIN.left}" y="158" font-size="12" fill="${COLORS.muted}">Pitch units are inches per foot.</text>
    <text x="${MARGIN.left}" y="182" font-size="13">Predominant pitch: <tspan font-weight="700">${escapeXml(ctx.totals.dominant_pitch || "—")}</tspan></text>
    <defs>
      <marker id="arrow" markerWidth="10" markerHeight="10" refX="4" refY="3" orient="auto">
        <path d="M0,0 L0,6 L6,3 z" fill="${COLORS.text}"/>
      </marker>
    </defs>
    ${planeOutlines}
    ${labels}
  `;
  return svgShell(ctx, "Pitch Diagram", body, { showCompass: true });
}

function renderAreaPage(ctx: Ctx): string {
  const total = round(ctx.totals.total_area_pitch_adjusted_sqft || 0, 0);
  const squares = round(ctx.totals.roof_square_count || 0, 1);

  const planeOutlines = ctx.planes
    .map((p) => `<polygon points="${pts(p.polygon_px)}" fill="${COLORS.planeFill}" stroke="${COLORS.outline}" stroke-width="1.5"/>`)
    .join("");

  const labels = ctx.planes
    .map((p) => {
      const area = round(p.area_pitch_adjusted_sqft || p.area_2d_sqft || 0, 0);
      return `<text x="${p._label.x}" y="${p._label.y + 6}" font-size="18" font-weight="700" text-anchor="middle" fill="${COLORS.text}">${area}</text>`;
    })
    .join("");

  const body = `
    <text x="${MARGIN.left}" y="135" font-size="20" font-weight="700">Area Diagram</text>
    <text x="${MARGIN.left}" y="158" font-size="13">Total Roof Area = <tspan font-weight="700">${total} sqft</tspan> (${squares} squares)</text>
    <text x="${MARGIN.left}" y="180" font-size="12" fill="${COLORS.muted}">Section labels are pitch-adjusted square feet.</text>
    ${planeOutlines}
    ${labels}
  `;
  return svgShell(ctx, "Area Diagram", body, { showCompass: true });
}

function renderNotesPage(ctx: Ctx): string {
  const planeOutlines = ctx.planes
    .map((p) => `<polygon points="${pts(p.polygon_px)}" fill="none" stroke="${COLORS.outline}" stroke-width="1.5"/>`)
    .join("");

  const edgeLines = ctx.edges
    .map((e) => {
      const st = EDGE_STYLE[e.edge_type] || EDGE_STYLE.unknown;
      return `<path d="${path(e.line_px)}" fill="none" stroke="${st.stroke}" stroke-width="${Math.max(1, st.width - 1)}" ${st.dash ? `stroke-dasharray="${st.dash}"` : ""} opacity="0.85"/>`;
    })
    .join("");

  const body = `
    <text x="${MARGIN.left}" y="135" font-size="20" font-weight="700">Notes Diagram</text>
    <text x="${MARGIN.left}" y="158" font-size="12" fill="${COLORS.muted}">Reference outline of measured roof structure.</text>
    ${planeOutlines}
    ${edgeLines}
    ${edgeLegend(MARGIN.left, 880)}
  `;
  return svgShell(ctx, "Notes Diagram", body, { showCompass: true });
}

// ============================================================================
// SVG building blocks
// ============================================================================

function svgShell(ctx: Ctx, pageTitle: string, body: string, opts: { showCompass: boolean }): string {
  const watermark = ctx.input.debugWatermarkText
    ? `<g opacity="0.18" transform="rotate(-24 ${PAGE_W / 2} ${PAGE_H / 2})"><text x="${PAGE_W / 2}" y="${PAGE_H / 2 - 10}" font-size="42" font-weight="800" text-anchor="middle" fill="#b91c1c">${escapeXml(ctx.input.debugWatermarkText)}</text></g>
       <rect x="${MARGIN.left}" y="92" width="${PAGE_W - MARGIN.left - MARGIN.right}" height="34" fill="#fee2e2" stroke="#b91c1c" stroke-width="1.5"/>
       <text x="${PAGE_W / 2}" y="114" font-size="15" font-weight="800" text-anchor="middle" fill="#991b1b">${escapeXml(ctx.input.debugWatermarkText)}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}" viewBox="0 0 ${PAGE_W} ${PAGE_H}">
  <rect x="0" y="0" width="${PAGE_W}" height="${PAGE_H}" fill="#ffffff"/>
  <text x="${PAGE_W / 2}" y="80" font-size="14" text-anchor="middle" font-weight="600" fill="${COLORS.text}">${escapeXml(ctx.address)}</text>
  ${watermark}
  ${body}
  ${opts.showCompass ? compassRose(COMPASS.cx, COMPASS.cy) : ""}
  <line x1="${MARGIN.left}" y1="${PAGE_H - 50}" x2="${PAGE_W - MARGIN.right}" y2="${PAGE_H - 50}" stroke="${COLORS.muted}" stroke-width="0.5"/>
  <text x="${MARGIN.left}" y="${PAGE_H - 30}" font-size="10" fill="${COLORS.muted}">Generated by PITCH AI Measurement · ${escapeXml(ctx.engineVersion)}</text>
  <text x="${PAGE_W - MARGIN.right}" y="${PAGE_H - 30}" font-size="10" fill="${COLORS.muted}" text-anchor="end">${escapeXml(pageTitle)}</text>
</svg>`;
}

function compassRose(cx: number, cy: number): string {
  return `
    <g>
      <circle cx="${cx}" cy="${cy}" r="42" fill="#ffffff" stroke="${COLORS.text}" stroke-width="1"/>
      <line x1="${cx}" y1="${cy - 38}" x2="${cx}" y2="${cy + 38}" stroke="${COLORS.text}" stroke-width="1.5"/>
      <line x1="${cx - 38}" y1="${cy}" x2="${cx + 38}" y2="${cy}" stroke="${COLORS.text}" stroke-width="1.5"/>
      <polygon points="${cx},${cy - 42} ${cx - 6},${cy - 28} ${cx + 6},${cy - 28}" fill="${COLORS.ridge}"/>
      <text x="${cx}" y="${cy - 50}" text-anchor="middle" font-size="14" font-weight="700">N</text>
      <text x="${cx}" y="${cy + 62}" text-anchor="middle" font-size="11">S</text>
      <text x="${cx - 54}" y="${cy + 4}" text-anchor="middle" font-size="11">W</text>
      <text x="${cx + 54}" y="${cy + 4}" text-anchor="middle" font-size="11">E</text>
    </g>
  `;
}

function edgeLegend(x: number, y: number): string {
  const items: { type: RendererEdge["edge_type"]; label: string }[] = [
    { type: "ridge", label: "Ridge" },
    { type: "valley", label: "Valley" },
    { type: "hip", label: "Hip" },
    { type: "eave", label: "Eave" },
    { type: "rake", label: "Rake" },
  ];
  return items
    .map((it, i) => {
      const st = EDGE_STYLE[it.type];
      const cx = x + i * 100;
      return `
        <line x1="${cx}" y1="${y}" x2="${cx + 24}" y2="${y}" stroke="${st.stroke}" stroke-width="${st.width}" ${st.dash ? `stroke-dasharray="${st.dash}"` : ""}/>
        <text x="${cx + 30}" y="${y + 4}" font-size="11" fill="${COLORS.text}">${it.label}</text>
      `;
    })
    .join("");
}

function textBadge(x: number, y: number, text: string, opts: { onDark?: boolean } = {}): string {
  const w = Math.max(20, text.length * 8 + 8);
  const h = 16;
  const fill = opts.onDark ? "rgba(0,0,0,0.65)" : "#ffffff";
  const textFill = opts.onDark ? "#ffffff" : COLORS.text;
  const stroke = opts.onDark ? "none" : COLORS.outline;
  return `
    <rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="3" ry="3" fill="${fill}" stroke="${stroke}" stroke-width="0.6"/>
    <text x="${x}" y="${y + 4}" font-size="11" font-weight="700" text-anchor="middle" fill="${textFill}">${escapeXml(text)}</text>
  `;
}

// ============================================================================
// Geometry helpers
// ============================================================================

function pts(points: Point[]): string {
  return points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}

function path(points: Point[]): string {
  if (!points?.length) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}

function bboxFromPoints(points: Point[]): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } | null {
  const valid = points.filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y));
  if (!valid.length) return null;
  const minX = Math.min(...valid.map((p) => p.x));
  const maxX = Math.max(...valid.map((p) => p.x));
  const minY = Math.min(...valid.map((p) => p.y));
  const maxY = Math.max(...valid.map((p) => p.y));
  return { minX, minY, maxX, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function polylineLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/** Midpoint by arc length (not endpoint average). Returns the point + parametric t. */
function polylineMidpointByArc(points: Point[]): Point & { t: number } {
  if (points.length < 2) return { ...(points[0] || { x: 0, y: 0 }), t: 0 };
  const total = polylineLength(points);
  const target = total / 2;
  let traveled = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (traveled + seg >= target) {
      const t = (target - traveled) / Math.max(seg, 1e-6);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, t: i / points.length };
    }
    traveled += seg;
  }
  return { ...points[points.length - 1], t: 1 };
}

function polylineTangentAt(points: Point[], _t: number): { dx: number; dy: number } {
  // For a 2-point segment, the tangent is just b-a. For polylines, use the segment
  // containing the midpoint (we already walked it in polylineMidpointByArc).
  const total = polylineLength(points);
  const target = total / 2;
  let traveled = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (traveled + seg >= target) return { dx: b.x - a.x, dy: b.y - a.y };
    traveled += seg;
  }
  const a = points[0];
  const b = points[points.length - 1];
  return { dx: b.x - a.x, dy: b.y - a.y };
}

function polygonCentroid(points: Point[]): Point {
  if (!points?.length) return { x: 0, y: 0 };
  // Area-weighted centroid (proper).
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const f = a.x * b.y - b.x * a.y;
    area += f;
    cx += (a.x + b.x) * f;
    cy += (a.y + b.y) * f;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-6) {
    // Degenerate — fall back to vertex average.
    return points.reduce((acc, p) => ({ x: acc.x + p.x / points.length, y: acc.y + p.y / points.length }), { x: 0, y: 0 });
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > p.y) !== (yj > p.y)) &&
      (p.x < ((xj - xi) * (p.y - yi)) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Visual centroid that is guaranteed to lie inside concave polygons. */
function polygonInteriorPoint(poly: Point[]): Point {
  const c = polygonCentroid(poly);
  if (pointInPolygon(c, poly)) return c;

  // Fallback: scan the bounding box rows and pick the middle of the longest interior run.
  const minX = Math.min(...poly.map((p) => p.x));
  const maxX = Math.max(...poly.map((p) => p.x));
  const minY = Math.min(...poly.map((p) => p.y));
  const maxY = Math.max(...poly.map((p) => p.y));
  const stepY = Math.max(2, (maxY - minY) / 40);
  const stepX = Math.max(2, (maxX - minX) / 80);

  let best: { x: number; y: number; len: number } = { x: c.x, y: c.y, len: 0 };
  for (let y = minY + stepY; y < maxY; y += stepY) {
    let runStart: number | null = null;
    for (let x = minX; x <= maxX; x += stepX) {
      const inside = pointInPolygon({ x, y }, poly);
      if (inside && runStart === null) runStart = x;
      if ((!inside || x + stepX > maxX) && runStart !== null) {
        const runEnd = inside ? x : x - stepX;
        const len = runEnd - runStart;
        if (len > best.len) best = { x: (runStart + runEnd) / 2, y, len };
        runStart = null;
      }
    }
  }
  return { x: best.x, y: best.y };
}

// ============================================================================
// Misc
// ============================================================================

function round(value: number, decimals = 0): number {
  const m = 10 ** decimals;
  return Math.round(Number(value || 0) * m) / m;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

function escapeXml(value: string): string {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
