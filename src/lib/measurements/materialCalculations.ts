/**
 * Material Calculation Engine
 * Calculates material quantities based on roof measurements
 */

import { SRS_PRICELIST, SRSPricelistItem } from '@/data/srs-pricelist-data';

export interface RoofMeasurementData {
  total_area_sqft: number;
  total_squares: number;
  lf_ridge: number;
  lf_hip: number;
  lf_valley: number;
  lf_eave: number;
  lf_rake: number;
  lf_step: number;
  penetration_counts?: {
    pipe_vent?: number;
    skylight?: number;
    chimney?: number;
    hvac?: number;
  };
  facets?: Array<{
    pitch: string;
    area_sqft: number;
  }>;
}

export interface MaterialCalculationOptions {
  waste_percentage: number; // 0, 8, 10, 12, 15, 17, 20
  selected_brands?: {
    shingles?: string;
    underlayment?: string;
    ridge_cap?: string;
    ice_water?: string;
    starter?: string;
  };
  complexity_factor?: number; // 1.0 = normal, 1.2 = complex
}

export interface MaterialQuantity {
  category: string;
  product_name: string;
  brand: string;
  item_code: string;
  quantity: number;
  unit_of_measure: string;
  unit_cost: number;
  total_cost: number;
  calculation_basis: string; // Explanation of how quantity was calculated
}

export interface MaterialCalculationResult {
  base_materials: MaterialQuantity[];
  waste_adjusted_materials: MaterialQuantity[];
  total_base_cost: number;
  total_waste_adjusted_cost: number;
  waste_percentage: number;
  summary: {
    shingle_bundles: number;
    ridge_cap_bundles: number;
    underlayment_rolls: number;
    ice_water_rolls: number;
    starter_bundles: number;
    drip_edge_sticks: number;
    valley_rolls: number;
    penetration_flashings: number;
  };
}

/**
 * Main calculation engine
 */
export class MaterialCalculator {
  private measurements: RoofMeasurementData;
  private options: MaterialCalculationOptions;

  constructor(measurements: RoofMeasurementData, options: MaterialCalculationOptions) {
    this.measurements = measurements;
    this.options = {
      waste_percentage: options.waste_percentage || 10,
      selected_brands: options.selected_brands || {},
      complexity_factor: options.complexity_factor || 1.0,
    };
  }

  /**
   * Calculate all materials
   */
  calculate(): MaterialCalculationResult {
    const baseMaterials = this.calculateBaseMaterials();
    const wasteAdjustedMaterials = this.applyWasteFactor(baseMaterials);

    const totalBaseCost = baseMaterials.reduce((sum, m) => sum + m.total_cost, 0);
    const totalWasteAdjustedCost = wasteAdjustedMaterials.reduce((sum, m) => sum + m.total_cost, 0);

    return {
      base_materials: baseMaterials,
      waste_adjusted_materials: wasteAdjustedMaterials,
      total_base_cost: totalBaseCost,
      total_waste_adjusted_cost: totalWasteAdjustedCost,
      waste_percentage: this.options.waste_percentage,
      summary: this.generateSummary(wasteAdjustedMaterials),
    };
  }

  /**
   * Calculate base material quantities (no waste)
   */
  private calculateBaseMaterials(): MaterialQuantity[] {
    const materials: MaterialQuantity[] = [];

    // 1. SHINGLES
    materials.push(...this.calculateShingles());

    // 2. RIDGE & HIP CAP
    materials.push(...this.calculateRidgeCap());

    // 3. STARTER STRIP
    materials.push(...this.calculateStarter());

    // 4. UNDERLAYMENT
    materials.push(...this.calculateUnderlayment());

    // 5. ICE & WATER SHIELD
    materials.push(...this.calculateIceWater());

    // 6. VALLEY MATERIAL
    materials.push(...this.calculateValley());

    // 7. DRIP EDGE
    materials.push(...this.calculateDripEdge());

    // 8. PENETRATION FLASHINGS
    materials.push(...this.calculateFlashings());

    return materials;
  }

