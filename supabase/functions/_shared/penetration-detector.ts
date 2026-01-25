// =====================================================
// Phase 98: Penetration Detector
// Detect and map roof penetrations
// =====================================================

export type PenetrationType = 
  | 'skylight'
  | 'chimney'
  | 'plumbing_vent'
  | 'hvac_unit'
  | 'exhaust_fan'
  | 'dormer'
  | 'solar_panel'
  | 'satellite_dish'
  | 'antenna'
  | 'turbine_vent'
  | 'ridge_vent'
  | 'unknown';

export interface DetectedPenetration {
  id: string;
  type: PenetrationType;
  confidence: number;
  position: {
    lat: number;
    lng: number;
    relativeX: number; // 0-1 relative to roof bounds
    relativeY: number; // 0-1 relative to roof bounds
  };
  dimensions: {
    width: number; // inches
    height: number; // inches
    area: number; // sq inches
  };
  flashingRequirements: FlashingRequirement;
  material?: string;
  condition?: 'good' | 'fair' | 'poor' | 'unknown';
}

export interface FlashingRequirement {
  type: 'pipe_boot' | 'step_flashing' | 'counter_flashing' | 'apron_flashing' | 'curb_mount' | 'custom';
  material: 'aluminum' | 'copper' | 'lead' | 'rubber' | 'galvanized' | 'stainless';
  linearFeet?: number;
  iceWaterRequired: boolean;
  sealantType?: string;
}

export interface PenetrationSummary {
  totalCount: number;
  byType: Record<PenetrationType, number>;
  totalFlashingLinearFeet: number;
  flashingMaterials: string[];
  estimatedCost: number;
  riskyPenetrations: DetectedPenetration[];
}

// Detection patterns for penetration types
const PENETRATION_PATTERNS: Record<PenetrationType, {
  description: string;
  typicalSize: { minWidth: number; maxWidth: number; minHeight: number; maxHeight: number };
  shape: 'rectangular' | 'circular' | 'square' | 'irregular';
  flashingType: FlashingRequirement['type'];
  flashingMaterial: FlashingRequirement['material'];
}> = {
  skylight: {
    description: 'Glass or plastic dome for natural lighting',
    typicalSize: { minWidth: 14, maxWidth: 72, minHeight: 14, maxHeight: 72 },
    shape: 'rectangular',
    flashingType: 'curb_mount',
    flashingMaterial: 'aluminum',
  },
  chimney: {
    description: 'Masonry or metal chimney for heating exhaust',
    typicalSize: { minWidth: 16, maxWidth: 48, minHeight: 16, maxHeight: 48 },
    shape: 'rectangular',
    flashingType: 'step_flashing',
    flashingMaterial: 'lead',
  },
  plumbing_vent: {
    description: 'PVC or metal pipe for plumbing ventilation',
    typicalSize: { minWidth: 1.5, maxWidth: 6, minHeight: 1.5, maxHeight: 6 },
    shape: 'circular',
    flashingType: 'pipe_boot',
    flashingMaterial: 'rubber',
  },
  hvac_unit: {
    description: 'Rooftop HVAC/AC unit (commercial)',
    typicalSize: { minWidth: 24, maxWidth: 96, minHeight: 24, maxHeight: 96 },
    shape: 'rectangular',
    flashingType: 'curb_mount',
    flashingMaterial: 'galvanized',
  },
  exhaust_fan: {
    description: 'Kitchen or bathroom exhaust fan vent',
    typicalSize: { minWidth: 4, maxWidth: 12, minHeight: 4, maxHeight: 12 },
    shape: 'circular',
    flashingType: 'pipe_boot',
    flashingMaterial: 'aluminum',
  },
  dormer: {
    description: 'Window projection from sloped roof',
    typicalSize: { minWidth: 36, maxWidth: 120, minHeight: 36, maxHeight: 96 },
    shape: 'rectangular',
    flashingType: 'step_flashing',
    flashingMaterial: 'aluminum',
  },
  solar_panel: {
    description: 'Photovoltaic solar panel array',
    typicalSize: { minWidth: 39, maxWidth: 200, minHeight: 65, maxHeight: 400 },
    shape: 'rectangular',
    flashingType: 'custom',
    flashingMaterial: 'aluminum',
  },
  satellite_dish: {
    description: 'Satellite TV or internet dish',
    typicalSize: { minWidth: 18, maxWidth: 36, minHeight: 18, maxHeight: 36 },
    shape: 'circular',
    flashingType: 'pipe_boot',
    flashingMaterial: 'rubber',
  },
  antenna: {
    description: 'TV antenna or radio tower mount',
    typicalSize: { minWidth: 2, maxWidth: 6, minHeight: 2, maxHeight: 6 },
    shape: 'circular',
    flashingType: 'pipe_boot',
    flashingMaterial: 'rubber',
  },
  turbine_vent: {
    description: 'Spinning turbine attic vent',
    typicalSize: { minWidth: 12, maxWidth: 18, minHeight: 12, maxHeight: 18 },
    shape: 'circular',
    flashingType: 'pipe_boot',
    flashingMaterial: 'aluminum',
  },
  ridge_vent: {
    description: 'Continuous ridge ventilation',
    typicalSize: { minWidth: 9, maxWidth: 12, minHeight: 0, maxHeight: 0 },
    shape: 'rectangular',
    flashingType: 'custom',
    flashingMaterial: 'aluminum',
  },
  unknown: {
    description: 'Unidentified roof penetration',
    typicalSize: { minWidth: 1, maxWidth: 100, minHeight: 1, maxHeight: 100 },
    shape: 'irregular',
    flashingType: 'custom',
    flashingMaterial: 'aluminum',
  },
};

