// abc-api-proxy is routed through the grouped `supplier-api` function at `/abc/proxy`.
// The actual handler is supabase/functions/abc-api-proxy/handler.ts, mounted by
// supabase/functions/supplier-api/index.ts. This shim preserves the legacy
// `supabase.functions.invoke("abc-api-proxy", ...)` URL so frontend callers
// (ABCConnectionSettings.tsx, PushToQXOButton.tsx, etc.) do not need to change.
import { forward } from "../_shared/shim.ts";
Deno.serve((req) => forward(req, "supplier-api", "/abc/proxy", "abc-api-proxy"));
