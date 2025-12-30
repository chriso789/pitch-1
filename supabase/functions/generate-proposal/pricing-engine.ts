// ============================================================================
// PRICING ENGINE - GOOD/BETTER/BEST TIER CALCULATIONS
// ============================================================================

export interface MaterialCost {
  name: string;
  category: string;
  quantity: number;
  unit: string;
  unitCost: number;
  totalCost: number;
}

export interface LaborCost {
  task: string;
  hours: number;
  ratePerHour: number;
  totalCost: number;
}

export interface TierConfig {
  name: string;
  label: string;
  description: string;
  materialMarkup: number;   // Percentage markup on materials
  laborMarkup: number;      // Percentage markup on labor
  profitMargin: number;     // Target profit margin
  warranty: {
    years: number;
    type: string;
    description: string;
  };
  features: string[];
  recommended?: boolean;
}

export interface PricingInput {
  roofAreaSqFt: number;
  pitch: string;
  complexity: 'simple' | 'moderate' | 'complex';
  wastePercent: number;
  linearMeasurements: {
    ridge: number;
    hip: number;
    valley: number;
    eave: number;
    rake: number;
  };
  laborRatePerHour?: number;
  overhead?: number;
}

export interface TierPricing {
  tier: 'good' | 'better' | 'best';
  label: string;
  description: string;
  materials: MaterialCost[];
  labor: LaborCost[];
  materialSubtotal: number;
  laborSubtotal: number;
  overhead: number;
  subtotal: number;
  profitMargin: number;
  profitAmount: number;
  totalPrice: number;
  pricePerSquare: number;
  warranty: TierConfig['warranty'];
  features: string[];
  financing: FinancingOption[];
  recommended: boolean;
}

export interface FinancingOption {
  provider: string;
  termMonths: number;
  aprPercent: number;
  monthlyPayment: number;
  totalFinanced: number;
  downPayment: number;
  promoText?: string;
}

// Default tier configurations
const DEFAULT_TIERS: Record<'good' | 'better' | 'best', TierConfig> = {
  good: {
    name: 'good',
    label: 'Good',
    description: 'Quality roofing at an affordable price',
    materialMarkup: 0.15,
    laborMarkup: 0.10,
    profitMargin: 0.20,
    warranty: {
      years: 10,
      type: 'Standard',
      description: '10-year manufacturer warranty on materials'
    },
    features: [
      '3-tab architectural shingles',
      'Standard underlayment',
      'Basic ice & water shield at valleys',
      'Standard drip edge',
      'Standard ventilation review'
    ]
  },
  better: {
    name: 'better',
    label: 'Better',
    description: 'Premium materials with enhanced protection',
    materialMarkup: 0.20,
    laborMarkup: 0.15,
    profitMargin: 0.25,
    warranty: {
      years: 25,
      type: 'Extended',
      description: '25-year extended warranty with labor coverage'
    },
    features: [
      'Dimensional architectural shingles',
      'Synthetic underlayment',
      'Full ice & water shield at eaves and valleys',
      'Aluminum drip edge',
      'Ridge vent installation',
      'Upgraded starter strips',
      'Enhanced flashing'
    ],
    recommended: true
  },
  best: {
    name: 'best',
    label: 'Best',
    description: 'Top-tier materials with lifetime protection',
    materialMarkup: 0.25,
    laborMarkup: 0.20,
    profitMargin: 0.30,
    warranty: {
      years: 50,
      type: 'Lifetime',
      description: '50-year lifetime warranty with full coverage'
    },
    features: [
      'Designer or luxury shingles',
      'Premium synthetic underlayment',
      'Full roof ice & water shield',
      'Copper or premium drip edge',
      'Enhanced ventilation system',
      'Premium starter and hip/ridge',
      'Custom flashing work',
      'Gutter apron installation',
      'Detailed photo documentation',
      'Priority scheduling'
    ]
  }
};

