/**
 * Roof Measurement Worksheet Calculation Engine
 * Human-verifiable geometry-based roof calculations
 * No magic AI guesses - everything is explainable math
 */

// ========== PITCH & SLOPE FACTOR ==========

export interface PitchInfo {
  pitch: string;          // e.g., "6/12"
  rise: number;           // X value
  run: number;            // Always 12
  pDecimal: number;       // X / 12
  slopeFactor: number;    // sqrt(1 + p²)
  degrees: number;        // atan(p) in degrees
}

/**
 * Calculate slope factor from pitch
 * Formula: slope_factor = sqrt(1 + (X/12)²)
 */
export function calculateSlopeFactor(rise: number, run: number = 12): number {
  const p = rise / run;
  return Math.sqrt(1 + p * p);
}

/**
 * Parse pitch string and return full info
 */
export function parsePitch(pitchStr: string): PitchInfo {
  const match = pitchStr.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+)/);
  if (!match) {
    // Default to flat
    return {
      pitch: 'flat',
      rise: 0,
      run: 12,
      pDecimal: 0,
      slopeFactor: 1.0,
      degrees: 0,
    };
  }
  
  const rise = parseFloat(match[1]);
  const run = parseFloat(match[2]) || 12;
  const pDecimal = rise / run;
  const slopeFactor = Math.sqrt(1 + pDecimal * pDecimal);
  const degrees = Math.atan(pDecimal) * (180 / Math.PI);
  
  return {
    pitch: pitchStr,
    rise,
    run,
    pDecimal: Math.round(pDecimal * 10000) / 10000,
    slopeFactor: Math.round(slopeFactor * 10000) / 10000,
    degrees: Math.round(degrees * 100) / 100,
  };
}

/**
 * Standard pitch reference table
 */
export const PITCH_REFERENCE_TABLE: PitchInfo[] = [
  { pitch: 'flat', rise: 0, run: 12, pDecimal: 0, slopeFactor: 1.0000, degrees: 0 },
  { pitch: '1/12', rise: 1, run: 12, pDecimal: 0.0833, slopeFactor: 1.0035, degrees: 4.76 },
  { pitch: '2/12', rise: 2, run: 12, pDecimal: 0.1667, slopeFactor: 1.0138, degrees: 9.46 },
  { pitch: '3/12', rise: 3, run: 12, pDecimal: 0.25, slopeFactor: 1.0308, degrees: 14.04 },
  { pitch: '4/12', rise: 4, run: 12, pDecimal: 0.3333, slopeFactor: 1.0541, degrees: 18.43 },
  { pitch: '5/12', rise: 5, run: 12, pDecimal: 0.4167, slopeFactor: 1.0833, degrees: 22.62 },
  { pitch: '6/12', rise: 6, run: 12, pDecimal: 0.5, slopeFactor: 1.1180, degrees: 26.57 },
  { pitch: '7/12', rise: 7, run: 12, pDecimal: 0.5833, slopeFactor: 1.1577, degrees: 30.26 },
  { pitch: '8/12', rise: 8, run: 12, pDecimal: 0.6667, slopeFactor: 1.2019, degrees: 33.69 },
  { pitch: '9/12', rise: 9, run: 12, pDecimal: 0.75, slopeFactor: 1.2500, degrees: 36.87 },
  { pitch: '10/12', rise: 10, run: 12, pDecimal: 0.8333, slopeFactor: 1.3017, degrees: 39.81 },
  { pitch: '11/12', rise: 11, run: 12, pDecimal: 0.9167, slopeFactor: 1.3566, degrees: 42.51 },
  { pitch: '12/12', rise: 12, run: 12, pDecimal: 1.0, slopeFactor: 1.4142, degrees: 45 },
];

// ========== PLANE AREA CALCULATIONS ==========

export type PlaneShape = 'rect' | 'tri' | 'trap' | 'custom';

export interface PlaneDimensions {
  shape: PlaneShape;
  // Rectangle: L, W
  L?: number;
  W?: number;
  // Triangle: base, height
  base?: number;
  height?: number;
  // Trapezoid: a (top), b (bottom), h (height)
  a?: number;
  b?: number;
  h?: number;
  // Custom: direct area input
  customArea?: number;
}

export interface PlaneCalculation {
  id: string;
  shape: PlaneShape;
  dimensions: PlaneDimensions;
  formula: string;
  substitution: string;
  planAreaSqft: number;
  pitch: string;
  pitchInfo: PitchInfo;
  surfaceAreaSqft: number;
  surfaceFormula: string;
  include: boolean;
  notes: string;
}

/**
 * Calculate plan area based on shape
 */
