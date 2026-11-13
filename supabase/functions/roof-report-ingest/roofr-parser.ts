// Roofr report reading and report-type detection.
// Kept separate from index.ts so it can be tested without starting the server.

import { normalizeText, parseFloatSafe, parseIntSafe } from "./xactimate-parser.ts";

function n(v: unknown, fallback = 0): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function feetInchesToFeet(ft: string, inch: string): number {
  return n(ft) + n(inch) / 12;
}

const STRONG_INSURANCE_MARKERS = [
  "xactimate",
  "xactanalysis",
  "xactware",
  "claim number",
  "policy number",
  "replacement cost value",
  "actual cash value",
  "date of loss",
];

function isBrandedRoofrMeasurementReport(lowerText: string): boolean {
  if (!lowerText.includes("this report was prepared by roofr")) return false;
  const hasRoofrPages =
    lowerText.includes("length measurement report") ||
    lowerText.includes("area measurement report") ||
    lowerText.includes("report summary");
  if (!hasRoofrPages) return false;
  return !STRONG_INSURANCE_MARKERS.some((m) => lowerText.includes(m));
}

export type Provider = "roofr" | "eagleview" | "roofscope" | "hover" | "google" | "xactimate" | "generic";

export function detectProvider(text: string): Provider {
  const t = text.toLowerCase();

  // Enhanced Xactimate detection with scoring system
  // Xactimate / insurance scopes can reference EagleView as the roof-data source,
  // so this must run BEFORE the EagleView branded-report check.
  const xactimatePatterns = [
    'xactimate',
    'xactanalysis',
    'xactware',
    'citizens claims',
    'claim number',
    'claim #',
    'policy number',
    'policy #',
    'covered damages',
    'price list:',
    'rcv',
    'acv',
    'depreciation',
    'replacement cost value',
    'actual cash value',
    'quantity',
    'unit tax',
    'sketch1',
    'number of squares',
    'surface area',
    'surface are',             // OCR often drops the final "a"
    'total perimeter length',
    'total ridge length',
    'total hip length',
    'total valley length',
    'job_',
    'slide insurance',
    'independent adjuster',
    'insured:',
    'adjuster:',
    'estimator:',
    'date of loss',
    'xact estimate',
    'xact analysis',
    'f1\n',
    'f2\n',
    'f3\n',
    'hip / ridge cap',
    'hip & ridge cap',
    'drip edge',
    'starter',
    'remove 3 tab',
    'r&r',                     // "Remove & Replace" line items
  ];
  
  // Branded measurement reports win over keyword scoring. Roofr's
  // "Material calculations" page lists starter / drip edge quantities, which
  // used to score as an insurance scope and sent Roofr uploads to the much
  // less complete fallback reader.
  if (isBrandedRoofrMeasurementReport(t)) return "roofr";

  // Count matching patterns
  let xactimateScore = 0;
  for (const pattern of xactimatePatterns) {
    if (t.includes(pattern)) {
      xactimateScore++;
      console.log("roof-report-ingest: Xactimate pattern matched:", pattern);
    }
  }
  
  // If 2+ patterns match, it's likely Xactimate
  if (xactimateScore >= 2) {
    console.log(`roof-report-ingest: Xactimate detected (${xactimateScore} patterns matched)`);
    return "xactimate";
  }
  
  // Early returns for clearly branded measurement reports
  if (t.includes("this report was prepared by roofr")) return "roofr";
  if (t.includes("eagle view technologies") || t.includes("eagleview")) return "eagleview";
  if (t.includes("roofscope")) return "roofscope";
  if (t.includes("hover.to") || t.includes("hover inc")) return "hover";
  if (t.includes("google maps") || t.includes("imagery ©") || t.includes("map data ©")) return "google";
  
  return "generic";
}

