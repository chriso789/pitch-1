// canvass-api /pin/sync — batched, idempotent, tenant-safe pin upserts.
// - Identity (userId, tenantId) is middleware-resolved; body tenant_id is ignored.
// - Each pin must carry client_mutation_id; replays return the original result.
// - Per-pin success/error results; one bad pin does not fail the batch.

import type { Context } from "jsr:@hono/hono";
import { jsonOk, jsonErr, serviceClient, type RouterEnv } from "../_shared/router.ts";

type PinInput = {
  client_mutation_id?: unknown;
  client_created_at?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  address?: { street?: unknown; city?: unknown; state?: unknown; zip?: unknown } | null;
  property_details?: Record<string, unknown> | null;
  disposition_id?: unknown;
  notes?: unknown;
  pin_metadata?: Record<string, unknown> | null;
};

type PinResult =
  | { client_mutation_id: string; ok: true; contact_id: string; replayed: boolean; server_created_at: string; code?: string }
  | { client_mutation_id: string | null; ok: false; code: string; error: string };

const LATLNG_TOL = 0.0001; // ~11m

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function validatePin(p: PinInput): { ok: true; pin: Required<Pick<PinInput, "latitude" | "longitude">> & PinInput & { client_mutation_id: string } } | { ok: false; code: string; error: string; client_mutation_id: string | null } {
  const cmid = typeof p.client_mutation_id === "string" && p.client_mutation_id.length > 0 ? p.client_mutation_id : null;
  if (!cmid) return { ok: false, code: "invalid_pin", error: "client_mutation_id required", client_mutation_id: null };
  if (!isFiniteNumber(p.latitude) || p.latitude < -90 || p.latitude > 90) {
    return { ok: false, code: "invalid_pin", error: "latitude out of range", client_mutation_id: cmid };
  }
  if (!isFiniteNumber(p.longitude) || p.longitude < -180 || p.longitude > 180) {
    return { ok: false, code: "invalid_pin", error: "longitude out of range", client_mutation_id: cmid };
  }
  return { ok: true, pin: { ...p, client_mutation_id: cmid, latitude: p.latitude, longitude: p.longitude } as any };
}

