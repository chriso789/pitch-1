// Blueprint Importer v2 — Phase 3 runtime acceptance gates.
// Enforces the Phase 0/1 rules that Phase 2 left as helper-only.
// Pure function; called from the document-worker /accept-trade route.

import { TRADE_SUPPORT_MAP, type TradeId } from "./trade-catalog.ts";
import { REVIEW_FLAG_CODES } from "./review-flag-codes.ts";

export interface AcceptanceContext {
  trade_id: string;
  already_accepted_trade_ids: string[];
  // detected_trade row this acceptance is promoting (may be null if user is
  // attempting to accept a trade that was never detected)
  detected_support_status: string | null;
  // For paint-derived gate: was a wall measurement source ingested in same session?
  has_exterior_walls_siding_source: boolean;
  // For PlanPath gate: do the measurements for this trade carry plan_path_ids?
  has_plan_paths_for_trade: boolean;
  // Phase 1 override allowing future_supported trades through with manual_only.
  requested_review_state?: "pending_review" | "blocked" | "cleared" | "manual_only";
}

export type AcceptanceVerdict =
  | { ok: true; review_state: "pending_review" | "manual_only" }
  | { ok: false; flag_code: string; reason: string; http_status: number };

export function evaluateTradeAcceptance(ctx: AcceptanceContext): AcceptanceVerdict {
  const tradeId = ctx.trade_id as TradeId;
  const support = TRADE_SUPPORT_MAP[tradeId];

  // Unknown trade
  if (!support) {
    return {
      ok: false,
      flag_code: REVIEW_FLAG_CODES.UNSUPPORTED_TRADE_FOR_MVP,
      reason: `trade '${ctx.trade_id}' is not in the catalog`,
      http_status: 400,
    };
  }

  // Hard block: windows_doors can never be a top-level accepted trade.
  if (support === "measurement_object_only") {
    return {
      ok: false,
      flag_code: REVIEW_FLAG_CODES.WINDOWS_DOORS_SELECTED_AS_TRADE,
      reason: "windows_doors is measurement-object-only and cannot be a top-level accepted trade",
      http_status: 422,
    };
  }

  // Unsupported
  if (support === "unsupported") {
    return {
      ok: false,
      flag_code: REVIEW_FLAG_CODES.UNSUPPORTED_TRADE_FOR_MVP,
      reason: `trade '${ctx.trade_id}' is unsupported`,
      http_status: 422,
    };
  }

  // Future-supported: only allowed with explicit manual_only review state.
  if (support === "future_supported") {
    if (ctx.requested_review_state !== "manual_only") {
      return {
        ok: false,
        flag_code: REVIEW_FLAG_CODES.FUTURE_TRADE_REQUIRES_SHEET_INTELLIGENCE,
        reason: "future_supported trades require manual_only review_state during MVP",
        http_status: 422,
      };
    }
    return { ok: true, review_state: "manual_only" };
  }

  // MVP-supported branch from here. paint_coatings requires siding source.
  if (tradeId === "paint_coatings") {
    const sidingAlreadyAccepted = ctx.already_accepted_trade_ids.includes("exterior_walls_siding");
    if (!ctx.has_exterior_walls_siding_source && !sidingAlreadyAccepted) {
      return {
        ok: false,
        flag_code: REVIEW_FLAG_CODES.PAINT_WITHOUT_WALL_SOURCE,
        reason: "paint_coatings cannot be accepted without an exterior_walls_siding source in the same session",
        http_status: 422,
      };
    }
  }

  // PlanPath presence required before marking a trade ready.
  if (!ctx.has_plan_paths_for_trade) {
    return {
      ok: false,
      flag_code: REVIEW_FLAG_CODES.MISSING_PLAN_PATH,
      reason: "no measurement objects with PlanPath provenance exist for this trade in the session",
      http_status: 422,
    };
  }

  return { ok: true, review_state: "pending_review" };
}