  /**
   * Calculate shingles
   */
  private calculateShingles(): MaterialQuantity[] {
    const squares = this.measurements.total_squares;
    const bundlesPerSquare = 3;
    const bundles = Math.ceil(squares * bundlesPerSquare);

    const brand = this.options.selected_brands?.shingles || 'GAF';
    const product = this.findProduct('Shingles', brand);

    if (!product) {
      return [];
    }

    return [{
      category: 'Shingles',
      product_name: product.product,
      brand: product.brand,
      item_code: product.item_code,
      quantity: Math.ceil(squares), // Sold by square
      unit_of_measure: 'SQ',
      unit_cost: product.unit_cost,
      total_cost: Math.ceil(squares) * product.unit_cost,
      calculation_basis: `${squares.toFixed(2)} squares × ${bundlesPerSquare} bundles/sq = ${bundles} bundles`,
    }];
  }

  /**
   * Calculate ridge & hip cap
   */
  private calculateRidgeCap(): MaterialQuantity[] {
    const totalRidgeHip = this.measurements.lf_ridge + this.measurements.lf_hip;
    const brand = this.options.selected_brands?.ridge_cap || 'GAF';
    const product = this.findProduct('Hip & Ridge', brand);

    if (!product || totalRidgeHip === 0) {
      return [];
    }

    // Default to 33 LF per bundle if metadata not available
    const lfPerBundle = product.metadata?.length_per_unit
      ? parseFloat(product.metadata.length_per_unit)
      : 33;
    
    const bundles = Math.ceil(totalRidgeHip / lfPerBundle);

    return [{
      category: 'Hip & Ridge',
      product_name: product.product,
      brand: product.brand,
      item_code: product.item_code,
      quantity: bundles,
      unit_of_measure: 'BD',
      unit_cost: product.unit_cost,
      total_cost: bundles * product.unit_cost,
      calculation_basis: `${totalRidgeHip.toFixed(0)} LF ÷ ${lfPerBundle} LF/bundle = ${bundles} bundles`,
    }];
  }

  /**
   * Calculate starter strip
   */
  private calculateStarter(): MaterialQuantity[] {
    const totalPerimeter = this.measurements.lf_eave + this.measurements.lf_rake;
    const brand = this.options.selected_brands?.starter || 'GAF';
    const product = this.findProduct('Starter', brand);

    if (!product || totalPerimeter === 0) {
      return [];
    }

    const lfPerBundle = product.metadata?.length_per_unit
      ? parseFloat(product.metadata.length_per_unit)
      : 105;
    
    const bundles = Math.ceil(totalPerimeter / lfPerBundle);

    return [{
      category: 'Starter',
      product_name: product.product,
      brand: product.brand,
      item_code: product.item_code,
      quantity: bundles,
      unit_of_measure: 'BD',
      unit_cost: product.unit_cost,
      total_cost: bundles * product.unit_cost,
      calculation_basis: `${totalPerimeter.toFixed(0)} LF ÷ ${lfPerBundle} LF/bundle = ${bundles} bundles`,
    }];
  }

  /**
   * Calculate underlayment
   */
  private calculateUnderlayment(): MaterialQuantity[] {
    const squares = this.measurements.total_squares;
    const brand = this.options.selected_brands?.underlayment || 'Top Shield';
    const product = this.findProduct('Underlayment', brand);

    if (!product) {
      return [];
    }

    // Most underlayment covers 10 squares per roll
    const squaresPerRoll = 10;
    const rolls = Math.ceil(squares / squaresPerRoll);

    return [{
      category: 'Underlayment',
      product_name: product.product,
      brand: product.brand,
      item_code: product.item_code,
      quantity: rolls,
      unit_of_measure: 'RL',
      unit_cost: product.unit_cost,
      total_cost: rolls * product.unit_cost,
      calculation_basis: `${squares.toFixed(2)} squares ÷ ${squaresPerRoll} sq/roll = ${rolls} rolls`,
    }];
  }

