import { assertEquals } from "jsr:@std/assert@1";
import { clampStoredProfitPercent } from "./profit.ts";

Deno.test("caps an 89.82% margin draft at the 85% database limit", () => {
  assertEquals(clampStoredProfitPercent(89.82330097110253), 85);
});

Deno.test("keeps normal margins unchanged (rounded to cents)", () => {
  assertEquals(clampStoredProfitPercent(32.456), 32.46);
});

Deno.test("caps losses below -100% at -100", () => {
  assertEquals(clampStoredProfitPercent(-250), -100);
});

Deno.test("non-finite margin stores as 0", () => {
  assertEquals(clampStoredProfitPercent(NaN), 0);
});
