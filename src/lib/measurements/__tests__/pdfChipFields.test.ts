import { describe, it, expect } from "vitest";
import {
  resolveDsmSize,
  resolveDebugRoofLinesCount,
  resolveAerialCandidateEdgeCount,
  formatDsmSize,
} from "../pdfChipFields";

describe("pdfChipFields — resolveDsmSize", () => {
  it("reads registration.dsm.dsm_size_px first", () => {
    expect(
      resolveDsmSize({
        registration: { dsm: { dsm_size_px: { width: 998, height: 998 } } },
      }),
    ).toEqual({ width: 998, height: 998 });
  });

  it("falls back through canonical paths", () => {
    expect(
      resolveDsmSize({
        registration: { dsm_size_px: { width: 998, height: 998 } },
      }),
    ).toEqual({ width: 998, height: 998 });
    expect(
      resolveDsmSize({
        registration: { transform_package: { dsm_size_px: { width: 998, height: 998 } } },
      }),
    ).toEqual({ width: 998, height: 998 });
    expect(
      resolveDsmSize({ dsm_split_status: { dsm_size_px: { width: 998, height: 998 } } }),
    ).toEqual({ width: 998, height: 998 });
    expect(
      resolveDsmSize({ registration_gate: { dsm_size_px: { width: 998, height: 998 } } }),
    ).toEqual({ width: 998, height: 998 });
  });

  it("NEVER uses registration.size (that is the static-map request size)", () => {
    // Only registration.size present (640x640 static-map request) — must
    // return null, not 640x640.
    expect(
      resolveDsmSize({ registration: { size: { width: 640, height: 640 } } }),
    ).toBeNull();
  });

  it("prefers true DSM size over any static-map size sibling", () => {
    expect(
      resolveDsmSize({
        registration: {
          size: { width: 640, height: 640 },
          dsm: { dsm_size_px: { width: 998, height: 998 } },
        },
      }),
    ).toEqual({ width: 998, height: 998 });
  });

  it("formatDsmSize returns 998×998 for Fonsica-shaped payload", () => {
    expect(
      formatDsmSize({
        registration: { dsm: { dsm_size_px: { width: 998, height: 998 } } },
      }),
    ).toBe("998×998");
  });

  it("returns null / em-dash for empty grj", () => {
    expect(resolveDsmSize({})).toBeNull();
    expect(formatDsmSize({})).toBe("—");
  });
});

describe("pdfChipFields — resolveDebugRoofLinesCount", () => {
  it("reads debug_roof_lines_count first", () => {
    expect(resolveDebugRoofLinesCount({ debug_roof_lines_count: 6 })).toBe(6);
  });

  it("falls back to debug_roof_lines.length", () => {
    expect(
      resolveDebugRoofLinesCount({
        debug_roof_lines: new Array(6).fill({}),
      }),
    ).toBe(6);
  });

  it("falls back to nested dsm_planar_graph_debug.debug_roof_lines", () => {
    expect(
      resolveDebugRoofLinesCount({
        dsm_planar_graph_debug: { debug_roof_lines: new Array(6).fill({}) },
      }),
    ).toBe(6);
  });

  it("reads terminal_debug_payload paths", () => {
    expect(
      resolveDebugRoofLinesCount({
        terminal_debug_payload: { debug_roof_lines_count: 6 },
      }),
    ).toBe(6);
    expect(
      resolveDebugRoofLinesCount({
        terminal_debug_payload: { raw_debug: { debug_roof_lines_count: 6 } },
      }),
    ).toBe(6);
  });

  it("does NOT fall back to aerial_candidate_roof_graph.edges.length", () => {
    expect(
      resolveDebugRoofLinesCount({
        aerial_candidate_roof_graph: { edges: new Array(12).fill({}) },
      }),
    ).toBe(0);
  });
});

describe("pdfChipFields — resolveAerialCandidateEdgeCount", () => {
  it("returns 12 from aerial_candidate_roof_graph.edges.length", () => {
    expect(
      resolveAerialCandidateEdgeCount({
        aerial_candidate_roof_graph: { executed: true, edges: new Array(12).fill({}) },
      }),
    ).toBe(12);
  });

  it("returns 0 when missing", () => {
    expect(resolveAerialCandidateEdgeCount({})).toBe(0);
  });
});