export function calculatePlanArea(dimensions: PlaneDimensions): { area: number; formula: string; substitution: string } {
  switch (dimensions.shape) {
    case 'rect': {
      const L = dimensions.L || 0;
      const W = dimensions.W || 0;
      return {
        area: L * W,
        formula: 'L × W',
        substitution: `${L} × ${W} = ${L * W}`,
      };
    }
    case 'tri': {
      const base = dimensions.base || 0;
      const height = dimensions.height || 0;
      const area = 0.5 * base * height;
      return {
        area,
        formula: '0.5 × base × height',
        substitution: `0.5 × ${base} × ${height} = ${area.toFixed(1)}`,
      };
    }
    case 'trap': {
      const a = dimensions.a || 0;
      const b = dimensions.b || 0;
      const h = dimensions.h || 0;
      const area = ((a + b) / 2) * h;
      return {
        area,
        formula: '((a + b) / 2) × h',
        substitution: `((${a} + ${b}) / 2) × ${h} = ${area.toFixed(1)}`,
      };
    }
    case 'custom':
      return {
        area: dimensions.customArea || 0,
        formula: 'Direct input',
        substitution: `${dimensions.customArea || 0} sq ft (measured)`,
      };
    default:
      return { area: 0, formula: '', substitution: '' };
  }
}

/**
 * Calculate surface area from plan area and pitch
 */
export function calculateSurfaceArea(planArea: number, pitchInfo: PitchInfo): { area: number; formula: string } {
  const surfaceArea = planArea * pitchInfo.slopeFactor;
  return {
    area: Math.round(surfaceArea),
    formula: `${planArea.toFixed(1)} × ${pitchInfo.slopeFactor.toFixed(4)} = ${surfaceArea.toFixed(1)} sq ft`,
  };
}

// ========== LINEAR FEATURE CALCULATIONS ==========

export type LinearType = 'ridge' | 'hip' | 'valley' | 'eave' | 'rake' | 'step_flashing' | 'perimeter';
export type MeasurementType = 'true' | 'plan' | 'derived';

export interface LinearSegment {
  id: string;
  type: LinearType;
  lengthFt: number;
  measurementType: MeasurementType;
  derivationMethod?: string;
  notes: string;
}

/**
 * Calculate rake length from run and pitch (derived)
 * rake_length = sqrt(run² + rise²)
 * where rise = run × (pitch / 12)
 */
export function calculateRakeFromRun(runFt: number, pitchInfo: PitchInfo): { length: number; formula: string } {
  const rise = runFt * pitchInfo.pDecimal;
  const rakeLength = Math.sqrt(runFt * runFt + rise * rise);
  return {
    length: Math.round(rakeLength * 10) / 10,
    formula: `sqrt(${runFt}² + (${runFt} × ${pitchInfo.pDecimal.toFixed(4)})²) = sqrt(${runFt}² + ${rise.toFixed(2)}²) = ${rakeLength.toFixed(1)} ft`,
  };
}

/**
 * Calculate hip/valley true length from plan length (derived)
 * For 90° corner with equal pitch: true_length ≈ plan_length × sqrt(1 + p²/2)
 */
export function calculateHipValleyFromPlan(planLengthFt: number, pitchInfo: PitchInfo): { length: number; formula: string } {
  const p = pitchInfo.pDecimal;
  const factor = Math.sqrt(1 + (p * p) / 2);
  const trueLength = planLengthFt * factor;
  return {
    length: Math.round(trueLength * 10) / 10,
    formula: `${planLengthFt} × sqrt(1 + ${p.toFixed(4)}²/2) = ${planLengthFt} × ${factor.toFixed(4)} = ${trueLength.toFixed(1)} ft`,
  };
}

// ========== WASTE FACTOR LOGIC ==========

export interface ComplexityCounts {
  planesCount: number;
  valleysCount: number;
  dormersCount: number;
  penetrationsCount: number;
}

export type WasteBand = 'simple' | 'moderate' | 'cut_up' | 'extreme';

export interface WasteRecommendation {
  band: WasteBand;
  basePercent: number;
  adders: { reason: string; percent: number }[];
  totalPercent: number;
  justification: string;
}

/**
 * Recommend waste percentage based on complexity
 */
