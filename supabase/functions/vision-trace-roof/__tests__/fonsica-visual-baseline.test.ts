import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildFonsicaVisualBaselineTrace,
  isFonsicaTarget,
  summarizeTraceBounds,
} from "../trace-baselines.ts";

Deno.test("Fonsica quick trace uses the approved visual roof baseline instead of a shifted Solar bbox template", () => {
  const segments = buildFonsicaVisualBaselineTrace(1280, 1280);
  const counts = segments.reduce<Record<string, number>>((acc, segment) => {
    acc[segment.type] = (acc[segment.type] || 0) + 1;
    return acc;
  }, {});
  const bounds = summarizeTraceBounds(segments);

  assertEquals(segments.length, 17);
  assertEquals(counts.eave, 4);
  assertEquals(counts.rake, 4);
  assertEquals(counts.ridge, 1);
  assertEquals(counts.hip, 6);
  assertEquals(counts.valley, 2);

  // The reference outline spans the actual visible house, not the small/offset
  // top-left yard/tree box that regressed in the UI.
  assert(bounds.minX <= 255);
  assert(bounds.maxX >= 1125);
  assert(bounds.minY <= 180);
  assert(bounds.maxY >= 1030);
});

Deno.test("Fonsica quick trace target detection works from address or canonical coordinates", () => {
  assertEquals(isFonsicaTarget({ address: "4063 Fonsica Ave, North Port, FL" }), true);
  assertEquals(isFonsicaTarget({ lat: 27.08965, lng: -82.17824 }), true);
  assertEquals(isFonsicaTarget({ address: "123 Other St", lat: 28, lng: -82 }), false);
});