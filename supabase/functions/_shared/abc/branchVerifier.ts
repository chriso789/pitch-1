/**
 * ABC branch verifier — single authority for whether the caller-selected
 * ABC Product API SKU may be sold from a given branch to a given Ship-To.
 *
 * See phase 1A brief (`branchVerifier`). Additive only — no handler currently
 * imports this module. Verification only: never infers branch availability,
 * never invents branch numbers, never silently passes empty branch lists,
 * never mutates catalog data.
 *
 * Rules:
 *   • Never inherit parent branches. The caller must pass the RESOLVED child.
 *   • Never assume every Ship-To may use every branch. The caller passes
 *     `accountBranches` — the flat list of branches the connected account is
 *     authorized to sell FROM for the currently selected Ship-To.
 *   • Selected branch must exist, be authorized on the account, and be listed
 *     on the exact Product API item for the child SKU.
 *   • If the Product API item exposes no branch list, verification is required.
 *   • Verifications expire (default 24h) and expired verifications block both
 *     pricing and ordering.
 *   • Case-insensitive, whitespace-trimmed matching. Preserve canonical.
 */

import type {
  NormalizedAbcBranchRef,
  ResolvedAbcChild,
} from "./types.ts";

// ---------- Public types ----------

export interface BranchVerificationContext {
  /** Branch the contractor selected in the UI (canonical wire form kept). */
  selectedBranchNumber: string;
  /** Ship-To the contractor selected. Null means no Ship-To scope. */
  selectedShipTo: string | null;
  /** Flat list of branches authorized for the connected account + Ship-To. */
  accountBranches: string[];
  /** ISO timestamp of the last successful verification for this SKU/branch. */
  verifiedAt?: string | null;
}

export type BranchVerificationReason =
  | "verified"
  | "branch_not_found"
  | "branch_not_authorized"
  | "branch_not_available"
  | "verification_required"
  | "verification_expired"
  | "missing_branch";

export interface BranchVerificationResult {
  verified: boolean;
  branchNumber: string | null;
  shipToNumber: string | null;
  reason: BranchVerificationReason;
  verifiedAt: string | null;
  expiresAt: string | null;
  warnings: string[];
}

export interface BranchVerificationOptions {
  /** Verification lifetime in milliseconds. Default 24h. */
  lifetimeMs?: number;
  /** Injectable clock for tests. */
  now?: () => Date;
}

// ---------- Constants ----------

const DEFAULT_LIFETIME_MS = 24 * 60 * 60 * 1000;

// ---------- Helpers ----------