// Material cost database (per unit)
const MATERIAL_COSTS = {
  // Shingles (per bundle, 3 bundles per square)
  shingles: {
    good: { name: '3-Tab Architectural', costPerBundle: 32 },
    better: { name: 'Dimensional Architectural', costPerBundle: 45 },
    best: { name: 'Designer Luxury', costPerBundle: 75 }
  },
  // Underlayment (per roll, ~400 sq ft coverage)
  underlayment: {
    good: { name: 'Standard Felt', costPerRoll: 28 },
    better: { name: 'Synthetic', costPerRoll: 65 },
    best: { name: 'Premium Synthetic', costPerRoll: 95 }
  },
  // Ice & water shield (per roll, ~75 sq ft coverage)
  iceWater: {
    good: { name: 'Basic I&W Shield', costPerRoll: 45 },
    better: { name: 'Standard I&W Shield', costPerRoll: 65 },
    best: { name: 'Premium Self-Adhered', costPerRoll: 95 }
  },
  // Drip edge (per 10' stick)
  dripEdge: {
    good: { name: 'Galvanized Steel', costPerStick: 5 },
    better: { name: 'Aluminum', costPerStick: 8 },
    best: { name: 'Copper-Look', costPerStick: 18 }
  },
  // Ridge cap (per bundle, ~25 LF coverage)
  ridgeCap: {
    good: { name: 'Standard Ridge', costPerBundle: 35 },
    better: { name: 'High-Profile Ridge', costPerBundle: 55 },
    best: { name: 'Designer Ridge', costPerBundle: 85 }
  },
  // Starter strip (per bundle, ~100 LF coverage)
  starter: {
    good: { name: 'Standard Starter', costPerBundle: 28 },
    better: { name: 'Premium Starter', costPerBundle: 42 },
    best: { name: 'Designer Starter', costPerBundle: 65 }
  },
  // Nails (per box, ~1 box per 4 squares)
  nails: {
    good: { name: 'Galvanized Nails', costPerBox: 45 },
    better: { name: 'Galvanized Nails', costPerBox: 45 },
    best: { name: 'Stainless Steel Nails', costPerBox: 85 }
  },
  // Pipe boots & flashing
  flashing: {
    good: { name: 'Standard Flashing Kit', costPer: 75 },
    better: { name: 'Premium Flashing Kit', costPer: 125 },
    best: { name: 'Copper Flashing Kit', costPer: 250 }
  },
  // Ventilation (per unit)
  ventilation: {
    good: { name: 'Box Vent', costPerUnit: 25, unitsPerSquare: 0.1 },
    better: { name: 'Ridge Vent', costPerLf: 3.5 },
    best: { name: 'Premium Ridge Vent', costPerLf: 6 }
  }
};

// Labor rates by complexity
const LABOR_MULTIPLIERS = {
  simple: 1.0,
  moderate: 1.25,
  complex: 1.6
};

// Pitch multipliers for labor
const PITCH_MULTIPLIERS: Record<string, number> = {
  'flat': 0.9,
  '2/12': 0.95,
  '3/12': 1.0,
  '4/12': 1.0,
  '5/12': 1.05,
  '6/12': 1.1,
  '7/12': 1.15,
  '8/12': 1.25,
  '9/12': 1.35,
  '10/12': 1.5,
  '11/12': 1.65,
  '12/12': 1.8
};

/**
 * Calculate materials for a single tier
 */