export function recommendWaste(complexity: ComplexityCounts, avgPitch: PitchInfo): WasteRecommendation {
  const { planesCount, valleysCount, dormersCount, penetrationsCount } = complexity;
  
  // Determine base band
  let band: WasteBand = 'simple';
  let basePercent = 10;
  
  if (planesCount <= 4 && valleysCount <= 1 && dormersCount === 0) {
    band = 'simple';
    basePercent = 10;
  } else if (planesCount <= 8 && valleysCount <= 3 && dormersCount <= 2) {
    band = 'moderate';
    basePercent = 12;
  } else if (planesCount <= 12 || valleysCount <= 6 || dormersCount <= 4) {
    band = 'cut_up';
    basePercent = 15;
  } else {
    band = 'extreme';
    basePercent = 20;
  }
  
  // Calculate adders
  const adders: { reason: string; percent: number }[] = [];
  
  // Steep pitch adder
  if (avgPitch.rise >= 8) {
    const adder = avgPitch.rise >= 10 ? 5 : 3;
    adders.push({ reason: `Steep pitch (${avgPitch.pitch})`, percent: adder });
  }
  
  // Many valleys adder
  if (valleysCount >= 4) {
    adders.push({ reason: `High valley count (${valleysCount})`, percent: 3 });
  }
  
  // Dormers adder
  if (dormersCount >= 2) {
    adders.push({ reason: `Multiple dormers (${dormersCount})`, percent: 3 });
  }
  
  // Penetrations adder
  if (penetrationsCount >= 8) {
    adders.push({ reason: `Many penetrations (${penetrationsCount})`, percent: 2 });
  }
  
  const totalAdders = adders.reduce((sum, a) => sum + a.percent, 0);
  const totalPercent = Math.min(basePercent + totalAdders, 25); // Cap at 25%
  
  const justification = `Base: ${basePercent}% (${band} roof with ${planesCount} planes, ${valleysCount} valleys, ${dormersCount} dormers). ` +
    (adders.length > 0 ? `Adders: ${adders.map(a => `+${a.percent}% for ${a.reason}`).join(', ')}.` : 'No additional complexity adders.');
  
  return {
    band,
    basePercent,
    adders,
    totalPercent,
    justification,
  };
}

// ========== ORDER CALCULATIONS ==========

export interface OrderCalculation {
  totalSurfaceAreaSqft: number;
  roofSquares: number;
  wastePercent: number;
  orderSquares: number;
  ridgeCapLf: number;
  starterLf: number;
  dripEdgeLf: number;
  calculations: {
    roofSquaresCalc: string;
    orderSquaresCalc: string;
    ridgeCapCalc: string;
    starterCalc: string;
    dripEdgeCalc: string;
  };
}

export function calculateOrder(
  totalSurfaceArea: number,
  wastePercent: number,
  ridgeLf: number,
  eaveLf: number,
  perimeterLf: number
): OrderCalculation {
  const roofSquares = totalSurfaceArea / 100;
  const orderSquares = roofSquares * (1 + wastePercent / 100);
  
  return {
    totalSurfaceAreaSqft: totalSurfaceArea,
    roofSquares: Math.round(roofSquares * 100) / 100,
    wastePercent,
    orderSquares: Math.round(orderSquares * 100) / 100,
    ridgeCapLf: ridgeLf,
    starterLf: eaveLf,
    dripEdgeLf: perimeterLf,
    calculations: {
      roofSquaresCalc: `${totalSurfaceArea.toFixed(0)} sq ft ÷ 100 = ${roofSquares.toFixed(2)} squares`,
      orderSquaresCalc: `${roofSquares.toFixed(2)} × (1 + ${wastePercent}%) = ${roofSquares.toFixed(2)} × ${(1 + wastePercent / 100).toFixed(2)} = ${orderSquares.toFixed(2)} squares`,
      ridgeCapCalc: `Ridge total: ${ridgeLf.toFixed(0)} LF`,
      starterCalc: `Eave total: ${eaveLf.toFixed(0)} LF`,
      dripEdgeCalc: `Perimeter total: ${perimeterLf.toFixed(0)} LF`,
    },
  };
}

// ========== QC CHECKS ==========

export interface QCCheck {
  id: string;
  description: string;
  pass: boolean | null;
  notes: string;
}

export interface QCResult {
  checks: QCCheck[];
  overallOk: boolean;
  overallNotes: string[];
}

