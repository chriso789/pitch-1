// Blueprint Importer v2 — Phase 7.8 provenance-bridge transaction harness.
//
// PURE orchestrator. Does NOT execute live writes against production tables.
// Instead, accepts a transaction context (`tx`) abstraction so a rollback-only
// test harness can simulate the exact future Phase 8 behavior:
//
//   - estimate_line_items insert and blueprint_estimate_line_provenance insert
//     happen in ONE transaction.
//   - Either side failing rolls back BOTH.
//   - Exactly one bridge row per live line.
//   - No bridge row is created for preview-only candidates.
//   - deterministic_handoff_key uniqueness per tenant is enforced by the
//     underlying unique index `bp_line_prov_unique_key`.
//
// All real DB calls are abstracted through the `TransactionContext` interface
// so this module can be unit-tested with mocks. The implementation here is
// intentionally PURE — calling it with production transaction objects is the
// responsibility of Phase 8.

import type { WriteMappingPayload } from "./phase7_8-write-mapping.ts";

export const PHASE_7_8_BRIDGE_VERSION = "v2.0-provenance-bridge-phase-7.8" as const;

export interface ProvenanceBridgeInsert {
  tenant_id: string;
  handoff_batch_id: string;
  line_candidate_id: string;
  canonical_estimate_target_table: "enhanced_estimates";
  canonical_estimate_target_id: string | null;
  live_estimate_line_item_id: string;
  deterministic_handoff_key: string;
  import_session_id: string;
  accepted_trade_id: string;
  template_binding_id: string | null;
  source_draft_line_id: string;
  source_draft_line_type: "material" | "labor";
  source_measurement_ids: string[];
  plan_path_ids: string[];
  source_document_ids: string[];
  formula_key: string | null;
  formula_inputs: Record<string, unknown>;
  approved_by: string | null;
  approved_at: string | null;
  live_written_by: string | null;
  live_written_at: string | null;
  metadata: Record<string, unknown>;
}

export interface TransactionContext {
  /** Insert a row into estimate_line_items. Must return the new row id or throw. */
  insertEstimateLineItem(payload: WriteMappingPayload): Promise<{ id: string }>;
  /** Insert a row into blueprint_estimate_line_provenance. Must throw on uniqueness/RLS errors. */
  insertProvenanceBridge(payload: ProvenanceBridgeInsert): Promise<{ id: string }>;
}

export interface BridgeOrchestrationInput {
  preview_only: boolean;
  write_payload: WriteMappingPayload | null;
  bridge_template: Omit<ProvenanceBridgeInsert, "live_estimate_line_item_id">;
}

export interface BridgeOrchestrationOutcome {
  bridge_version: typeof PHASE_7_8_BRIDGE_VERSION;
  status: "skipped_preview_only" | "committed" | "rolled_back_estimate_line" | "rolled_back_bridge";
  live_estimate_line_item_id: string | null;
  provenance_bridge_id: string | null;
  rollback_reason: string | null;
}

export async function runProvenanceBridgeTransaction(
  tx: TransactionContext,
  input: BridgeOrchestrationInput,
  /** Real prod impl wraps this in BEGIN/COMMIT/ROLLBACK; tests inject a fake txn. */
  withTransaction: <T>(fn: () => Promise<T>) => Promise<T>,
): Promise<BridgeOrchestrationOutcome> {
  // Preview-only candidates MUST NOT create any bridge row.
  if (input.preview_only || !input.write_payload) {
    return {
      bridge_version: PHASE_7_8_BRIDGE_VERSION,
      status: "skipped_preview_only",
      live_estimate_line_item_id: null,
      provenance_bridge_id: null,
      rollback_reason: null,
    };
  }

  let liveId: string | null = null;
  let bridgeId: string | null = null;
  let rollbackReason: string | null = null;
  let status: BridgeOrchestrationOutcome["status"] = "committed";

  try {
    await withTransaction(async () => {
      const line = await tx.insertEstimateLineItem(input.write_payload!);
      liveId = line.id;
      try {
        const bridge = await tx.insertProvenanceBridge({
          ...input.bridge_template,
          live_estimate_line_item_id: line.id,
        });
        bridgeId = bridge.id;
      } catch (err) {
        // Bridge failure must roll back the estimate line.
        status = "rolled_back_bridge";
        rollbackReason = (err as Error).message;
        liveId = null;
        throw err;
      }
    });
  } catch (err) {
    // estimate line failure path: liveId never set.
    if (status !== "rolled_back_bridge") {
      status = "rolled_back_estimate_line";
      rollbackReason = (err as Error).message;
    }
    return {
      bridge_version: PHASE_7_8_BRIDGE_VERSION,
      status,
      live_estimate_line_item_id: null,
      provenance_bridge_id: null,
      rollback_reason: rollbackReason,
    };
  }

  return {
    bridge_version: PHASE_7_8_BRIDGE_VERSION,
    status,
    live_estimate_line_item_id: liveId,
    provenance_bridge_id: bridgeId,
    rollback_reason: null,
  };
}
