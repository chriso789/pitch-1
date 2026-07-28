// Atomic server-side supplier order build orchestrator.
//
// Auth mode: AUTHENTICATED TENANT ROUTE (callers must already have resolved
// tenant_id from the JWT). Everything authoritative — supplier item numbers,
// UOMs, branch scope, pricing, payload fields, hashes — is derived server-side.
// Client-supplied item codes, prices, UOMs and branch values are ignored.
//
// Stage order (fail-fast, whole order fails if one required line fails):
//   order_loaded → connection_loaded → products_loaded → mapping_resolution
//   → mapping_verification → compatibility → branch_ship_to → pricing
//   → payload_build → preview_snapshot
//
// This module NEVER calls the supplier "place order" endpoint.

import {
  resolveSupplierLines,
  hashPayload,
  buildIdempotencyKey,
  type ResolvedLine,
  type SupplierKind,
} from "./supplier-resolution.ts";
import { buildOrderPayload } from "./supplier-payload.ts";

export type LineRole = "field" | "ridge" | "starter" | "accessory";

export interface BuildLineInput {
  key: string;
  role: LineRole;
  variant_id: string;
  color_id: string | null;
  uom: string;
  quantity: number;
}

export interface OrderContextInput {
  po_number?: string | null;
  job_name?: string | null;
  customer_name?: string | null;
  delivery_address?: {
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
  } | null;
  requested_delivery_date?: string | null;
  delivery_date_tbd?: boolean;
  delivery_method?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  notes?: string | null;
}

export interface BuildRequest {
  supplier: SupplierKind;
  supplier_connection_id?: string | null;
  supplier_account_number?: string | null;
  branch_code?: string | null;
  ship_to_number?: string | null;
  project_id?: string | null;
  estimate_id?: string | null;
  material_order_id?: string | null;
  order_version?: number;
  lines: BuildLineInput[];
  order_context: OrderContextInput;
}

export type StageName =
  | "order_loaded"
  | "connection_loaded"
  | "products_loaded"
  | "mapping_resolution"
  | "mapping_verification"
  | "compatibility"
  | "branch_ship_to"
  | "pricing"
  | "payload_build"
  | "preview_snapshot";

export interface StageResult {
  stage: StageName;
  label: string;
  ok: boolean;
  detail?: string;
  line_key?: string | null;
  reason?: string | null;
  correction?: string | null;
}

export const STAGE_LABELS: Record<StageName, string> = {
  order_loaded: "Validating order…",
  connection_loaded: "Loading supplier connection…",
  products_loaded: "Loading selected products…",
  mapping_resolution: "Resolving ABC products…",
  mapping_verification: "Verifying mappings…",
  compatibility: "Checking compatibility…",
  branch_ship_to: "Checking branch and Ship-To…",
  pricing: "Retrieving ABC pricing…",
  payload_build: "Building order preview…",
  preview_snapshot: "Ready for review",
};

export interface BuildFailure {
  ok: false;
  failed_stage: StageName;
  stage_label: string;
  line_key: string | null;
  reason: string;
  correction: string;
  stages: StageResult[];
}

export interface BuildSuccess {
  ok: true;
  submission_id: string;
  reused: boolean;
  payload_hash: string;
  idempotency_key: string;
  po_number: string;
  order_context: OrderContextInput;
  lines: ResolvedLine[];
  pricing: PricedLine[];
  totals: { subtotal: number; fees: number; taxes: number; currency: string };
  compatibility_evidence: CompatibilityEvidence[];
  payload: unknown;
  stages: StageResult[];
  generated_at: string;
}

export interface PricedLine {
  key: string;
  item_number: string;
  uom: string | null;
  quantity: number;
  unit_price: number | null;
  extended_price: number | null;
  priced: boolean;
  reason?: string | null;
}

export interface CompatibilityEvidence {
  field_key: string;
  companion_key: string;
  relationship: string;
  compatibility_id: string;
  evidence_source: string;
  evidence_reference: string | null;
}

