// Authoritative supplier item-code resolution.
//
// CONTRACT (do not weaken):
//   A canonical Pitch selection — manufacturer + product line + variant
//   (profile/dimensions/packaging) + color + UOM — resolves to EXACTLY ONE
//   supplier orderable item code, scoped to a specific supplier, supplier
//   connection/account and branch.
//
//   There is NO fuzzy path here. Description similarity, color-name equality,
//   "first search result", constructed item numbers and generic substitutes are
//   all forbidden as authorization. Fuzzy scoring may only ever produce
//   *suggestions* for administrative review (see /catalog/suggest).
//
//   An ABC resolution can never satisfy an SRS line and vice versa, and a
//   mapping validated for one branch can never satisfy another branch.

export type SupplierKind = "abc" | "srs" | "qxo" | "other";

export type ResolutionFailureCode =
  | "no_mapping"
  | "ambiguous"
  | "inactive"
  | "discontinued"
  | "superseded"
  | "not_approved"
  | "uom_mismatch"
  | "branch_mismatch"
  | "connection_mismatch"
  | "color_required"
  | "variant_not_found"
  | "color_not_in_product_line"
  | "stale_validation"
  | "invalid_quantity";

/** A mapping must have been re-validated against the live catalog within this window. */
export const CATALOG_VALIDATION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

export interface ResolveLineInput {
  /** Caller-supplied stable key so the response can be zipped back to the UI rows. */
  key: string;
  variant_id: string;
  color_id?: string | null;
  uom: string;
  quantity: number;
}

export interface ResolveRequest {
  supplier: SupplierKind;
  supplier_connection_id?: string | null;
  supplier_account_number?: string | null;
  branch_code?: string | null;
  lines: ResolveLineInput[];
}

export interface ResolvedLine {
  key: string;
  ok: boolean;
  failure_code?: ResolutionFailureCode;
  failure_message?: string;

  // canonical identity (echoed back so the preview table never re-derives it)
  variant_id: string;
  color_id: string | null;
  manufacturer_id: string | null;
  manufacturer_name: string | null;
  product_line_id: string | null;
  product_line_name: string | null;
  variant_name: string | null;
  profile: string | null;
  dimensions: string | null;
  packaging: string | null;
  canonical_uom: string | null;
  color_name: string | null;
  manufacturer_color_code: string | null;
  quantity: number;
  requested_uom: string;

  // supplier resolution
  supplier: SupplierKind;
  supplier_connection_id: string | null;
  supplier_account_number: string | null;
  branch_code: string | null;
  mapping_id: string | null;
  mapping_revision: number | null;
  supplier_item_number: string | null;
  supplier_catalog_item_id: string | null;
  supplier_description: string | null;
  supplier_color_name: string | null;
  supplier_uom: string | null;
  validated_at: string | null;
  catalog_fingerprint: string | null;
  /** How the mapping was established: api | catalog_import | manual_approved. Never fuzzy. */
  mapping_source: string | null;
  /** Mapping approval state as stored (approved lines only ever resolve ok). */
  approval_state: string | null;


  /** Candidate item numbers when the failure is `ambiguous`, for manager review. */
  candidates?: Array<{ mapping_id: string; supplier_item_number: string; supplier_description: string | null }>;
}

const norm = (v: unknown) => String(v ?? "").trim();
const upper = (v: unknown) => norm(v).toUpperCase();

function fail(
  base: ResolvedLine,
  code: ResolutionFailureCode,
  message: string,
  extra: Partial<ResolvedLine> = {},
): ResolvedLine {
  return { ...base, ...extra, ok: false, failure_code: code, failure_message: message };
}

interface VariantRow {
  id: string;
  manufacturer_id: string;
  product_line_id: string;
  variant_name: string;
  profile: string | null;
  dimensions: string | null;
  packaging: string | null;
  canonical_uom: string;
  requires_color: boolean;
  is_active: boolean;
  mfr_manufacturers?: { id: string; name: string } | null;
  mfr_product_lines?: { id: string; name: string } | null;
}

interface ColorRow {
  id: string;
  product_line_id: string;
  canonical_name: string;
  manufacturer_color_code: string | null;
  is_active: boolean;
}

