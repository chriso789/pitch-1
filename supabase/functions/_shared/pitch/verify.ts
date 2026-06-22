// PR #5 — vendor-free per-facet pitch verification orchestrator.
//
// This helper fans out to DSM plane fit, Solar roofSegmentStats, and the
// Street/visual edge-angle cross-check, then scores the three streams with the
// canonical consensus gate. It is intentionally pure aside from the optional
// caller-supplied Street View metadata/edge observations; active routes persist
// the returned facet rows and rollup.

import {
  fitFacetDsmPlane,
  type DsmGridInput,
  type PxPoint,
} from "./dsm-plane-fit.ts";
import {
  lookupSolarPitchForFacet,
  type SolarRoofSegmentLike,
} from "./solar-pitch-lookup.ts";
import {
  buildStreetViewPitchEvidence,
  type StreetViewEdgeAngleInput,
} from "./streetview-edge-angle.ts";
import {
  scorePitchConsensus,
  type PitchConsensusResult,
} from "./consensus.ts";

export interface PitchVerificationFacetInput {
  facet_id: string | number;
  polygon_px: PxPoint[];
  centroid_px?: PxPoint | null;
  azimuth_degrees?: number | null;
  streetview?: Omit<StreetViewEdgeAngleInput, "facet_id" | "reference_pitch_rise_over_12"> | null;
}

export interface VerifyPitchPerFacetInput {
  facets: PitchVerificationFacetInput[];
  dsm?: DsmGridInput | null;
  solar_segments?: SolarRoofSegmentLike[] | null;
  agreement_tolerance_rise_over_12?: number;
}

export interface PitchFacetVerificationRow extends PitchConsensusResult {
  dsm_plane_fit: ReturnType<typeof fitFacetDsmPlane> | null;
  solar_pitch: ReturnType<typeof lookupSolarPitchForFacet> | null;
  streetview_pitch: ReturnType<typeof buildStreetViewPitchEvidence> | null;
  db_patch: Record<string, unknown>;
}

export interface VerifyPitchPerFacetResult {
  status: "passed" | "failed";
  score: number;
  hard_fail_reason: "pitch_disagreement" | "pitch_insufficient_evidence" | null;
  block_customer_report: boolean;
  facet_results: PitchFacetVerificationRow[];
  summary: {
    facet_count: number;
    high_count: number;
    medium_count: number;
    low_count: number;
    insufficient_evidence_count: number;
  };
}

export function verifyPitchPerFacet(input: VerifyPitchPerFacetInput): VerifyPitchPerFacetResult {
  const facetResults: PitchFacetVerificationRow[] = [];

  for (const facet of input.facets) {
    const dsmFit = input.dsm
      ? fitFacetDsmPlane({
        facet_id: facet.facet_id,
        facet_polygon_px: facet.polygon_px,
        dsm: input.dsm,
      })
      : null;

    const solarPitch = lookupSolarPitchForFacet({
      facet_id: facet.facet_id,
      polygon_px: facet.polygon_px,
      centroid_px: facet.centroid_px ?? null,
      azimuth_degrees: facet.azimuth_degrees ?? null,
    }, input.solar_segments ?? []);

    const streetviewPitch = facet.streetview
      ? buildStreetViewPitchEvidence({
        facet_id: facet.facet_id,
        ...facet.streetview,
        reference_pitch_rise_over_12: dsmFit?.pitch_rise_over_12 ?? solarPitch.pitch_rise_over_12,
      })
      : null;

    const consensus = scorePitchConsensus({
      facet_id: facet.facet_id,
      agreement_tolerance_rise_over_12: input.agreement_tolerance_rise_over_12,
      evidences: [
        dsmFit?.pitch_rise_over_12 != null
          ? {
            stream: "dsm" as const,
            pitch_degrees: dsmFit.pitch_degrees,
            pitch_rise_over_12: dsmFit.pitch_rise_over_12,
            confidence: dsmFit.status === "passed" ? 0.95 : dsmFit.status === "needs_review" ? 0.62 : 0,
            residual: dsmFit.rmse_m,
          }
          : null,
        solarPitch.pitch_rise_over_12 != null
          ? {
            stream: "solar" as const,
            pitch_degrees: solarPitch.pitch_degrees,
            pitch_rise_over_12: solarPitch.pitch_rise_over_12,
            confidence: solarPitch.confidence,
          }
          : null,
        streetviewPitch?.pitch_rise_over_12 != null
          ? {
            stream: "streetview" as const,
            pitch_degrees: streetviewPitch.pitch_degrees,
            pitch_rise_over_12: streetviewPitch.pitch_rise_over_12,
            confidence: streetviewPitch.confidence,
          }
          : null,
      ].filter(Boolean) as any,
    });

    const row: PitchFacetVerificationRow = {
      ...consensus,
      dsm_plane_fit: dsmFit,
      solar_pitch: solarPitch,
      streetview_pitch: streetviewPitch,
      db_patch: buildFacetDbPatch(consensus),
    };
    facetResults.push(row);
  }

  const high = facetResults.filter((f) => f.pitch_agreement_state === "high").length;
  const medium = facetResults.filter((f) => f.pitch_agreement_state === "medium").length;
  const low = facetResults.filter((f) => f.pitch_agreement_state === "low").length;
  const insufficient = facetResults.filter((f) => f.pitch_agreement_state === "insufficient_evidence").length;
  const score = facetResults.length
    ? Math.round(((high + medium * 0.9) / facetResults.length) * 10_000) / 10_000
    : 0;
  const hardFailReason = low > 0 ? "pitch_disagreement" : insufficient > 0 ? "pitch_insufficient_evidence" : null;

  return {
    status: hardFailReason ? "failed" : "passed",
    score,
    hard_fail_reason: hardFailReason,
    block_customer_report: !!hardFailReason,
    facet_results: facetResults,
    summary: {
      facet_count: facetResults.length,
      high_count: high,
      medium_count: medium,
      low_count: low,
      insufficient_evidence_count: insufficient,
    },
  };
}

function buildFacetDbPatch(result: PitchConsensusResult): Record<string, unknown> {
  return {
    pitch_dsm_deg: result.pitch_dsm_deg,
    pitch_solar_deg: result.pitch_solar_deg,
    pitch_streetview_deg: result.pitch_streetview_deg,
    pitch_dsm_rise_over_12: result.pitch_dsm_rise_over_12,
    pitch_solar_rise_over_12: result.pitch_solar_rise_over_12,
    pitch_streetview_rise_over_12: result.pitch_streetview_rise_over_12,
    pitch_consensus_rise_over_12: result.pitch_consensus_rise_over_12,
    pitch_agreement_state: result.pitch_agreement_state,
    pitch_source_final: result.pitch_source_final,
    pitch_confidence: result.pitch_confidence,
    pitch_verification_json: result,
  };
}
