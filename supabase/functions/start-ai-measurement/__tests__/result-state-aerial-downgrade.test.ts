import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeResultStateForWrite } from "../../_shared/result-state.ts";

Deno.test("result-state: dsm_validation_unavailable normalizes to perimeter_only", () => {
  const out = normalizeResultStateForWrite("dsm_validation_unavailable", {});
  assertEquals(out, "perimeter_only");
});

Deno.test("result-state: explicit perimeter_only passes through", () => {
  const out = normalizeResultStateForWrite("perimeter_only", {});
  assertEquals(out, "perimeter_only");
});
