// Vendor-agnostic measurement parser for roofing PDF text.
// Extracts the canonical fields required to build a RoofMeasurementData record
// and converts them into the app's standardized RoofMeasurementData JSON shape.

export interface ParsedLinear {
  eaves: number;
  valleys: number;
  hips: number;
  ridges: number;
  rakes: number;
  wallFlashing: number;
  stepFlashing: number;
}

export interface PitchBreakdownRow {
  pitch: string;          // "6/12"
  pitchValue: number;     // 6
  area: number;           // sq ft on this pitch
  percentOfRoof: number;  // 0..100
}

export interface WasteRow {
  area: number;
  squares: number;
}

export interface ParsedMeasurements {
  totalArea: number;
  facetCount: number;
  pitch: string;          // predominant pitch label, e.g. "6/12"
  pitchValue: number;     // predominant pitch value, e.g. 6
  perimeter: number;
  linear: ParsedLinear;
  wasteTable: Record<string, WasteRow>;
  suggestedWastePct: number | null;
  materials: Record<string, number>;
  pitchBreakdown: PitchBreakdownRow[];
  source: "eagleview" | "roofr" | "hover" | "gaf-quickmeasure" | "unknown";
  reportDate?: string;
  reportId?: string;
  address?: string;
  lat?: number;
  lng?: number;
  warnings: string[];
}

const FT_IN = /(\d+(?:\.\d+)?)\s*(?:ft|')\s*(?:(\d+(?:\.\d+)?)\s*(?:in|"))?/i;

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
    if (m && m[1] != null) return m[1];
  }
  return null;
}

function detectSource(text: string): ParsedMeasurements["source"] {
  if (/eagleview/i.test(text)) return "eagleview";
  if (/quickmeasure|gaf\s*quick/i.test(text)) return "gaf-quickmeasure";
  if (/\bhover\b/i.test(text)) return "hover";
  if (/\broofr\b/i.test(text)) return "roofr";
  return "unknown";
}

function parseLinear(text: string, label: string): number {
  // Matches "Eaves: 123 ft", "Total Eaves 123 ft 4 in", "Eaves Length = 123'", etc.
  const re = new RegExp(
    `(?:Total\\s+)?${label}(?:\\s*Length)?[:\\s=]*((?:\\d+(?:\\.\\d+)?)\\s*(?:ft|')(?:\\s*\\d+(?:\\.\\d+)?\\s*(?:in|"))?|\\d+(?:\\.\\d+)?)`,
    "i",
  );
  const m = text.match(re);
  return m ? ftInches(m[1]) : 0;
}

function parsePitch(text: string): { label: string; value: number } {
  const m = text.match(/(?:Predominant\s+)?[Pp]itch[:\s]*(\d+(?:\.\d+)?)\s*\/\s*12/);
  if (m) {
    return { label: `${m[1]}/12`, value: parseFloat(m[1]) };
  }
  // fallback: scan all "n/12" pitches and pick highest area row from breakdown
  const all = [...text.matchAll(/(\d+(?:\.\d+)?)\s*\/\s*12/g)];
  if (all.length > 0) {
    const v = parseFloat(all[0][1]);
    return { label: `${all[0][1]}/12`, value: v };
  }
  return { label: "6/12", value: 6 };
}

function parsePitchBreakdown(text: string): PitchBreakdownRow[] {
  // Look for rows like:  "6/12   1,234 sq ft   45%"
  const out: PitchBreakdownRow[] = [];
  const re = /(\d+(?:\.\d+)?)\s*\/\s*12\s*[\s|:-]+([\d,]+)\s*sq\s*ft\s*[\s|:-]*([\d.]+)\s*%/gi;
  for (const m of text.matchAll(re)) {
    const value = parseFloat(m[1]);
    const area = parseInt(m[2].replace(/,/g, ""), 10);
    const pct = parseFloat(m[3]);
    if (Number.isFinite(area) && area > 0) {
      out.push({ pitch: `${m[1]}/12`, pitchValue: value, area, percentOfRoof: pct });
    }
  }
  return out;
}