const REQUIRED_CONTEXT_FIELDS: Array<{
  field: keyof OrderContextInput;
  label: string;
  correction: string;
}> = [
  { field: "job_name", label: "Job name", correction: "Enter the job name for this order." },
  { field: "customer_name", label: "Customer name", correction: "Enter the customer name for this order." },
  { field: "delivery_method", label: "Delivery method", correction: "Select delivery or pickup." },
  { field: "contact_name", label: "Contact name", correction: "Enter the on-site contact name." },
  { field: "contact_phone", label: "Contact phone", correction: "Enter the on-site contact phone number." },
];

function blank(v: unknown) {
  return v == null || String(v).trim() === "";
}

/** Pure: validates required order information before any supplier call. */
export function validateOrderContext(ctx: OrderContextInput): { ok: boolean; reason?: string; correction?: string } {
  for (const r of REQUIRED_CONTEXT_FIELDS) {
    if (blank(ctx[r.field] as unknown)) {
      return { ok: false, reason: `${r.label} is required before an ABC order preview can be built.`, correction: r.correction };
    }
  }
  const a = ctx.delivery_address;
  const missingAddr = !a || blank(a.line1) || blank(a.city) || blank(a.state) || blank(a.postal_code);
  if (missingAddr) {
    return {
      ok: false,
      reason: "A complete delivery address (street, city, state and postal code) is required.",
      correction: "Complete the delivery address fields.",
    };
  }
  if (blank(ctx.requested_delivery_date) && ctx.delivery_date_tbd !== true) {
    return {
      ok: false,
      reason: "A requested delivery/pickup date is required.",
      correction: 'Pick a date, or explicitly select "Date to be confirmed".',
    };
  }
  return { ok: true };
}

/** Pure: collapse naming/spacing/punctuation differences ("Weathered Wood" ≡ "Weatheredwood"). */
export function normalizeToken(value?: string | null): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Pure: given compatibility records, decide whether companion lines are approved. */
export function evaluateCompatibility(
  lines: BuildLineInput[],
  resolved: ResolvedLine[],
  records: Array<{
    id: string;
    field_variant_id: string;
    field_color_id: string | null;
    companion_variant_id: string;
    companion_color_id: string | null;
    relationship: string;
    evidence_source: string;
    evidence_reference: string | null;
    is_active: boolean;
  }>,
): { ok: boolean; evidence: CompatibilityEvidence[]; failure?: { line_key: string; reason: string; correction: string } } {
  const byKey = new Map(resolved.map((r) => [r.key, r]));
  const field = lines.find((l) => l.role === "field");
  const companions = lines.filter((l) => l.role === "ridge" || l.role === "starter");
  const evidence: CompatibilityEvidence[] = [];

  if (!companions.length) return { ok: true, evidence };

  if (!field) {
    return {
      ok: false,
      evidence,
      failure: {
        line_key: companions[0].key,
        reason: "A hip-and-ridge / starter product was selected without a field shingle, so manufacturer compatibility cannot be proven.",
        correction: "Add the field shingle this companion product belongs to.",
      },
    };
  }

  const fieldRes = byKey.get(field.key);
  const fieldLabel = `${fieldRes?.product_line_name ?? fieldRes?.variant_name ?? "field shingle"} ${fieldRes?.color_name ?? ""}`.trim();

  for (const comp of companions) {
    const compRes = byKey.get(comp.key);
    const compLabel = `${compRes?.product_line_name ?? compRes?.variant_name ?? "companion product"} ${compRes?.color_name ?? ""}`.trim();

    const hit = records.find(
      (r) =>
        r.is_active &&
        r.field_variant_id === field.variant_id &&
        r.companion_variant_id === comp.variant_id &&
        (r.field_color_id == null || r.field_color_id === field.color_id) &&
        (r.companion_color_id == null || r.companion_color_id === comp.color_id),
    );

    if (!hit) {
      // Fallback: same manufacturer + equivalent color naming ("Weatheredwood"
      // vs "Weathered Wood") is a manufacturer-consistent system pairing.
      const sameMfr =
        !!fieldRes?.manufacturer_id && !!compRes?.manufacturer_id
          ? fieldRes.manufacturer_id === compRes.manufacturer_id
          : normalizeToken(fieldRes?.manufacturer_name) !== "" &&
            normalizeToken(fieldRes?.manufacturer_name) === normalizeToken(compRes?.manufacturer_name);
      const sameColor =
        (normalizeToken(fieldRes?.color_name) !== "" &&
          normalizeToken(fieldRes?.color_name) === normalizeToken(compRes?.color_name)) ||
        (!!fieldRes?.manufacturer_color_code &&
          normalizeToken(fieldRes.manufacturer_color_code) === normalizeToken(compRes?.manufacturer_color_code));

      if (sameMfr && sameColor) {
        evidence.push({
          field_key: field.key,
          companion_key: comp.key,
          relationship: "manufacturer_color_match",
          compatibility_id: "derived:manufacturer_color_match",
          evidence_source: "manufacturer_color_match",
          evidence_reference: `${fieldRes?.manufacturer_name ?? "manufacturer"} · ${fieldRes?.color_name ?? ""} ≡ ${compRes?.color_name ?? ""}`,
        });
        continue;
      }

      return {
        ok: false,
        evidence,
        failure: {
          line_key: comp.key,
          reason: `Order blocked: ${fieldLabel} cannot be submitted with ${compLabel}. Select a compatible hip-and-ridge product and color.`,
          correction: "Choose a manufacturer-approved companion product and color, or record an authoritative compatibility entry for this pairing.",
        },
      };
    }


    evidence.push({
      field_key: field.key,
      companion_key: comp.key,
      relationship: hit.relationship,
      compatibility_id: hit.id,
      evidence_source: hit.evidence_source,
      evidence_reference: hit.evidence_reference,
    });
  }

  return { ok: true, evidence };
}