  /**
   * Calculate ice & water shield
   */
  private calculateIceWater(): MaterialQuantity[] {
    // Ice & water typically used on eaves (first 3 feet) and valleys
    const eaveArea = (this.measurements.lf_eave * 3) / 100; // 3 feet from eave edge, convert to squares
    const valleyArea = (this.measurements.lf_valley * 3) / 100; // 3 feet on each side of valley
    const totalSquares = eaveArea + valleyArea;

    const brand = this.options.selected_brands?.ice_water || 'GAF';
    const product = this.findProduct('Ice & Water', brand);

    if (!product || totalSquares === 0) {
      return [];
    }

    // Ice & water covers 2 squares per roll
    const squaresPerRoll = 2;
    const rolls = Math.ceil(totalSquares / squaresPerRoll);

    return [{
      category: 'Ice & Water',
      product_name: product.product,
      brand: product.brand,
      item_code: product.item_code,
      quantity: rolls,
      unit_of_measure: 'RL',
      unit_cost: product.unit_cost,
      total_cost: rolls * product.unit_cost,
      calculation_basis: `Eaves (${this.measurements.lf_eave}LF × 3') + Valleys (${this.measurements.lf_valley}LF × 3') = ${totalSquares.toFixed(1)} sq ÷ ${squaresPerRoll} sq/roll = ${rolls} rolls`,
    }];
  }

  /**
   * Calculate valley material
   */
  private calculateValley(): MaterialQuantity[] {
    if (this.measurements.lf_valley === 0) {
      return [];
    }

    const product = this.findProduct('Metal', undefined, 'Valley Roll');

    if (!product) {
      return [];
    }

    const lfPerRoll = 50; // Standard valley roll is 50 LF
    const rolls = Math.ceil(this.measurements.lf_valley / lfPerRoll);

    return [{
      category: 'Valley',
      product_name: product.product,
      brand: product.brand,
      item_code: product.item_code,
      quantity: rolls,
      unit_of_measure: 'RL',
      unit_cost: product.unit_cost,
      total_cost: rolls * product.unit_cost,
      calculation_basis: `${this.measurements.lf_valley.toFixed(0)} LF ÷ ${lfPerRoll} LF/roll = ${rolls} rolls`,
    }];
  }

  /**
   * Calculate drip edge
   */
  private calculateDripEdge(): MaterialQuantity[] {
    const totalPerimeter = this.measurements.lf_eave + this.measurements.lf_rake;
    const product = this.findProduct('Metal', undefined, 'Drip Edge');

    if (!product || totalPerimeter === 0) {
      return [];
    }

    const lfPerStick = 10; // Standard drip edge is 10 LF per piece
    const sticks = Math.ceil(totalPerimeter / lfPerStick);

    return [{
      category: 'Drip Edge',
      product_name: product.product,
      brand: product.brand,
      item_code: product.item_code,
      quantity: sticks,
      unit_of_measure: 'PC',
      unit_cost: product.unit_cost,
      total_cost: sticks * product.unit_cost,
      calculation_basis: `${totalPerimeter.toFixed(0)} LF ÷ ${lfPerStick} LF/piece = ${sticks} pieces`,
    }];
  }

  /**
   * Calculate penetration flashings
   */
  private calculateFlashings(): MaterialQuantity[] {
    const materials: MaterialQuantity[] = [];
    const penetrations = this.measurements.penetration_counts || {};

    // Pipe boots
    if (penetrations.pipe_vent && penetrations.pipe_vent > 0) {
      const product = this.findProduct('Ventilation', undefined, 'Lead Boot');
      if (product) {
        materials.push({
          category: 'Flashing',
          product_name: 'Lead Boot 2"',
          brand: product.brand,
          item_code: product.item_code,
          quantity: penetrations.pipe_vent,
          unit_of_measure: 'EA',
          unit_cost: product.unit_cost,
          total_cost: penetrations.pipe_vent * product.unit_cost,
          calculation_basis: `${penetrations.pipe_vent} pipe vents`,
        });
      }
    }

    // Skylight flashing kits (estimate)
    if (penetrations.skylight && penetrations.skylight > 0) {
      materials.push({
        category: 'Flashing',
        product_name: 'Skylight Flashing Kit',
        brand: 'Generic',
        item_code: 'SKYLIGHT-KIT',
        quantity: penetrations.skylight,
        unit_of_measure: 'EA',
        unit_cost: 75.00, // Estimated
        total_cost: penetrations.skylight * 75.00,
        calculation_basis: `${penetrations.skylight} skylights`,
      });
    }

    // Chimney flashing kits (estimate)
    if (penetrations.chimney && penetrations.chimney > 0) {
      materials.push({
        category: 'Flashing',
        product_name: 'Chimney Flashing Kit',
        brand: 'Generic',
        item_code: 'CHIMNEY-KIT',
        quantity: penetrations.chimney,
        unit_of_measure: 'EA',
        unit_cost: 125.00, // Estimated
        total_cost: penetrations.chimney * 125.00,
        calculation_basis: `${penetrations.chimney} chimneys`,
      });
    }

    return materials;
  }

