// Edge API client — calls routed Supabase Edge Functions through the existing
// `supabase.functions.invoke` SDK. Routes are encoded in the request body via
// the `__route` field; the routed function's Hono router dispatches on it.
//
// Usage:
//   import { edgeApi } from "@/lib/edgeApi";
//   const { data, error } = await edgeApi("messaging-api", "/sms/send", { to, message });

import { supabase } from "@/integrations/supabase/client";

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
  if (error) return { data: null, error: error.message ?? "invoke_failed" };
  if (!data) return { data: null, error: "empty_response" };
  if (data.ok === false) return { data: null, error: data.error, raw: data };
  return { data: (data as EdgeOk<T>).data, error: null, raw: data };
}