function parseWasteTable(text: string, totalArea: number): {
  table: Record<string, WasteRow>;
  suggested: number | null;
} {
  const out: Record<string, WasteRow> = {};
  const rows = text.matchAll(/(\d{1,2})\s*%\s*[|\s]+([\d,]+)\s*sq\s*ft/gi);
  for (const row of rows) {
    const pct = row[1];
    const area = parseInt(row[2].replace(/,/g, ""), 10);
    if (Number.isFinite(area) && area > 0) {
      out[pct] = { area, squares: Math.round((area / 100) * 10) / 10 };
    }
  }
  const suggestedM = text.match(/Suggested\s+Waste[:\s]*(\d{1,2})\s*%/i);
  const suggested = suggestedM ? parseInt(suggestedM[1], 10) : null;

  if (Object.keys(out).length === 0 && totalArea > 0) {
    const sq = totalArea / 100;
    for (const pct of [0, 10, 12, 15, 17, 20, 22]) {
      const factor = 1 + pct / 100;
      out[String(pct)] = {
        area: Math.round(totalArea * factor),
        squares: Math.round(sq * factor * 10) / 10,
      };
    }
  }
  return { table: out, suggested };
}

function deriveMaterials(totalArea: number, linear: ParsedLinear, wastePct: number): Record<string, number> {
  const factor = 1 + wastePct / 100;
  const squares = (totalArea * factor) / 100;
  return {
    shingleBundles: Math.ceil(squares * 3),
    starterBundles: Math.ceil((linear.eaves + linear.rakes) / 100),
    iceWaterRolls: Math.ceil((linear.eaves + linear.valleys) / 60),
    syntheticRolls: Math.ceil((totalArea * factor) / 1000),
    cappingBundles: Math.ceil((linear.hips + linear.ridges) / 25),
    valleySheets: Math.ceil(linear.valleys / 8),
    dripEdgeSheets: Math.ceil((linear.eaves + linear.rakes) / 10),
  };
}

function parseLatLng(text: string): { lat?: number; lng?: number } {
  const m = text.match(/(-?\d{1,2}\.\d{3,8})\s*,\s*(-?\d{1,3}\.\d{3,8})/);
  if (m) {
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { lat, lng };
    }
  }
  return {};
}

