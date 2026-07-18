// Edge API client — calls routed Supabase Edge Functions through the existing
// `supabase.functions.invoke` SDK. Routes are encoded in the request body via
// the `__route` field; the routed function's Hono router dispatches on it.

import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/supabase-js";

type EdgeOk<T> = { ok: true; data: T; requestId: string };
type EdgeErr = { ok: false; error: string; code: string; requestId: string };
export type EdgeResponse<T> = EdgeOk<T> | EdgeErr;

export async function edgeApi<T = unknown>(
  fn: string,
  route: string,
  body: Record<string, unknown> = {},
  init?: { headers?: Record<string, string> },
): Promise<{ data: T | null; error: string | null; raw?: EdgeResponse<T> }> {
  const { data, error } = await supabase.functions.invoke<EdgeResponse<T>>(fn, {
    body: { __route: route, ...body },
    headers: { "x-route": route, ...(init?.headers ?? {}) },
  });
  if (error) {
    // supabase.functions.invoke returns a generic "non-2xx" message and buries
    // the actual response body in FunctionsHttpError.context. Surface it.
    let detail = error.message ?? "invoke_failed";
    if (error instanceof FunctionsHttpError) {
      try {
        const text = await error.context.clone().text();
        if (text) {
          try {
            const parsed = JSON.parse(text);
            detail = parsed?.error || parsed?.message || text;
          } catch {
            detail = text;
          }
        }
      } catch { /* ignore */ }
    }
    console.error(`[edgeApi] ${fn}${route} failed:`, detail);
    return { data: null, error: detail };
  }
  if (!data) return { data: null, error: "empty_response" };
  if (data.ok === false) return { data: null, error: data.error, raw: data };
  return { data: (data as EdgeOk<T>).data, error: null, raw: data };
}