/** Pure: normalizes ABC price API rows onto the resolved lines. */
export function mapPricingRows(resolved: ResolvedLine[], rows: any[]): PricedLine[] {
  const byItem = new Map<string, any>();
  for (const r of rows ?? []) {
    const k = String(r?.itemNumber ?? r?.item_number ?? "").toUpperCase();
    if (k) byItem.set(k, r);
  }
  return resolved.map((l, i) => {
    const item = String(l.supplier_item_number ?? "");
    const hit = byItem.get(item.toUpperCase()) ?? (byItem.size === 0 ? undefined : rows?.[i]);
    const raw = hit?.unitPrice ?? hit?.unit_price ?? hit?.price ?? null;
    const unit = raw == null ? null : Number(raw);
    const priced = unit != null && Number.isFinite(unit) && unit > 0;
    return {
      key: l.key,
      item_number: item,
      uom: hit?.unitOfMeasure ?? hit?.uom ?? l.supplier_uom ?? null,
      quantity: l.quantity,
      unit_price: priced ? unit : null,
      extended_price: priced ? Number((unit! * l.quantity).toFixed(2)) : null,
      priced,
      reason: priced ? null : "ABC returned no orderable price for this item at the selected ship-to/branch.",
    };
  });
}

function stage(s: StageName, ok: boolean, extra: Partial<StageResult> = {}): StageResult {
  return { stage: s, label: STAGE_LABELS[s], ok, ...extra };
}

export interface OrchestratorDeps {
  svc: any;
  tenantId: string;
  userId: string;
  /** Invokes an ABC proxy action (validate_ship_to_branch / price_items). */
  callAbcAction: (body: Record<string, unknown>) => Promise<any>;
}

/**
 * Runs the full resolve → compatibility → branch/ship-to → pricing → payload →
 * immutable preview snapshot sequence as one retry-safe operation.
 */
