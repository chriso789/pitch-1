import type { BlueprintF1RuntimeResult } from "./blueprint-f1-runtime.ts";
import type { TradeId, TradeSupportStatus } from "../blueprint-importer/trade-catalog.ts";
import { TRADE_SUPPORT_MAP } from "../blueprint-importer/trade-catalog.ts";

export const BLUEPRINT_F1_TRADE_DETECTION_VERSION = "f1-trade-detection-v1";

export interface F1DetectedTrade {
  trade_id: TradeId;
  support_status: TradeSupportStatus;
  confidence: number;
  source_pages: number[];
  signals: string[];
  review_state: "pending_review" | "manual_only";
}

type Rule = { trade_id: TradeId; patterns: RegExp[]; min_hits?: number; architectural_bonus?: boolean };

const RULES: Rule[] = [
  { trade_id: "exterior_walls_siding", patterns: [/\bEXTERIOR\s+ELEVATION/i,/\bBUILDING\s+ELEVATION/i,/\bSIDING\b/i,/\bSTUCCO\b/i,/\bEIFS\b/i,/HARDIE/i,/BOARD\s*&\s*BATTEN/i], architectural_bonus: true },
  { trade_id: "paint_coatings", patterns: [/\bPAINT\b/i,/\bCOATING/i,/FINISH\s+SCHEDULE/i,/EXTERIOR\s+FINISH/i], architectural_bonus: true },
  { trade_id: "gutters_fascia_trim", patterns: [/\bGUTTER/i,/\bDOWNSPOUT/i,/\bFASCIA/i,/\bSOFFIT/i,/\bTRIM\b/i], architectural_bonus: true },
  { trade_id: "windows_doors", patterns: [/\bWINDOW\s+SCHEDULE/i,/\bDOOR\s+SCHEDULE/i,/\bWINDOW\b/i,/\bDOOR\b/i], min_hits: 1 },
  { trade_id: "drywall", patterns: [/\bDRYWALL\b/i,/\bGYPSUM\b/i,/\bGWB\b/i,/GYP\.?\s*BOARD/i,/PARTITION\s+TYPE/i], architectural_bonus: true },
  { trade_id: "framing", patterns: [/\bFRAMING\s+PLAN/i,/\bSTUD\b/i,/\bJOIST\b/i,/\bRAFTER\b/i,/\bTRUSS\b/i,/\bHEADER\b/i,/PARTITION\s+PLAN/i] },
  { trade_id: "insulation", patterns: [/\bINSULATION\b/i,/\bR-?\d{1,2}\b/i,/SPRAY\s+FOAM/i,/BATT\s+INSULATION/i] },
  { trade_id: "flooring", patterns: [/\bFLOOR\s+FINISH/i,/\bFLOORING\b/i,/TILE\s+FLOOR/i,/LVT\b/i,/CARPET/i] },
  { trade_id: "concrete", patterns: [/\bFOUNDATION\s+PLAN/i,/\bSLAB\b/i,/\bCONCRETE\b/i,/FOOTING/i] },
  { trade_id: "electrical", patterns: [/\bELECTRICAL\b/i,/\bPOWER\s+PLAN/i,/\bLIGHTING\s+PLAN/i,/PANEL\s+SCHEDULE/i] },
  { trade_id: "plumbing", patterns: [/\bPLUMBING\b/i,/\bSANITARY\b/i,/\bDOMESTIC\s+WATER/i,/PLUMBING\s+FIXTURE/i] },
  { trade_id: "hvac", patterns: [/\bHVAC\b/i,/\bMECHANICAL\s+PLAN/i,/\bDUCTWORK\b/i,/\bAIR\s+HANDLER/i,/\bRTU\b/i] },
];

export function detectBlueprintTradesF1(f1: BlueprintF1RuntimeResult): F1DetectedTrade[] {
  const out: F1DetectedTrade[] = [];
  for (const rule of RULES) {
    const pages: number[] = [];
    const signals = new Set<string>();
    let weightedHits = 0;
    for (const page of f1.pages) {
      const text = page.raw_text ?? "";
      let pageHits = 0;
      for (const pattern of rule.patterns) {
        const match = text.match(pattern);
        if (!match) continue;
        pageHits += 1;
        signals.add(match[0].replace(/\s+/g, " ").trim().toUpperCase());
      }
      const architectural = page.layout_json?.discipline === "architectural" || page.page_subtype === "architectural";
      if (pageHits > 0) {
        pages.push(page.page_number);
        weightedHits += pageHits + (rule.architectural_bonus && architectural ? 0.5 : 0);
      }
    }
    if (weightedHits < (rule.min_hits ?? 1)) continue;
    const support = TRADE_SUPPORT_MAP[rule.trade_id];
    const confidence = Math.min(0.96, 0.58 + Math.min(0.28, weightedHits * 0.07) + Math.min(0.1, pages.length * 0.02));
    out.push({
      trade_id: rule.trade_id,
      support_status: support,
      confidence: Number(confidence.toFixed(3)),
      source_pages: [...new Set(pages)].sort((a,b)=>a-b),
      signals: [...signals].slice(0,12),
      review_state: support === "future_supported" ? "manual_only" : "pending_review",
    });
  }
  return out.sort((a,b)=>b.confidence-a.confidence || a.trade_id.localeCompare(b.trade_id));
}
