/**
 * Hook for manufacturer specifications used in material calculations
 * Uses default specs based on manufacturer packaging - can be extended to fetch from database
 */

export interface ManufacturerSpec {
  id: string;
  manufacturer: string;
  product_name: string;
  product_type: string;
  coverage_per_unit: number;
  coverage_unit: string;
  package_unit: string;
  formula: string;
  default_waste_percent: number;
  notes?: string;
}

// Default specs based on manufacturer packaging
export const DEFAULT_SPECS: Record<string, ManufacturerSpec> = {
  shingles: {
    id: 'default-shingles',
    manufacturer: 'GAF',
    product_name: 'Timberline HDZ',
    product_type: 'shingles',
    coverage_per_unit: 33.3,
    coverage_unit: 'sq_ft',
    package_unit: 'bundle',
    formula: 'ceil((roof.squares * (1 + waste_pct / 100)) * 3)',
    default_waste_percent: 10,
    notes: '3 bundles per square, 33.3 sq ft coverage per bundle',
  },
  starter_strip: {
    id: 'default-starter',
    manufacturer: 'GAF',
    product_name: 'Pro-Start',
    product_type: 'starter_strip',
    coverage_per_unit: 105,
    coverage_unit: 'LF',
    package_unit: 'bundle',
    formula: 'ceil((lf.eave + lf.rake) / 105)',
    default_waste_percent: 5,
    notes: '105 LF per bundle',
  },
  ridge_cap: {
    id: 'default-ridge',
    manufacturer: 'GAF',
    product_name: 'Seal-A-Ridge',
    product_type: 'ridge_cap',
    coverage_per_unit: 33,
    coverage_unit: 'LF',
    package_unit: 'bundle',
    formula: 'ceil((lf.ridge + lf.hip) / 33)',
    default_waste_percent: 5,
    notes: '33 LF per bundle',
  },
  ice_water_shield: {
    id: 'default-ice-water',
    manufacturer: 'GAF',
    product_name: 'WeatherWatch',
    product_type: 'ice_water_shield',
    coverage_per_unit: 66.7,
    coverage_unit: 'LF',
    package_unit: 'roll',
    formula: 'ceil((lf.valley + (lf.eave * 3)) / 66.7)',
    default_waste_percent: 5,
    notes: '66.7 LF per roll, 36" wide',
  },
  drip_edge: {
    id: 'default-drip',
    manufacturer: 'Generic',
    product_name: 'Aluminum Drip Edge',
    product_type: 'drip_edge',
    coverage_per_unit: 10,
    coverage_unit: 'LF',
    package_unit: 'piece',
    formula: 'ceil((lf.eave + lf.rake) / 10)',
    default_waste_percent: 5,
    notes: '10 ft pieces',
  },
  step_flashing: {
    id: 'default-step',
    manufacturer: 'Generic',
    product_name: 'Step Flashing 4x4',
    product_type: 'step_flashing',
    coverage_per_unit: 1,
    coverage_unit: 'LF',
    package_unit: 'piece',
    formula: 'ceil(lf.step_flashing)',
    default_waste_percent: 10,
    notes: '1 piece per linear foot',
  },
};

interface MeasurementContext {
  roof: { area: number; squares: number };
  lf: {
    eave: number;
    rake: number;
    ridge: number;
    hip: number;
    valley: number;
    step_flashing: number;
  };
  penetrations: { pipe_count: number };
  waste_pct: number;
}

export function evaluateFormula(formula: string, context: MeasurementContext): number {
  try {
    let evalFormula = formula;
    evalFormula = evalFormula.replace(/roof\.area/g, String(context.roof.area));
    evalFormula = evalFormula.replace(/roof\.squares/g, String(context.roof.squares));
    evalFormula = evalFormula.replace(/lf\.eave/g, String(context.lf.eave));
    evalFormula = evalFormula.replace(/lf\.rake/g, String(context.lf.rake));
    evalFormula = evalFormula.replace(/lf\.ridge/g, String(context.lf.ridge));
    evalFormula = evalFormula.replace(/lf\.hip/g, String(context.lf.hip));
    evalFormula = evalFormula.replace(/lf\.valley/g, String(context.lf.valley));
    evalFormula = evalFormula.replace(/lf\.step_flashing/g, String(context.lf.step_flashing));
    evalFormula = evalFormula.replace(/penetrations\.pipe_count/g, String(context.penetrations.pipe_count));
    evalFormula = evalFormula.replace(/waste_pct/g, String(context.waste_pct));

    const fn = new Function('ceil', 'floor', 'round', 'max', 'min', `return ${evalFormula}`);
    return fn(Math.ceil, Math.floor, Math.round, Math.max, Math.min);
  } catch (error) {
    console.error('Formula evaluation error:', error, formula);
    return 0;
  }
}

export function useManufacturerSpecs() {
  const getSpec = (productType: string): ManufacturerSpec => {
    return DEFAULT_SPECS[productType] || DEFAULT_SPECS.shingles;
  };

  const calculateQuantity = (productType: string, context: MeasurementContext): number => {
    const spec = getSpec(productType);
    return evaluateFormula(spec.formula, context);
  };

  return {
    specs: Object.values(DEFAULT_SPECS),
    isLoading: false,
    error: null,
    getSpec,
    calculateQuantity,
    defaultSpecs: DEFAULT_SPECS,
  };
}