function trim(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function upperKey(v: unknown): string {
  return trim(v).toUpperCase();
}

function parseInstant(v: unknown): Date | null {
  const s = trim(v);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function findBranchOnItem(
  branches: NormalizedAbcBranchRef[],
  wantedUpper: string,
): NormalizedAbcBranchRef | null {
  for (const b of branches) {
    if (!b || typeof b.branchNumber !== "string") continue;
    if (upperKey(b.branchNumber) === wantedUpper) return b;
  }
  return null;
}

function isAuthorized(accountBranches: string[], wantedUpper: string): boolean {
  if (!Array.isArray(accountBranches)) return false;
  for (const b of accountBranches) {
    if (upperKey(b) === wantedUpper) return true;
  }
  return false;
}

function reject(
  reason: BranchVerificationReason,
  branchNumber: string | null,
  shipToNumber: string | null,
  warnings: string[] = [],
): BranchVerificationResult {
  return {
    verified: false,
    branchNumber,
    shipToNumber,
    reason,
    verifiedAt: null,
    expiresAt: null,
    warnings,
  };
}

// ---------- Public API ----------

/**
 * Verify whether the exact resolved child SKU may be sold FROM the selected
 * branch to the selected Ship-To.
 *
 * NEVER mutates the input item. NEVER invents branch numbers. Returns a
 * verification result the caller can persist alongside the pricing/order
 * decision.
 */
export function verifyBranchEligibility(
  item: ResolvedAbcChild,
  ctx: BranchVerificationContext,
  options: BranchVerificationOptions = {},
): BranchVerificationResult {
  const warnings: string[] = [];
  const selectedRaw = trim(ctx?.selectedBranchNumber);
  const selectedUpper = upperKey(selectedRaw);
  const shipToNumber = ctx?.selectedShipTo == null ? null : trim(ctx.selectedShipTo) || null;

  // 1. Must have a selected branch.
  if (!selectedUpper) {
    return reject("missing_branch", null, shipToNumber, warnings);
  }

  // 2. Ship-To scope is required — the account branch list is scoped per Ship-To.
  if (!shipToNumber) {
    warnings.push("Selected Ship-To is missing; branch cannot be authorized without Ship-To scope.");
    return reject("branch_not_authorized", selectedRaw, null, warnings);
  }

  // 3. If Product API exposes no branch list, force explicit re-verification.
  const itemBranches = Array.isArray(item?.branches) ? item.branches : [];
  const requiresVerification = !!item?.branchVerificationRequired || itemBranches.length === 0;
  if (requiresVerification && itemBranches.length === 0) {
    return reject("verification_required", selectedRaw, shipToNumber, warnings);
  }

  // 4. Branch must be authorized on the account for THIS Ship-To. Never inherit.
  if (!isAuthorized(ctx.accountBranches ?? [], selectedUpper)) {
    return reject("branch_not_authorized", selectedRaw, shipToNumber, warnings);
  }

  // 5. Branch must exist on the exact Product API item — never inherit from parent.
  const match = findBranchOnItem(itemBranches, selectedUpper);
  if (!match) {
    return reject("branch_not_found", selectedRaw, shipToNumber, warnings);
  }

  // 6. If Product API tells us the branch has zero stock, block ordering.
  //    (null/undefined means "unknown" — do not block on missing data.)
  if (typeof match.available === "number" && match.available <= 0) {
    return reject("branch_not_available", match.branchNumber, shipToNumber, warnings);
  }

  // 7. Item flagged as needing explicit verification even though branch is listed.
  if (item.branchVerificationRequired) {
    // If caller hasn't yet stamped a verifiedAt, force re-verification.
    if (!parseInstant(ctx.verifiedAt)) {
      return reject("verification_required", match.branchNumber, shipToNumber, warnings);
    }
  }

  // 8. Verification freshness.
  const verifiedAt = parseInstant(ctx.verifiedAt);
  const lifetimeMs = options.lifetimeMs ?? DEFAULT_LIFETIME_MS;
  const now = (options.now ?? (() => new Date()))();
  if (verifiedAt) {
    const expiresAt = new Date(verifiedAt.getTime() + lifetimeMs);
    if (now.getTime() > expiresAt.getTime()) {
      return {
        verified: false,
        branchNumber: match.branchNumber,
        shipToNumber,
        reason: "verification_expired",
        verifiedAt: verifiedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        warnings,
      };
    }
    return {
      verified: true,
      branchNumber: match.branchNumber,
      shipToNumber,
      reason: "verified",
      verifiedAt: verifiedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      warnings,
    };
  }

  // 9. No verifiedAt yet — caller has all evidence in hand; stamp `now`.
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + lifetimeMs).toISOString();
  return {
    verified: true,
    branchNumber: match.branchNumber,
    shipToNumber,
    reason: "verified",
    verifiedAt: nowIso,
    expiresAt,
    warnings,
  };
}

/**
 * Cheap helper for callers that only need to know whether an existing
 * verification timestamp is still fresh. Does NOT re-check branch eligibility.
 */
export function branchVerificationExpired(
  verifiedAt: string,
  options: BranchVerificationOptions = {},
): boolean {
  const parsed = parseInstant(verifiedAt);
  if (!parsed) return true;
  const lifetimeMs = options.lifetimeMs ?? DEFAULT_LIFETIME_MS;
  const now = (options.now ?? (() => new Date()))();
  return now.getTime() > parsed.getTime() + lifetimeMs;
}
