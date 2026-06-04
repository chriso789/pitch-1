// Phase 6 — handoff preview builder tests. Pure functions, no DB.
import { describe, it, expect } from "vitest";
import {
  buildHandoffPreview,
  buildHandoffBatchKey,
  type Phase6DraftRow,
  type Phase6AcceptedTrade,
} from "../../supabase/functions/_shared/blueprint-importer/phase6-preview.ts";
import {
  createDeterministicHandoffKey,
  CANONICAL_ESTIMATE_TARGET,
} from "../../supabase/functions/_shared/blueprint-importer/crm-handoff.ts";

const T = "11111111-1111-1111-1111-111111111111";
const S = "22222222-2222-2222-2222-222222222222";
const B = "33333333-3333-3333-3333-333333333333";

function accepted(id: string, trade_id: string): Phase6AcceptedTrade {
  return { id, trade_id, user_assumptions: { waste_percent: 12 } };
}

function matDraft(id: string, acceptedId: string, overrides: Partial<Phase6DraftRow> = {}): Phase6DraftRow {
  return {
    id,
    accepted_trade_id: acceptedId,
    template_binding_id: "tb-1",
    item_key: "shingles",
    item_name: "Architectural shingles",
    quantity: 96,
    unit: "bundle",
    source_measurement_ids: ["m1"],
    plan_path_ids: ["pp1"],
    formula_key: "area_with_waste",
    formula_inputs: { area_sqft: 2842, waste_percent: 12 },
    catalog_resolution_status: "unresolved",
    status: "ready",
    ...overrides,
  };
}

const baseInput = {
  tenant_id: T,
  import_session_id: S,
  handoff_batch_id: B,
  template_bindings: [{ id: "tb-1", accepted_trade_id: "acc-roof", template_version: "mvp.roofing.v1", user_assumptions: { waste_percent: 12 } }],
  plan_paths: [{ id: "pp1", source_document_id: "doc1" }],
  review_flags: [],
  draft_mode: "both" as const,
  catalog_mode: "preview_only" as const,
  custom_line_mode: "disabled" as const,
  pricing_mode: "quantity_only" as const,
  paint_source_present: true,
};

describe("Phase 6 — canonical target + batch key", () => {
  it("canonical target is enhanced_estimates only", () => {
    expect(CANONICAL_ESTIMATE_TARGET).toBe("enhanced_estimates");
  });

  it("batch key is deterministic and stable", async () => {
    const a = await buildHandoffBatchKey({
      tenant_id: T, import_session_id: S, target_context_type: "standalone",
      pricing_mode: "quantity_only", catalog_mode: "preview_only", custom_line_mode: "disabled",
    });
    const b = await buildHandoffBatchKey({
      tenant_id: T, import_session_id: S, target_context_type: "standalone",
      pricing_mode: "quantity_only", catalog_mode: "preview_only", custom_line_mode: "disabled",
    });
    expect(a).toEqual(b);
    expect(a).toHaveLength(64);
  });
});