export async function handlePinSync(c: Context<RouterEnv>) {
  const userId = c.get("userId")!;
  const tenantId = c.get("tenantId")!;
  const svc = serviceClient();

  let body: { pins?: PinInput[] };
  try {
    body = await c.req.json();
  } catch {
    return jsonErr(c, "invalid_body", "Body must be JSON", 400);
  }
  // Reject any body-supplied tenant_id explicitly — server resolves it.
  const pins = Array.isArray(body?.pins) ? body.pins : null;
  if (!pins) return jsonErr(c, "invalid_body", "pins array required", 400);
  if (pins.length === 0) return jsonOk(c, { results: [], server_time: new Date().toISOString() });
  if (pins.length > 200) return jsonErr(c, "batch_too_large", "max 200 pins per batch", 400);

  // Rep name for metadata
  const { data: rep } = await svc
    .from("profiles")
    .select("first_name, last_name")
    .eq("id", userId)
    .maybeSingle();
  const repName = `${rep?.first_name ?? ""} ${rep?.last_name ?? ""}`.trim();

  const results: PinResult[] = [];

  for (const raw of pins) {
    const v = validatePin(raw);
    if (!v.ok) {
      results.push({ client_mutation_id: v.client_mutation_id, ok: false, code: v.code, error: v.error });
      continue;
    }
    const pin = v.pin;
    const cmid = pin.client_mutation_id;

    // Idempotency lookup
    const { data: existing } = await svc
      .from("canvass_pin_mutations")
      .select("contact_id, result_code, result_payload, server_created_at")
      .eq("tenant_id", tenantId)
      .eq("client_mutation_id", cmid)
      .maybeSingle();

    if (existing) {
      results.push({
        client_mutation_id: cmid,
        ok: true,
        contact_id: existing.contact_id ?? "",
        replayed: true,
        server_created_at: existing.server_created_at,
        code: existing.result_code,
      });
      continue;
    }

    // Conflict detection: same tenant, ~same lat/lng (no address_hash on contacts)
    const { data: nearby } = await svc
      .from("contacts")
      .select("id")
      .eq("tenant_id", tenantId)
      .gte("latitude", pin.latitude - LATLNG_TOL)
      .lte("latitude", pin.latitude + LATLNG_TOL)
      .gte("longitude", pin.longitude - LATLNG_TOL)
      .lte("longitude", pin.longitude + LATLNG_TOL)
      .eq("is_deleted", false)
      .limit(1);

    if (nearby && nearby.length > 0) {
      const existingContactId = nearby[0].id;
      // Persist ledger so future replays of this cmid are stable
      const { data: ledger } = await svc
        .from("canvass_pin_mutations")
        .insert({
          tenant_id: tenantId,
          user_id: userId,
          client_mutation_id: cmid,
          contact_id: existingContactId,
          result_code: "address_conflict",
          result_payload: { existing_contact_id: existingContactId },
          client_created_at: typeof pin.client_created_at === "string" ? pin.client_created_at : null,
        })
        .select("server_created_at")
        .maybeSingle();
      results.push({
        client_mutation_id: cmid,
        ok: true,
        contact_id: existingContactId,
        replayed: false,
        server_created_at: ledger?.server_created_at ?? new Date().toISOString(),
        code: "address_conflict",
      });
      continue;
    }

    // Insert contact (server-set tenant_id)
    const pd = (pin.property_details ?? {}) as Record<string, any>;
    const addr = (pin.address ?? {}) as Record<string, any>;
    const meta = (pin.pin_metadata ?? {}) as Record<string, any>;

    const { data: contact, error: contactErr } = await svc
      .from("contacts")
      .insert({
        tenant_id: tenantId,
        first_name: pd.homeowner_first_name || "Canvass",
        last_name: pd.homeowner_last_name || "Lead",
        address_street: addr.street ?? null,
        address_city: addr.city ?? null,
        address_state: addr.state ?? null,
        address_zip: addr.zip ?? null,
        latitude: pin.latitude,
        longitude: pin.longitude,
        lead_source: "canvassing",
        lead_source_details: {
          canvass_app: "pitch_canvass",
          client_mutation_id: cmid,
          client_created_at: typeof pin.client_created_at === "string" ? pin.client_created_at : null,
          rep_id: userId,
        },
        notes: typeof pin.notes === "string" ? pin.notes : null,
        created_by: userId,
        assigned_to: userId,
        qualification_status: "new_lead",
        metadata: {
          canvassing_data: meta,
          property_details: pd,
          canvassed_by: userId,
          canvassed_by_name: repName,
        },
      })
      .select("id")
      .single();

    if (contactErr || !contact) {
      results.push({
        client_mutation_id: cmid,
        ok: false,
        code: "insert_failed",
        error: contactErr?.message ?? "contact insert failed",
      });
      continue;
    }

    // Optional disposition: validate same-tenant before applying
    let dispositionCode: string | undefined;
    if (typeof pin.disposition_id === "string" && pin.disposition_id.length > 0) {
      const { data: disp } = await svc
        .from("dialer_dispositions")
        .select("id, is_positive, tenant_id")
        .eq("id", pin.disposition_id)
        .maybeSingle();
      if (!disp || disp.tenant_id !== tenantId) {
        dispositionCode = "disposition_rejected";
      } else {
        await svc
          .from("contacts")
          .update({ qualification_status: disp.is_positive ? "qualified" : "not_interested" })
          .eq("id", contact.id)
          .eq("tenant_id", tenantId);
      }
    }

    // Ledger
    const { data: ledger } = await svc
      .from("canvass_pin_mutations")
      .insert({
        tenant_id: tenantId,
        user_id: userId,
        client_mutation_id: cmid,
        contact_id: contact.id,
        result_code: "created",
        result_payload: { contact_id: contact.id, disposition_code: dispositionCode ?? null },
        client_created_at: typeof pin.client_created_at === "string" ? pin.client_created_at : null,
      })
      .select("server_created_at")
      .maybeSingle();

    results.push({
      client_mutation_id: cmid,
      ok: true,
      contact_id: contact.id,
      replayed: false,
      server_created_at: ledger?.server_created_at ?? new Date().toISOString(),
      code: dispositionCode ?? "created",
    });
  }

  return jsonOk(c, { results, server_time: new Date().toISOString() });
}