export class PenetrationDetector {
  // Detect penetrations from AI analysis data
  detectPenetrations(
    aiDetectionData: {
      penetrations?: Array<{
        type: string;
        bounds: { x: number; y: number; width: number; height: number };
        confidence: number;
      }>;
    },
    roofBounds: { lat: number; lng: number; width: number; height: number }
  ): DetectedPenetration[] {
    const penetrations: DetectedPenetration[] = [];
    
    if (!aiDetectionData.penetrations) return penetrations;
    
    for (const detected of aiDetectionData.penetrations) {
      const type = this.mapPenetrationType(detected.type);
      const pattern = PENETRATION_PATTERNS[type];
      
      penetrations.push({
        id: `pen-${Date.now()}-${penetrations.length}`,
        type,
        confidence: detected.confidence,
        position: {
          lat: roofBounds.lat + (detected.bounds.y / roofBounds.height) * 0.001,
          lng: roofBounds.lng + (detected.bounds.x / roofBounds.width) * 0.001,
          relativeX: detected.bounds.x / roofBounds.width,
          relativeY: detected.bounds.y / roofBounds.height,
        },
        dimensions: {
          width: detected.bounds.width,
          height: detected.bounds.height,
          area: detected.bounds.width * detected.bounds.height,
        },
        flashingRequirements: {
          type: pattern.flashingType,
          material: pattern.flashingMaterial,
          linearFeet: this.calculateFlashingLength(detected.bounds, pattern.shape),
          iceWaterRequired: this.requiresIceWater(type),
          sealantType: this.getSealantType(type),
        },
      });
    }
    
    return penetrations;
  }

  // Map detected type string to enum
  private mapPenetrationType(typeString: string): PenetrationType {
    const normalized = typeString.toLowerCase().replace(/[^a-z]/g, '_');
    
    const typeMap: Record<string, PenetrationType> = {
      'skylight': 'skylight',
      'chimney': 'chimney',
      'vent': 'plumbing_vent',
      'pipe': 'plumbing_vent',
      'hvac': 'hvac_unit',
      'ac': 'hvac_unit',
      'exhaust': 'exhaust_fan',
      'fan': 'exhaust_fan',
      'dormer': 'dormer',
      'solar': 'solar_panel',
      'panel': 'solar_panel',
      'satellite': 'satellite_dish',
      'dish': 'satellite_dish',
      'antenna': 'antenna',
      'turbine': 'turbine_vent',
      'ridge': 'ridge_vent',
    };
    
    for (const [key, value] of Object.entries(typeMap)) {
      if (normalized.includes(key)) return value;
    }
    
    return 'unknown';
  }

  // Calculate flashing linear feet
  private calculateFlashingLength(
    bounds: { width: number; height: number },
    shape: 'rectangular' | 'circular' | 'square' | 'irregular'
  ): number {
    if (shape === 'circular') {
      const diameter = Math.max(bounds.width, bounds.height);
      return Math.PI * diameter / 12; // Convert to feet
    }
    
    return (2 * bounds.width + 2 * bounds.height) / 12; // Perimeter in feet
  }

