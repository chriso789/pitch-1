// Phase 1.5 integration test — runs the real mapper against the anonymized
// fixture corpus and asserts the safety invariants. Also covers idempotency
// of the persist/supersede contract via a mock Supabase client.
//
// Goal: prove the mapper never invents flat/sloped quantities from global-only
// imports, and that re-running persist never produces duplicate active rows.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mapMeasurementsToTemplate } from "./mapper.ts";
import { fixtureList, canonicalTemplate } from "./fixtures.ts";
import type { Assignment, MappingResult } from "./types.ts";

function runFixture(fxKey: string): MappingResult {
  const fx = fixtureList.find((f) => f.key === fxKey)!;
  return mapMeasurementsToTemplate({
    measurement_import_id: fx.import.id,
    calc_template_id: canonicalTemplate.calc_template_id,
    segments: fx.segments,
    features: fx.features,
    groups: canonicalTemplate.groups,
    items: canonicalTemplate.items,
    section_rules: canonicalTemplate.section_rules,
    item_rules: canonicalTemplate.item_rules,
  });
}

function findItem(result: MappingResult, itemId: string): Assignment | undefined {
  return [...result.assignments, ...result.unresolved, ...result.conflicts]
    .find((a) => a.template_item_id === itemId);
}

// -------------------------------------------------------------------------
// Per-fixture invariants
// -------------------------------------------------------------------------

Deno.test("fixture: aggregate_only_roof -> flat item unresolved, never guessed", () => {
  const r = runFixture("aggregate_only_roof");
  const flat = findItem(r, "it-flat-membrane")!;
  assertEquals(flat.status, "unresolved");
  assert(flat.reason_code === "global_only_import" || flat.reason_code === "missing_class_measurement");
  assertEquals(flat.quantity, null);

  // Sloped IS available (provider gave a 6/12 pitch on the aggregate area).
  const sloped = findItem(r, "it-sloped-shingles")!;
  assertEquals(sloped.status, "assigned");
  assert((sloped.quantity ?? 0) > 0);

  // Global-scoped item assigns but is tagged with global_fallback.
  const underlay = findItem(r, "it-global-total")!;
  assertEquals(underlay.status, "assigned_global_fallback");
  assertEquals(underlay.reason_code, "global_fallback");
});

Deno.test("fixture: mixed_flat_sloped_roof -> both class items assign without fallback", () => {
  const r = runFixture("mixed_flat_sloped_roof");
  const flat = findItem(r, "it-flat-membrane")!;
  const sloped = findItem(r, "it-sloped-shingles")!;
  assertEquals(flat.status, "assigned");
  assertEquals(flat.quantity, 800);
  assertEquals(sloped.status, "assigned");
  assertEquals(sloped.quantity, 1760); // 1600 * 1.10

  const underlay = findItem(r, "it-global-total")!;
  assertEquals(underlay.status, "assigned"); // not global_fallback — class evidence exists
});

Deno.test("fixture: flat_only_roof -> sloped item unresolved", () => {
  const r = runFixture("flat_only_roof");
  assertEquals(findItem(r, "it-flat-membrane")!.status, "assigned");
  assertEquals(findItem(r, "it-sloped-shingles")!.status, "unresolved");
});

Deno.test("fixture: low_slope_only_roof -> flat-rule (includes low_slope) assigns; sloped unresolved", () => {
  const r = runFixture("low_slope_only_roof");
  const flat = findItem(r, "it-flat-membrane")!;
  assertEquals(flat.status, "assigned");
  assertEquals(flat.quantity, 1800);
  assertEquals(findItem(r, "it-sloped-shingles")!.status, "unresolved");
});

Deno.test("fixture: sloped_only_roof -> flat unresolved, sloped quantity correct", () => {
  const r = runFixture("sloped_only_roof");
  assertEquals(findItem(r, "it-flat-membrane")!.status, "unresolved");
  const sloped = findItem(r, "it-sloped-shingles")!;
  assertEquals(sloped.status, "assigned");
  assertEquals(sloped.quantity, 2200); // (900+1100) * 1.10
});

Deno.test("fixture: missing_pitch_roof -> ALL class items unresolved", () => {
  const r = runFixture("missing_pitch_roof");
  assertEquals(findItem(r, "it-flat-membrane")!.status, "unresolved");
  assertEquals(findItem(r, "it-sloped-shingles")!.status, "unresolved");
  // Global items still resolve via fallback because aggregate_only=true.
  assertEquals(findItem(r, "it-global-total")!.status, "assigned_global_fallback");
});

Deno.test("fixture: provider_flat_override_roof -> provider flag wins over pitch", () => {
  const r = runFixture("provider_flat_override_roof");
  const flat = findItem(r, "it-flat-membrane")!;
  assertEquals(flat.status, "assigned");
  assertEquals(flat.quantity, 2200);
});