  /**
   * Apply waste factor to materials
   */
  private applyWasteFactor(baseMaterials: MaterialQuantity[]): MaterialQuantity[] {
    const wasteFactor = 1 + (this.options.waste_percentage / 100);
    
    return baseMaterials.map(material => {
      // Apply waste to area-based materials, not to counted items like penetrations
      const shouldApplyWaste = ['Shingles', 'Underlayment', 'Ice & Water', 'Hip & Ridge', 'Starter', 'Drip Edge'].includes(material.category);
      
      if (!shouldApplyWaste) {
        return material;
      }

      const wasteQuantity = Math.ceil(material.quantity * wasteFactor);
      
      return {
        ...material,
        quantity: wasteQuantity,
        total_cost: wasteQuantity * material.unit_cost,
        calculation_basis: `${material.calculation_basis} + ${this.options.waste_percentage}% waste = ${wasteQuantity}`,
      };
    });
  }

  /**
   * Generate summary
   */
  private generateSummary(materials: MaterialQuantity[]): MaterialCalculationResult['summary'] {
    const summary = {
      shingle_bundles: 0,
      ridge_cap_bundles: 0,
      underlayment_rolls: 0,
      ice_water_rolls: 0,
      starter_bundles: 0,
      drip_edge_sticks: 0,
      valley_rolls: 0,
      penetration_flashings: 0,
    };

    materials.forEach(m => {
      if (m.category === 'Shingles') summary.shingle_bundles = m.quantity * 3; // Convert squares to bundles
      if (m.category === 'Hip & Ridge') summary.ridge_cap_bundles = m.quantity;
      if (m.category === 'Underlayment') summary.underlayment_rolls = m.quantity;
      if (m.category === 'Ice & Water') summary.ice_water_rolls = m.quantity;
      if (m.category === 'Starter') summary.starter_bundles = m.quantity;
      if (m.category === 'Drip Edge') summary.drip_edge_sticks = m.quantity;
      if (m.category === 'Valley') summary.valley_rolls = m.quantity;
      if (m.category === 'Flashing') summary.penetration_flashings += m.quantity;
    });

    return summary;
  }

  /**
   * Find product in catalog
   */
  private findProduct(category: string, brand?: string, productNameContains?: string): SRSPricelistItem | undefined {
    let products = SRS_PRICELIST.filter(p => p.category === category);

    if (brand) {
      products = products.filter(p => p.brand === brand);
    }

    if (productNameContains) {
      products = products.filter(p => p.product.toLowerCase().includes(productNameContains.toLowerCase()));
    }

    // Return first match or first product in category
    return products[0];
  }
}

/**
 * Quick calculation helper
 */
export function calculateMaterials(
  measurements: RoofMeasurementData,
  options: MaterialCalculationOptions
): MaterialCalculationResult {
  const calculator = new MaterialCalculator(measurements, options);
  return calculator.calculate();
}

/**
 * Get available brands for each category
 */
export function getAvailableBrands(): Record<string, string[]> {
  const brandsByCategory: Record<string, Set<string>> = {};

  SRS_PRICELIST.forEach(item => {
    if (!brandsByCategory[item.category]) {
      brandsByCategory[item.category] = new Set();
    }
    brandsByCategory[item.category].add(item.brand);
  });

  // Convert Sets to Arrays
  const result: Record<string, string[]> = {};
  Object.keys(brandsByCategory).forEach(category => {
    result[category] = Array.from(brandsByCategory[category]).sort();
  });

  return result;
}
