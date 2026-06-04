// Deterministic trade detection from parsed report extractions.
// Pure function. No AI. No DB.

import type { TradeId, TradeSupportStatus } from "./trade-catalog.ts";
import { TRADE_SUPPORT_MAP } from "./trade-catalog.ts";

export interface DetectedTradeCandidate {
  trade_id: TradeId;
  support_status: TradeSupportStatus;
  confidence: number; // 0..1
  detection_signals: Record<string, unknown>;
}

interface RoofLikeExtraction {
  total_roof_area_sqft?: number | null;
  eaves_ft?: number | null;
  rakes_ft?: number | null;
  fascia_eaves_rake_lf?: number | null;
}

interface WallLikeExtraction {
  wall_area_sqft?: number | null;
  window_door_area_sqft?: number | null;
  window_door_count?: number | null;
  fascia_eaves_rake_lf?: number | null;
}

export function detectTradesFromRoofReport(
  ext: RoofLikeExtraction,
  vendor: string,
): DetectedTradeCandidate[] {
  const out: DetectedTradeCandidate[] = [];
  if ((ext.total_roof_area_sqft ?? 0) > 0) {
    out.push({
      trade_id: "roofing",
      support_status: TRADE_SUPPORT_MAP.roofing,
      confidence: 0.95,
      detection_signals: { source: vendor, has_total_roof_area: true },
    });
  }
  if ((ext.eaves_ft ?? 0) > 0 || (ext.rakes_ft ?? 0) > 0) {
    out.push({
      trade_id: "gutters_fascia_trim",
      support_status: TRADE_SUPPORT_MAP.gutters_fascia_trim,
      confidence: 0.75,
      detection_signals: {
        source: vendor,
        eaves_present: (ext.eaves_ft ?? 0) > 0,
        rakes_present: (ext.rakes_ft ?? 0) > 0,
      },
    });
  }
  return out;
}

export function detectTradesFromWallReport(
  ext: WallLikeExtraction,
  vendor: string,
): DetectedTradeCandidate[] {
  const out: DetectedTradeCandidate[] = [];
  if ((ext.wall_area_sqft ?? 0) > 0) {
    out.push({
      trade_id: "exterior_walls_siding",
      support_status: TRADE_SUPPORT_MAP.exterior_walls_siding,
      confidence: 0.95,
      detection_signals: { source: vendor, has_total_wall_area: true },
    });
    out.push({
      trade_id: "paint_coatings",
      support_status: TRADE_SUPPORT_MAP.paint_coatings,
      confidence: 0.7,
      detection_signals: { source: vendor, derived_from: "exterior_walls_siding" },
    });
  }
  if ((ext.fascia_eaves_rake_lf ?? 0) > 0) {
    out.push({
      trade_id: "gutters_fascia_trim",
      support_status: TRADE_SUPPORT_MAP.gutters_fascia_trim,
      confidence: 0.8,
      detection_signals: { source: vendor, has_fascia: true },
    });
  }
  if ((ext.window_door_area_sqft ?? 0) > 0 || (ext.window_door_count ?? 0) > 0) {
    // measurement-object-only: surfaced as a detected option but not acceptable.
    out.push({
      trade_id: "windows_doors",
      support_status: TRADE_SUPPORT_MAP.windows_doors,
      confidence: 0.9,
      detection_signals: { source: vendor, w_d_area: ext.window_door_area_sqft ?? null, w_d_count: ext.window_door_count ?? null },
    });
  }
  return out;
}
