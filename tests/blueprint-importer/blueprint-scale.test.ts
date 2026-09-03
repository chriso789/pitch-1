import { describe, expect, it } from "vitest";
import {
  classifyBlueprintPage,
  extractScale,
  parseDrawingScale,
} from "../../supabase/functions/_shared/parsers/blueprint-classifier.ts";

describe("blueprint scale extraction", () => {
  it("captures a complete architectural scale after SCALE prefix", () => {
    expect(extractScale('ROOF PLAN A-201 SCALE: 1/4" = 1\'-0"')).toBe('1/4" = 1\'-0"');
  });

  it("captures fractional architectural scales without a SCALE prefix", () => {
    expect(extractScale('DETAIL 3/A501 3/16" = 1\'-0"')).toBe('3/16" = 1\'-0"');
  });

  it("captures engineering scales", () => {
    expect(extractScale('SITE PLAN SCALE 1" = 20\'-0"')).toBe('1" = 20\'-0"');
  });

  it("captures ratio scales", () => {
    expect(extractScale('FLOOR PLAN SCALE: 1:50')).toBe('1:50');
  });

  it("normalizes 1/4 inch equals 1 foot", () => {
    const scale = parseDrawingScale('1/4" = 1\'-0"');
    expect(scale?.drawing_inches).toBe(0.25);
    expect(scale?.real_inches).toBe(12);
    expect(scale?.ratio).toBe(48);
    expect(scale?.feet_per_drawing_inch).toBe(4);
    expect(scale?.format).toBe("architectural");
  });

  it("normalizes 3/16 inch equals 1 foot", () => {
    const scale = parseDrawingScale('3/16" = 1\'-0"');
    expect(scale?.ratio).toBe(64);
    expect(scale?.feet_per_drawing_inch).toBeCloseTo(16 / 3, 8);
  });

  it("normalizes engineering scales", () => {
    const scale = parseDrawingScale('1" = 20\'-0"');
    expect(scale?.ratio).toBe(240);
    expect(scale?.feet_per_drawing_inch).toBe(20);
    expect(scale?.format).toBe("engineering");
  });

  it("normalizes ratio scales", () => {
    const scale = parseDrawingScale("1:100");
    expect(scale?.ratio).toBe(100);
    expect(scale?.feet_per_drawing_inch).toBeCloseTo(100 / 12, 8);
    expect(scale?.format).toBe("ratio");
  });

  it("persists the full scale text in page classification", () => {
    const result = classifyBlueprintPage(
      1,
      'A-201 ROOF PLAN RIDGE VALLEY HIP PITCH 6/12 SCALE: 1/8" = 1\'-0" SHINGLE ROOFING',
    );
    expect(result.page_type).toBe("roof_plan");
    expect(result.scale_text).toBe('1/8" = 1\'-0"');
  });
});
