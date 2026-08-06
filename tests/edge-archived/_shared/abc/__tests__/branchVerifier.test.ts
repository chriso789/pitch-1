/**
 * Unit tests for supabase/functions/_shared/abc/branchVerifier.ts
 *
 * Runs under `deno test`. Pure module contract tests — no handler integration.
 */

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  branchVerificationExpired,
  type BranchVerificationContext,
  verifyBranchEligibility,
} from "../branchVerifier.ts";
import type { NormalizedAbcBranchRef, ResolvedAbcChild } from "../types.ts";

// Minimal ResolvedAbcChild shell — verifier only reads branches + branchVerificationRequired.
function child(
  branches: unknown,
  opts: { branchVerificationRequired?: boolean } = {},
): ResolvedAbcChild {
  return {
    itemNumber: "SHNGL-WW",
    itemDescription: "Weathered Wood Shingle",
    familyId: null,
    familyName: null,
    manufacturer: null,
    parentItemNumber: null,
    color: { displayName: null, rawName: null, code: null, aliasOf: null },
    validUoms: [],
    branches: branches as NormalizedAbcBranchRef[],
    branchVerificationRequired: !!opts.branchVerificationRequired,
    status: null,
    isActive: true,
    isOrderable: true,
    orderabilityReasons: [],
    source: null as unknown as ResolvedAbcChild["source"],
  } as unknown as ResolvedAbcChild;
}

function ctx(overrides: Partial<BranchVerificationContext> = {}): BranchVerificationContext {
  return {
    selectedBranchNumber: "042",
    selectedShipTo: "SHIP-1001",
    accountBranches: ["042", "051"],
    verifiedAt: null,
    ...overrides,
  };
}

async function loadFixture(name: string) {
  const url = new URL(`./fixtures/branches/${name}.json`, import.meta.url);
  const text = await Deno.readTextFile(url);
  return JSON.parse(text);
}

// ---------- Fixture-backed cases ----------

Deno.test("branch exists on item and is authorized → verified", async () => {
  const fx = await loadFixture("item-two-branches");
  const r = verifyBranchEligibility(child(fx.branches), ctx({ selectedBranchNumber: "042" }));
  assert(r.verified);
  assertEquals(r.reason, "verified");
  assertEquals(r.branchNumber, "042");
  assertEquals(r.shipToNumber, "SHIP-1001");
  assert(r.verifiedAt !== null);
  assert(r.expiresAt !== null);
});

Deno.test("branch not on item → branch_not_found", async () => {
  const fx = await loadFixture("item-two-branches");
  const r = verifyBranchEligibility(
    child(fx.branches),
    ctx({ selectedBranchNumber: "999", accountBranches: ["042", "051", "999"] }),
  );
  assertFalse(r.verified);
  assertEquals(r.reason, "branch_not_found");
  assertEquals(r.branchNumber, "999");
});

Deno.test("branch not on account → branch_not_authorized (never inherit)", async () => {
  const fx = await loadFixture("item-two-branches");
  const r = verifyBranchEligibility(
    child(fx.branches),
    ctx({ selectedBranchNumber: "051", accountBranches: ["042"] }),
  );
  assertFalse(r.verified);
  assertEquals(r.reason, "branch_not_authorized");
});

Deno.test("Product API returned no branches → verification_required", async () => {
  const fx = await loadFixture("item-no-branches");
  const r = verifyBranchEligibility(
    child(fx.branches, { branchVerificationRequired: true }),
    ctx(),
  );
  assertFalse(r.verified);
  assertEquals(r.reason, "verification_required");
});

Deno.test("branch listed with available=0 → branch_not_available", async () => {
  const fx = await loadFixture("item-zero-available");
  const r = verifyBranchEligibility(child(fx.branches), ctx());
  assertFalse(r.verified);
  assertEquals(r.reason, "branch_not_available");
  assertEquals(r.branchNumber, "042");
});

Deno.test("duplicate branches on item still match once", async () => {
  const fx = await loadFixture("item-duplicate-branches");
  const r = verifyBranchEligibility(child(fx.branches), ctx());
  assert(r.verified);
  assertEquals(r.branchNumber, "042");
});

Deno.test("mixed case / whitespace matches but preserves canonical wire form", async () => {
  const fx = await loadFixture("item-mixed-case");
  const r = verifyBranchEligibility(
    child(fx.branches),
    ctx({ selectedBranchNumber: "  042  ", accountBranches: ["042"] }),
  );
  assert(r.verified);
  // Canonical form preserved as returned by ABC (" 042 " on the fixture).
  assertEquals(r.branchNumber, " 042 ");
});

// ---------- Inline behavior cases ----------

Deno.test("missing selected branch → missing_branch", () => {
  const r = verifyBranchEligibility(
    child([{ branchNumber: "042", available: 5 }]),
    ctx({ selectedBranchNumber: "" }),
  );
  assertFalse(r.verified);
  assertEquals(r.reason, "missing_branch");
  assertEquals(r.branchNumber, null);
});