function calculateMaterials(
  tier: 'good' | 'better' | 'best',
  input: PricingInput,
  tierConfig: TierConfig
): MaterialCost[] {
  const { roofAreaSqFt, wastePercent, linearMeasurements } = input;
  const wasteFactor = 1 + (wastePercent / 100);
  const squares = roofAreaSqFt / 100;
  const materials: MaterialCost[] = [];
  
  // Shingles (3 bundles per square)
  const shingleBundles = Math.ceil(squares * 3 * wasteFactor);
  const shingle = MATERIAL_COSTS.shingles[tier];
  materials.push({
    name: shingle.name,
    category: 'Shingles',
    quantity: shingleBundles,
    unit: 'bundle',
    unitCost: shingle.costPerBundle * (1 + tierConfig.materialMarkup),
    totalCost: shingleBundles * shingle.costPerBundle * (1 + tierConfig.materialMarkup)
  });
  
  // Underlayment (400 sq ft per roll)
  const underlayRolls = Math.ceil((roofAreaSqFt * wasteFactor) / 400);
  const underlay = MATERIAL_COSTS.underlayment[tier];
  materials.push({
    name: underlay.name,
    category: 'Underlayment',
    quantity: underlayRolls,
    unit: 'roll',
    unitCost: underlay.costPerRoll * (1 + tierConfig.materialMarkup),
    totalCost: underlayRolls * underlay.costPerRoll * (1 + tierConfig.materialMarkup)
  });
  
  // Ice & water shield - varies by tier
  const iceWater = MATERIAL_COSTS.iceWater[tier];
  let iceWaterSqFt = 0;
  if (tier === 'good') {
    iceWaterSqFt = linearMeasurements.valley * 3; // Just valleys, 3' width
  } else if (tier === 'better') {
    iceWaterSqFt = (linearMeasurements.eave * 3) + (linearMeasurements.valley * 3);
  } else {
    iceWaterSqFt = roofAreaSqFt * 0.4; // 40% coverage for best
  }
  const iceWaterRolls = Math.ceil(iceWaterSqFt / 75);
  if (iceWaterRolls > 0) {
    materials.push({
      name: iceWater.name,
      category: 'Ice & Water Shield',
      quantity: iceWaterRolls,
      unit: 'roll',
      unitCost: iceWater.costPerRoll * (1 + tierConfig.materialMarkup),
      totalCost: iceWaterRolls * iceWater.costPerRoll * (1 + tierConfig.materialMarkup)
    });
  }
  
  // Drip edge (10' sticks)
  const dripEdgeLf = linearMeasurements.eave + linearMeasurements.rake;
  const dripEdgeSticks = Math.ceil((dripEdgeLf * wasteFactor) / 10);
  const dripEdge = MATERIAL_COSTS.dripEdge[tier];
  materials.push({
    name: dripEdge.name,
    category: 'Drip Edge',
    quantity: dripEdgeSticks,
    unit: 'stick',
    unitCost: dripEdge.costPerStick * (1 + tierConfig.materialMarkup),
    totalCost: dripEdgeSticks * dripEdge.costPerStick * (1 + tierConfig.materialMarkup)
  });
  
  // Ridge cap (25 LF per bundle)
  const ridgeLf = linearMeasurements.ridge + linearMeasurements.hip;
  const ridgeCapBundles = Math.ceil((ridgeLf * wasteFactor) / 25);
  const ridgeCap = MATERIAL_COSTS.ridgeCap[tier];
  materials.push({
    name: ridgeCap.name,
    category: 'Ridge Cap',
    quantity: ridgeCapBundles,
    unit: 'bundle',
    unitCost: ridgeCap.costPerBundle * (1 + tierConfig.materialMarkup),
    totalCost: ridgeCapBundles * ridgeCap.costPerBundle * (1 + tierConfig.materialMarkup)
  });
  
  // Starter strip (100 LF per bundle)
  const starterLf = linearMeasurements.eave + linearMeasurements.rake;
  const starterBundles = Math.ceil((starterLf * wasteFactor) / 100);
  const starter = MATERIAL_COSTS.starter[tier];
  materials.push({
    name: starter.name,
    category: 'Starter Strip',
    quantity: starterBundles,
    unit: 'bundle',
    unitCost: starter.costPerBundle * (1 + tierConfig.materialMarkup),
    totalCost: starterBundles * starter.costPerBundle * (1 + tierConfig.materialMarkup)
  });
  
  // Nails (1 box per 4 squares)
  const nailBoxes = Math.ceil(squares / 4);
  const nails = MATERIAL_COSTS.nails[tier];
  materials.push({
    name: nails.name,
    category: 'Fasteners',
    quantity: nailBoxes,
    unit: 'box',
    unitCost: nails.costPerBox * (1 + tierConfig.materialMarkup),
    totalCost: nailBoxes * nails.costPerBox * (1 + tierConfig.materialMarkup)
  });
  
  // Flashing kit (1 per job + 1 per 20 squares)
  const flashingKits = 1 + Math.floor(squares / 20);
  const flashing = MATERIAL_COSTS.flashing[tier];
  materials.push({
    name: flashing.name,
    category: 'Flashing',
    quantity: flashingKits,
    unit: 'kit',
    unitCost: flashing.costPer * (1 + tierConfig.materialMarkup),
    totalCost: flashingKits * flashing.costPer * (1 + tierConfig.materialMarkup)
  });
  
  // Ventilation
  const vent = MATERIAL_COSTS.ventilation[tier];
  if (tier === 'good' && 'unitsPerSquare' in vent) {
    const ventUnits = Math.ceil(squares * vent.unitsPerSquare);
    materials.push({
      name: vent.name,
      category: 'Ventilation',
      quantity: ventUnits,
      unit: 'unit',
      unitCost: vent.costPerUnit * (1 + tierConfig.materialMarkup),
      totalCost: ventUnits * vent.costPerUnit * (1 + tierConfig.materialMarkup)
    });
  } else if ('costPerLf' in vent) {
    const ventLf = linearMeasurements.ridge;
    materials.push({
      name: vent.name,
      category: 'Ventilation',
      quantity: ventLf,
      unit: 'LF',
      unitCost: vent.costPerLf * (1 + tierConfig.materialMarkup),
      totalCost: ventLf * vent.costPerLf * (1 + tierConfig.materialMarkup)
    });
  }
  
  return materials;
}

