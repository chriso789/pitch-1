// PR #5 — three-stream pitch consensus.
// Vendor-free: only DSM, Solar, and visual/street-facing evidence may contribute.

export type PitchStream = "dsm" | "solar" | "streetview";
export type PitchAgreementState = "high" | "medium" | "low" | "insufficient_evidence";
export type PitchSourceFinal = "dsm" | "solar" | "streetview" | "consensus" | "unavailable";
export type PitchConfidence = "high" | "medium" | "low";

export interface PitchEvidenceValue {
  stream: PitchStream;
  pitch_degrees?: number | null;
  pitch_rise_over_12?: number | null;
  confidence?: number | null;
  residual?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface PitchConsensusInput {
  facet_id: string | number;
  evidences: PitchEvidenceValue[];
  agreement_tolerance_rise_over_12?: number;
}

export interface PitchConsensusResult {
  facet_id: string | number;
  pitch_agreement_state: PitchAgreementState;
  pitch_confidence: PitchConfidence;
  pitch_source_final: PitchSourceFinal;
  pitch_consensus_rise_over_12: number | null;
  pitch_consensus_deg: number | null;
  pitch_dsm_rise_over_12: number | null;
  pitch_solar_rise_over_12: number | null;
  pitch_streetview_rise_over_12: number | null;
  pitch_dsm_deg: number | null;
  pitch_solar_deg: number | null;
  pitch_streetview_deg: number | null;
  agreeing_streams: PitchStream[];
  usable_streams: PitchStream[];
  max_delta_rise_over_12: number | null;
  pair_deltas: Record<string, number | null>;
  hard_fail_reason: "pitch_disagreement" | null;
  block_customer_report: boolean;
}

const DEFAULT_TOLERANCE_RISE_OVER_12 = 1.0;

export function scorePitchConsensus(input: PitchConsensusInput): PitchConsensusResult {
  const tolerance = input.agreement_tolerance_rise_over_12 ?? DEFAULT_TOLERANCE_RISE_OVER_12;
  const normalized = normalizeEvidence(input.evidences);
  const byStream = new Map<PitchStream, NormalizedEvidence>();
  for (const ev of normalized) {
    const existing = byStream.get(ev.stream);
    if (!existing || ev.confidence > existing.confidence) byStream.set(ev.stream, ev);
  }

  const dsm = byStream.get("dsm") ?? null;
  const solar = byStream.get("solar") ?? null;
  const streetview = byStream.get("streetview") ?? null;
  const usable = [dsm, solar, streetview].filter((v): v is NormalizedEvidence => !!v);
  const pairDeltas = buildPairDeltas(dsm, solar, streetview);
  const maxDelta = maxFinite(Object.values(pairDeltas));

  if (usable.length < 2) {
    return buildResult(input.facet_id, dsm, solar, streetview, {
      state: "insufficient_evidence",
      confidence: "low",
      source: "unavailable",
      consensus: null,
      agreeing: usable.map((v) => v.stream),
      maxDelta,
      pairDeltas,
      hardFail: null,
      block: true,
    });
  }

  const allThreeAgree = dsm && solar && streetview &&
    allWithinTolerance([dsm, solar, streetview], tolerance);
  if (allThreeAgree) {
    return buildResult(input.facet_id, dsm, solar, streetview, {
      state: "high",
      confidence: "high",
      source: "dsm",
      consensus: dsm.pitch_rise_over_12,
      agreeing: ["dsm", "solar", "streetview"],
      maxDelta,
      pairDeltas,
      hardFail: null,
      block: false,
    });
  }

  const agreeingPairs = findAgreeingPairs(usable, tolerance);
  if (agreeingPairs.length > 0) {
    const best = agreeingPairs.sort((a, b) => a.delta - b.delta)[0];
    return buildResult(input.facet_id, dsm, solar, streetview, {
      state: "medium",
      confidence: "medium",
      source: "consensus",
      consensus: mean(best.pair.map((v) => v.pitch_rise_over_12)),
      agreeing: best.pair.map((v) => v.stream),
      maxDelta,
      pairDeltas,
      hardFail: null,
      block: false,
    });
  }

  return buildResult(input.facet_id, dsm, solar, streetview, {
    state: "low",
    confidence: "low",
    source: "unavailable",
    consensus: null,
    agreeing: [],
    maxDelta,
    pairDeltas,
    hardFail: "pitch_disagreement",
    block: true,
  });
}

export function degreesToRiseOver12(degrees: number | null | undefined): number | null {
  if (degrees == null || !Number.isFinite(degrees)) return null;
  if (degrees < 0 || degrees > 75) return null;
  return Math.tan(degrees * Math.PI / 180) * 12;
}

export function riseOver12ToDegrees(riseOver12: number | null | undefined): number | null {
  if (riseOver12 == null || !Number.isFinite(riseOver12)) return null;
  if (riseOver12 < 0 || riseOver12 > 24) return null;
  return Math.atan(riseOver12 / 12) * 180 / Math.PI;
}

interface NormalizedEvidence {
  stream: PitchStream;
  pitch_rise_over_12: number;
  pitch_degrees: number;
  confidence: number;
  residual: number | null;
}

function normalizeEvidence(evidences: PitchEvidenceValue[]): NormalizedEvidence[] {
  const out: NormalizedEvidence[] = [];
  for (const ev of evidences) {
    const rise = ev.pitch_rise_over_12 ?? degreesToRiseOver12(ev.pitch_degrees);
    const deg = ev.pitch_degrees ?? riseOver12ToDegrees(rise);
    if (rise == null || deg == null || !Number.isFinite(rise) || !Number.isFinite(deg)) continue;
    out.push({
      stream: ev.stream,
      pitch_rise_over_12: rise,
      pitch_degrees: deg,
      confidence: clamp01(Number(ev.confidence ?? 0.75)),
      residual: ev.residual == null || !Number.isFinite(ev.residual) ? null : Number(ev.residual),
    });
  }
  return out;
}

function buildPairDeltas(
  dsm: NormalizedEvidence | null,
  solar: NormalizedEvidence | null,
  streetview: NormalizedEvidence | null,
): Record<string, number | null> {
  return {
    dsm_solar: delta(dsm, solar),
    dsm_streetview: delta(dsm, streetview),
    solar_streetview: delta(solar, streetview),
  };
}

function delta(a: NormalizedEvidence | null, b: NormalizedEvidence | null): number | null {
  if (!a || !b) return null;
  return round(Math.abs(a.pitch_rise_over_12 - b.pitch_rise_over_12), 3);
}

function allWithinTolerance(values: NormalizedEvidence[], tolerance: number): boolean {
  for (let i = 0; i < values.length - 1; i++) {
    for (let j = i + 1; j < values.length; j++) {
      if (Math.abs(values[i].pitch_rise_over_12 - values[j].pitch_rise_over_12) > tolerance) return false;
    }
  }
  return true;
}

function findAgreeingPairs(values: NormalizedEvidence[], tolerance: number): Array<{ pair: [NormalizedEvidence, NormalizedEvidence]; delta: number }> {
  const pairs: Array<{ pair: [NormalizedEvidence, NormalizedEvidence]; delta: number }> = [];
  for (let i = 0; i < values.length - 1; i++) {
    for (let j = i + 1; j < values.length; j++) {
      const d = Math.abs(values[i].pitch_rise_over_12 - values[j].pitch_rise_over_12);
      if (d <= tolerance) pairs.push({ pair: [values[i], values[j]], delta: d });
    }
  }
  return pairs;
}

function buildResult(
  facetId: string | number,
  dsm: NormalizedEvidence | null,
  solar: NormalizedEvidence | null,
  streetview: NormalizedEvidence | null,
  args: {
    state: PitchAgreementState;
    confidence: PitchConfidence;
    source: PitchSourceFinal;
    consensus: number | null;
    agreeing: PitchStream[];
    maxDelta: number | null;
    pairDeltas: Record<string, number | null>;
    hardFail: "pitch_disagreement" | null;
    block: boolean;
  },
): PitchConsensusResult {
  return {
    facet_id: facetId,
    pitch_agreement_state: args.state,
    pitch_confidence: args.confidence,
    pitch_source_final: args.source,
    pitch_consensus_rise_over_12: round(args.consensus, 3),
    pitch_consensus_deg: round(riseOver12ToDegrees(args.consensus), 3),
    pitch_dsm_rise_over_12: round(dsm?.pitch_rise_over_12, 3),
    pitch_solar_rise_over_12: round(solar?.pitch_rise_over_12, 3),
    pitch_streetview_rise_over_12: round(streetview?.pitch_rise_over_12, 3),
    pitch_dsm_deg: round(dsm?.pitch_degrees, 3),
    pitch_solar_deg: round(solar?.pitch_degrees, 3),
    pitch_streetview_deg: round(streetview?.pitch_degrees, 3),
    agreeing_streams: args.agreeing,
    usable_streams: [dsm, solar, streetview].filter((v): v is NormalizedEvidence => !!v).map((v) => v.stream),
    max_delta_rise_over_12: round(args.maxDelta, 3),
    pair_deltas: args.pairDeltas,
    hard_fail_reason: args.hardFail,
    block_customer_report: args.block,
  };
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function maxFinite(values: Array<number | null>): number | null {
  const finite = values.filter((v): v is number => v != null && Number.isFinite(v));
  return finite.length ? Math.max(...finite) : null;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round(value: number | null | undefined, digits: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}