describe("Phase 6 — candidate generation", () => {
  it("turns material drafts into candidates with provenance + deterministic key", async () => {
    const result = await buildHandoffPreview({
      ...baseInput,
      accepted_trades: [accepted("acc-roof", "roofing")],
      material_drafts: [matDraft("md-1", "acc-roof")],
      labor_drafts: [],
    });
    expect(result.candidates).toHaveLength(1);
    const c = result.candidates[0];
    expect(c.source_measurement_ids.length).toBeGreaterThan(0);
    expect(c.plan_path_ids.length).toBeGreaterThan(0);
    expect(c.source_document_ids).toEqual(["doc1"]);
    expect(c.deterministic_handoff_key).toHaveLength(64);
    expect(c.source_draft_line_type).toBe("material");
    expect(c.tenant_id).toBe(T);
  });

  it("catalog unresolved blocks handoff but keeps candidate visible", async () => {
    const result = await buildHandoffPreview({
      ...baseInput,
      accepted_trades: [accepted("acc-roof", "roofing")],
      material_drafts: [matDraft("md-1", "acc-roof", { catalog_resolution_status: "unresolved" })],
      labor_drafts: [],
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].handoff_allowed).toBe(false);
    expect(result.candidates[0].handoff_blockers).toContain("CATALOG_UNRESOLVED_LIVE_HANDOFF");
    expect(result.batch_status).toBe("user_review_required");
  });

  it("matched catalog with all gates green => handoff_allowed", async () => {
    const result = await buildHandoffPreview({
      ...baseInput,
      accepted_trades: [accepted("acc-roof", "roofing")],
      material_drafts: [matDraft("md-1", "acc-roof", { catalog_resolution_status: "matched", catalog_item_id: "cat-1" })],
      labor_drafts: [],
      catalog_mode: "catalog_resolved_only",
    });
    expect(result.candidates[0].handoff_allowed).toBe(true);
    expect(result.candidates[0].handoff_blockers).toEqual([]);
    expect(result.batch_status).toBe("preview_created");
    expect(result.candidates_handoff_allowed).toBe(1);
  });

  it("windows_doors is skipped (never becomes a standalone candidate)", async () => {
    const result = await buildHandoffPreview({
      ...baseInput,
      accepted_trades: [accepted("acc-wd", "windows_doors")],
      material_drafts: [matDraft("md-wd", "acc-wd")],
      labor_drafts: [],
    });
    expect(result.candidates).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reasons).toContain("WINDOWS_DOORS_STANDALONE_TRADE");
  });

  it("future-supported trade is skipped", async () => {
    const result = await buildHandoffPreview({
      ...baseInput,
      accepted_trades: [accepted("acc-fr", "framing")],
      material_drafts: [matDraft("md-fr", "acc-fr")],
      labor_drafts: [],
    });
    expect(result.candidates).toHaveLength(0);
    expect(result.skipped[0].reasons).toContain("FUTURE_SUPPORTED_TRADE");
  });

  it("missing plan_path_ids or source_measurement_ids skips draft", async () => {
    const result = await buildHandoffPreview({
      ...baseInput,
      accepted_trades: [accepted("acc-roof", "roofing")],
      material_drafts: [
        matDraft("md-a", "acc-roof", { plan_path_ids: [] }),
        matDraft("md-b", "acc-roof", { source_measurement_ids: [] }),
      ],
      labor_drafts: [],
    });
    expect(result.candidates).toHaveLength(0);
    expect(result.skipped).toHaveLength(2);
  });

  it("superseded drafts are ignored", async () => {
    const result = await buildHandoffPreview({
      ...baseInput,
      accepted_trades: [accepted("acc-roof", "roofing")],
      material_drafts: [matDraft("md-1", "acc-roof", { status: "superseded" })],
      labor_drafts: [],
    });
    expect(result.candidates).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it("paint without wall source blocks", async () => {
    const result = await buildHandoffPreview({
      ...baseInput,
      paint_source_present: false,
      accepted_trades: [accepted("acc-paint", "paint_coatings")],
      material_drafts: [matDraft("md-p", "acc-paint", { catalog_resolution_status: "matched" })],
      labor_drafts: [],
      catalog_mode: "catalog_resolved_only",
    });
    expect(result.candidates[0].handoff_blockers).toContain("PAINT_WITHOUT_SIDING_SOURCE");
    expect(result.candidates[0].handoff_allowed).toBe(false);
  });

  it("blocking review flag on draft propagates", async () => {
    const result = await buildHandoffPreview({
      ...baseInput,
      accepted_trades: [accepted("acc-roof", "roofing")],
      material_drafts: [matDraft("md-1", "acc-roof", { catalog_resolution_status: "matched" })],
      labor_drafts: [],
      catalog_mode: "catalog_resolved_only",
      review_flags: [{
        id: "f1", flag_code: "formula_input_missing", severity: "blocker", blocking: true, resolved: false,
        related_entity_type: "material_draft_line", related_entity_id: "md-1",
      }],
    });
    expect(result.candidates[0].handoff_allowed).toBe(false);
    expect(result.candidates[0].blocking_review_flag_ids).toContain("f1");
  });

  it("warning flag propagates without blocking", async () => {
    const result = await buildHandoffPreview({
      ...baseInput,
      accepted_trades: [accepted("acc-roof", "roofing")],
      material_drafts: [matDraft("md-1", "acc-roof", { catalog_resolution_status: "matched" })],
      labor_drafts: [],
      catalog_mode: "catalog_resolved_only",
      review_flags: [{
        id: "w1", flag_code: "roof_penetration_field_verification_required", severity: "warning", blocking: false, resolved: false,
        related_entity_type: "material_draft_line", related_entity_id: "md-1",
      }],
    });
    expect(result.candidates[0].handoff_allowed).toBe(true);
    expect(result.candidates[0].warning_review_flag_ids).toContain("w1");
    expect((result.candidates[0].metadata as any).warning_codes).toContain("ROOF_PENETRATION_FIELD_VERIFY");
  });

  it("labor drafts produce labor candidates with labor_rate_missing pricing", async () => {
    const labor: Phase6DraftRow = {
      id: "lab-1", accepted_trade_id: "acc-roof", template_binding_id: "tb-1",
      item_key: "install_shingles", item_name: "Install shingles",
      quantity: 28.4, unit: "sq",
      source_measurement_ids: ["m1"], plan_path_ids: ["pp1"],
      formula_key: "squares_from_sqft", status: "ready",
    };
    const result = await buildHandoffPreview({
      ...baseInput,
      accepted_trades: [accepted("acc-roof", "roofing")],
      material_drafts: [], labor_drafts: [labor],
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].source_draft_line_type).toBe("labor");
    expect(result.candidates[0].pricing_status).toBe("labor_rate_missing");
  });

  it("idempotency: same inputs produce same deterministic_handoff_key", async () => {
    const inputs = {
      tenant_id: T, import_session_id: S, accepted_trade_id: "acc-roof",
      template_binding_id: "tb-1", source_draft_line_id: "md-1",
      source_draft_line_type: "material" as const, formula_key: "area_with_waste",
      quantity: 96, unit: "bundle",
      source_measurement_ids: ["m1"], plan_path_ids: ["pp1"],
      template_version: "mvp.roofing.v1",
      user_assumptions: { waste_percent: 12 },
    };
    const a = await createDeterministicHandoffKey(inputs);
    const b = await createDeterministicHandoffKey(inputs);
    expect(a).toEqual(b);
  });

  it("allowed_accepted_trade_ids filters candidates", async () => {
    const result = await buildHandoffPreview({
      ...baseInput,
      accepted_trades: [accepted("acc-roof", "roofing"), accepted("acc-w", "exterior_walls_siding")],
      material_drafts: [matDraft("md-1", "acc-roof"), matDraft("md-2", "acc-w")],
      labor_drafts: [],
      template_bindings: [
        { id: "tb-1", accepted_trade_id: "acc-roof" },
        { id: "tb-2", accepted_trade_id: "acc-w" },
      ],
      allowed_accepted_trade_ids: ["acc-roof"],
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].accepted_trade_id).toBe("acc-roof");
  });

  it("batch status: empty preview is preview_created", async () => {
    const result = await buildHandoffPreview({
      ...baseInput,
      accepted_trades: [],
      material_drafts: [], labor_drafts: [],
    });
    expect(result.batch_status).toBe("preview_created");
    expect(result.candidates).toHaveLength(0);
  });

  it("user_review_status defaults to pending; handoff_allowed cannot be set to approved by builder", async () => {
    const result = await buildHandoffPreview({
      ...baseInput,
      accepted_trades: [accepted("acc-roof", "roofing")],
      material_drafts: [matDraft("md-1", "acc-roof", { catalog_resolution_status: "matched" })],
      labor_drafts: [],
      catalog_mode: "catalog_resolved_only",
    });
    expect(result.candidates[0].user_review_status).toBe("pending");
  });
});