/**
 * Calculate labor costs for a tier
 */
function calculateLabor(
  tier: 'good' | 'better' | 'best',
  input: PricingInput,
  tierConfig: TierConfig
): LaborCost[] {
  const { roofAreaSqFt, pitch, complexity, linearMeasurements, laborRatePerHour = 55 } = input;
  const squares = roofAreaSqFt / 100;
  const labor: LaborCost[] = [];
  
  // Get multipliers
  const pitchMultiplier = PITCH_MULTIPLIERS[pitch] || 1.15;
  const complexityMultiplier = LABOR_MULTIPLIERS[complexity];
  
  // Base labor: approximately 1.5 hours per square for tear-off + install
  const baseHoursPerSquare = 1.5;
  const adjustedHoursPerSquare = baseHoursPerSquare * pitchMultiplier * complexityMultiplier;
  
  // Main roofing labor
  const roofingHours = squares * adjustedHoursPerSquare;
  labor.push({
    task: 'Tear-off & Installation',
    hours: Math.round(roofingHours * 10) / 10,
    ratePerHour: laborRatePerHour * (1 + tierConfig.laborMarkup),
    totalCost: roofingHours * laborRatePerHour * (1 + tierConfig.laborMarkup)
  });
  
  // Flashing labor
  const totalEdgeLf = linearMeasurements.ridge + linearMeasurements.hip + 
                      linearMeasurements.valley + linearMeasurements.eave + 
                      linearMeasurements.rake;
  const flashingHours = (totalEdgeLf / 50) * complexityMultiplier; // ~50 LF per hour
  labor.push({
    task: 'Edge & Flashing Work',
    hours: Math.round(flashingHours * 10) / 10,
    ratePerHour: laborRatePerHour * (1 + tierConfig.laborMarkup),
    totalCost: flashingHours * laborRatePerHour * (1 + tierConfig.laborMarkup)
  });
  
  // Cleanup & haul-off
  const cleanupHours = squares * 0.15 * complexityMultiplier;
  labor.push({
    task: 'Cleanup & Disposal',
    hours: Math.round(cleanupHours * 10) / 10,
    ratePerHour: laborRatePerHour * (1 + tierConfig.laborMarkup),
    totalCost: cleanupHours * laborRatePerHour * (1 + tierConfig.laborMarkup)
  });
  
  // Additional work for better/best tiers
  if (tier === 'better' || tier === 'best') {
    const ventHours = linearMeasurements.ridge / 20; // Ridge vent installation
    labor.push({
      task: 'Ridge Vent Installation',
      hours: Math.round(ventHours * 10) / 10,
      ratePerHour: laborRatePerHour * (1 + tierConfig.laborMarkup),
      totalCost: ventHours * laborRatePerHour * (1 + tierConfig.laborMarkup)
    });
  }
  
  if (tier === 'best') {
    // Photo documentation time
    labor.push({
      task: 'Photo Documentation',
      hours: 1.5,
      ratePerHour: laborRatePerHour * (1 + tierConfig.laborMarkup),
      totalCost: 1.5 * laborRatePerHour * (1 + tierConfig.laborMarkup)
    });
    
    // Gutter apron
    const gutterHours = linearMeasurements.eave / 30;
    labor.push({
      task: 'Gutter Apron Installation',
      hours: Math.round(gutterHours * 10) / 10,
      ratePerHour: laborRatePerHour * (1 + tierConfig.laborMarkup),
      totalCost: gutterHours * laborRatePerHour * (1 + tierConfig.laborMarkup)
    });
  }
  
  return labor;
}