Deno.test("empty branch list on item → verification_required", () => {
  const r = verifyBranchEligibility(
    child([]),
    ctx(),
  );
  assertFalse(r.verified);
  assertEquals(r.reason, "verification_required");
});

Deno.test("parent branches are ignored — verifier only reads the resolved child", () => {
  // Simulate a parent leaking through: item.branches is empty but the caller
  // passes accountBranches. Verifier MUST still fail (never inherit).
  const r = verifyBranchEligibility(child([]), ctx({ accountBranches: ["042", "051"] }));
  assertFalse(r.verified);
  assertEquals(r.reason, "verification_required");
});

Deno.test("ship-to missing → branch_not_authorized with warning", () => {
  const r = verifyBranchEligibility(
    child([{ branchNumber: "042", available: 5 }]),
    ctx({ selectedShipTo: null }),
  );
  assertFalse(r.verified);
  assertEquals(r.reason, "branch_not_authorized");
  assert(r.warnings.some((w) => w.includes("Ship-To")));
});

Deno.test("verification fresh within lifetime → verified with echoed timestamps", () => {
  const now = new Date("2026-01-02T12:00:00.000Z");
  const verifiedAt = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
  const r = verifyBranchEligibility(
    child([{ branchNumber: "042", available: 5 }]),
    ctx({ verifiedAt }),
    { now: () => now },
  );
  assert(r.verified);
  assertEquals(r.reason, "verified");
  assertEquals(r.verifiedAt, verifiedAt);
  assertEquals(r.expiresAt, new Date(new Date(verifiedAt).getTime() + 24 * 60 * 60 * 1000).toISOString());
});

Deno.test("verification older than lifetime → verification_expired", () => {
  const now = new Date("2026-01-02T12:00:00.000Z");
  const verifiedAt = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();
  const r = verifyBranchEligibility(
    child([{ branchNumber: "042", available: 5 }]),
    ctx({ verifiedAt }),
    { now: () => now },
  );
  assertFalse(r.verified);
  assertEquals(r.reason, "verification_expired");
  assertEquals(r.verifiedAt, verifiedAt);
});

Deno.test("configurable lifetime honored", () => {
  const now = new Date("2026-01-02T12:00:00.000Z");
  const verifiedAt = new Date(now.getTime() - 30 * 60 * 1000).toISOString(); // 30 min ago
  const r = verifyBranchEligibility(
    child([{ branchNumber: "042", available: 5 }]),
    ctx({ verifiedAt }),
    { now: () => now, lifetimeMs: 15 * 60 * 1000 }, // 15 min lifetime
  );
  assertFalse(r.verified);
  assertEquals(r.reason, "verification_expired");
});

Deno.test("branchVerificationRequired forces stamp even when branch is present", () => {
  const r = verifyBranchEligibility(
    child([{ branchNumber: "042", available: 5 }], { branchVerificationRequired: true }),
    ctx({ verifiedAt: null }),
  );
  assertFalse(r.verified);
  assertEquals(r.reason, "verification_required");
});

Deno.test("branchVerificationRequired + fresh verifiedAt → verified", () => {
  const now = new Date("2026-01-02T12:00:00.000Z");
  const r = verifyBranchEligibility(
    child([{ branchNumber: "042", available: 5 }], { branchVerificationRequired: true }),
    ctx({ verifiedAt: now.toISOString() }),
    { now: () => now },
  );
  assert(r.verified);
  assertEquals(r.reason, "verified");
});

Deno.test("multiple branches on item — only selected is verified", () => {
  const r = verifyBranchEligibility(
    child([
      { branchNumber: "042", available: 10 },
      { branchNumber: "051", available: 20 },
      { branchNumber: "063", available: 30 },
    ]),
    ctx({ selectedBranchNumber: "051", accountBranches: ["042", "051", "063"] }),
  );
  assert(r.verified);
  assertEquals(r.branchNumber, "051");
});

Deno.test("available=null (unknown) does NOT block — verifier only rejects on explicit 0", () => {
  const r = verifyBranchEligibility(
    child([{ branchNumber: "042", available: null }]),
    ctx(),
  );
  assert(r.verified);
  assertEquals(r.reason, "verified");
});

Deno.test("branchVerificationExpired returns true for garbage / missing timestamps", () => {
  assert(branchVerificationExpired(""));
  assert(branchVerificationExpired("not-a-date"));
});

Deno.test("branchVerificationExpired returns false when fresh, true when past lifetime", () => {
  const now = new Date("2026-01-02T12:00:00.000Z");
  const fresh = new Date(now.getTime() - 60 * 1000).toISOString();
  const stale = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
  assertFalse(branchVerificationExpired(fresh, { now: () => now }));
  assert(branchVerificationExpired(stale, { now: () => now }));
});
