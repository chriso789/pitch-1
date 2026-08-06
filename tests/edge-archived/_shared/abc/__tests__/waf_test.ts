import { assert, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { detectWaf } from "../waf.ts";

Deno.test("detectWaf returns false for empty body", () => {
  assertFalse(detectWaf(403, ""));
  assertFalse(detectWaf(403, null));
  assertFalse(detectWaf(403, undefined));
});

Deno.test("detectWaf catches _incapsula_resource marker on any status", () => {
  assert(detectWaf(200, "<script>var _Incapsula_Resource=..."));
  assert(detectWaf(500, "var _incapsula_resource = 'abc'"));
});

Deno.test("detectWaf catches incident id + incapsula/imperva combo", () => {
  assert(detectWaf(403, "incident_id: 123-incapsula"));
  assert(detectWaf(403, "Incident ID 999 - Imperva Security"));
  assertFalse(detectWaf(403, "incident_id 123 (no waf keyword)"));
});

Deno.test("detectWaf recognises typical 403/406/503 HTML challenges", () => {
  const body = "<html>request unsuccessful</html>";
  assert(detectWaf(403, body));
  assert(detectWaf(406, body));
  assert(detectWaf(503, body));
  // Wrong status codes should not trigger.
  assertFalse(detectWaf(400, body));
  assertFalse(detectWaf(500, body));
});

Deno.test("detectWaf ignores harmless upstream JSON errors", () => {
  assertFalse(detectWaf(400, '{"error":"bad payload"}'));
  assertFalse(detectWaf(500, '{"errorMessage":"internal"}'));
});