interface MappingRow {
  id: string;
  supplier: SupplierKind;
  supplier_connection_id: string | null;
  supplier_account_number: string | null;
  branch_code: string | null;
  variant_id: string;
  color_id: string | null;
  supplier_item_number: string;
  supplier_catalog_item_id: string | null;
  supplier_description: string | null;
  supplier_color_name: string | null;
  supplier_uom: string;
  status: string;
  approval_state: string;
  superseded_by: string | null;
  effective_from: string | null;
  effective_to: string | null;
  validated_at: string | null;
  catalog_fingerprint: string | null;
  mapping_source: string | null;

  revision: number;
}

/**
 * Resolve every line against `supplier_item_mappings`. Always returns one entry
 * per input line; callers must treat `ok === false` as blocking.
 *
 * `svc` is a service-role Supabase client. `tenantId` MUST be resolved from the
 * authenticated user by the caller — never from the request body.
 */
export async function resolveSupplierLines(
  svc: any,
  tenantId: string,
  req: ResolveRequest,
  now: Date = new Date(),
): Promise<ResolvedLine[]> {
  const supplier = req.supplier;
  const connectionId = req.supplier_connection_id ?? null;
  const accountNumber = req.supplier_account_number ?? null;
  const branchCode = req.branch_code ?? null;

  const variantIds = [...new Set(req.lines.map((l) => l.variant_id).filter(Boolean))];
  const colorIds = [...new Set(req.lines.map((l) => l.color_id).filter(Boolean) as string[])];

  const [variantsRes, colorsRes, mappingsRes] = await Promise.all([
    variantIds.length
      ? svc
          .from("mfr_product_variants")
          .select(
            "id, manufacturer_id, product_line_id, variant_name, profile, dimensions, packaging, canonical_uom, requires_color, is_active, mfr_manufacturers(id,name), mfr_product_lines(id,name)",
          )
          .eq("tenant_id", tenantId)
          .in("id", variantIds)
      : Promise.resolve({ data: [] }),
    colorIds.length
      ? svc
          .from("mfr_colors")
          .select("id, product_line_id, canonical_name, manufacturer_color_code, is_active")
          .eq("tenant_id", tenantId)
          .in("id", colorIds)
      : Promise.resolve({ data: [] }),
    variantIds.length
      ? svc
          .from("supplier_item_mappings")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("supplier", supplier)
          .in("variant_id", variantIds)
      : Promise.resolve({ data: [] }),
  ]);

  const variants = new Map<string, VariantRow>(
    ((variantsRes.data ?? []) as VariantRow[]).map((v) => [v.id, v]),
  );
  const colors = new Map<string, ColorRow>(
    ((colorsRes.data ?? []) as ColorRow[]).map((c) => [c.id, c]),
  );
  const allMappings = (mappingsRes.data ?? []) as MappingRow[];

  return req.lines.map((line) => {
    const base: ResolvedLine = {
      key: line.key,
      ok: false,
      variant_id: line.variant_id,
      color_id: line.color_id ?? null,
      manufacturer_id: null,
      manufacturer_name: null,
      product_line_id: null,
      product_line_name: null,
      variant_name: null,
      profile: null,
      dimensions: null,
      packaging: null,
      canonical_uom: null,
      color_name: null,
      manufacturer_color_code: null,
      quantity: Number(line.quantity ?? 0),
      requested_uom: upper(line.uom),
      supplier,
      supplier_connection_id: connectionId,
      supplier_account_number: accountNumber,
      branch_code: branchCode,
      mapping_id: null,
      mapping_revision: null,
      supplier_item_number: null,
      supplier_catalog_item_id: null,
      supplier_description: null,
      supplier_color_name: null,
      supplier_uom: null,
      validated_at: null,
      catalog_fingerprint: null,
      mapping_source: null,
      approval_state: null,

    };

    const variant = variants.get(line.variant_id);
    if (!variant || !variant.is_active) {
      return fail(base, "variant_not_found", "Product variant not found or inactive for this company.");
    }

    const enriched: ResolvedLine = {
      ...base,
      manufacturer_id: variant.manufacturer_id,
      manufacturer_name: variant.mfr_manufacturers?.name ?? null,
      product_line_id: variant.product_line_id,
      product_line_name: variant.mfr_product_lines?.name ?? null,
      variant_name: variant.variant_name,
      profile: variant.profile,
      dimensions: variant.dimensions,
      packaging: variant.packaging,
      canonical_uom: variant.canonical_uom,
    };

    if (!Number.isFinite(enriched.quantity) || enriched.quantity <= 0) {
      return fail(enriched, "invalid_quantity", "Quantity must be greater than zero.");
    }

    let color: ColorRow | undefined;
    if (variant.requires_color) {
      if (!line.color_id) {
        return fail(enriched, "color_required", "This product requires a color selection.");
      }
      color = colors.get(line.color_id);
      if (!color || !color.is_active) {
        return fail(enriched, "no_mapping", "Selected color not found or inactive.");
      }
      // A color name is only meaningful inside its own product line.
      if (color.product_line_id !== variant.product_line_id) {
        return fail(
          enriched,
          "color_not_in_product_line",
          "Selected color does not belong to this manufacturer's product line.",
        );
      }
      enriched.color_name = color.canonical_name;
      enriched.manufacturer_color_code = color.manufacturer_color_code;
    } else if (line.color_id) {
      color = colors.get(line.color_id);
      if (color) {
        if (color.product_line_id !== variant.product_line_id) {
          return fail(
            enriched,
            "color_not_in_product_line",
            "Selected color does not belong to this manufacturer's product line.",
          );
        }
        enriched.color_name = color.canonical_name;
        enriched.manufacturer_color_code = color.manufacturer_color_code;
      }
    }

    const wantColorId = line.color_id ?? null;
    const wantUom = upper(line.uom);

    // Exact identity match only.
    const identityMatches = allMappings.filter(
      (m) =>
        m.variant_id === variant.id &&
        (m.color_id ?? null) === wantColorId &&
        m.supplier === supplier,
    );

    if (!identityMatches.length) {
      return fail(
        enriched,
        "no_mapping",
        `No ${supplier.toUpperCase()} item is mapped for ${enriched.manufacturer_name ?? "?"} ${
          enriched.product_line_name ?? ""
        } / ${enriched.color_name ?? "no color"} / ${wantUom}.`,
      );
    }

    // Connection scope: a mapping bound to a connection can only serve that connection.
    const connectionScoped = identityMatches.filter(
      (m) => !m.supplier_connection_id || m.supplier_connection_id === connectionId,
    );
    if (!connectionScoped.length) {
      return fail(
        enriched,
        "connection_mismatch",
        "Mapping exists but is bound to a different supplier account/connection.",
      );
    }

    // Branch scope: a branch-specific mapping can only serve that branch.
    const branchScoped = connectionScoped.filter(
      (m) => !m.branch_code || norm(m.branch_code) === norm(branchCode),
    );
    if (!branchScoped.length) {
      return fail(
        enriched,
        "branch_mismatch",
        `Mapping was validated for a different branch than ${branchCode ?? "(none selected)"}.`,
      );
    }

    // UOM must be supported exactly — never defaulted.
    const uomScoped = branchScoped.filter((m) => upper(m.supplier_uom) === wantUom);
    if (!uomScoped.length) {
      return fail(
        enriched,
        "uom_mismatch",
        `Mapped ${supplier.toUpperCase()} item does not support the selected UOM (${wantUom}).`,
      );
    }

    // Effective dating.
    const nowMs = now.getTime();
    const dated = uomScoped.filter((m) => {
      const from = m.effective_from ? Date.parse(m.effective_from) : -Infinity;
      const to = m.effective_to ? Date.parse(m.effective_to) : Infinity;
      return nowMs >= from && nowMs <= to;
    });
    if (!dated.length) {
      return fail(enriched, "inactive", "Mapping is outside its effective date range.");
    }

    const approved = dated.filter((m) => m.approval_state === "approved");
    if (!approved.length) {
      return fail(enriched, "not_approved", "Mapping exists but has not been approved for ordering.");
    }

    const active = approved.filter((m) => m.status === "active");
    if (!active.length) {
      const worst = approved[0];
      const code: ResolutionFailureCode =
        worst.status === "revalidation_required" ||
        worst.status === "stale" ||
        worst.status === "catalog_conflict"
          ? "stale_validation"
          : worst.status === "inactive_supplier_item"
          ? "inactive"
          :
        worst.status === "discontinued"
          ? "discontinued"
          : worst.status === "superseded"
          ? "superseded"
          : "inactive";
      return fail(enriched, code, `Mapped ${supplier.toUpperCase()} item is ${worst.status}.`, {
        supplier_item_number: worst.supplier_item_number,
        mapping_id: worst.id,
      });
    }

    if (active.length > 1) {
      return fail(enriched, "ambiguous", "Multiple approved supplier items match; manager review required.", {
        candidates: active.map((m) => ({
          mapping_id: m.id,
          supplier_item_number: m.supplier_item_number,
          supplier_description: m.supplier_description,
        })),
      });
    }

    const m = active[0];

    // Catalog validation freshness.
    const validatedMs = m.validated_at ? Date.parse(m.validated_at) : NaN;
    if (!Number.isFinite(validatedMs) || nowMs - validatedMs > CATALOG_VALIDATION_MAX_AGE_MS) {
      return fail(
        enriched,
        "stale_validation",
        "Mapping has not been validated against the live supplier catalog recently.",
        { mapping_id: m.id, supplier_item_number: m.supplier_item_number, validated_at: m.validated_at },
      );
    }

    return {
      ...enriched,
      ok: true,
      mapping_id: m.id,
      mapping_revision: m.revision,
      supplier_item_number: m.supplier_item_number,
      supplier_catalog_item_id: m.supplier_catalog_item_id,
      supplier_description: m.supplier_description,
      supplier_color_name: m.supplier_color_name,
      supplier_uom: upper(m.supplier_uom),
      validated_at: m.validated_at,
      catalog_fingerprint: m.catalog_fingerprint,
      mapping_source: (m as any).mapping_source ?? null,
      approval_state: m.approval_state ?? null,

    };
  });
}

