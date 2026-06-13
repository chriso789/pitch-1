// Per (tenant, user, supplier, action) sliding-window rate limiter for QXO.
// Backed by supplier_rate_limits.

import { serviceClient } from "../router.ts";

export interface RateLimitOptions {
  tenantId: string;
  userId?: string | null;
  action: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  retryAfterSeconds: number;
}

export async function checkRateLimit(opts: RateLimitOptions): Promise<RateLimitResult> {
  const svc = serviceClient();
  const now = new Date();
  // Bucket the window: round window_start down to windowSeconds.
  const bucketMs = opts.windowSeconds * 1000;
  const bucketStart = new Date(Math.floor(now.getTime() / bucketMs) * bucketMs);
  const userId = opts.userId ?? "00000000-0000-0000-0000-000000000000";

  // Upsert and increment.
  const { data: existing } = await svc
    .from("supplier_rate_limits")
    .select("id,count")
    .eq("tenant_id", opts.tenantId)
    .eq("user_id", userId)
    .eq("supplier", "qxo")
    .eq("action", opts.action)
    .eq("window_start", bucketStart.toISOString())
    .maybeSingle();

  let count = 1;
  if (existing?.id) {
    count = (existing.count ?? 0) + 1;
    await svc
      .from("supplier_rate_limits")
      .update({ count, updated_at: now.toISOString() })
      .eq("id", existing.id);
  } else {
    const { error } = await svc.from("supplier_rate_limits").insert({
      tenant_id: opts.tenantId,
      user_id: userId,
      supplier: "qxo",
      action: opts.action,
      window_start: bucketStart.toISOString(),
      count: 1,
    });
    // On race-condition UNIQUE conflict, re-read.
    if (error && error.code === "23505") {
      const { data: again } = await svc
        .from("supplier_rate_limits")
        .select("id,count")
        .eq("tenant_id", opts.tenantId)
        .eq("user_id", userId)
        .eq("supplier", "qxo")
        .eq("action", opts.action)
        .eq("window_start", bucketStart.toISOString())
        .maybeSingle();
      count = (again?.count ?? 0) + 1;
      if (again?.id) {
        await svc.from("supplier_rate_limits").update({ count }).eq("id", again.id);
      }
    }
  }

  const allowed = count <= opts.limit;
  const retryAfterSeconds = allowed
    ? 0
    : Math.max(1, Math.ceil((bucketStart.getTime() + bucketMs - now.getTime()) / 1000));

  return { allowed, count, limit: opts.limit, retryAfterSeconds };
}
