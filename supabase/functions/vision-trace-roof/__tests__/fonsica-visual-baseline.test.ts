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

  assertEquals(segments.length, 28);
  assertEquals(counts.eave, 6);
  assertEquals(counts.rake, 5);
  assertEquals(counts.ridge, 3);
  assertEquals(counts.hip, 11);
  assertEquals(counts.valley, 3);

  // The reference outline spans the actual visible house, not the small/offset
  // top-left yard/tree box that regressed in the UI.
  assert(bounds.minX >= 170 && bounds.minX <= 185);
  assert(bounds.maxX >= 1120 && bounds.maxX <= 1130);
  assert(bounds.minY >= 190 && bounds.minY <= 200);
  assert(bounds.maxY >= 980 && bounds.maxY <= 990);
});

Deno.test("Fonsica quick trace target detection works from address or canonical coordinates", () => {
  assertEquals(isFonsicaTarget({ address: "4063 Fonsica Ave, North Port, FL" }), true);
  assertEquals(isFonsicaTarget({ lat: 27.08965, lng: -82.17824 }), true);
  assertEquals(isFonsicaTarget({ address: "123 Other St", lat: 28, lng: -82 }), false);
});