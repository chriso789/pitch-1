// PR #5 — Self-consistent pitch verification
//
// Pure function: given DSM / Solar / Street View pitch values for a single
// facet, return the agreement state and the final reported pitch.
//
// Tolerance = ±1/12 in rise/run space, which at typical residential pitches
// (3/12–9/12 ⇒ 14°–37°) is ≈ ±2.39° at 6/12 and ≈ ±2.86° at 9/12. We use a
// flat ±2.5° tolerance which is the right behavior in the band that matters
// and slightly forgiving outside it. The Fonsica acceptance criterion
// (`high` at ~6/12) was checked against this constant.
//
// Agreement matrix:
//   3 evidence streams, all within tolerance       → high
//   2 evidence streams, both within tolerance      → high (final = mean)
//   3 streams, 2 agree + 1 outlier                 → medium (final = mean of agreeing pair, source = best of pair)
//   2 streams, disagree                            → low
//   3 streams, all disagree                        → low
//   <2 streams available                           → insufficient_evidence

export const PITCH_TOLERANCE_DEG = 2.5;

export type PitchSource = "dsm" | "solar" | "streetview";
export type AgreementState = "high" | "medium" | "low" | "insufficient_evidence";

export interface PitchEvidenceInput {
  dsm?: number | null;
  solar?: number | null;
  streetview?: number | null;
}

export interface PitchConsensusResult {
  state: AgreementState;
  final_deg: number | null;
  final_source: PitchSource | "consensus" | "none";
  /** How many of the three streams had a numeric value. */
  evidence_count: number;
  /** Pair/triple actually used to compute final_deg. */
  agreeing_sources: PitchSource[];
  /** Pairwise deltas in degrees (only between present streams). */
  deltas_deg: Record<string, number>;
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function within(a: number, b: number, tol = PITCH_TOLERANCE_DEG): boolean {
  return Math.abs(a - b) <= tol;
}

function mean(vals: number[]): number {
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

export function computePitchConsensus(
  evidence: PitchEvidenceInput,
  tolerance: number = PITCH_TOLERANCE_DEG,
): PitchConsensusResult {
  const dsm = isNum(evidence.dsm) ? evidence.dsm : null;
  const solar = isNum(evidence.solar) ? evidence.solar : null;
  const streetview = isNum(evidence.streetview) ? evidence.streetview : null;

  const present: { source: PitchSource; value: number }[] = [];
  if (dsm !== null) present.push({ source: "dsm", value: dsm });
  if (solar !== null) present.push({ source: "solar", value: solar });
  if (streetview !== null) present.push({ source: "streetview", value: streetview });

  const deltas: Record<string, number> = {};
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      const a = present[i], b = present[j];
      deltas[`${a.source}_${b.source}`] = Math.abs(a.value - b.value);
    }
  }

  if (present.length < 2) {
    return {
      state: "insufficient_evidence",
      final_deg: present[0]?.value ?? null,
      final_source: "none",
      evidence_count: present.length,
      agreeing_sources: present.map(p => p.source),
      deltas_deg: deltas,
    };
  }

  // Source preference for tie-breaking when picking a single representative.
  // DSM is most direct (3D geometry), Solar is well-calibrated, Street View is noisiest.
  const prefer: Record<PitchSource, number> = { dsm: 3, solar: 2, streetview: 1 };

  if (present.length === 2) {
    const [a, b] = present;
    if (within(a.value, b.value, tolerance)) {
      return {
        state: "high",
        final_deg: mean([a.value, b.value]),
        final_source: "consensus",
        evidence_count: 2,
        agreeing_sources: [a.source, b.source],
        deltas_deg: deltas,
      };
    }
    return {
      state: "low",
      final_deg: null,
      final_source: "none",
      evidence_count: 2,
      agreeing_sources: [],
      deltas_deg: deltas,
    };
  }

  // present.length === 3
  const pairs: [number, number][] = [[0, 1], [0, 2], [1, 2]];
  const agreeingPairs = pairs.filter(([i, j]) =>
    within(present[i].value, present[j].value, tolerance)
  );

  if (agreeingPairs.length === 3) {
    // All three agree → high
    const vals = present.map(p => p.value);
    return {
      state: "high",
      final_deg: mean(vals),
      final_source: "consensus",
      evidence_count: 3,
      agreeing_sources: present.map(p => p.source),
      deltas_deg: deltas,
    };
  }

  if (agreeingPairs.length >= 1) {
    // 2-of-3 agreement → medium. Pick the pair with smallest delta.
    let best = agreeingPairs[0];
    let bestDelta = Math.abs(present[best[0]].value - present[best[1]].value);
    for (const p of agreeingPairs.slice(1)) {
      const d = Math.abs(present[p[0]].value - present[p[1]].value);
      if (d < bestDelta) { best = p; bestDelta = d; }
    }
    const a = present[best[0]], b = present[best[1]];
    const finalDeg = mean([a.value, b.value]);
    // Pick the preferred source name from the agreeing pair.
    const finalSource: PitchSource = prefer[a.source] >= prefer[b.source] ? a.source : b.source;
    return {
      state: "medium",
      final_deg: finalDeg,
      final_source: finalSource,
      evidence_count: 3,
      agreeing_sources: [a.source, b.source],
      deltas_deg: deltas,
    };
  }

  // 3 streams, none agree
  return {
    state: "low",
    final_deg: null,
    final_source: "none",
    evidence_count: 3,
    agreeing_sources: [],
    deltas_deg: deltas,
  };
}

/** Convert a pitch in degrees to the nearest x/12 rise/run integer string. */
export function degToRisePerTwelve(deg: number): string {
  const rise = Math.round(Math.tan((deg * Math.PI) / 180) * 12);
  return `${rise}/12`;
}

/** Convert rise/12 to degrees. */
export function risePerTwelveToDeg(rise: number): number {
  return (Math.atan(rise / 12) * 180) / Math.PI;
}