  // Check if penetration requires ice/water shield
  private requiresIceWater(type: PenetrationType): boolean {
    return ['skylight', 'chimney', 'dormer', 'hvac_unit'].includes(type);
  }

  // Get recommended sealant type
  private getSealantType(type: PenetrationType): string {
    switch (type) {
      case 'chimney':
        return 'High-temp silicone';
      case 'skylight':
        return 'Polyurethane caulk';
      case 'plumbing_vent':
        return 'Butyl tape';
      default:
        return 'Polyurethane sealant';
    }
  }

  // Generate summary of all penetrations
  generateSummary(penetrations: DetectedPenetration[]): PenetrationSummary {
    const byType: Record<PenetrationType, number> = {} as any;
    let totalFlashing = 0;
    const materials = new Set<string>();
    const riskyPenetrations: DetectedPenetration[] = [];
    
    for (const pen of penetrations) {
      byType[pen.type] = (byType[pen.type] || 0) + 1;
      totalFlashing += pen.flashingRequirements.linearFeet || 0;
      materials.add(pen.flashingRequirements.material);
      
      // Flag risky penetrations
      if (pen.type === 'chimney' && pen.condition === 'poor') {
        riskyPenetrations.push(pen);
      }
      if (pen.confidence < 0.6) {
        riskyPenetrations.push(pen);
      }
    }
    
    // Estimate cost (simplified)
    const costPerLinearFoot = 15;
    const costPerPenetration = 50;
    const estimatedCost = (totalFlashing * costPerLinearFoot) + 
                          (penetrations.length * costPerPenetration);
    
    return {
      totalCount: penetrations.length,
      byType,
      totalFlashingLinearFeet: totalFlashing,
      flashingMaterials: Array.from(materials),
      estimatedCost,
      riskyPenetrations,
    };
  }

  // Generate AI detection prompt for penetrations
  getDetectionPrompt(): string {
    return `
      Analyze the roof image and identify ALL penetrations (objects that break through the roof surface).
      
      For EACH penetration found, provide:
      1. Type (skylight, chimney, vent pipe, HVAC unit, exhaust fan, dormer, solar panel, satellite dish, antenna, turbine vent, ridge vent)
      2. Approximate bounding box (x, y, width, height as percentage of image)
      3. Confidence score (0-1)
      
      Common penetrations to look for:
      - Plumbing vents: Small circular pipes, usually 1.5-4 inches diameter, scattered on roof
      - Skylights: Rectangular glass panels, often 2x4 feet or larger
      - Chimneys: Masonry or metal structures, typically 2x2 feet or larger
      - HVAC units: Large metal boxes on flat or low-slope commercial roofs
      - Solar panels: Rectangular dark panels, often in arrays
      - Turbine vents: Spinning dome-shaped vents, 12-18 inches diameter
      
      Return results as JSON array.
    `;
  }

  // Get flashing requirements for estimate
  getFlashingEstimate(penetrations: DetectedPenetration[]): {
    pipeBoots: { count: number; sizes: string[] };
    stepFlashing: number;
    counterFlashing: number;
    curbMounts: number;
    iceWaterShield: number;
    sealant: { tubes: number; type: string };
  } {
    let pipeBoots = 0;
    const bootSizes: string[] = [];
    let stepFlashing = 0;
    let counterFlashing = 0;
    let curbMounts = 0;
    let iceWater = 0;
    
    for (const pen of penetrations) {
      const req = pen.flashingRequirements;
      
      switch (req.type) {
        case 'pipe_boot':
          pipeBoots++;
          bootSizes.push(`${pen.dimensions.width}" dia`);
          break;
        case 'step_flashing':
          stepFlashing += req.linearFeet || 0;
          counterFlashing += (req.linearFeet || 0) * 0.3; // Counter flashing ~30% of step
          break;
        case 'curb_mount':
          curbMounts++;
          break;
      }
      
      if (req.iceWaterRequired) {
        // 3 feet around penetration
        iceWater += (pen.dimensions.width + 72) * (pen.dimensions.height + 72) / 144; // sq ft
      }
    }
    
    // Estimate sealant tubes (1 tube per 3 penetrations)
    const sealantTubes = Math.ceil(penetrations.length / 3);
    
    return {
      pipeBoots: { count: pipeBoots, sizes: bootSizes },
      stepFlashing,
      counterFlashing,
      curbMounts,
      iceWaterShield: iceWater,
      sealant: { tubes: sealantTubes, type: 'Polyurethane' },
    };
  }
}

export default PenetrationDetector;
