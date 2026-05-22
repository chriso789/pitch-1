// LEGACY SHIM (Slice 2B). Forwards to document-worker /classify-pages.
// Deterministic plan_pages re-classification; no AI. To be deleted after the
// quiet window once all callers migrate to edgeApi("document-worker", "/classify-pages").
import { forward } from "../_shared/shim.ts";
Deno.serve((req) => forward(req, "document-worker", "/classify-pages", "classify-blueprint-pages"));