/**
 * Calculate financing options for a price
 */
function calculateFinancing(totalPrice: number, tier: 'good' | 'better' | 'best'): FinancingOption[] {
  const options: FinancingOption[] = [];
  
  // Standard financing terms
  const terms = [
    { months: 12, apr: 0, promo: '0% APR for 12 months' },
    { months: 36, apr: 5.99, promo: undefined },
    { months: 60, apr: 7.99, promo: undefined },
    { months: 120, apr: 9.99, promo: 'Low monthly payments' }
  ];
  
  for (const term of terms) {
    const principal = totalPrice;
    const monthlyRate = term.apr / 100 / 12;
    
    let monthlyPayment: number;
    if (term.apr === 0) {
      monthlyPayment = principal / term.months;
    } else {
      monthlyPayment = principal * (monthlyRate * Math.pow(1 + monthlyRate, term.months)) / 
                       (Math.pow(1 + monthlyRate, term.months) - 1);
    }
    
    options.push({
      provider: 'In-House Financing',
      termMonths: term.months,
      aprPercent: term.apr,
      monthlyPayment: Math.round(monthlyPayment * 100) / 100,
      totalFinanced: Math.round(monthlyPayment * term.months * 100) / 100,
      downPayment: 0,
      promoText: term.promo
    });
  }
  
  return options;
}

/**
 * Calculate pricing for all three tiers
 */
export function calculateTierPricing(
  input: PricingInput,
  customTiers?: Partial<Record<'good' | 'better' | 'best', Partial<TierConfig>>>
): TierPricing[] {
  const tiers: ('good' | 'better' | 'best')[] = ['good', 'better', 'best'];
  const results: TierPricing[] = [];
  
  for (const tier of tiers) {
    const tierConfig = {
      ...DEFAULT_TIERS[tier],
      ...(customTiers?.[tier] || {})
    };
    
    const materials = calculateMaterials(tier, input, tierConfig);
    const labor = calculateLabor(tier, input, tierConfig);
    
    const materialSubtotal = materials.reduce((sum, m) => sum + m.totalCost, 0);
    const laborSubtotal = labor.reduce((sum, l) => sum + l.totalCost, 0);
    
    const overhead = input.overhead || 0.08; // 8% default overhead
    const overheadAmount = (materialSubtotal + laborSubtotal) * overhead;
    
    const subtotal = materialSubtotal + laborSubtotal + overheadAmount;
    const profitAmount = subtotal * tierConfig.profitMargin;
    const totalPrice = subtotal + profitAmount;
    
    const squares = input.roofAreaSqFt / 100;
    const pricePerSquare = totalPrice / squares;
    
    results.push({
      tier,
      label: tierConfig.label,
      description: tierConfig.description,
      materials,
      labor,
      materialSubtotal: Math.round(materialSubtotal * 100) / 100,
      laborSubtotal: Math.round(laborSubtotal * 100) / 100,
      overhead: Math.round(overheadAmount * 100) / 100,
      subtotal: Math.round(subtotal * 100) / 100,
      profitMargin: tierConfig.profitMargin,
      profitAmount: Math.round(profitAmount * 100) / 100,
      totalPrice: Math.round(totalPrice * 100) / 100,
      pricePerSquare: Math.round(pricePerSquare * 100) / 100,
      warranty: tierConfig.warranty,
      features: tierConfig.features,
      financing: calculateFinancing(totalPrice, tier),
      recommended: tierConfig.recommended || false
    });
  }
  
  return results;
}

/**
 * Format currency for display
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}

/**
 * Calculate savings between tiers
 */
export function calculateTierSavings(
  baseTier: TierPricing,
  comparisonTier: TierPricing
): { amount: number; percent: number } {
  const difference = comparisonTier.totalPrice - baseTier.totalPrice;
  const percent = (difference / comparisonTier.totalPrice) * 100;
  
  return {
    amount: Math.round(difference * 100) / 100,
    percent: Math.round(percent * 10) / 10
  };
}
