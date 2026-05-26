// Fire-and-forget usage tracker for edge functions. Never throws into caller.
// Calls platform-api/track-usage via the internal worker secret. If the secret
// isn't configured (dev), the call is a no-op.
//
// Usage:
//   import { trackUsage } from "../_shared/track-usage.ts";
//   trackUsage({ tenantId, userId, provider: "openai", eventType: "ai_tokens_input", quantity: 1234, edgeFunction: "estimate-generator" });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const INTERNAL_WORKER_SECRET = Deno.env.get("INTERNAL_WORKER_SECRET") ?? "";

export interface TrackUsageInput {
  tenantId?: string | null;
  userId?: string | null;
  provider: string;
  eventType: string;
  featureArea?: string | null;
  quantity?: number;
  unit?: string | null;
  edgeFunction?: string | null;
  requestId?: string | null;
  status?: "success" | "error" | string;
  metadata?: Record<string, unknown>;
}

export function trackUsage(input: TrackUsageInput): void {
  if (!SUPABASE_URL || !INTERNAL_WORKER_SECRET) return;
  const payload = {
    __route: "/track-usage",
    tenant_id: input.tenantId ?? null,
    user_id: input.userId ?? null,
    provider: input.provider,
    event_type: input.eventType,
    feature_area: input.featureArea ?? null,
    quantity: input.quantity ?? 1,
    unit: input.unit ?? null,
    edge_function: input.edgeFunction ?? null,
    request_id: input.requestId ?? null,
    status: input.status ?? "success",
    metadata: input.metadata ?? {},
  };
  try {
    // Fire-and-forget; never await, never throw.
    fetch(`${SUPABASE_URL}/functions/v1/platform-api`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": INTERNAL_WORKER_SECRET,
        "x-route": "/track-usage",
      },
      body: JSON.stringify(payload),
    }).catch(() => {/* swallow */});
  } catch {/* swallow */}
}

/** Check whether an action is allowed under the tenant's monthly plan limit. */
export async function checkUsageLimit(input: {
  tenantId: string;
  eventType: string;
  quantity?: number;
}): Promise<{ allowed: boolean; current_usage: number; limit: number | null; percent_used: number; warning: boolean; reason: string }> {
  if (!SUPABASE_URL || !INTERNAL_WORKER_SECRET) {
    return { allowed: true, current_usage: 0, limit: null, percent_used: 0, warning: false, reason: "secret_unconfigured" };
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/platform-api`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": INTERNAL_WORKER_SECRET,
        "x-route": "/check-usage-limit",
      },
      body: JSON.stringify({
        __route: "/check-usage-limit",
        tenant_id: input.tenantId,
        event_type: input.eventType,
        quantity: input.quantity ?? 1,
      }),
    });
    const json: any = await res.json();
    if (json?.ok && json.data) return json.data;
  } catch {/* swallow */}
  return { allowed: true, current_usage: 0, limit: null, percent_used: 0, warning: false, reason: "check_failed" };
}
