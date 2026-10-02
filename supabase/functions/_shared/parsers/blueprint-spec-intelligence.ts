// Blueprint F1E specification intelligence.
// Deterministic text evidence only. Never converts a detected spec into an approved
// estimate/material selection without downstream review.

import type { PdfLayoutPage, PdfLayoutTextItem } from "./pdf-layout.ts";
import type { DrawingViewport } from "./blueprint-viewports.ts";

export const BLUEPRINT_SPEC_VERSION = "f1-spec-v1";

export type SpecCategory =
  | "roofing" | "insulation" | "deck" | "wall_board" | "framing"
  | "fire_rating" | "paint" | "flooring" | "concrete" | "mechanical"
  | "electrical" | "plumbing" | "general";

export interface BlueprintSpecCandidate {
  page_number: number;
  viewport_key: string | null;
  category: SpecCategory;
  key_name: string;
  value_text: string;
  normalized_value: Record<string, unknown>;
  confidence: number;
  source_text: string;
  bbox: { x: number; y: number; width: number; height: number };
  metadata: {
    version: string;
    source: "pdf_text";
    requires_review: true;
  };
}

interface Rule {
  category: SpecCategory;
  key_name: string;
  pattern: RegExp;
  normalize: (match: RegExpMatchArray) => Record<string, unknown>;
  confidence: number;
}

