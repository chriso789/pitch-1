import { describe, it, expect } from "vitest";
import { resolveAerialCandidateGraph } from "../aerialCandidateGraphResolver";

describe("resolveAerialCandidateGraph", () => {
  it("resolves top-level executed graph with 12 edges", () => {
    const res = resolveAerialCandidateGraph({
      aerial_candidate_roof_graph: { executed: true, edges: new Array(12).fill({}) },
    });
    expect(res).toEqual({ present: true, executed: true, edgeCount: 12, source: "root" });
  });

  it("uses dsm_planar_graph_debug fallback", () => {
    const res = resolveAerialCandidateGraph({
      dsm_planar_graph_debug: {
        aerial_candidate_roof_graph: { executed: true, edges: new Array(12).fill({}) },
      },
    });
    expect(res).toEqual({
      present: true, executed: true, edgeCount: 12, source: "dsm_planar_graph_debug",
    });
  });

  it("uses terminal pre_phase3_5_preempt fallback", () => {
    const res = resolveAerialCandidateGraph({
      terminal_debug_payload: {
        pre_phase3_5_preempt: {
          aerial_candidate_roof_graph: { executed: true, edges: new Array(12).fill({}) },
        },
      },
    });
    expect(res).toEqual({
      present: true, executed: true, edgeCount: 12, source: "terminal_preempt",
    });
  });

  it("handles executed but empty edges", () => {
    const res = resolveAerialCandidateGraph({
      aerial_candidate_roof_graph: { executed: true, edges: [] },
    });
    expect(res).toEqual({ present: true, executed: true, edgeCount: 0, source: "root" });
  });

  it("returns all-false for missing graph", () => {
    const res = resolveAerialCandidateGraph({});
    expect(res).toEqual({ present: false, executed: false, edgeCount: 0, source: null });
  });

  it("stale root does not mask nested executed graph", () => {
    const res = resolveAerialCandidateGraph({
      aerial_candidate_roof_graph: { executed: false, edges: [] },
      dsm_planar_graph_debug: {
        aerial_candidate_roof_graph: { executed: true, edges: new Array(8).fill({}) },
      },
    });
    expect(res).toEqual({
      present: true, executed: true, edgeCount: 8, source: "dsm_planar_graph_debug",
    });
  });

  it("falls back to candidate_faces.length", () => {
    const res = resolveAerialCandidateGraph({
      aerial_candidate_roof_graph: { executed: true, candidate_faces: new Array(5).fill({}) },
    });
    expect(res.edgeCount).toBe(5);
  });

  it("falls back to numeric edge_count", () => {
    const res = resolveAerialCandidateGraph({
      aerial_candidate_roof_graph: { executed: true, edge_count: 7 },
    });
    expect(res.edgeCount).toBe(7);
  });

  it("falls back to numeric edges_count", () => {
    const res = resolveAerialCandidateGraph({
      aerial_candidate_roof_graph: { executed: true, edges_count: 9 },
    });
    expect(res.edgeCount).toBe(9);
  });

  it("best non-zero count wins across sources", () => {
    const res = resolveAerialCandidateGraph({
      aerial_candidate_roof_graph: { executed: true, edges: [] },
      terminal_debug_payload: {
        pre_phase3_5_preempt: {
          aerial_candidate_roof_graph: { executed: true, edges: new Array(12).fill({}) },
        },
      },
    });
    expect(res).toEqual({
      present: true, executed: true, edgeCount: 12, source: "terminal_preempt",
    });
  });
});
