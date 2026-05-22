// LEGACY SHIM (Slice 2B). Forwards to document-worker /parse/blueprint.
// Deterministic blueprint pipeline; no AI fallback. To be deleted after the
// quiet window once all callers migrate to edgeApi("document-worker", "/parse/blueprint").
import { forward } from "../_shared/shim.ts";
Deno.serve((req) => forward(req, "document-worker", "/parse/blueprint", "parse-blueprint-document"));
