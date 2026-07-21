// Shared ABC Core — Phase 1A barrel export.
//
// Both `abc-api-proxy` (legacy) and `supplier-api/abc/proxy` (v2) will
// eventually import from this file. During Phase 1A the modules exist but
// neither handler imports them yet; extraction happens in Phase 1B.
//
// See docs/abc-integration-trace.md for the migration plan and
// supabase/functions/_shared/abc/README.md for module-by-module status.

export * from "./env.ts";
export * from "./pkce.ts";
export * from "./waf.ts";
export * from "./errors.ts";
export * from "./http.ts";
export * from "./types.ts";
export * from "./productNormalizer.ts";
export * from "./branchVerifier.ts";
export * from "./availabilityParser.ts";
