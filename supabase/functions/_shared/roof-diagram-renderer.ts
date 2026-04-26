// Roof Diagram Renderer
// Generates EagleView-style SVG diagram pages from PITCH measured geometry.
// Inputs are stored in ai_roof_planes / ai_roof_edges / ai_measurement_results.

type Point = { x: number; y: number };

type Plane = {
  id?: string;
  plane_index: number;
  polygon_px: Point[];
  pitch?: number | null;
  pitch_degrees?: number | null;
  area_2d_sqft?: number | null;
  area_pitch_adjusted_sqft?: number | null;
  confidence?: number | null;
};

type Edge = {
  id?: string;
  edge_type: "ridge" | "hip" | "valley" | "eave" | "rake" | "unknown";
  line_px: Point[];
  length_ft?: number | null;
  confidence?: number | null;
};

export type DiagramInput = {
  propertyAddress: string;
  planes: Plane[];
  edges: Edge[];
  totals: any;
  width?: number;
  height?: number;
};

export type GeneratedDiagram = {
  diagram_type: "outline" | "length" | "pitch" | "area" | "notes";
  title: string;
  page_number: number;
  svg_markup: string;
};

const EDGE_STYLES: Record<string, { stroke: string; dash?: string; width: number }> = {
  ridge: { stroke: "#d71920", width: 3 },
  hip: { stroke: "#f58220", width: 3 },
  valley: { stroke: "#1f77b4", width: 3 },
  eave: { stroke: "#111111", width: 2 },
  rake: { stroke: "#555555", width: 2, dash: "6 4" },
  unknown: { stroke: "#777777", width: 2, dash: "3 3" },
};

export function generateRoofDiagrams(input: DiagramInput): GeneratedDiagram[] {
  const width = input.width || 1000;
  const height = input.height || 1000;

  // Hard rule: never generate diagrams from empty / placeholder geometry.
  if (!input.planes?.length) return [];

  const normalized = normalizeGeometryToViewport(input.planes, input.edges || [], width, height);

  return [
    {
      diagram_type: "outline",
      title: "Roof Outline Diagram",
      page_number: 1,
      svg_markup: renderOutlineDiagram(input, normalized, width, height),
    },
    {
      diagram_type: "length",
      title: "Length Diagram",
      page_number: 2,
      svg_markup: renderLengthDiagram(input, normalized, width, height),
    },
    {
      diagram_type: "pitch",
      title: "Pitch Diagram",
      page_number: 3,
      svg_markup: renderPitchDiagram(input, normalized, width, height),
    },
    {
      diagram_type: "area",
      title: "Area Diagram",
      page_number: 4,
      svg_markup: renderAreaDiagram(input, normalized, width, height),
    },
    {
      diagram_type: "notes",
      title: "Notes Diagram",
      page_number: 5,
      svg_markup: renderNotesDiagram(input, normalized, width, height),
    },
  ];
}

function renderOutlineDiagram(input: DiagramInput, g: any, width: number, height: number) {
  return svgShell(
    input.propertyAddress,
    "Roof Outline Diagram",
    width,
    height,
    `
    ${renderPlaneFills(g.planes)}
    ${renderPlaneOutlines(g.planes)}
    ${renderCompass(width, height)}
  `,
  );
}

function renderLengthDiagram(input: DiagramInput, g: any, width: number, height: number) {
  return svgShell(
    input.propertyAddress,
    "Length Diagram",
    width,
    height,
    `
    <text x="60" y="105" font-size="20" font-weight="700">Length Diagram:</text>
    <text x="60" y="132" font-size="16">All measurements are rounded to the nearest foot.</text>
    <text x="60" y="158" font-size="16">Ridge Length = ${round(input.totals?.ridge_length_ft || 0, 0)} ft</text>
    <text x="60" y="184" font-size="16">Valley Length = ${round(input.totals?.valley_length_ft || 0, 0)} ft</text>

    ${renderPlaneOutlines(g.planes)}
    ${(g.edges as Edge[]).map((e) => renderEdgeWithLength(e)).join("\n")}
    ${renderCompass(width, height)}
  `,
  );
}

function renderPitchDiagram(input: DiagramInput, g: any, width: number, height: number) {
  return svgShell(
    input.propertyAddress,
    "Pitch Diagram",
    width,
    height,
    `
    <text x="60" y="105" font-size="20" font-weight="700">Pitch Diagram:</text>
    <text x="60" y="132" font-size="16">Pitch units are inches per foot.</text>

    ${renderPlaneOutlines(g.planes)}
    ${(g.planes as Plane[])
      .map((p) => {
        const c = polygonCentroid(p.polygon_px);
        const pitch = p.pitch != null ? `${round(p.pitch, 1)}/12` : "Review";
        return `
        <text x="${c.x}" y="${c.y}" font-size="24" text-anchor="middle" font-weight="700">${pitch}</text>
        <line x1="${c.x}" y1="${c.y + 8}" x2="${c.x}" y2="${c.y + 42}" stroke="#111" stroke-width="2" marker-end="url(#arrow)" />
      `;
      })
      .join("\n")}
    ${renderCompass(width, height)}
  `,
    true,
  );
}

function renderAreaDiagram(input: DiagramInput, g: any, width: number, height: number) {
  return svgShell(
    input.propertyAddress,
    "Area Diagram",
    width,
    height,
    `
    <text x="60" y="105" font-size="20" font-weight="700">Area Diagram:</text>
    <text x="60" y="132" font-size="18">Total Area = ${round(input.totals?.total_area_pitch_adjusted_sqft || 0, 0)} sqft</text>

    ${renderPlaneOutlines(g.planes)}
    ${(g.planes as Plane[])
      .map((p) => {
        const c = polygonCentroid(p.polygon_px);
        const area = round(p.area_pitch_adjusted_sqft || p.area_2d_sqft || 0, 0);
        return `<text x="${c.x}" y="${c.y}" font-size="24" text-anchor="middle" font-weight="700">${area}</text>`;
      })
      .join("\n")}
    ${renderCompass(width, height)}
  `,
  );
}

