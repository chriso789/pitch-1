/**
 * ABC production order assembler — Phase 1B / Slice 3B.
 *
 * The SINGLE canonical path for production ABC orders. Both
 * `abc-api-proxy` and `supplier-api/abc-proxy` MUST call this module for
 * `place_order` / `submit_order`. No inline payload construction is
 * permitted in either handler after Slice 3B.
 *
 * Guarantees:
 *   - Never trusts caller-supplied supplier identity (item number, UOM,
 *     price, branch, ship-to, address, jobsite contact).
 *   - Reloads every field from trusted server records (abc_connections,
 *     projects, contacts, template_item_supplier_mappings, abc_price_cache).
 *   - Requires an approved supplier mapping per line — no fallback to
 *     `item_name` / `srs_item_code` / free-text.
 *   - Requires validated project/property address.
 *   - Requires fresh pricing (default TTL 60 min) — no silent refresh.
 *   - Deterministic payload + idempotency key via buildAbcOrderPayload.
 *   - Idempotent submission: identical requests return the existing order.
 *
 * This module never calls ABC HTTP endpoints and never mutates OAuth
 * tokens. Handlers keep responsibility for the outbound call, audit
 * logging, and success persistence via {@link persistAbcProductionOrder}.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  buildAbcOrderPayload,
  type BuildOrderInput,
  type BuiltOrderResult,
  type OrderLineProof,
} from "./orderService.ts";

export interface ProductionOrderItemInput {
  template_item_id: string;
  quantity: number;
  instructions?: string | null;
}

export interface AssembleProductionOrderRequest {
  tenant_id: string;
  environment: "sandbox" | "production";
  project_id: string;
  items: ProductionOrderItemInput[];
  delivery_method?: "pickup" | "ground_drop" | "roof_load";
  delivery_date?: string | null;
  notes?: string | null;
  purchase_order?: string | null;
  pricing_max_age_minutes?: number;
}

export interface AssembleProductionOrderError {
  ok: false;
  code: string;
  message: string;
  field?: string;
  details?: Record<string, unknown>;
}

export interface AssembleProductionOrderSuccess {
  ok: true;
  orderRequest: unknown;
  built: Extract<BuiltOrderResult, { valid: true }>;
  snapshot: {
    branchNumber: string;
    shipToNumber: string;
    addressValidated: boolean;
    pricingRunId: string;
    mappings: Array<{
      template_item_id: string;
      mapping_id: string;
      item_number: string;
      uom: string;
      description: string;
      color: string | null;
    }>;
  };
  jobsiteContact: { name: string; email: string; phone: string };
  purchaseOrder: string;
  deliveryDate: string | null;
  totalAmount: number;
}

export type AssembleProductionOrderResult =
  | AssembleProductionOrderSuccess
  | AssembleProductionOrderError;

const err = (
  code: string,
  message: string,
  extra?: Partial<AssembleProductionOrderError>,
): AssembleProductionOrderError => ({
  ok: false,
  code,
  message,
  ...(extra ?? {}),
});

function mapDeliveryService(m?: string): "CPU" | "OTG" | "OTR" {
  if (m === "ground_drop") return "OTG";
  if (m === "roof_load") return "OTR";
  return "CPU";
}

// -------- Trusted reloads (all optional plumbing overridable in tests) --------

export interface ProductionOrderDataSource {
  loadConnection(
    tenant_id: string,
    environment: string,
  ): Promise<{
    account_number?: string | null;
    default_branch_code?: string | null;
    selected_branch_number?: string | null;
    selected_ship_to_number?: string | null;
  } | null>;

  loadProjectWithContact(
    tenant_id: string,
    project_id: string,
  ): Promise<{
    project_number: string | null;
    job_number: string | null;
    contact_number: string | null;
    contact: {
      id: string;
      first_name: string | null;
      last_name: string | null;
      company_name: string | null;
      email: string | null;
      phone: string | null;
      address_street: string | null;
      address_city: string | null;
      address_state: string | null;
      address_zip: string | null;
      address_validated: boolean | null;
    } | null;
  } | null>;

  loadApprovedMapping(
    tenant_id: string,
    template_item_id: string,
  ): Promise<{
    id: string;
    template_item_id: string;
    supplier_item_number: string | null;
    supplier_description: string | null;
    supplier_item_description: string | null;
    default_uom: string | null;
    uom: string | null;
    color_name: string | null;
    review_state: string | null;
  } | null>;

  loadFreshPrice(
    tenant_id: string,
    item_number: string,
    uom: string,
    ship_to: string,
    branch: string,
    maxAgeMinutes: number,
  ): Promise<{ unit_price: number; fetched_at: string } | null>;

  findExistingOrderByIdempotency(
    tenant_id: string,
    environment: string,
    idempotencyKey: string,
  ): Promise<{
    id: string;
    order_number: string | null;
    confirmation_number: string | null;
    order_status: string | null;
    raw_payload: unknown;
  } | null>;
}

export function createSupabaseDataSource(
  supabase: SupabaseClient,
): ProductionOrderDataSource {
  return {
    async loadConnection(tenant_id, environment) {
      const { data } = await supabase
        .from("abc_connections")
        .select(
          "account_number,default_branch_code,selected_branch_number,selected_ship_to_number",
        )
        .eq("tenant_id", tenant_id)
        .eq("environment", environment)
        .maybeSingle();
      return (data as any) ?? null;
    },
    async loadProjectWithContact(tenant_id, project_id) {
      const { data: proj } = await supabase
        .from("projects")
        .select("project_number,job_number,contact_number")
        .eq("tenant_id", tenant_id)
        .eq("id", project_id)
        .maybeSingle();
      if (!proj) return null;
      let contact = null;
      if ((proj as any).contact_number) {
        const { data: c } = await supabase
          .from("contacts")
          .select(
            "id,first_name,last_name,company_name,email,phone,address_street,address_city,address_state,address_zip,address_validated",
          )
          .eq("tenant_id", tenant_id)
          .eq("contact_number", (proj as any).contact_number)
          .maybeSingle();
        contact = (c as any) ?? null;
      }
      return { ...(proj as any), contact };
    },
    async loadApprovedMapping(tenant_id, template_item_id) {
      const { data } = await supabase
        .from("template_item_supplier_mappings")
        .select(
          "id,template_item_id,supplier_item_number,supplier_description,supplier_item_description,default_uom,uom,color_name,review_state",
        )
        .eq("tenant_id", tenant_id)
        .eq("supplier", "abc")
        .eq("template_item_id", template_item_id)
        .in("review_state", ["approved", "confirmed", "auto_approved"])
        .maybeSingle();
      return (data as any) ?? null;
    },
    async loadFreshPrice(tenant_id, item_number, uom, ship_to, branch, maxAgeMinutes) {
      const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000).toISOString();
      const { data } = await supabase
        .from("abc_price_cache")
        .select("unit_price,fetched_at")
        .eq("tenant_id", tenant_id)
        .eq("item_number", item_number)
        .eq("uom", uom)
        .eq("ship_to_number", ship_to)
        .eq("branch_number", branch)
        .gte("fetched_at", cutoff)
        .order("fetched_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data || !Number.isFinite(Number((data as any).unit_price))) return null;
      return {
        unit_price: Number((data as any).unit_price),
        fetched_at: (data as any).fetched_at,
      };
    },
    async findExistingOrderByIdempotency(tenant_id, environment, idempotencyKey) {
      const { data } = await supabase
        .from("abc_orders")
        .select("id,order_number,confirmation_number,order_status,raw_payload")
        .eq("tenant_id", tenant_id)
        .eq("environment", environment)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      return (data as any) ?? null;
    },
  };
}

// -------- Assembler --------

export async function assembleProductionAbcOrder(
  ds: ProductionOrderDataSource,
  req: AssembleProductionOrderRequest,
): Promise<AssembleProductionOrderResult> {
  if (!req.tenant_id) return err("missing_tenant", "Tenant is required");
  if (!req.project_id) {
    return err("missing_project", "project_id is required — production orders must be tied to a project");
  }
  if (!Array.isArray(req.items) || req.items.length === 0) {
    return err("no_items", "No line items to submit");
  }
  const bad = req.items.find((i) => !i.template_item_id || !(Number(i.quantity) > 0));
  if (bad) {
    return err(
      "invalid_line",
      "Every line must have a template_item_id and quantity > 0",
      { field: "items" },
    );
  }

  const conn = await ds.loadConnection(req.tenant_id, req.environment);
  const branchNumber = String(
    conn?.selected_branch_number || conn?.default_branch_code || "",
  ).trim();
  const shipToNumber = String(
    conn?.selected_ship_to_number || conn?.account_number || "",
  ).trim();
  if (!branchNumber) return err("branch_not_configured", "ABC branch is not configured for this tenant");
  if (!shipToNumber) return err("ship_to_not_configured", "ABC ship-to is not configured for this tenant");

  const project = await ds.loadProjectWithContact(req.tenant_id, req.project_id);
  if (!project) return err("project_not_found", "Project could not be loaded for this tenant");
  const contact = project.contact;
  if (!contact) {
    return err("project_contact_missing", "Project has no linked contact — cannot resolve delivery address");
  }
  if (!contact.address_validated) {
    return err(
      "order_address_not_validated",
      "Project delivery address must be validated before submitting a production order",
      { field: "delivery_address" },
    );
  }
  if (!contact.address_street || !contact.address_city || !contact.address_state || !contact.address_zip) {
    return err("order_address_incomplete", "Project delivery address is incomplete");
  }

  const pricingMaxAge = Math.max(1, Number(req.pricing_max_age_minutes ?? 60));
  const mappings: AssembleProductionOrderSuccess["snapshot"]["mappings"] = [];
  const priceTimestamps: number[] = [];
  const lines: BuildOrderInput["lines"] = [];

  for (let i = 0; i < req.items.length; i++) {
    const it = req.items[i];
    const m = await ds.loadApprovedMapping(req.tenant_id, it.template_item_id);
    if (!m) {
      return err("mapping_not_approved", `Template item ${it.template_item_id} has no approved ABC mapping`, {
        field: `items[${i}].template_item_id`,
        details: { template_item_id: it.template_item_id },
      });
    }
    const itemNumber = String(m.supplier_item_number || "").trim();
    const uom = String(m.default_uom || m.uom || "").trim().toUpperCase();
    if (!itemNumber) {
      return err("mapping_missing_item_number", `Approved mapping for ${it.template_item_id} is missing supplier_item_number`, {
        field: `items[${i}].template_item_id`,
      });
    }
    if (!uom) {
      return err("mapping_missing_uom", `Approved mapping for ${it.template_item_id} is missing UOM`, {
        field: `items[${i}].template_item_id`,
      });
    }
    const price = await ds.loadFreshPrice(
      req.tenant_id,
      itemNumber,
      uom,
      shipToNumber,
      branchNumber,
      pricingMaxAge,
    );
    if (!price) {
      return err(
        "pricing_expired",
        `No fresh ABC price for ${itemNumber} (${uom}) at branch ${branchNumber}. Refresh pricing before submitting.`,
        {
          field: `items[${i}].template_item_id`,
          details: { item_number: itemNumber, uom, branch: branchNumber, max_age_minutes: pricingMaxAge },
        },
      );
    }
    priceTimestamps.push(new Date(price.fetched_at).getTime());
    const description = m.supplier_description || m.supplier_item_description || itemNumber;
    mappings.push({
      template_item_id: it.template_item_id,
      mapping_id: m.id,
      item_number: itemNumber,
      uom,
      description,
      color: m.color_name ?? null,
    });
    lines.push({
      id: i + 1,
      itemNumber,
      itemDescription: description,
      uom,
      quantity: Number(it.quantity),
      unitPrice: price.unit_price,
      instructions: it.instructions ?? null,
      approvedMappingId: m.id,
      approvedPricingRunId: `abc:${req.environment}:${branchNumber}:${shipToNumber}:${new Date(price.fetched_at).getTime()}`,
      priceSource: "price_cache",
      colorLabel: m.color_name ?? null,
    });
  }

  const pricingRunId = `abc:${req.environment}:${branchNumber}:${shipToNumber}:${Math.max(...priceTimestamps)}`;

  const shipToName =
    contact.company_name ||
    [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim() ||
    "Jobsite";

  const jobsiteContact = {
    name: shipToName,
    email: contact.email ?? "",
    phone: contact.phone ?? "",
  };

  const poNumber = (req.purchase_order && String(req.purchase_order).trim()) ||
    `PITCH-${project.job_number || project.project_number || "JOB"}-${Date.now()}`;

  const built = buildAbcOrderPayload({
    variant: "legacy_place",
    requestId: poNumber,
    purchaseOrder: poNumber,
    branchNumber,
    shipToNumber,
    deliveryService: mapDeliveryService(req.delivery_method),
    deliveryRequestedFor: req.delivery_date ?? null,
    currency: "USD",
    shipToName,
    address: {
      line1: contact.address_street,
      city: contact.address_city,
      state: contact.address_state,
      postal: contact.address_zip,
      country: "USA",
    },
    jobsiteContact,
    comments: req.notes ? [{ code: "H", description: String(req.notes).slice(0, 500) }] : [],
    lines,
  });

  if (!built.valid) {
    return err("preflight_failed", built.errors[0]?.message || "Order preflight failed", {
      details: { errors: built.errors },
    });
  }

  const totalAmount = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);

  return {
    ok: true,
    orderRequest: built.orderRequest as unknown,
    built,
    snapshot: {
      branchNumber,
      shipToNumber,
      addressValidated: true,
      pricingRunId,
      mappings,
    },
    jobsiteContact,
    purchaseOrder: poNumber,
    deliveryDate: req.delivery_date ?? null,
    totalAmount,
  };
}

// -------- Persistence --------

export interface PersistProductionOrderInput {
  tenant_id: string;
  environment: "sandbox" | "production";
  project_id: string;
  estimate_id?: string | null;
  purchaseOrder: string;
  deliveryDate: string | null;
  jobsiteContact: { name: string; email: string; phone: string };
  built: Extract<BuiltOrderResult, { valid: true }>;
  snapshot: AssembleProductionOrderSuccess["snapshot"];
  response: { ok: boolean; status: number; body: unknown };
  lineInputs: ProductionOrderItemInput[];
}

export async function persistAbcProductionOrder(
  supabase: SupabaseClient,
  input: PersistProductionOrderInput,
): Promise<{ orderId: string | null; skipped: boolean }> {
  if (!input.response.ok) return { orderId: null, skipped: true };
  try {
    const respFirst = Array.isArray(input.response.body)
      ? (input.response.body as unknown[])[0]
      : (input.response.body as Record<string, unknown> | null | undefined);
    const orderObj = (input.built.orderRequest as any)[0];
    const orderNumber =
      (respFirst as any)?.orderNumber ||
      (respFirst as any)?.order_number ||
      orderObj.purchaseOrder;
    const confirmation =
      (respFirst as any)?.confirmationNumber ||
      (respFirst as any)?.confirmation_number ||
      null;
    const totalAmount =
      Number((respFirst as any)?.totalAmount || (respFirst as any)?.total_amount || 0) ||
      input.built.lineProofs.reduce(
        (s: number, p: OrderLineProof) => s + p.quantity * p.unitPrice,
        0,
      );

    const { data: orderRow, error: orderErr } = await supabase
      .from("abc_orders")
      .insert({
        tenant_id: input.tenant_id,
        environment: input.environment,
        order_number: orderNumber,
        purchase_order: orderObj.purchaseOrder,
        confirmation_number: confirmation,
        order_status: (respFirst as any)?.status || "submitted",
        branch_number: input.snapshot.branchNumber,
        sold_to_number: input.snapshot.shipToNumber,
        ship_to_number: input.snapshot.shipToNumber,
        ordered_on: new Date().toISOString().slice(0, 10),
        delivery_requested_for: input.deliveryDate || null,
        total_amount: totalAmount,
        currency: "USD",
        source: "pitch",
        payload_hash: input.built.payloadHash,
        idempotency_key: input.built.idempotencyKey,
        pricing_run_id: input.snapshot.pricingRunId,
        mapping_snapshot: { mappings: input.snapshot.mappings },
        jobsite_contact_name: input.jobsiteContact.name || null,
        jobsite_contact_email: input.jobsiteContact.email || null,
        jobsite_contact_phone: input.jobsiteContact.phone || null,
        raw_payload: { request: input.built.orderRequest, response: input.response.body },
      })
      .select("id")
      .single();

    if (orderErr || !orderRow?.id) return { orderId: null, skipped: false };

    const proofs = input.built.lineProofs;
    await supabase.from("abc_order_lines").insert(
      proofs.map((p) => ({
        order_id: orderRow.id,
        tenant_id: input.tenant_id,
        line_id: String(p.lineId),
        item_number: p.itemNumber,
        item_description: p.itemDescription,
        ordered_qty: p.quantity,
        ordered_uom: p.uom,
        unit_price: p.unitPrice,
        amount: p.quantity * p.unitPrice,
        abc_item_number: p.itemNumber,
        abc_item_description: p.itemDescription,
        abc_uom: p.uom,
        abc_price: p.unitPrice,
        abc_price_source: p.priceSource,
        abc_branch_number: p.branchNumber,
        abc_ship_to_number: p.shipToNumber,
        approved_mapping_id: p.approvedMappingId,
        approved_pricing_run_id: p.approvedPricingRunId,
        line_proof: p as unknown as Record<string, unknown>,
      })),
    );

    if (input.project_id) {
      await supabase.from("abc_order_job_links").insert({
        tenant_id: input.tenant_id,
        order_id: orderRow.id,
        job_id: input.project_id,
        estimate_id: input.estimate_id || null,
      });
    }

    return { orderId: orderRow.id, skipped: false };
  } catch (persistErr) {
    console.error("[abc/orderProduction] persistence error", persistErr);
    return { orderId: null, skipped: false };
  }
}
