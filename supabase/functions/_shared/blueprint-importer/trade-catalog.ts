// Blueprint Importer v2 — Trade catalog contract (Phase 1, side-effect-free).
// Source of truth: docs/blueprint-trade-catalog.md
// DO NOT call DB / APIs / extraction / estimate generation from this file.

export type TradeSupportStatus =
  | "mvp_supported"
  | "measurement_object_only"
  | "future_supported"
  | "unsupported";

export type TradeId =
  | "roofing"
  | "exterior_walls_siding"
  | "paint_coatings"
  | "gutters_fascia_trim"
  | "windows_doors"
  | "drywall"
  | "framing"
  | "insulation"
  | "flooring"
  | "concrete"
  | "electrical"
  | "plumbing"
  | "hvac";

export const MVP_SUPPORTED_TRADES: readonly TradeId[] = [
  "roofing",
  "exterior_walls_siding",
  "paint_coatings",
  "gutters_fascia_trim",
] as const;

export const MEASUREMENT_OBJECT_ONLY_TRADES: readonly TradeId[] = [
  "windows_doors",
] as const;

export const FUTURE_SUPPORTED_TRADES: readonly TradeId[] = [
  "drywall",
  "framing",
  "insulation",
  "flooring",
  "concrete",
  "electrical",
  "plumbing",
  "hvac",
] as const;

export const UNSUPPORTED_TRADES: readonly TradeId[] = [] as const;

export const TRADE_SUPPORT_MAP: Readonly<Record<TradeId, TradeSupportStatus>> = {
  roofing: "mvp_supported",
  exterior_walls_siding: "mvp_supported",
  paint_coatings: "mvp_supported",
  gutters_fascia_trim: "mvp_supported",
  windows_doors: "measurement_object_only",
  drywall: "future_supported",
  framing: "future_supported",
  insulation: "future_supported",
  flooring: "future_supported",
  concrete: "future_supported",
  electrical: "future_supported",
  plumbing: "future_supported",
  hvac: "future_supported",
};

export function isMvpSupportedTrade(trade: TradeId): boolean {
  return TRADE_SUPPORT_MAP[trade] === "mvp_supported";
}
export function isMeasurementObjectOnlyTrade(trade: TradeId): boolean {
  return TRADE_SUPPORT_MAP[trade] === "measurement_object_only";
}
export function isFutureSupportedTrade(trade: TradeId): boolean {
  return TRADE_SUPPORT_MAP[trade] === "future_supported";
}

/**
 * Phase 0 rule enforcement: returns null if the trade is acceptable in the MVP
 * acceptance flow, or a string reason if it must be blocked. Pure / deterministic.
 *
 * - windows_doors: measurement-object-only — never a top-level accepted MVP trade.
 * - paint_coatings: derived — requires exterior_walls_siding accepted in same session.
 * - future_supported: allowed only with manual_only review state.
 * - unsupported: always blocked.
 */
export function assertCanAcceptTradeForMvp(input: {
  trade_id: TradeId;
  accepted_trade_ids_in_session: TradeId[];
  review_state?: "pending_review" | "blocked" | "cleared" | "manual_only";
}): { ok: true } | { ok: false; reason: string; flag_code: string } {
  const status = TRADE_SUPPORT_MAP[input.trade_id];

  if (status === "measurement_object_only") {
    return {
      ok: false,
      reason: "windows_doors is measurement-object-only and cannot be a top-level accepted trade",
      flag_code: "windows_doors_selected_as_trade",
    };
  }
  if (status === "unsupported") {
    return { ok: false, reason: "trade is unsupported", flag_code: "unsupported_trade_for_mvp" };
  }
  if (status === "future_supported") {
    if (input.review_state !== "manual_only") {
      return {
        ok: false,
        reason: "future_supported trades require manual_only review_state during MVP",
        flag_code: "future_trade_requires_sheet_intelligence",
      };
    }
    return { ok: true };
  }
  if (input.trade_id === "paint_coatings") {
    if (!input.accepted_trade_ids_in_session.includes("exterior_walls_siding")) {
      return {
        ok: false,
        reason: "paint_coatings is derived from exterior_walls_siding and cannot stand alone",
        flag_code: "paint_without_wall_source",
      };
    }
  }
  return { ok: true };
}
