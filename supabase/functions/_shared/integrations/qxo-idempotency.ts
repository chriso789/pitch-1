// Idempotency wrapper for QXO write actions.
// Backed by supplier_idempotency_keys (UNIQUE tenant_id, supplier, action, idempotency_key).
//
// Behavior:
//   - First request: insert row {status:'started', request_hash}, run `run()`, then update with result.
//   - Duplicate key + same hash: return stored response (with `__idempotent_replay: true`).
//   - Duplicate key + different hash: throw IdempotencyConflictError → caller returns 409.

import { serviceClient } from "../router.ts";

export class IdempotencyConflictError extends Error {
  constructor(public storedHash: string, public newHash: string) {
    super("idempotency_key_reused_with_different_payload");
    this.name = "IdempotencyConflictError";
  }
}

export interface IdempotencyOptions {
  tenantId: string;
  action: string;
  key: string;
  payload: unknown;
  run: () => Promise<{ status: "succeeded" | "failed" | "pending_verification"; response: unknown }>;
}

export interface IdempotencyResult {
  status: "succeeded" | "failed" | "pending_verification";
  response: unknown;
  replayed: boolean;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function canonicalize(value: unknown): string {
  // Stable JSON: sort object keys recursively.
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

export async function withIdempotency(opts: IdempotencyOptions): Promise<IdempotencyResult> {
  if (!opts.key || typeof opts.key !== "string" || opts.key.length < 8) {
    throw new Error("idempotency_key_required");
  }
  const svc = serviceClient();
  const requestHash = await sha256Hex(canonicalize(opts.payload));

  // Try to insert the started row. On UNIQUE violation, read existing.
  const { error: insertErr } = await svc.from("supplier_idempotency_keys").insert({
    tenant_id: opts.tenantId,
    supplier: "qxo",
    action: opts.action,
    idempotency_key: opts.key,
    request_hash: requestHash,
    status: "started",
  });

  if (insertErr && insertErr.code !== "23505") {
    // 23505 = unique_violation
    throw insertErr;
  }

  if (insertErr && insertErr.code === "23505") {
    // Existing row — load it.
    const { data: existing } = await svc
      .from("supplier_idempotency_keys")
      .select("status,request_hash,response_json")
      .eq("tenant_id", opts.tenantId)
      .eq("supplier", "qxo")
      .eq("action", opts.action)
      .eq("idempotency_key", opts.key)
      .maybeSingle();

    if (!existing) throw new Error("idempotency_lookup_failed");

    if (existing.request_hash && existing.request_hash !== requestHash) {
      throw new IdempotencyConflictError(String(existing.request_hash), requestHash);
    }

    // Same hash. If still 'started', another request is in flight; surface a 409-style retry hint.
    if (existing.status === "started") {
      return { status: "pending_verification", response: { in_flight: true }, replayed: true };
    }

    return {
      status: existing.status as IdempotencyResult["status"],
      response: existing.response_json,
      replayed: true,
    };
  }

  // We inserted the started row. Run the action.
  try {
    const result = await opts.run();
    await svc
      .from("supplier_idempotency_keys")
      .update({
        status: result.status,
        response_json: result.response as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", opts.tenantId)
      .eq("supplier", "qxo")
      .eq("action", opts.action)
      .eq("idempotency_key", opts.key);

    return { ...result, replayed: false };
  } catch (e) {
    // Persist a failed status so we don't double-submit on retry of the same key.
    await svc
      .from("supplier_idempotency_keys")
      .update({
        status: "failed",
        response_json: { error: e instanceof Error ? e.message : String(e) },
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", opts.tenantId)
      .eq("supplier", "qxo")
      .eq("action", opts.action)
      .eq("idempotency_key", opts.key);
    throw e;
  }
}