// -----------------------------
// Roofr parser
// -----------------------------
export function parseRoofr(textRaw: string) {
  const text = normalizeText(textRaw);

  const addrMatch =
    text.match(/Report summary\s*\n([^\n]+)\n/i) ||
    text.match(/\n([^\n]*,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?)\s*\n/);
  const address = addrMatch?.[1]?.trim() ?? null;

  // Roofr reports contain BOTH whole-property pages ("Area measurement report",
  // "Length measurement report") and per-structure summaries ("Structure #1 summary").
  // The whole-property pages are authoritative — a per-structure block can be a tiny
  // detached shed and must never be mistaken for the roof total.
  const num = (re: RegExp) => parseIntSafe(text.match(re)?.[1]);
  const ftIn = (re: RegExp) => {
    const m = text.match(re);
    return m ? feetInchesToFeet(m[1], m[2]) : null;
  };
  // Sum every per-structure occurrence, so multi-structure reports still add up.
  const sumAll = (re: RegExp): number | null => {
    const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m: RegExpExecArray | null;
    let total: number | null = null;
    while ((m = rx.exec(text)) !== null) {
      const v = m[2] !== undefined
        ? feetInchesToFeet(m[1], m[2])
        : parseFloatSafe(m[1]);
      if (v !== null) total = (total ?? 0) + v;
    }
    return total;
  };

  // Whole-property area page (colon form), then cover page, then structure sum.
  const totalRoofArea =
    num(/Total roof area:\s*([\d,]+)\s*sqft/i) ??
    num(/Roof Report\s*\n+\s*([\d,]+)\s*sqft/i) ??
    sumAll(/Total roof area\s*\n?\s*([\d,]+)\s*sqft/i);
  const totalPitchedArea =
    num(/Pitched roof area:\s*([\d,]+)\s*sqft/i) ??
    sumAll(/Total pitched area\s*\n?\s*([\d,]+)\s*sqft/i);
  const totalFlatArea =
    num(/Flat roof area:\s*([\d,]+)\s*sqft/i) ??
    sumAll(/Total flat area\s*\n?\s*([\d,]+)\s*sqft/i);
  const facetCount =
    num(/([\d,]+)\s*facets\s*\n+\s*Predominant pitch/i) ??
    num(/Total roof facets\s*\n?\s*([\d,]+)\s*facets/i);
  const predominantPitch =
    text.match(/Predominant pitch:?\s*\n?\s*(\d+\/\d+)/i)?.[1] ?? null;

  // Length measurement page uses "Eaves: 242ft 11in"; structure summaries use "Total eaves".
  function lengthFor(label: string) {
    const main = ftIn(new RegExp(`(?:^|\\n)\\s*${label}:\\s*(\\d+)\\s*ft\\s*(\\d+)\\s*in`, "i"));
    if (main !== null) return main;
    return sumAll(new RegExp(`Total ${label}\\s*\\n?\\s*(\\d+)\\s*ft\\s*(\\d+)\\s*in`, "i"));
  }

  const eaves = lengthFor("eaves");
  const valleys = lengthFor("valleys");
  const hips = lengthFor("hips");
  const ridges = lengthFor("ridges");
  const rakes = lengthFor("rakes");
  const wallFlashing = lengthFor("wall flashing");
  const stepFlashing = lengthFor("step flashing");
  const transitions = lengthFor("transitions");
  const parapetWall = lengthFor("parapet wall");
  const unspecified = lengthFor("unspecified");

  const pitchRows: Array<{ pitch: string; area_sqft: number }> = [];
  const pitchRe = /Pitch\s+(\d+\/\d+)\s+Area\s+\(sqft\)\s+([\d,]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = pitchRe.exec(text)) !== null) {
    const pitch = m[1];
    const area = parseIntSafe(m[2]);
    if (pitch && area !== null) pitchRows.push({ pitch, area_sqft: area });
  }

  // Waste table: "Waste %" row, then "Area (sqft)" row, then "Squares" row.
  // Read the percentages from the report itself — Roofr varies them per roof.
  let wasteTable: Array<{ waste_pct: number; area_sqft: number | null; squares: number | null }> | null = null;
  const wasteBlock = text.match(
    /Waste %\s+((?:\d+(?:\.\d+)?%\s+)+)Area \(sqft\)\s+((?:[\d,]+\s+)+)Squares\s+((?:\d+(?:\.\d+)?\s*)+)/i,
  );
  if (wasteBlock) {
    const pcts = wasteBlock[1].match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const areas = wasteBlock[2].trim().split(/\s+/).map((x) => parseIntSafe(x));
    const squares = wasteBlock[3].trim().split(/\s+/).map((x) => parseFloatSafe(x));
    if (pcts.length) {
      wasteTable = pcts.map((pct, i) => ({
        waste_pct: pct,
        area_sqft: areas[i] ?? null,
        squares: squares[i] ?? null,
      }));
    }
  }

  // Roofr prints the combined edge totals; use them when present, else add up.
  const combined = (label: string) =>
    ftIn(new RegExp(`${label}\\s*\\n?\\s*(\\d+)\\s*ft\\s*(\\d+)\\s*in`, "i"));
  const eavesPlusRakes =
    combined("Eaves \\+ rakes") ?? (eaves !== null && rakes !== null ? eaves + rakes : null);
  const hipsPlusRidges =
    combined("Hips \\+ ridges") ?? (hips !== null && ridges !== null ? hips + ridges : null);

  return {
    provider: "roofr",
    address,
    total_area_sqft: totalRoofArea,
    pitched_area_sqft: totalPitchedArea ?? totalRoofArea,
    flat_area_sqft: totalFlatArea,
    facet_count: facetCount,
    predominant_pitch: predominantPitch,
    ridges_ft: ridges,
    hips_ft: hips,
    valleys_ft: valleys,
    rakes_ft: rakes,
    eaves_ft: eaves,
    wall_flashing_ft: wallFlashing,
    step_flashing_ft: stepFlashing,
    transitions_ft: transitions,
    parapet_walls_ft: parapetWall,
    unspecified_ft: unspecified,
    perimeter_ft: eavesPlusRakes,
    hips_ridges_ft: hipsPlusRidges,
    pitches: pitchRows.length ? pitchRows : null,
    waste_table: wasteTable,
  };
}