function renderNotesDiagram(input: DiagramInput, g: any, width: number, height: number) {
  return svgShell(
    input.propertyAddress,
    "Notes Diagram",
    width,
    height,
    `
    <text x="60" y="105" font-size="20" font-weight="700">Notes:</text>
    ${renderPlaneOutlines(g.planes)}
    ${renderCompass(width, height)}
  `,
  );
}

function renderPlaneFills(planes: Plane[]) {
  return planes
    .map((p) => {
      const points = p.polygon_px.map((pt) => `${pt.x},${pt.y}`).join(" ");
      return `<polygon points="${points}" fill="#f7f7f7" stroke="none" />`;
    })
    .join("\n");
}

function renderPlaneOutlines(planes: Plane[]) {
  return planes
    .map((p) => {
      const points = p.polygon_px.map((pt) => `${pt.x},${pt.y}`).join(" ");
      return `<polygon points="${points}" fill="none" stroke="#111" stroke-width="2" />`;
    })
    .join("\n");
}

function renderEdgeWithLength(edge: Edge) {
  const style = EDGE_STYLES[edge.edge_type] || EDGE_STYLES.unknown;
  const d = polylinePath(edge.line_px);
  const mid = polylineMidpoint(edge.line_px);
  const len = round(edge.length_ft || 0, 0);

  return `
    <path d="${d}" fill="none" stroke="${style.stroke}" stroke-width="${style.width}" ${
    style.dash ? `stroke-dasharray="${style.dash}"` : ""
  } />
    <text x="${mid.x}" y="${mid.y - 8}" font-size="20" text-anchor="middle" font-weight="700" fill="#111">${len}</text>
  `;
}

function svgShell(address: string, title: string, width: number, height: number, body: string, arrows = false) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="white"/>
  ${
    arrows
      ? `<defs>
    <marker id="arrow" markerWidth="10" markerHeight="10" refX="4" refY="3" orient="auto">
      <path d="M0,0 L0,6 L6,3 z" fill="#111" />
    </marker>
  </defs>`
      : ""
  }
  <text x="${width / 2}" y="50" font-size="22" text-anchor="middle" font-weight="700">${escapeXml(address)}</text>
  ${body}
  <text x="${width / 2}" y="${height - 30}" font-size="14" text-anchor="middle" fill="#555">Generated by PITCH AI Measurement — ${escapeXml(title)}</text>
</svg>`;
}

function normalizeGeometryToViewport(planes: Plane[], edges: Edge[], width: number, height: number) {
  const allPoints = [
    ...planes.flatMap((p) => p.polygon_px || []),
    ...edges.flatMap((e) => e.line_px || []),
  ];

  if (allPoints.length === 0) {
    return { planes, edges };
  }

  const minX = Math.min(...allPoints.map((p) => p.x));
  const maxX = Math.max(...allPoints.map((p) => p.x));
  const minY = Math.min(...allPoints.map((p) => p.y));
  const maxY = Math.max(...allPoints.map((p) => p.y));

  const sourceW = Math.max(maxX - minX, 1);
  const sourceH = Math.max(maxY - minY, 1);

  const pad = 140;
  const scale = Math.min((width - pad * 2) / sourceW, (height - pad * 2) / sourceH);

  const transform = (p: Point) => ({
    x: (p.x - minX) * scale + pad,
    y: (p.y - minY) * scale + pad + 60,
  });

  return {
    planes: planes.map((p) => ({ ...p, polygon_px: (p.polygon_px || []).map(transform) })),
    edges: edges.map((e) => ({ ...e, line_px: (e.line_px || []).map(transform) })),
  };
}

function polylinePath(points: Point[]) {
  if (!points?.length) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

function polylineMidpoint(points: Point[]): Point {
  if (!points?.length) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];

  const total = polylineLength(points);
  let traveled = 0;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);

    if (traveled + seg >= total / 2) {
      const t = (total / 2 - traveled) / seg;
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      };
    }

    traveled += seg;
  }

  return points[Math.floor(points.length / 2)];
}

function polylineLength(points: Point[]) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

function polygonCentroid(points: Point[]): Point {
  if (!points?.length) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

function renderCompass(width: number, height: number) {
  const cx = width - 150;
  const cy = height - 150;

  return `
    <line x1="${cx}" y1="${cy - 45}" x2="${cx}" y2="${cy + 45}" stroke="#111" stroke-width="2"/>
    <line x1="${cx - 45}" y1="${cy}" x2="${cx + 45}" y2="${cy}" stroke="#111" stroke-width="2"/>
    <text x="${cx}" y="${cy - 58}" text-anchor="middle" font-size="18" font-weight="700">N</text>
    <text x="${cx}" y="${cy + 75}" text-anchor="middle" font-size="18" font-weight="700">S</text>
    <text x="${cx - 62}" y="${cy + 6}" text-anchor="middle" font-size="18" font-weight="700">W</text>
    <text x="${cx + 62}" y="${cy + 6}" text-anchor="middle" font-size="18" font-weight="700">E</text>
  `;
}

function escapeXml(value: string) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function round(value: number, decimals = 2) {
  const m = 10 ** decimals;
  return Math.round(Number(value || 0) * m) / m;
}