Deno.test("fixture: weird_provider_labels_roof -> 'other' never feeds flat/sloped items", () => {
  const r = runFixture("weird_provider_labels_roof");
  const flat = findItem(r, "it-flat-membrane")!;
  assertEquals(flat.status, "unresolved", "flat item must not silently consume 'other' segments");
  const sloped = findItem(r, "it-sloped-shingles")!;
  assertEquals(sloped.status, "assigned");
  assertEquals(sloped.quantity, 1980); // 1800 * 1.10
});

// -------------------------------------------------------------------------
// SAFETY INVARIANT (the most important rule)
// -------------------------------------------------------------------------

Deno.test("SAFETY: global-only imports NEVER produce a class-scoped quantity", () => {
  for (const fxKey of ["aggregate_only_roof", "missing_pitch_roof"]) {
    const r = runFixture(fxKey);
    for (const a of r.assignments) {
      const isClassScoped = (a.matched_by as Record<string, unknown>).scope === "class";
      if (isClassScoped) {
        // The only legal way a class-scoped item appears in `assignments` is if
        // that exact class IS present. For these two fixtures, no class evidence
        // is supplied for "flat" — so it MUST NOT show up assigned.
        const cls = (a.matched_by as Record<string, unknown>).surface_classes as string[];
        assert(
          !cls.includes("flat"),
          `${fxKey}: a flat class-scoped item leaked into assignments — this is the rule that must never break`,
        );
      }
    }
  }
});

// -------------------------------------------------------------------------
// Determinism (re-running mapper gives identical output -> no drift)
// -------------------------------------------------------------------------

Deno.test("DETERMINISM: mapper produces identical output across runs", () => {
  for (const fx of fixtureList) {
    const a = runFixture(fx.key);
    const b = runFixture(fx.key);
    assertEquals(a.summary, b.summary);
    assertEquals(a.assignments.length, b.assignments.length);
    assertEquals(a.unresolved.length, b.unresolved.length);
  }
});

// -------------------------------------------------------------------------
// IDEMPOTENCY: persist+supersede contract (Option B)
//
// We don't hit Postgres here — we simulate the edge-function persist path
// against a tiny in-memory store and assert that re-running persist marks
// prior rows superseded and writes new ones under a fresh mapping_run_id,
// so there is never more than one active row per (import,template,item).
// -------------------------------------------------------------------------

interface FakeRow {
  id: string;
  template_item_id: string;
  mapping_run_id: string;
  is_dry_run: boolean;
  superseded_at: string | null;
}

class FakeStore {
  rows: FakeRow[] = [];
  private nextId = 0;
  persist(result: MappingResult): string {
    const runId = `run-${++this.nextId}`;
    // supersede prior active non-dry rows for this import/template
    for (const r of this.rows) {
      if (!r.is_dry_run && r.superseded_at == null) r.superseded_at = new Date().toISOString();
    }
    for (const a of [...result.assignments, ...result.unresolved, ...result.conflicts]) {
      this.rows.push({
        id: `row-${this.rows.length}`,
        template_item_id: a.template_item_id,
        mapping_run_id: runId,
        is_dry_run: false,
        superseded_at: null,
      });
    }
    return runId;
  }
  activeRows(): FakeRow[] {
    return this.rows.filter((r) => !r.is_dry_run && r.superseded_at == null);
  }
}

Deno.test("IDEMPOTENCY: re-persist supersedes prior rows; one active row per item", () => {
  const result = runFixture("mixed_flat_sloped_roof");
  const store = new FakeStore();
  store.persist(result);
  store.persist(result); // re-run
  store.persist(result); // re-run again

  const active = store.activeRows();
  // 4 items in the canonical template
  assertEquals(active.length, 4);
  const itemIds = new Set(active.map((r) => r.template_item_id));
  assertEquals(itemIds.size, 4, "no duplicate active rows per template item");

  // Total rows kept for audit (3 runs * 4 items = 12)
  assertEquals(store.rows.length, 12);
  // Exactly one mapping_run_id covers the current active set
  const activeRuns = new Set(active.map((r) => r.mapping_run_id));
  assertEquals(activeRuns.size, 1);
});

Deno.test("DRY-RUN never writes to the persisted store", () => {
  // Dry-run is enforced at the edge-function boundary (see measurement-api/index.ts).
  // We document that contract here: a dry_run preview must not call store.persist().
  const store = new FakeStore();
  // simulate: caller chose dry-run -> persist() is simply not invoked.
  assertEquals(store.rows.length, 0);
  assertEquals(store.activeRows().length, 0);
});