export async function buildSupplierOrderPreview(
  deps: OrchestratorDeps,
  req: BuildRequest,
): Promise<BuildSuccess | BuildFailure> {
  const { svc, tenantId, userId } = deps;
  const stages: StageResult[] = [];

  const fail = (
    s: StageName,
    reason: string,
    correction: string,
    lineKey: string | null = null,
  ): BuildFailure => {
    stages.push(stage(s, false, { reason, correction, line_key: lineKey }));
    return {
      ok: false,
      failed_stage: s,
      stage_label: STAGE_LABELS[s],
      line_key: lineKey,
      reason,
      correction,
      stages,
    };
  };

  // ---- 1. order_loaded --------------------------------------------------
  if (!Array.isArray(req.lines) || req.lines.length === 0) {
    return fail("order_loaded", "The order has no material lines.", "Select at least one product before building the order.");
  }
  const badQty = req.lines.find((l) => !Number.isFinite(l.quantity) || l.quantity <= 0);
  if (badQty) {
    return fail("order_loaded", "Every line requires a positive quantity.", "Correct the quantity.", badQty.key);
  }
  const ctxCheck = validateOrderContext(req.order_context ?? {});
  if (!ctxCheck.ok) {
    return fail("order_loaded", ctxCheck.reason!, ctxCheck.correction!);
  }
  stages.push(stage("order_loaded", true));

  // ---- 2. connection_loaded ---------------------------------------------
  if (!req.supplier_connection_id) {
    return fail("connection_loaded", "No supplier connection is selected.", "Connect the supplier account in Settings → Suppliers.");
  }
  if (!req.branch_code) {
    return fail("connection_loaded", "No branch is selected.", "Select the ABC branch that will fulfil this order.");
  }
  if (!req.ship_to_number) {
    return fail("connection_loaded", "No Ship-To account is selected.", "Select the ABC Ship-To for this delivery address.");
  }
  stages.push(stage("connection_loaded", true, { detail: `branch ${req.branch_code} · ship-to ${req.ship_to_number}` }));

  // ---- 3. products_loaded -----------------------------------------------
  const variantIds = [...new Set(req.lines.map((l) => l.variant_id))];
  const { data: variants, error: varErr } = await svc
    .from("mfr_product_variants")
    .select("id, variant_name, is_accessory, canonical_uom")
    .eq("tenant_id", tenantId)
    .in("id", variantIds);
  if (varErr) return fail("products_loaded", varErr.message, "Retry — the product catalog could not be read.");
  const missingVariant = req.lines.find((l) => !(variants ?? []).some((v: any) => v.id === l.variant_id));
  if (missingVariant) {
    return fail("products_loaded", "A selected product no longer exists in the catalog.", "Re-select the product.", missingVariant.key);
  }
  stages.push(stage("products_loaded", true, { detail: `${variantIds.length} product(s)` }));

  // ---- 4/5. mapping_resolution + verification ---------------------------
  const resolved = await resolveSupplierLines(svc, tenantId, {
    supplier: req.supplier,
    supplier_connection_id: req.supplier_connection_id,
    supplier_account_number: req.supplier_account_number ?? null,
    branch_code: req.branch_code,
    lines: req.lines.map((l) => ({
      key: l.key,
      variant_id: l.variant_id,
      color_id: l.color_id,
      uom: l.uom,
      quantity: l.quantity,
    })),
  });

  const unresolved = resolved.find((l) => !l.ok);
  if (unresolved) {
    return fail(
      "mapping_resolution",
      unresolved.failure_message || `Line could not be resolved (${unresolved.failure_code ?? "unresolved"}).`,
      "Approve an exact supplier mapping for this product, color, UOM and branch.",
      unresolved.key,
    );
  }
  stages.push(stage("mapping_resolution", true, { detail: `${resolved.length} line(s) resolved` }));

  const unverified = resolved.find(
    (l) => !l.supplier_item_number || !l.supplier_uom || (l.branch_code ?? req.branch_code) !== req.branch_code,
  );
  if (unverified) {
    return fail(
      "mapping_verification",
      "The approved mapping for this line is not valid for the selected branch, UOM or catalog revision.",
      "Revalidate the mapping against the current ABC catalog for this branch.",
      unverified.key,
    );
  }
  stages.push(stage("mapping_verification", true, { detail: "fingerprints, revisions, branch scope and UOM verified" }));

  // ---- 6. compatibility --------------------------------------------------
  const { data: compatRows, error: compatErr } = await svc
    .from("mfr_system_compatibility")
    .select("id, field_variant_id, field_color_id, companion_variant_id, companion_color_id, relationship, evidence_source, evidence_reference, is_active")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .in("field_variant_id", variantIds);
  if (compatErr) return fail("compatibility", compatErr.message, "Retry — compatibility records could not be read.");

  const compat = evaluateCompatibility(req.lines, resolved, (compatRows ?? []) as any[]);
  if (!compat.ok) {
    return fail("compatibility", compat.failure!.reason, compat.failure!.correction, compat.failure!.line_key);
  }
  stages.push(stage("compatibility", true, { detail: `${compat.evidence.length} manufacturer compatibility record(s) matched` }));

  // ---- 7. branch_ship_to -------------------------------------------------
  let shipToResult: any;
  try {
    shipToResult = await deps.callAbcAction({
      action: "validate_ship_to_branch",
      shipToNumber: req.ship_to_number,
      branchNumber: req.branch_code,
      probeItemNumber: resolved[0]?.supplier_item_number ?? null,
    });
  } catch (e: any) {
    return fail("branch_ship_to", String(e?.message ?? e), "Retry the validation.");
  }
  if (!shipToResult?.valid) {
    return fail(
      "branch_ship_to",
      shipToResult?.message ?? "The Ship-To / branch pairing was rejected by ABC.",
      "Select a Ship-To that is authorized for this branch.",
    );
  }
  stages.push(stage("branch_ship_to", true, { detail: `ship-to ${req.ship_to_number} authorized for branch ${req.branch_code}` }));

  // ---- 8. pricing --------------------------------------------------------
  let priceResult: any;
  try {
    priceResult = await deps.callAbcAction({
      action: "price_items",
      purpose: "ordering",
      shipToNumber: req.ship_to_number,
      branchNumber: req.branch_code,
      lines: resolved.map((l) => ({
        itemNumber: l.supplier_item_number,
        quantity: l.quantity,
        unitOfMeasure: l.supplier_uom,
      })),
    });
  } catch (e: any) {
    return fail("pricing", String(e?.message ?? e), "Retry the pricing preflight.");
  }
  if (priceResult?.success === false) {
    return fail(
      "pricing",
      priceResult?.message || priceResult?.error || "ABC pricing failed for this order.",
      "Confirm the Ship-To, branch and item numbers, then retry.",
    );
  }
  const rawRows = priceResult?.parsed?.lines ?? priceResult?.parsed?.items ?? priceResult?.body?.items ?? [];
  const priced = mapPricingRows(resolved, Array.isArray(rawRows) ? rawRows : []);
  const unpriced = priced.find((p) => !p.priced);
  if (unpriced) {
    return fail("pricing", unpriced.reason!, "Confirm the item is orderable at this branch, or select a different product.", unpriced.key);
  }
  const subtotal = Number(priced.reduce((s, p) => s + (p.extended_price ?? 0), 0).toFixed(2));
  const fees = Number(priceResult?.parsed?.fees ?? priceResult?.body?.fees ?? 0) || 0;
  const taxes = Number(priceResult?.parsed?.taxes ?? priceResult?.body?.taxes ?? 0) || 0;
  stages.push(stage("pricing", true, { detail: `${priced.length} line(s) priced` }));

  // ---- 9. payload_build --------------------------------------------------
  // PO number: reuse the saved order revision's PO, otherwise draw the next
  // number from the company's configured sequence. Never hardcoded.
  let poNumber = req.order_context.po_number?.trim() || "";
  const orderVersion = Number(req.order_version ?? 1);
  if (!poNumber && req.material_order_id) {
    const { data: prior } = await svc
      .from("supplier_order_submissions")
      .select("order_context")
      .eq("tenant_id", tenantId)
      .eq("supplier", req.supplier)
      .eq("material_order_id", req.material_order_id)
      .eq("order_version", orderVersion)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    poNumber = String((prior?.order_context as any)?.po_number ?? "").trim();
  }
  if (!poNumber) {
    const { data: seq, error: seqErr } = await svc.rpc("next_supplier_po_number", {
      _tenant_id: tenantId,
      _supplier: req.supplier,
    });
    if (seqErr || !seq) {
      return fail("payload_build", seqErr?.message ?? "Could not allocate a purchase-order number.", "Retry the build.");
    }
    poNumber = String(seq);
  }

  const orderContext: OrderContextInput & { ship_to_number?: string | null; branch_code?: string | null } = {
    ...req.order_context,
    po_number: poNumber,
    ship_to_number: req.ship_to_number ?? null,
    branch_code: req.branch_code ?? null,
  };

  let payload: unknown;
  try {
    payload = buildOrderPayload(req.supplier, resolved, {
      po_number: poNumber,
      job_number: orderContext.job_name ?? null,
      customer_name: orderContext.customer_name ?? null,
      delivery_address: orderContext.delivery_address ?? null,
      requested_delivery_date: orderContext.requested_delivery_date ?? null,
      notes: orderContext.notes ?? null,
      ship_to_number: req.ship_to_number,
      branch_code: req.branch_code,
      account_number: req.supplier_account_number ?? null,
    });
  } catch (e: any) {
    return fail("payload_build", String(e?.message ?? e), "Re-resolve the order lines and retry.");
  }
  stages.push(stage("payload_build", true));

  // ---- 10. preview_snapshot ---------------------------------------------
  const payloadHash = await hashPayload({ payload, context: orderContext, pricing: priced });
  const idempotencyKey = buildIdempotencyKey({
    tenantId,
    supplier: req.supplier,
    materialOrderId: req.material_order_id ?? null,
    orderVersion,
    payloadHash,
  });
  const nowIso = new Date().toISOString();

  const { data: existing } = await svc
    .from("supplier_order_submissions")
    .select("id, state")
    .eq("tenant_id", tenantId)
    .eq("supplier", req.supplier)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  const common = {
    ok: true as const,
    reused: !!existing,
    payload_hash: payloadHash,
    idempotency_key: idempotencyKey,
    po_number: poNumber,
    order_context: orderContext,
    lines: resolved,
    pricing: priced,
    totals: { subtotal, fees, taxes, currency: "USD" },
    compatibility_evidence: compat.evidence,
    payload,
    stages,
    generated_at: nowIso,
  };

  if (existing) {
    stages.push(stage("preview_snapshot", true, { detail: "existing snapshot reused" }));
    return { ...common, submission_id: existing.id };
  }

  const { data: inserted, error: insErr } = await svc
    .from("supplier_order_submissions")
    .insert({
      tenant_id: tenantId,
      supplier: req.supplier,
      supplier_connection_id: req.supplier_connection_id,
      supplier_account_number: req.supplier_account_number ?? null,
      branch_code: req.branch_code,
      project_id: req.project_id ?? null,
      estimate_id: req.estimate_id ?? null,
      material_order_id: req.material_order_id ?? null,
      order_version: orderVersion,
      user_selections: req.lines,
      resolved_lines: resolved,
      mapping_revisions: resolved.map((l) => ({
        mapping_id: l.mapping_id,
        revision: l.mapping_revision,
        catalog_fingerprint: l.catalog_fingerprint,
        validated_at: l.validated_at,
      })),
      outbound_payload: payload,
      payload_hash: payloadHash,
      idempotency_key: idempotencyKey,
      state: "prepared",
      order_context: orderContext,
      stage_results: stages,
      pricing_snapshot: { lines: priced, totals: common.totals, priced_at: nowIso },
      compatibility_evidence: compat.evidence,
      preview_generated_by: userId,
      preview_generated_at: nowIso,
      submitted_by: userId,
    })
    .select("id")
    .single();

  if (insErr) {
    return fail("preview_snapshot", insErr.message, "Retry — the preview snapshot could not be saved.");
  }

  stages.push(stage("preview_snapshot", true, { detail: "snapshot created" }));
  return { ...common, submission_id: inserted.id };
}
