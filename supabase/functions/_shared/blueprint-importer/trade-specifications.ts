import type { TradeId } from "./trade-catalog.ts";

export type TradeSpecificationReviewState = "pending_review" | "confirmed" | "dismissed" | "blocked";

export interface BlueprintTradeSpecification {
  id?: string;
  import_session_id: string;
  source_document_id?: string | null;
  trade_id: TradeId;
  spec_key: string;
  category: string;
  value_text?: string | null;
  normalized_value?: Record<string, unknown>;
  confidence: number;
  plan_path_id?: string | null;
  page_number?: number | null;
  review_state?: TradeSpecificationReviewState;
  metadata?: Record<string, unknown>;
}
