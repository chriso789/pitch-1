/**
 * Roof Measurement Worksheet Engine for Supabase Edge Functions
 * Deno-compatible version of the calculation engine
 * 
 * Single source of truth for all roof measurement calculations.
 * Every number is explainable with basic geometry.
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
 * Parse pitch string and return full info with math shown
 */
export function parsePitch(pitchStr: string): PitchInfo {
  const match = pitchStr.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+)/);
  if (!match) {
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
 * Standard pitch reference table - AUTHORITATIVE values
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

/**
 * Get slope factor from pitch string - uses lookup table or calculates
 */
export function getSlopeFactorFromPitch(pitchStr: string): number {
  const ref = PITCH_REFERENCE_TABLE.find(p => p.pitch === pitchStr);
  if (ref) return ref.slopeFactor;
  return parsePitch(pitchStr).slopeFactor;
}

// ========== PLANE AREA CALCULATIONS ==========

export type PlaneShape = 'rect' | 'tri' | 'trap' | 'polygon' | 'custom';

export interface PlaneDimensions {
  shape: PlaneShape;
  L?: number;
  W?: number;
  base?: number;
  height?: number;
  a?: number;
  b?: number;
  h?: number;
  customArea?: number;
  vertices?: Array<{ x: number; y: number }>;
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
 * Calculate plan area based on shape - always shows the math
 */
export function calculatePlanArea(dimensions: PlaneDimensions): { area: number; formula: string; substitution: string } {
  switch (dimensions.shape) {
    case 'rect': {
      const L = dimensions.L || 0;
      const W = dimensions.W || 0;
      const area = L * W;
      return {
        area,
        formula: 'L × W',
        substitution: `${L} × ${W} = ${area.toFixed(1)} sq ft`,
      };
    }
    case 'tri': {
      const base = dimensions.base || 0;
      const height = dimensions.height || 0;
      const area = 0.5 * base * height;
      return {
        area,
        formula: '0.5 × base × height',
        substitution: `0.5 × ${base} × ${height} = ${area.toFixed(1)} sq ft`,
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
        substitution: `((${a} + ${b}) / 2) × ${h} = ${area.toFixed(1)} sq ft`,
      };
    }
    case 'polygon': {
      // Shoelace formula for polygon area
      const verts = dimensions.vertices || [];
      if (verts.length < 3) return { area: 0, formula: 'Shoelace', substitution: 'Insufficient vertices' };
      
      let sum = 0;
      for (let i = 0; i < verts.length; i++) {
        const j = (i + 1) % verts.length;
        sum += verts[i].x * verts[j].y;
        sum -= verts[j].x * verts[i].y;
      }
      const area = Math.abs(sum / 2);
      return {
        area,
        formula: 'Shoelace: |Σ(x_i × y_{i+1} - x_{i+1} × y_i)| / 2',
        substitution: `${verts.length} vertices → ${area.toFixed(1)} sq ft`,
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
 * surface_area = plan_area × slope_factor
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

export interface LinearTotals {
  ridge: number;
  hip: number;
  valley: number;
  eave: number;
  rake: number;
  perimeter: number;
  step_flashing: number;
}

/**
 * Calculate rake length from run and pitch (derived)
 * rake_length = sqrt(run² + rise²)
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

/**
 * Sum linear segments by type
 */
export function sumLinearSegments(segments: LinearSegment[]): LinearTotals {
  const totals: LinearTotals = { ridge: 0, hip: 0, valley: 0, eave: 0, rake: 0, perimeter: 0, step_flashing: 0 };
  
  for (const seg of segments) {
    if (seg.type in totals) {
      totals[seg.type as keyof LinearTotals] += seg.lengthFt;
    }
  }
  
  totals.perimeter = totals.eave + totals.rake;
  
  return totals;
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
 * Recommend waste percentage based on complexity - transparent logic
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
  
  // Calculate adders with explicit reasoning
  const adders: { reason: string; percent: number }[] = [];
  
  if (avgPitch.rise >= 8) {
    const adder = avgPitch.rise >= 10 ? 5 : 3;
    adders.push({ reason: `Steep pitch (${avgPitch.pitch})`, percent: adder });
  }
  
  if (valleysCount >= 4) {
    adders.push({ reason: `High valley count (${valleysCount})`, percent: 3 });
  }
  
  if (dormersCount >= 2) {
    adders.push({ reason: `Multiple dormers (${dormersCount})`, percent: 3 });
  }
  
  if (penetrationsCount >= 8) {
    adders.push({ reason: `Many penetrations (${penetrationsCount})`, percent: 2 });
  }
  
  const totalAdders = adders.reduce((sum, a) => sum + a.percent, 0);
  const totalPercent = Math.min(basePercent + totalAdders, 25);
  
  const justification = `Base: ${basePercent}% (${band} roof with ${planesCount} planes, ${valleysCount} valleys, ${dormersCount} dormers). ` +
    (adders.length > 0 ? `Adders: ${adders.map(a => `+${a.percent}% for ${a.reason}`).join(', ')}.` : 'No additional complexity adders.');
  
  return { band, basePercent, adders, totalPercent, justification };
}

// ========== ORDER CALCULATIONS ==========

export interface OrderCalculation {
  totalPlanAreaSqft: number;
  totalSurfaceAreaSqft: number;
  roofSquares: number;
  wastePercent: number;
  orderSquares: number;
  ridgeCapLf: number;
  starterLf: number;
  dripEdgeLf: number;
  calculations: {
    planToSurfaceCalc: string;
    roofSquaresCalc: string;
    orderSquaresCalc: string;
    ridgeCapCalc: string;
    starterCalc: string;
    dripEdgeCalc: string;
  };
}

export function calculateOrder(
  totalPlanArea: number,
  totalSurfaceArea: number,
  wastePercent: number,
  linearTotals: LinearTotals
): OrderCalculation {
  const roofSquares = totalSurfaceArea / 100;
  const orderSquares = roofSquares * (1 + wastePercent / 100);
  
  return {
    totalPlanAreaSqft: Math.round(totalPlanArea),
    totalSurfaceAreaSqft: Math.round(totalSurfaceArea),
    roofSquares: Math.round(roofSquares * 100) / 100,
    wastePercent,
    orderSquares: Math.round(orderSquares * 100) / 100,
    ridgeCapLf: Math.round(linearTotals.ridge),
    starterLf: Math.round(linearTotals.eave),
    dripEdgeLf: Math.round(linearTotals.perimeter),
    calculations: {
      planToSurfaceCalc: `Plan: ${totalPlanArea.toFixed(0)} sq ft → Surface: ${totalSurfaceArea.toFixed(0)} sq ft (with pitch adjustment)`,
      roofSquaresCalc: `${totalSurfaceArea.toFixed(0)} sq ft ÷ 100 = ${roofSquares.toFixed(2)} squares`,
      orderSquaresCalc: `${roofSquares.toFixed(2)} × (1 + ${wastePercent}%) = ${roofSquares.toFixed(2)} × ${(1 + wastePercent / 100).toFixed(2)} = ${orderSquares.toFixed(2)} squares`,
      ridgeCapCalc: `Ridge total: ${linearTotals.ridge.toFixed(0)} LF`,
      starterCalc: `Eave total: ${linearTotals.eave.toFixed(0)} LF`,
      dripEdgeCalc: `Perimeter (eave + rake): ${linearTotals.perimeter.toFixed(0)} LF`,
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
  
  // QC1: Pitch validation
  const planesWithoutPitch = planes.filter(p => p.include && (!p.pitch || p.pitch === 'unknown'));
  checks.push({
    id: 'QC1',
    description: 'Every included plane has known pitch',
    pass: planesWithoutPitch.length === 0,
    notes: planesWithoutPitch.length > 0 
      ? `${planesWithoutPitch.length} planes missing pitch`
      : 'All planes have pitch defined',
  });
  
  // QC2: Plan area validation
  const invalidPlanAreas = planes.filter(p => p.include && (isNaN(p.planAreaSqft) || p.planAreaSqft <= 0));
  checks.push({
    id: 'QC2',
    description: 'Plan areas are positive and valid',
    pass: invalidPlanAreas.length === 0,
    notes: invalidPlanAreas.length > 0
      ? `Invalid plan areas: ${invalidPlanAreas.map(p => p.id).join(', ')}`
      : 'All plan areas valid',
  });
  
  // QC3: Surface area math check
  const surfaceAreaIssues = planes.filter(p => {
    if (!p.include) return false;
    const expected = p.planAreaSqft * p.pitchInfo.slopeFactor;
    return Math.abs(p.surfaceAreaSqft - expected) > 5;
  });
  checks.push({
    id: 'QC3',
    description: 'Surface areas correctly use slope factor',
    pass: surfaceAreaIssues.length === 0,
    notes: surfaceAreaIssues.length > 0
      ? `Surface area mismatch: ${surfaceAreaIssues.map(p => p.id).join(', ')}`
      : 'All surface areas match formula',
  });
  
  // QC4: Totals reconciliation
  const totalPlan = planes.filter(p => p.include).reduce((sum, p) => sum + p.planAreaSqft, 0);
  const totalSurface = planes.filter(p => p.include).reduce((sum, p) => sum + p.surfaceAreaSqft, 0);
  checks.push({
    id: 'QC4',
    description: 'Total surface ≥ total plan (pitch applied)',
    pass: totalPlan > 0 && totalSurface >= totalPlan,
    notes: `Plan: ${totalPlan.toFixed(0)} sq ft, Surface: ${totalSurface.toFixed(0)} sq ft`,
  });
  
  // QC5: Linear totals
  const linearTotals = sumLinearSegments(linearSegments);
  checks.push({
    id: 'QC5',
    description: 'Linear measurements recorded',
    pass: linearTotals.perimeter > 0,
    notes: `Perimeter: ${linearTotals.perimeter.toFixed(0)} LF, Ridge: ${linearTotals.ridge.toFixed(0)} LF`,
  });
  
  // QC6: Waste validation
  const avgPitch = parsePitch('6/12');
  const recommended = recommendWaste(complexity, avgPitch);
  const wasteDiff = Math.abs(wastePercent - recommended.totalPercent);
  checks.push({
    id: 'QC6',
    description: 'Waste matches complexity',
    pass: wasteDiff <= 5,
    notes: `Chosen: ${wastePercent}%, Recommended: ${recommended.totalPercent}% (${recommended.band})`,
  });
  
  // QC7: Smell test
  const squares = totalSurface / 100;
  const isReasonable = squares >= 5 && squares <= 200;
  checks.push({
    id: 'QC7',
    description: 'Squares within typical residential range (5-200)',
    pass: isReasonable,
    notes: `${squares.toFixed(1)} squares - ${isReasonable ? 'reasonable' : 'unusual, verify'}`,
  });
  
  const failedChecks = checks.filter(c => c.pass === false);
  
  return {
    checks,
    overallOk: failedChecks.length === 0,
    overallNotes: failedChecks.map(c => `${c.id} FAILED: ${c.notes}`),
  };
}

// ========== AI GEOMETRY CONVERTER ==========

export interface AIDetectedVertex {
  x: number;  // Percentage 0-100
  y: number;
  type: string;
}

export interface AIDetectedLine {
  type: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  lengthFt?: number;
}

/**
 * Convert AI-detected perimeter vertices to worksheet plane using Shoelace formula
 * This ensures area calculation is EXACTLY the same as what we use elsewhere
 */
export function convertPerimeterToPlane(
  vertices: AIDetectedVertex[],
  imageCenter: { lat: number; lng: number },
  imageSize: number,
  zoom: number,
  pitch: string
): PlaneCalculation {
  // Calculate meters per pixel at this zoom/lat
  const metersPerPixel = (156543.03392 * Math.cos(imageCenter.lat * Math.PI / 180)) / Math.pow(2, zoom);
  const sqMetersToSqFt = 10.764;
  
  // Convert percentage vertices to feet-based coordinates
  const verticesInFeet = vertices.map(v => ({
    x: ((v.x / 100) - 0.5) * imageSize * metersPerPixel * 3.28084,
    y: ((v.y / 100) - 0.5) * imageSize * metersPerPixel * 3.28084,
  }));
  
  // Apply Shoelace formula for PLAN area
  let sum = 0;
  for (let i = 0; i < verticesInFeet.length; i++) {
    const j = (i + 1) % verticesInFeet.length;
    sum += verticesInFeet[i].x * verticesInFeet[j].y;
    sum -= verticesInFeet[j].x * verticesInFeet[i].y;
  }
  const planAreaSqft = Math.abs(sum / 2);
  
  const pitchInfo = parsePitch(pitch);
  const surfaceResult = calculateSurfaceArea(planAreaSqft, pitchInfo);
  
  return {
    id: 'MAIN_ROOF',
    shape: 'polygon',
    dimensions: {
      shape: 'polygon',
      vertices: verticesInFeet,
    },
    formula: 'Shoelace: |Σ(x_i × y_{i+1} - x_{i+1} × y_i)| / 2',
    substitution: `${vertices.length} vertices → ${planAreaSqft.toFixed(1)} sq ft (PLAN)`,
    planAreaSqft: Math.round(planAreaSqft),
    pitch,
    pitchInfo,
    surfaceAreaSqft: surfaceResult.area,
    surfaceFormula: surfaceResult.formula,
    include: true,
    notes: `AI-detected perimeter, ${vertices.length} vertices`,
  };
}

/**
 * Convert AI-detected lines to linear segments with proper typing
 */
export function convertAILinesToSegments(
  lines: AIDetectedLine[],
  imageCenter: { lat: number; lng: number },
  imageSize: number,
  zoom: number
): LinearSegment[] {
  const metersPerPixel = (156543.03392 * Math.cos(imageCenter.lat * Math.PI / 180)) / Math.pow(2, zoom);
  
  return lines.map((line, index) => {
    // Calculate length from pixel coordinates
    const dx = ((line.endX - line.startX) / 100) * imageSize * metersPerPixel;
    const dy = ((line.endY - line.startY) / 100) * imageSize * metersPerPixel;
    const lengthMeters = Math.sqrt(dx * dx + dy * dy);
    const lengthFt = lengthMeters * 3.28084;
    
    const typeMap: Record<string, LinearType> = {
      'ridge': 'ridge',
      'hip': 'hip',
      'valley': 'valley',
      'eave': 'eave',
      'rake': 'rake',
      'step_flashing': 'step_flashing',
    };
    
    return {
      id: `${line.type}_${index + 1}`,
      type: typeMap[line.type] || 'eave',
      lengthFt: Math.round(lengthFt * 10) / 10,
      measurementType: 'derived' as MeasurementType,
      derivationMethod: 'AI vertex detection',
      notes: `Derived from AI detection`,
    };
  });
}

/**
 * Derive complexity counts from linear segments
 */
export function deriveComplexityFromSegments(segments: LinearSegment[], facetCount: number): ComplexityCounts {
  const valleysCount = segments.filter(s => s.type === 'valley').length;
  
  return {
    planesCount: Math.max(facetCount, 2),
    valleysCount,
    dormersCount: 0, // AI doesn't reliably detect dormers
    penetrationsCount: 0, // AI doesn't count penetrations
  };
}

// ========== FACET AGGREGATION FUNCTIONS ==========

export interface FacetData {
  id: string;
  planAreaSqft: number;
  surfaceAreaSqft: number;
  pitch: string;
  slopeFactor: number;
  orientation?: string;
}

export interface FacetTotals {
  totalPlanAreaSqft: number;
  totalSurfaceAreaSqft: number;
  totalSquares: number;
  facetCount: number;
  predominantPitch: string;
  areaByPitch: Record<string, number>;
  facets: FacetData[];
}

/**
 * Calculate facet surface area from plan area and pitch
 * Returns detailed breakdown with formula
 */
export function calculateFacetSurfaceArea(
  planArea: number, 
  pitch: string
): { planArea: number; surfaceArea: number; slopeFactor: number; formula: string } {
  const pitchInfo = parsePitch(pitch);
  const surfaceArea = planArea * pitchInfo.slopeFactor;
  
  return {
    planArea: Math.round(planArea * 100) / 100,
    surfaceArea: Math.round(surfaceArea * 100) / 100,
    slopeFactor: pitchInfo.slopeFactor,
    formula: `${planArea.toFixed(1)} × ${pitchInfo.slopeFactor.toFixed(4)} = ${surfaceArea.toFixed(1)} sqft`,
  };
}

/**
 * Aggregate all facet data into totals
 */
export function aggregateFacetTotals(
  facets: Array<{ id: string; planAreaSqft: number; pitch: string; orientation?: string }>
): FacetTotals {
  if (!facets || facets.length === 0) {
    return {
      totalPlanAreaSqft: 0,
      totalSurfaceAreaSqft: 0,
      totalSquares: 0,
      facetCount: 0,
      predominantPitch: '6/12',
      areaByPitch: {},
      facets: [],
    };
  }

  const processedFacets: FacetData[] = [];
  const areaByPitch: Record<string, number> = {};
  let totalPlan = 0;
  let totalSurface = 0;

  for (const facet of facets) {
    const pitchInfo = parsePitch(facet.pitch);
    const surfaceArea = facet.planAreaSqft * pitchInfo.slopeFactor;

    processedFacets.push({
      id: facet.id,
      planAreaSqft: facet.planAreaSqft,
      surfaceAreaSqft: Math.round(surfaceArea),
      pitch: facet.pitch,
      slopeFactor: pitchInfo.slopeFactor,
      orientation: facet.orientation,
    });

    totalPlan += facet.planAreaSqft;
    totalSurface += surfaceArea;

    // Track area by pitch
    if (!areaByPitch[facet.pitch]) {
      areaByPitch[facet.pitch] = 0;
    }
    areaByPitch[facet.pitch] += surfaceArea;
  }

  // Determine predominant pitch (largest area)
  let predominantPitch = '6/12';
  let maxArea = 0;
  for (const [pitch, area] of Object.entries(areaByPitch)) {
    if (area > maxArea) {
      maxArea = area;
      predominantPitch = pitch;
    }
  }

  return {
    totalPlanAreaSqft: Math.round(totalPlan),
    totalSurfaceAreaSqft: Math.round(totalSurface),
    totalSquares: Math.round(totalSurface / 100 * 100) / 100,
    facetCount: facets.length,
    predominantPitch,
    areaByPitch,
    facets: processedFacets,
  };
}

/**
 * Aggregate linear features by type
 */
export function aggregateLinearByType(
  linearFeatures: Array<{ type: string; lengthFt: number }>
): LinearTotals & { breakdown: Record<string, { count: number; totalFt: number }> } {
  const breakdown: Record<string, { count: number; totalFt: number }> = {
    ridge: { count: 0, totalFt: 0 },
    hip: { count: 0, totalFt: 0 },
    valley: { count: 0, totalFt: 0 },
    eave: { count: 0, totalFt: 0 },
    rake: { count: 0, totalFt: 0 },
    step_flashing: { count: 0, totalFt: 0 },
  };

  for (const feature of linearFeatures) {
    const type = feature.type.toLowerCase();
    if (breakdown[type]) {
      breakdown[type].count++;
      breakdown[type].totalFt += feature.lengthFt;
    }
  }

  return {
    ridge: Math.round(breakdown.ridge.totalFt),
    hip: Math.round(breakdown.hip.totalFt),
    valley: Math.round(breakdown.valley.totalFt),
    eave: Math.round(breakdown.eave.totalFt),
    rake: Math.round(breakdown.rake.totalFt),
    step_flashing: Math.round(breakdown.step_flashing.totalFt),
    perimeter: Math.round(breakdown.eave.totalFt + breakdown.rake.totalFt),
    breakdown,
  };
}

/**
 * Calculate roof squares from total surface area
 */
export function calculateRoofSquares(totalSurfaceAreaSqft: number): {
  squares: number;
  formula: string;
} {
  const squares = totalSurfaceAreaSqft / 100;
  return {
    squares: Math.round(squares * 100) / 100,
    formula: `${totalSurfaceAreaSqft.toFixed(0)} sqft ÷ 100 = ${squares.toFixed(2)} squares`,
  };
}

// ========== WORKSHEET JSON OUTPUT ==========

export interface WorksheetJSON {
  job_info: {
    job_name: string;
    date: string;
    source: string;
    notes: string[];
  };
  pitches_used: PitchInfo[];
  planes: Array<{
    id: string;
    shape: string;
    plan_area_sqft: number;
    pitch: string;
    slope_factor: number;
    surface_area_sqft: number;
    formula: string;
    substitution: string;
  }>;
  plane_totals: {
    plan_area_sqft: number;
    surface_area_sqft: number;
    squares: number;
  };
  linear_totals: LinearTotals;
  linear_segments: Array<{
    id: string;
    type: string;
    length_ft: number;
    measurement_type: string;
  }>;
  complexity: ComplexityCounts;
  waste: WasteRecommendation;
  order: OrderCalculation;
  qc: QCResult;
}

/**
 * Build complete worksheet JSON from AI analysis data
 */
export function buildWorksheetFromAI(
  address: string,
  perimeterVertices: AIDetectedVertex[],
  derivedLines: AIDetectedLine[],
  imageCenter: { lat: number; lng: number },
  imageSize: number,
  zoom: number,
  detectedPitch: string,
  facetCount: number
): WorksheetJSON {
  // Convert AI data to worksheet format
  const mainPlane = convertPerimeterToPlane(perimeterVertices, imageCenter, imageSize, zoom, detectedPitch);
  const planes = [mainPlane];
  
  const linearSegments = convertAILinesToSegments(derivedLines, imageCenter, imageSize, zoom);
  const linearTotals = sumLinearSegments(linearSegments);
  
  // Calculate totals
  const totalPlan = planes.reduce((sum, p) => sum + p.planAreaSqft, 0);
  const totalSurface = planes.reduce((sum, p) => sum + p.surfaceAreaSqft, 0);
  
  // Derive complexity and waste
  const complexity = deriveComplexityFromSegments(linearSegments, facetCount);
  const pitchInfo = parsePitch(detectedPitch);
  const waste = recommendWaste(complexity, pitchInfo);
  
  // Calculate order
  const order = calculateOrder(totalPlan, totalSurface, waste.totalPercent, linearTotals);
  
  // Run QC
  const qc = runQCChecks(planes, linearSegments, complexity, waste.totalPercent);
  
  return {
    job_info: {
      job_name: address,
      date: new Date().toISOString(),
      source: 'AI aerial analysis',
      notes: [
        `Image zoom: ${zoom}`,
        `Image size: ${imageSize}px (logical)`,
        `Perimeter vertices: ${perimeterVertices.length}`,
        `Derived lines: ${derivedLines.length}`,
      ],
    },
    pitches_used: [pitchInfo],
    planes: planes.map(p => ({
      id: p.id,
      shape: p.shape,
      plan_area_sqft: p.planAreaSqft,
      pitch: p.pitch,
      slope_factor: p.pitchInfo.slopeFactor,
      surface_area_sqft: p.surfaceAreaSqft,
      formula: p.formula,
      substitution: p.substitution,
    })),
    plane_totals: {
      plan_area_sqft: Math.round(totalPlan),
      surface_area_sqft: Math.round(totalSurface),
      squares: Math.round(totalSurface / 100 * 100) / 100,
    },
    linear_totals: linearTotals,
    linear_segments: linearSegments.map(s => ({
      id: s.id,
      type: s.type,
      length_ft: s.lengthFt,
      measurement_type: s.measurementType,
    })),
    complexity,
    waste,
    order,
    qc,
  };
}

/**
 * Build worksheet from facets (enhanced version)
 */
export function buildWorksheetFromFacets(
  address: string,
  facets: Array<{ id: string; planAreaSqft: number; pitch: string; orientation?: string }>,
  linearFeatures: Array<{ type: string; lengthFt: number }>,
  source: string = 'AI segmentation'
): WorksheetJSON {
  // Aggregate facets
  const facetTotals = aggregateFacetTotals(facets);
  
  // Convert facets to planes
  const planes: PlaneCalculation[] = facets.map((f, idx) => {
    const pitchInfo = parsePitch(f.pitch);
    const surfaceResult = calculateSurfaceArea(f.planAreaSqft, pitchInfo);
    
    return {
      id: f.id || `FACET_${idx + 1}`,
      shape: 'polygon' as PlaneShape,
      dimensions: { shape: 'custom' as PlaneShape, customArea: f.planAreaSqft },
      formula: 'plan_area × slope_factor',
      substitution: surfaceResult.formula,
      planAreaSqft: f.planAreaSqft,
      pitch: f.pitch,
      pitchInfo,
      surfaceAreaSqft: surfaceResult.area,
      surfaceFormula: surfaceResult.formula,
      include: true,
      notes: f.orientation ? `Orientation: ${f.orientation}` : '',
    };
  });
  
  // Aggregate linear features
  const linearAggregated = aggregateLinearByType(linearFeatures);
  const linearSegments: LinearSegment[] = linearFeatures.map((f, idx) => ({
    id: `${f.type}_${idx + 1}`,
    type: f.type as LinearType,
    lengthFt: f.lengthFt,
    measurementType: 'derived' as MeasurementType,
    notes: '',
  }));
  
  // Derive complexity
  const complexity: ComplexityCounts = {
    planesCount: facets.length,
    valleysCount: linearAggregated.breakdown.valley?.count || 0,
    dormersCount: 0,
    penetrationsCount: 0,
  };
  
  // Calculate waste
  const avgPitch = parsePitch(facetTotals.predominantPitch);
  const waste = recommendWaste(complexity, avgPitch);
  
  // Calculate order
  const order = calculateOrder(
    facetTotals.totalPlanAreaSqft,
    facetTotals.totalSurfaceAreaSqft,
    waste.totalPercent,
    linearAggregated
  );
  
  // Run QC
  const qc = runQCChecks(planes, linearSegments, complexity, waste.totalPercent);
  
  return {
    job_info: {
      job_name: address,
      date: new Date().toISOString(),
      source,
      notes: [
        `Facets: ${facets.length}`,
        `Predominant pitch: ${facetTotals.predominantPitch}`,
        `Total area: ${facetTotals.totalSurfaceAreaSqft} sqft`,
      ],
    },
    pitches_used: [...new Set(facets.map(f => f.pitch))].map(p => parsePitch(p)),
    planes: planes.map(p => ({
      id: p.id,
      shape: p.shape,
      plan_area_sqft: p.planAreaSqft,
      pitch: p.pitch,
      slope_factor: p.pitchInfo.slopeFactor,
      surface_area_sqft: p.surfaceAreaSqft,
      formula: p.formula,
      substitution: p.substitution,
    })),
    plane_totals: {
      plan_area_sqft: facetTotals.totalPlanAreaSqft,
      surface_area_sqft: facetTotals.totalSurfaceAreaSqft,
      squares: facetTotals.totalSquares,
    },
    linear_totals: linearAggregated,
    linear_segments: linearSegments.map(s => ({
      id: s.id,
      type: s.type,
      length_ft: s.lengthFt,
      measurement_type: s.measurementType,
    })),
    complexity,
    waste,
    order,
    qc,
  };
}
