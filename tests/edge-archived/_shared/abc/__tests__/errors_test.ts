import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { interpretAbcError, mapAbcError } from "../errors.ts";

Deno.test("mapAbcError returns stable codes for the documented statuses", () => {
  assertEquals(mapAbcError(499, {}), "abc_waf_blocked");
  assertEquals(mapAbcError(0, {}), "abc_network_error");
  assertEquals(mapAbcError(400, {}), "abc_400_bad_payload");
  assertEquals(mapAbcError(401, {}), "abc_401_unauthorized");
  assertEquals(mapAbcError(403, {}), "abc_403_forbidden");
  assertEquals(mapAbcError(404, {}), "abc_404_not_found");
  assertEquals(mapAbcError(429, {}), "abc_429_rate_limited");
  assertEquals(mapAbcError(500, {}), "abc_500_upstream");
  assertEquals(mapAbcError(502, {}), "abc_500_upstream");
  assertEquals(mapAbcError(418, {}), "abc_418");
});

Deno.test("mapAbcError pulls OAuth-specific errors out of the body", () => {
  assertEquals(
    mapAbcError(400, { error: "invalid_redirect_uri" }),
    "invalid_redirect_uri",
  );
  assertEquals(
    mapAbcError(400, { code: "INVALID_CLIENT" }),
    "invalid_client",
  );
  assertEquals(mapAbcError(400, { error: "missing scope" }), "missing_scope");
});

Deno.test("interpretAbcError explains WAF blocks distinctly", () => {
  const msg = interpretAbcError("abc_waf_blocked", 499, {});
  if (!msg || !msg.toLowerCase().includes("imperva")) {
    throw new Error(`expected imperva explanation, got ${msg}`);
  }
});

Deno.test("interpretAbcError surfaces 400 errorMessage verbatim", () => {
  assertEquals(
    interpretAbcError("abc_400_bad_payload", 400, { errorMessage: "shipTo missing" }),
    "shipTo missing",
  );
  assertEquals(interpretAbcError("abc_500_upstream", 500, {}), null);
  assertEquals(interpretAbcError(null, 400, {}), null);
});