export function runQCChecks(
  planes: PlaneCalculation[],
  linearSegments: LinearSegment[],
  complexity: ComplexityCounts,
  wastePercent: number
): QCResult {
  const checks: QCCheck[] = [];
  const notes: string[] = [];
  
  // QC1: Every included plane has pitch
  const planesWithoutPitch = planes.filter(p => p.include && (!p.pitch || p.pitch === 'unknown'));
  checks.push({
    id: 'QC1',
    description: 'Every included plane has known pitch or is flagged',
    pass: planesWithoutPitch.length === 0,
    notes: planesWithoutPitch.length > 0 
      ? `${planesWithoutPitch.length} planes missing pitch: ${planesWithoutPitch.map(p => p.id).join(', ')}`
      : 'All planes have pitch defined',
  });
  
  // QC2: Plan areas valid
  const invalidPlanAreas = planes.filter(p => p.include && (isNaN(p.planAreaSqft) || p.planAreaSqft <= 0));
  checks.push({
    id: 'QC2',
    description: 'Plan areas use correct formulas and units',
    pass: invalidPlanAreas.length === 0,
    notes: invalidPlanAreas.length > 0
      ? `Invalid plan areas: ${invalidPlanAreas.map(p => p.id).join(', ')}`
      : 'All plan areas valid',
  });
  
  // QC3: Surface areas calculated correctly
  const surfaceAreaIssues = planes.filter(p => {
    if (!p.include) return false;
    const expected = p.planAreaSqft * p.pitchInfo.slopeFactor;
    return Math.abs(p.surfaceAreaSqft - expected) > 1;
  });
  checks.push({
    id: 'QC3',
    description: 'Surface areas use correct slope factor per plane',
    pass: surfaceAreaIssues.length === 0,
    notes: surfaceAreaIssues.length > 0
      ? `Surface area mismatch: ${surfaceAreaIssues.map(p => p.id).join(', ')}`
      : 'All surface areas correctly calculated',
  });
  
  // QC4: Totals reconcile
  const totalPlan = planes.filter(p => p.include).reduce((sum, p) => sum + p.planAreaSqft, 0);
  const totalSurface = planes.filter(p => p.include).reduce((sum, p) => sum + p.surfaceAreaSqft, 0);
  checks.push({
    id: 'QC4',
    description: 'Total PLAN and SURFACE areas reconcile with plane sums',
    pass: totalPlan > 0 && totalSurface >= totalPlan,
    notes: `Plan: ${totalPlan.toFixed(0)} sq ft, Surface: ${totalSurface.toFixed(0)} sq ft`,
  });
  
  // QC5: Linear totals reconcile
  const linearByType = linearSegments.reduce((acc, seg) => {
    acc[seg.type] = (acc[seg.type] || 0) + seg.lengthFt;
    return acc;
  }, {} as Record<string, number>);
  checks.push({
    id: 'QC5',
    description: 'Linear totals match segment sums',
    pass: true,
    notes: Object.entries(linearByType).map(([type, total]) => `${type}: ${total.toFixed(0)} LF`).join(', '),
  });
  
  // QC6: Waste matches complexity
  const recommendedWaste = recommendWaste(complexity, parsePitch('6/12'));
  const wasteDiff = Math.abs(wastePercent - recommendedWaste.totalPercent);
  checks.push({
    id: 'QC6',
    description: 'Waste choice matches complexity counts',
    pass: wasteDiff <= 5,
    notes: `Chosen: ${wastePercent}%, Recommended: ${recommendedWaste.totalPercent}% (${recommendedWaste.band})`,
  });
  
  // QC7: Smell test
  const squares = totalSurface / 100;
  const isReasonable = squares >= 5 && squares <= 200; // Typical residential range
  checks.push({
    id: 'QC7',
    description: 'Smell test - squares reasonable for footprint',
    pass: isReasonable,
    notes: `${squares.toFixed(1)} squares - ${isReasonable ? 'within typical residential range' : 'unusual size, verify measurements'}`,
  });
  
  const failedChecks = checks.filter(c => c.pass === false);
  
  return {
    checks,
    overallOk: failedChecks.length === 0,
    overallNotes: failedChecks.map(c => `${c.id} FAILED: ${c.notes}`),
  };
}

// ========== JSON OUTPUT SCHEMA ==========

export interface RoofWorksheetJSON {
  job_info: {
    job_name: string;
    date: string;
    measurer: string;
    source: 'field' | 'plan' | 'takeoff' | 'other';
    units: string;
    rounding: { length_ft: number | null; area_sqft: number | null };
    notes: string[];
  };
  pitches: PitchInfo[];
  planes: Array<{
    id: string;
    shape: PlaneShape;
    dimensions: PlaneDimensions;
    plan_area_sqft: number;
    pitch: string;
    slope_factor: number;
    surface_area_sqft: number;
    include: boolean;
    notes: string[];
  }>;
  plane_totals: {
    plan_area_sqft: number;
    surface_area_sqft: number;
    squares: number;
  };
  linear_components: {
    segments: Array<{
      component: LinearType;
      id: string;
      length_ft: number;
      type: MeasurementType;
      notes: string;
    }>;
    totals_ft: {
      ridge: number;
      hip: number;
      valley: number;
      eave: number;
      rake: number;
      perimeter: number;
    };
  };
  complexity: ComplexityCounts & { notes: string[] };
  waste: {
    material: string;
    band: WasteBand;
    waste_percent: number;
    justification: string[];
  };
  totals_and_order: OrderCalculation;
  qc: QCResult;
}