function thickness(value: string | undefined): number | null {
  if (!value) return null;
  const fraction = value.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const RULES: Rule[] = [
  { category: "roofing", key_name: "roof_membrane", confidence: 0.94,
    pattern: /\b(45|50|60|80)\s*(?:MIL|MIL\.)\s+(TPO|EPDM|PVC)\b/i,
    normalize: (m) => ({ thickness_mil: Number(m[1]), membrane_type: m[2].toUpperCase() }) },
  { category: "roofing", key_name: "roof_system_type", confidence: 0.88,
    pattern: /\b(FULLY\s+ADHERED|MECHANICALLY\s+ATTACHED|BALLASTED)\s+(?:ROOF(?:ING)?\s+)?(?:SYSTEM|MEMBRANE)?\b/i,
    normalize: (m) => ({ attachment_method: m[1].replace(/\s+/g, "_").toLowerCase() }) },
  { category: "insulation", key_name: "roof_insulation", confidence: 0.88,
    pattern: /\b(?:POLYISO|POLYISOCYANURATE)(?:\s+INSULATION)?(?:\s*[-–:]?\s*)(\d+(?:\.\d+)?|\d+\s*\/\s*\d+)?\s*(?:IN|\")?/i,
    normalize: (m) => ({ material: "polyiso", thickness_inches: thickness(m[1]) }) },
  { category: "roofing", key_name: "cover_board", confidence: 0.9,
    pattern: /\b(\d+(?:\.\d+)?|\d+\s*\/\s*\d+)\s*(?:IN|\")?\s+(?:GYPSUM|GYPSUM\s+COVER|DENSDECK|SECUROCK)\s+(?:COVER\s+)?BOARD\b/i,
    normalize: (m) => ({ thickness_inches: thickness(m[1]) }) },
  { category: "deck", key_name: "roof_deck", confidence: 0.84,
    pattern: /\b(\d{2}|\d{2}\s*GA)\s*(?:GAUGE|GA\.?|GAGE)?\s+(STEEL|METAL)\s+DECK\b/i,
    normalize: (m) => ({ gauge: Number(String(m[1]).replace(/\D/g, "")), material: m[2].toLowerCase() }) },
  { category: "wall_board", key_name: "gypsum_board", confidence: 0.9,
    pattern: /\b(1\s*\/\s*2|5\s*\/\s*8)\s*(?:IN|\")?\s+(TYPE\s*X\s+)?(?:GYPSUM|GYP\.?|GWB|GYPSUM\s+WALL)\s*(?:BOARD)?\b/i,
    normalize: (m) => ({ thickness_inches: thickness(m[1]), type_x: Boolean(m[2]) }) },
  { category: "framing", key_name: "metal_stud", confidence: 0.88,
    pattern: /\b(\d+(?:\.\d+)?|\d+\s*\/\s*\d+)\s*(?:IN|\")?\s+(\d{2})\s*(?:GA|GAUGE)?\s+(?:METAL\s+)?STUDS?\s*(?:@|AT)\s*(\d+)\s*(?:IN|\")?\s*O\.?C\.?/i,
    normalize: (m) => ({ stud_depth_inches: thickness(m[1]), gauge: Number(m[2]), spacing_inches_oc: Number(m[3]) }) },
  { category: "fire_rating", key_name: "assembly_fire_rating", confidence: 0.86,
    pattern: /\b([1-4])\s*(?:HR|HOUR)[-\s]*(?:FIRE[-\s]*)?(?:RATED|RATING|ASSEMBLY)\b/i,
    normalize: (m) => ({ hours: Number(m[1]) }) },
  { category: "paint", key_name: "paint_coats", confidence: 0.75,
    pattern: /\b(ONE|TWO|THREE|1|2|3)\s+COATS?\s+(?:OF\s+)?(?:PAINT|FINISH)\b/i,
    normalize: (m) => ({ coats: ({ one: 1, two: 2, three: 3 } as Record<string, number>)[m[1].toLowerCase()] ?? Number(m[1]) }) },
  { category: "flooring", key_name: "floor_finish", confidence: 0.72,
    pattern: /\b(LVT|VCT|PORCELAIN\s+TILE|CERAMIC\s+TILE|CARPET|EPOXY\s+FLOOR(?:ING)?|POLISHED\s+CONCRETE)\b/i,
    normalize: (m) => ({ finish_type: m[1].replace(/\s+/g, "_").toLowerCase() }) },
  { category: "concrete", key_name: "concrete_strength", confidence: 0.9,
    pattern: /\b(\d{3,4})\s*PSI\s+CONCRETE\b/i,
    normalize: (m) => ({ compressive_strength_psi: Number(m[1]) }) },
  { category: "mechanical", key_name: "duct_insulation", confidence: 0.72,
    pattern: /\bR[-\s]?(\d+(?:\.\d+)?)\s+(?:DUCT|DUCTWORK)\s+INSULATION\b/i,
    normalize: (m) => ({ r_value: Number(m[1]) }) },
  { category: "plumbing", key_name: "pipe_material", confidence: 0.7,
    pattern: /\b(CPVC|PVC|PEX|COPPER|CAST\s+IRON)\s+(?:PIPE|PIPING)\b/i,
    normalize: (m) => ({ material: m[1].replace(/\s+/g, "_").toLowerCase() }) },
];

function box(item: PdfLayoutTextItem) {
  return { x: item.x, y: item.y, width: item.width, height: item.height };
}

function center(item: PdfLayoutTextItem) {
  return { x: item.x + item.width / 2, y: item.y + item.height / 2 };
}

function owner(item: PdfLayoutTextItem, viewports: DrawingViewport[]): string | null {
  const c = center(item);
  const containing = viewports.filter((v) => c.x >= v.bbox.x && c.x <= v.bbox.x + v.bbox.width && c.y >= v.bbox.y && c.y <= v.bbox.y + v.bbox.height);
  containing.sort((a, b) => a.bbox.width * a.bbox.height - b.bbox.width * b.bbox.height);
  return containing[0]?.viewport_key ?? null;
}

export function extractBlueprintSpecifications(page: PdfLayoutPage, viewports: DrawingViewport[] = []): BlueprintSpecCandidate[] {
  const out: BlueprintSpecCandidate[] = [];
  const seen = new Set<string>();
  for (const item of page.text_items) {
    const text = item.text.replace(/\s+/g, " ").trim();
    for (const rule of RULES) {
      const match = text.match(rule.pattern);
      if (!match) continue;
      const key = `${page.page_number}|${rule.category}|${rule.key_name}|${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        page_number: page.page_number,
        viewport_key: owner(item, viewports),
        category: rule.category,
        key_name: rule.key_name,
        value_text: match[0],
        normalized_value: rule.normalize(match),
        confidence: rule.confidence,
        source_text: text,
        bbox: box(item),
        metadata: { version: BLUEPRINT_SPEC_VERSION, source: "pdf_text", requires_review: true },
      });
    }
  }
  return out;
}
