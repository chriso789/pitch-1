// ============================================================
// update-scope-compare-review — action→patch derivation tests
// Mirrors the pure switch in the edge function. No DB, no auth.
// ============================================================
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

type Action =
  | "include" | "exclude" | "mark_reviewed" | "mark_unreviewed"
  | "add_note" | "override_match" | "clear_override";

interface Body {
  action: Action;
  reviewer_note?: string;
  carrier_line_item_id?: string;
  contractor_line_item_id?: string;
}

// Same logic as supabase/functions/update-scope-compare-review/index.ts
function deriveReviewPatch(body: Body): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  switch (body.action) {
    case "include": patch.included_in_supplement = true; break;
    case "exclude": patch.included_in_supplement = false; break;
    case "mark_reviewed": patch.reviewer_status = "reviewed"; break;
    case "mark_unreviewed": patch.reviewer_status = "unreviewed"; break;
    case "add_note": patch.reviewer_note = body.reviewer_note ?? null; break;
    case "override_match":
      if (body.carrier_line_item_id) patch.carrier_line_item_id = body.carrier_line_item_id;
      if (body.contractor_line_item_id) patch.contractor_line_item_id = body.contractor_line_item_id;
      patch.reviewer_status = "reviewed";
      break;
    case "clear_override": break;
  }
  return patch;
}

Deno.test("include sets included_in_supplement=true", () => {
  assertEquals(deriveReviewPatch({ action: "include" }).included_in_supplement, true);
});

Deno.test("exclude sets included_in_supplement=false", () => {
  assertEquals(deriveReviewPatch({ action: "exclude" }).included_in_supplement, false);
});

Deno.test("mark_reviewed sets reviewer_status=reviewed", () => {
  assertEquals(deriveReviewPatch({ action: "mark_reviewed" }).reviewer_status, "reviewed");
});

Deno.test("mark_unreviewed sets reviewer_status=unreviewed", () => {
  assertEquals(deriveReviewPatch({ action: "mark_unreviewed" }).reviewer_status, "unreviewed");
});

Deno.test("add_note stores reviewer_note text", () => {
  const p = deriveReviewPatch({ action: "add_note", reviewer_note: "needs adjuster review" });
  assertEquals(p.reviewer_note, "needs adjuster review");
});

Deno.test("add_note with no body stores null", () => {
  assertEquals(deriveReviewPatch({ action: "add_note" }).reviewer_note, null);
});

Deno.test("override_match patches line ids and marks reviewed", () => {
  const p = deriveReviewPatch({
    action: "override_match",
    carrier_line_item_id: "c-1",
    contractor_line_item_id: "k-1",
  });
  assertEquals(p.carrier_line_item_id, "c-1");
  assertEquals(p.contractor_line_item_id, "k-1");
  assertEquals(p.reviewer_status, "reviewed");
});

Deno.test("clear_override produces empty patch (side-effect handles deletion)", () => {
  assertEquals(Object.keys(deriveReviewPatch({ action: "clear_override" })).length, 0);
});

Deno.test("ALLOWED action list is exhaustive", () => {
  const ALLOWED: Action[] = [
    "include","exclude","mark_reviewed","mark_unreviewed","add_note","override_match","clear_override",
  ];
  for (const a of ALLOWED) {
    // Should not throw
    deriveReviewPatch({ action: a });
  }
  assert(ALLOWED.length === 7);
});
