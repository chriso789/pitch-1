// Vendor-agnostic measurement parser for roofing PDF text.
// Extracts the canonical fields required to build a RoofMeasurementData record.

export interface ParsedLinear {
  eaves: number;
  valleys: number;
  hips: number;
  ridges: number;
  rakes: number;
  wallFlashing: number;
  stepFlashing: number;
}

export interface ParsedMeasurements {
  totalArea: number;
  facetCount: number;
  pitch: string;          // "6/12"
  pitchValue: number;     // 6
  perimeter: number;
  linear: ParsedLinear;
  wasteTable: Record<string, { area: number; squares: number }>;
  materials: Record<string, number>;
  source: "eagleview" | "roofr" | "unknown";
  reportDate?: string;
  address?: string;
}

const FT_IN = /(\d+(?:\.\d+)?)\s*ft(?:\s*(\d+(?:\.\d+)?)\s*in)?/i;

function ftInches(value: string | null | undefined): number {
  if (!value) return 0;
  const m = value.match(FT_IN);
  if (m) {
    const ft = parseFloat(m[1]);
    const inches = m[2] ? parseFloat(m[2]) : 0;
    return ft + inches / 12;
  }
  const num = parseFloat(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(num) ? num : 0;
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return null;
}

function detectSource(text: string): ParsedMeasurements["source"] {
  if (/eagleview/i.test(text)) return "eagleview";
  if (/roofr/i.test(text)) return "roofr";
  return "unknown";
}

function parseLinear(text: string, label: string): number {
  const re = new RegExp(
    `(?:Total\\s+)?${label}[:\\s]*((?:\\d+(?:\\.\\d+)?)\\s*ft(?:\\s*\\d+(?:\\.\\d+)?\\s*in)?|\\d+(?:\\.\\d+)?)`,
    "i",
  );
  const m = text.match(re);
  return m ? ftInches(m[1]) : 0;
}

function parsePitch(text: string): { label: string; value: number } {
  const m = text.match(/(?:Predominant\s+)?[Pp]itch[:\s]*(\d+(?:\.\d+)?)\s*\/\s*12/);
  if (m) {
    const value = parseFloat(m[1]);
    return { label: `${m[1]}/12`, value };
  }
  return { label: "6/12", value: 6 };
}

function parseWasteTable(text: string, totalArea: number): Record<string, { area: number; squares: number }> {
  const out: Record<string, { area: number; squares: number }> = {};
  const rows = text.matchAll(/(\d{1,2})\s*%\s*[|\s]+([\d,]+)\s*sq\s*ft/gi);
  for (const row of rows) {
    const pct = row[1];
    const area = parseInt(row[2].replace(/,/g, ""), 10);
    if (Number.isFinite(area) && area > 0) {
      out[pct] = { area, squares: Math.round((area / 100) * 10) / 10 };
    }
  }
  if (Object.keys(out).length === 0 && totalArea > 0) {
    const sq = totalArea / 100;
    out["0"] = { area: totalArea, squares: Math.round(sq * 10) / 10 };
    out["10"] = {
      area: Math.round(totalArea * 1.1),
      squares: Math.round(sq * 1.1 * 10) / 10,
    };
    out["15"] = {
      area: Math.round(totalArea * 1.15),
      squares: Math.round(sq * 1.15 * 10) / 10,
    };
  }
  return out;
}

function deriveMaterials(totalArea: number, linear: ParsedLinear): Record<string, number> {
  const squares = totalArea / 100;
  return {
    shingleBundles: Math.ceil(squares * 1.1 * 3),
    starterBundles: Math.ceil((linear.eaves + linear.rakes) / 100),
    iceWaterRolls: Math.ceil((linear.eaves + linear.valleys) / 60),
    syntheticRolls: Math.ceil(totalArea / 1000),
    cappingBundles: Math.ceil((linear.hips + linear.ridges) / 25),
    valleySheets: Math.ceil(linear.valleys / 8),
    dripEdgeSheets: Math.ceil((linear.eaves + linear.rakes) / 10),
  };
}

export function parseReportText(text: string): ParsedMeasurements {
  const totalAreaMatch = firstMatch(text, [
    /Total\s+roof\s+area[:\s]*([\d,]+)\s*sq\s*ft/i,
    /Total\s+area[:\s]*([\d,]+)\s*sq\s*ft/i,
    /Roof\s+area[:\s]*([\d,]+)/i,
  ]);
  const totalArea = totalAreaMatch ? parseInt(totalAreaMatch.replace(/,/g, ""), 10) : 0;

  const facetMatch = firstMatch(text, [/(\d+)\s*facets?/i, /Number\s+of\s+facets[:\s]*(\d+)/i]);
  const facetCount = facetMatch ? parseInt(facetMatch, 10) : 0;

  const pitch = parsePitch(text);

  const linear: ParsedLinear = {
    eaves: parseLinear(text, "[Ee]aves?"),
    valleys: parseLinear(text, "[Vv]alleys?"),
    hips: parseLinear(text, "[Hh]ips?"),
    ridges: parseLinear(text, "[Rr]idges?"),
    rakes: parseLinear(text, "[Rr]akes?"),
    wallFlashing: parseLinear(text, "[Ww]all\\s*flashing"),
    stepFlashing: parseLinear(text, "[Ss]tep\\s*flashing"),
  };

  const perimeter = linear.eaves + linear.rakes;

  const reportDate = firstMatch(text, [
    /Report\s+(?:date|generated)[:\s]*([0-9/.-]{6,12})/i,
    /Date[:\s]*([0-9/.-]{6,12})/i,
  ]) ?? undefined;

  const address = firstMatch(text, [
    /Property\s+Address[:\s]*([^\n]{5,140})/i,
    /Address[:\s]*([^\n]{5,140})/i,
  ])?.trim();

  return {
    totalArea,
    facetCount,
    pitch: pitch.label,
    pitchValue: pitch.value,
    perimeter,
    linear,
    wasteTable: parseWasteTable(text, totalArea),
    materials: deriveMaterials(totalArea, linear),
    source: detectSource(text),
    reportDate,
    address,
  };
}

// ---------- canonical JSON conversion ----------

export interface CanonicalRoofJSON {
  meta: {
    version: "v1";
    source: "vendor-pdf";
    vendor: ParsedMeasurements["source"];
    generated_at: string;
    report_date?: string;
  };
  location: { address: string | null; lat: number | null; lng: number | null };
  roof: { type: string; confidence: number };
  measurements: {
    area_sqft: number | null;
    predominant_pitch: number | null;
    facets: number | null;
    lengths_ft: {
      ridge: number;
      hip: number;
      valley: number;
      eave: number;
      rake: number;
      perimeter: number;
    };
  };
  waste_table: Record<string, { area: number; squares: number }>;
  materials: Record<string, number>;
  geometry: {
    footprint_polygon: [number, number][];
    features: Array<{ type: string; p1: [number, number]; p2: [number, number] }>;
  };
  diagram_geometry: unknown | null;
}

export function toCanonicalJSON(
  m: ParsedMeasurements,
  diagramGeometry: unknown | null,
  location?: { address?: string | null; lat?: number | null; lng?: number | null },
): CanonicalRoofJSON {
  const dg = (diagramGeometry as any) || null;

  const footprint =
    (dg?.footprint_polygon as [number, number][]) ||
    (dg?.facets?.[0]?.polygon?.map((p: any) => [p.x, p.y])) ||
    [];

  const features: Array<{ type: string; p1: [number, number]; p2: [number, number] }> = [];
  if (dg?.edges) {
    for (const t of ["ridges", "hips", "valleys", "eaves", "rakes"] as const) {
      const arr = dg.edges[t] || [];
      for (const e of arr) {
        if (e?.start && e?.end) {
          features.push({
            type: t.slice(0, -1),
            p1: [e.start.x ?? e.start.lat, e.start.y ?? e.start.lng],
            p2: [e.end.x ?? e.end.lat, e.end.y ?? e.end.lng],
          });
        }
      }
    }
  }

  let roofType = "unknown";
  if (m.linear.hips > m.linear.rakes && m.linear.hips > 10) roofType = "hip";
  else if (m.linear.rakes > 10 && m.linear.hips < 5) roofType = "gable";
  else if (m.linear.valleys > 30) roofType = "complex_valley";

  return {
    meta: {
      version: "v1",
      source: "vendor-pdf",
      vendor: m.source,
      generated_at: new Date().toISOString(),
      report_date: m.reportDate,
    },
    location: {
      address: location?.address ?? m.address ?? null,
      lat: location?.lat ?? null,
      lng: location?.lng ?? null,
    },
    roof: { type: roofType, confidence: 0.7 },
    measurements: {
      area_sqft: m.totalArea || null,
      predominant_pitch: m.pitchValue || null,
      facets: m.facetCount || null,
      lengths_ft: {
        ridge: m.linear.ridges,
        hip: m.linear.hips,
        valley: m.linear.valleys,
        eave: m.linear.eaves,
        rake: m.linear.rakes,
        perimeter: m.perimeter,
      },
    },
    waste_table: m.wasteTable,
    materials: m.materials,
    geometry: { footprint_polygon: footprint, features },
    diagram_geometry: diagramGeometry ?? null,
  };
}
