interface MaterialQuantities {
  shingleBundles: number;
  shingleSquares: number;
  starterStrip: number;
  iceWaterShield: number;
  ridgeCapBundles: number;
  dripEdge: number;
  valleyMaterial: number;
  penetrationFlashings: number;
  underlaymentRolls: number;
}

interface MeasurementData {
  totalArea: number;
  perimeter: number;
  ridgeLength: number;
  hipLength: number;
  valleyLength: number;
  eaveLength: number;
  rakeLength: number;
  wastePercentage: number;
}

/**
 * Convert a roof_measurements row into the MeasurementData shape
 * used by calculateMaterialQuantities.
 */
export function fromRoofMeasurement(row: {
  total_area_adjusted_sqft?: number | null;
  total_ridge_length?: number | null;
  total_hip_length?: number | null;
  total_valley_length?: number | null;
  total_eave_length?: number | null;
  total_rake_length?: number | null;
  waste_factor_percent?: number | null;
}): MeasurementData {
  const eave = row.total_eave_length ?? 0;
  const rake = row.total_rake_length ?? 0;
  return {
    totalArea: row.total_area_adjusted_sqft ?? 0,
    perimeter: eave + rake,
    ridgeLength: row.total_ridge_length ?? 0,
    hipLength: row.total_hip_length ?? 0,
    valleyLength: row.total_valley_length ?? 0,
    eaveLength: eave,
    rakeLength: rake,
    wastePercentage: row.waste_factor_percent ?? 10,
  };
}

export function calculateMaterialQuantities(
  measurement: MeasurementData
): MaterialQuantities {
  const {
    totalArea,
    perimeter,
    ridgeLength = 0,
    hipLength = 0,
    valleyLength = 0,
    eaveLength = perimeter * 0.5,
    rakeLength = perimeter * 0.5,
    wastePercentage = 10,
  } = measurement;

  // Calculate adjusted area with waste
  const adjustedArea = totalArea * (1 + wastePercentage / 100);
  const squares = adjustedArea / 100;

  // Shingles (3 bundles per square)
  const shingleBundles = Math.ceil(squares * 3);

  // Starter strip (eaves + rakes)
  const starterStrip = Math.ceil(eaveLength + rakeLength);

  // Ice & water shield (valleys + first 3 feet of eaves)
  const iceWaterShield = Math.ceil(valleyLength + (eaveLength * 3));

  // Ridge cap (ridges + hips, divided by coverage per bundle ~35 linear feet)
  const totalRidgeHip = ridgeLength + hipLength;
  const ridgeCapBundles = Math.ceil(totalRidgeHip / 35);

  // Drip edge (perimeter)
  const dripEdge = Math.ceil(perimeter);

  // Valley material (valley length)
  const valleyMaterial = Math.ceil(valleyLength);

  // Penetration flashings (estimate 1 per 500 sq ft)
  const penetrationFlashings = Math.max(1, Math.ceil(totalArea / 500));

  // Underlayment rolls (4 sq per roll / 400 sq ft coverage)
  const underlaymentRolls = Math.max(1, Math.ceil(adjustedArea / 400));

  return {
    shingleBundles,
    shingleSquares: parseFloat(squares.toFixed(2)),
    starterStrip,
    iceWaterShield,
    ridgeCapBundles,
    dripEdge,
    valleyMaterial,
    penetrationFlashings,
    underlaymentRolls,
  };
}

export function formatMaterialList(quantities: MaterialQuantities): Array<{
  item: string;
  quantity: number;
  unit: string;
}> {
  return [
    { item: 'Shingles', quantity: quantities.shingleBundles, unit: 'bundles' },
    { item: 'Shingles', quantity: quantities.shingleSquares, unit: 'squares' },
    { item: 'Starter Strip', quantity: quantities.starterStrip, unit: 'linear ft' },
    { item: 'Ice & Water Shield', quantity: quantities.iceWaterShield, unit: 'sq ft' },
    { item: 'Ridge Cap', quantity: quantities.ridgeCapBundles, unit: 'bundles' },
    { item: 'Drip Edge', quantity: quantities.dripEdge, unit: 'linear ft' },
    { item: 'Valley Material', quantity: quantities.valleyMaterial, unit: 'linear ft' },
    { item: 'Penetration Flashings', quantity: quantities.penetrationFlashings, unit: 'pieces' },
    { item: 'Underlayment', quantity: quantities.underlaymentRolls, unit: 'rolls' },
  ];
}