export interface PreflightResult {
  ok: boolean;
  lines: ResolvedLine[];
  blocking: Array<{ key: string; failure_code: ResolutionFailureCode; failure_message: string }>;
}

/** Hard gate. No line may be submitted as free text; any failure blocks the whole order. */
export async function preflightSupplierOrder(
  svc: any,
  tenantId: string,
  req: ResolveRequest,
  now: Date = new Date(),
): Promise<PreflightResult> {
  if (!req.lines?.length) {
    return { ok: false, lines: [], blocking: [{ key: "*", failure_code: "no_mapping", failure_message: "Order has no material lines." }] };
  }
  const lines = await resolveSupplierLines(svc, tenantId, req, now);
  const blocking = lines
    .filter((l) => !l.ok)
    .map((l) => ({
      key: l.key,
      failure_code: l.failure_code!,
      failure_message: l.failure_message ?? "Unresolved line.",
    }));
  return { ok: blocking.length === 0, lines, blocking };
}

/** Stable fingerprint of an outbound payload, used for the immutable snapshot. */
export async function hashPayload(payload: unknown): Promise<string> {
  // Recursively key-sorted serialization. A top-level key allowlist would drop
  // every nested field (item codes, colors, quantities) from the digest, which
  // would let two materially different orders share one idempotency key.
  const stable = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === "object") {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce((acc: Record<string, unknown>, k) => {
          acc[k] = stable((v as Record<string, unknown>)[k]);
          return acc;
        }, {});
    }
    return v;
  };
  const json = JSON.stringify(stable(payload));
  const bytes = new TextEncoder().encode(json);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}


/** Deterministic idempotency key so a retry can never place a duplicate order. */
export function buildIdempotencyKey(parts: {
  tenantId: string;
  supplier: SupplierKind;
  materialOrderId?: string | null;
  orderVersion: number;
  payloadHash: string;
}): string {
  return [
    parts.tenantId,
    parts.supplier,
    parts.materialOrderId ?? "no-order",
    `v${parts.orderVersion}`,
    parts.payloadHash.slice(0, 32),
  ].join(":");
}
