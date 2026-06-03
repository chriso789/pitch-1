// dispatchInternalWorkerJob — sends payload to external internal worker service.
// If WORKER_BASE_URL is not configured, returns dispatched=false so the runner
// can mark the skill_run as 'requires_internal_worker' and block downstream.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { ExecutorContext } from "./runner.ts";
import type { SkillDef } from "./registry.ts";

export interface DispatchResult {
  dispatched: boolean;
  worker_id?: string;
  worker_job_ref?: string;
  blocking_reason?: string;
  worker_response?: Record<string, unknown>;
}

const WORKER_BASE_URL = Deno.env.get("MSKILL_WORKER_BASE_URL") ?? "";
const WORKER_SECRET = Deno.env.get("INTERNAL_WORKER_SECRET") ?? "";

export async function dispatchInternalWorkerJob(
  svc: SupabaseClient,
  ctx: ExecutorContext,
  skill: SkillDef,
): Promise<DispatchResult> {
  if (!skill.worker_endpoint) {
    return { dispatched: false, blocking_reason: "skill has no worker endpoint" };
  }
  if (!WORKER_BASE_URL || !WORKER_SECRET) {
    return {
      dispatched: false,
      blocking_reason: "MSKILL_WORKER_BASE_URL or INTERNAL_WORKER_SECRET not configured — cannot complete from stub",
    };
  }

  // Locate registered worker for capability (advisory, not required)
  const { data: worker } = await svc.from("mskill_workers")
    .select("id, base_url, is_online")
    .eq("is_online", true)
    .limit(1)
    .maybeSingle();

  const url = `${WORKER_BASE_URL.replace(/\/$/, "")}${skill.worker_endpoint}`;
  const payload = {
    mskill_request_id: ctx.mskill_request_id,
    mskill_job_id: ctx.mskill_job_id,
    mskill_run_id: ctx.mskill_run_id,
    request_hash: ctx.request_hash,
    skill_key: skill.skill_key,
    callback_url: `${Deno.env.get("SUPABASE_URL") ?? ""}/functions/v1/measurement-worker`,
    callback_route: "/worker/callback",
    callback_secret: WORKER_SECRET,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-worker-secret": WORKER_SECRET,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return {
        dispatched: false,
        worker_id: worker?.id,
        blocking_reason: `worker returned ${res.status}`,
        worker_response: { status: res.status },
      };
    }
    const body = await res.json().catch(() => ({}));
    return {
      dispatched: true,
      worker_id: worker?.id,
      worker_job_ref: body?.worker_job_ref ?? body?.job_id ?? null,
      worker_response: body,
    };
  } catch (err) {
    return {
      dispatched: false,
      worker_id: worker?.id,
      blocking_reason: `worker dispatch error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