export function parseReportText(text: string): ParsedMeasurements {
  const warnings: string[] = [];

  const totalAreaMatch = firstMatch(text, [
    /Total\s+roof\s+area[:\s]*([\d,]+)\s*sq\s*ft/i,
    /Total\s+area[:\s]*([\d,]+)\s*sq\s*ft/i,
    /Roof\s+area[:\s]*([\d,]+)/i,
    /Total\s+squares[:\s]*([\d,.]+)/i,
  ]);
  let totalArea = 0;
  if (totalAreaMatch) {
    const n = parseFloat(totalAreaMatch.replace(/,/g, ""));
    // if "squares" matched, convert
    totalArea = /squares/i.test(text.match(/Total\s+squares/i)?.[0] || "")
      ? Math.round(n * 100)
      : Math.round(n);
  } else {
    warnings.push("total_area_not_found");
  }

  const facetMatch = firstMatch(text, [
    /Number\s+of\s+facets[:\s]*(\d+)/i,
    /(\d+)\s*facets?\b/i,
    /(\d+)\s*roof\s*planes?/i,
  ]);
  const facetCount = facetMatch ? parseInt(facetMatch, 10) : 0;

  const pitch = parsePitch(text);
  if (!/[Pp]itch/.test(text)) warnings.push("pitch_not_found");

  const linear: ParsedLinear = {
    eaves: parseLinear(text, "[Ee]aves?"),
    valleys: parseLinear(text, "[Vv]alleys?"),
    hips: parseLinear(text, "[Hh]ips?"),
    ridges: parseLinear(text, "[Rr]idges?"),
    rakes: parseLinear(text, "[Rr]akes?"),
    wallFlashing: parseLinear(text, "[Ww]all\\s*flashing"),
    stepFlashing: parseLinear(text, "[Ss]tep\\s*flashing"),
  };

  const perimeterMatch = firstMatch(text, [
    /Perimeter[:\s]*((?:\d+(?:\.\d+)?)\s*(?:ft|'))/i,
  ]);
  const perimeter = perimeterMatch ? ftInches(perimeterMatch) : linear.eaves + linear.rakes;

  const reportDate = firstMatch(text, [
    /Report\s+(?:date|generated)[:\s]*([0-9/.\-]{6,12})/i,
    /Date\s+(?:Issued|Created)[:\s]*([0-9/.\-]{6,12})/i,
    /Date[:\s]*([0-9/.\-]{6,12})/i,
  ]) ?? undefined;

  const reportId = firstMatch(text, [
    /Report\s+(?:ID|Number|#)[:\s]*([A-Z0-9\-]{4,40})/i,
    /Order\s+(?:ID|Number|#)[:\s]*([A-Z0-9\-]{4,40})/i,
  ]) ?? undefined;

  const address = firstMatch(text, [
    /Property\s+Address[:\s]*([^\n]{5,140})/i,
    /Subject\s+Property[:\s]*([^\n]{5,140})/i,
    /Address[:\s]*([^\n]{5,140})/i,
  ])?.trim();

  const { lat, lng } = parseLatLng(text);

  const waste = parseWasteTable(text, totalArea);
  const wastePct = waste.suggested ?? 12;
  const pitchBreakdown = parsePitchBreakdown(text);

  // Sanity warnings
  if (totalArea > 0 && (linear.eaves + linear.rakes) === 0) warnings.push("no_perimeter_lines");
  if (totalArea > 50000) warnings.push("area_unusually_large");

  return {
    totalArea,
    facetCount,
    pitch: pitch.label,
    pitchValue: pitch.value,
    perimeter,
    linear,
    wasteTable: waste.table,
    suggestedWastePct: waste.suggested,
    materials: deriveMaterials(totalArea, linear, wastePct),
    pitchBreakdown,
    source: detectSource(text),
    reportDate,
    reportId,
    address,
    lat,
    lng,
    warnings,
  };
}

// ---------- canonical JSON conversion (matches src/types/roofMeasurement.ts) ----------

type FeatureType = "ridge" | "hip" | "valley" | "eave" | "rake";

interface CanonicalFeature {
  type: FeatureType;
  p1: [number, number];
  p2: [number, number];
  confidence: number;
  source: "vendor_override";
}

export interface CanonicalRoofJSON {
  meta: {
    version: "v1";
    source: "vendor-pdf";
    vendor: ParsedMeasurements["source"];
    generated_at: string;
    report_date?: string;
    report_id?: string;
    parser_version: string;
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
  pitch_breakdown: PitchBreakdownRow[];
  waste_table: Record<string, WasteRow>;
  suggested_waste_pct: number | null;
  materials: Record<string, number>;
  geometry: {
    footprint_polygon: [number, number][];
    features: CanonicalFeature[];
  };
  diagram_geometry: unknown | null;
  warnings: string[];
}

const PARSER_VERSION = "vendor-parser-1.1.0";

function classifyRoof(linear: ParsedLinear): { type: string; confidence: number } {
  const { hips, rakes, valleys } = linear;
  if (hips > 30 && rakes < 10) return { type: "hip", confidence: 0.85 };
  if (rakes > 20 && hips < 5) return { type: "gable", confidence: 0.85 };
  if (valleys > 30) return { type: "complex_valley", confidence: 0.7 };
  if (hips > 0 && rakes > 0) return { type: "mixed", confidence: 0.65 };
  return { type: "unknown", confidence: 0.4 };
}

export function toCanonicalJSON(
  m: ParsedMeasurements,
  diagramGeometry: unknown | null,
  location?: { address?: string | null; lat?: number | null; lng?: number | null },
): CanonicalRoofJSON {
  const dg = (diagramGeometry as any) || null;

  const footprint: [number, number][] =
    (dg?.footprint_polygon as [number, number][]) ||
    (dg?.facets?.[0]?.polygon?.map((p: any) => [Number(p.x), Number(p.y)] as [number, number])) ||
    [];

  const features: CanonicalFeature[] = [];
  if (dg?.edges) {
    const map: Array<[string, FeatureType]> = [
      ["ridges", "ridge"],
      ["hips", "hip"],
      ["valleys", "valley"],
      ["eaves", "eave"],
      ["rakes", "rake"],
    ];
    for (const [key, type] of map) {
      const arr = dg.edges[key] || [];
      for (const e of arr) {
        if (e?.start && e?.end) {
          features.push({
            type,
            p1: [Number(e.start.x ?? e.start.lat), Number(e.start.y ?? e.start.lng)],
            p2: [Number(e.end.x ?? e.end.lat), Number(e.end.y ?? e.end.lng)],
            confidence: 0.8,
            source: "vendor_override",
          });
        }
      }
    }
  }

  const roof = classifyRoof(m.linear);

  return {
    meta: {
      version: "v1",
      source: "vendor-pdf",
      vendor: m.source,
      generated_at: new Date().toISOString(),
      report_date: m.reportDate,
      report_id: m.reportId,
      parser_version: PARSER_VERSION,
    },
    location: {
      address: location?.address ?? m.address ?? null,
      lat: location?.lat ?? m.lat ?? null,
      lng: location?.lng ?? m.lng ?? null,
    },
    roof,
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
    pitch_breakdown: m.pitchBreakdown,
    waste_table: m.wasteTable,
    suggested_waste_pct: m.suggestedWastePct,
    materials: m.materials,
    geometry: { footprint_polygon: footprint, features },
    diagram_geometry: diagramGeometry ?? null,
    warnings: m.warnings,
  };
}
