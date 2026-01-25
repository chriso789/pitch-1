/**
 * Phase 34: Roof Material Detection Enhancement
 * Detects roofing material type to improve pitch and edge detection.
 */

export type RoofMaterial = 'asphalt_shingle' | 'architectural_shingle' | 'metal' | 'tile_clay' | 'tile_concrete' | 'slate' | 'wood_shake' | 'flat_membrane' | 'tpo' | 'epdm' | 'unknown';

export interface MaterialDetectionResult {
  detectedMaterial: RoofMaterial;
  confidence: number;
  colorDetected: string;
  texturePattern: string;
  expectedPitchRange: { min: number; max: number };
  edgeSensitivity: 'high' | 'medium' | 'low';
}

const MATERIAL_SPECS: Record<RoofMaterial, { pitchMin: number; pitchMax: number; edgeSensitivity: 'high' | 'medium' | 'low' }> = {
  asphalt_shingle: { pitchMin: 2, pitchMax: 12, edgeSensitivity: 'medium' },
  architectural_shingle: { pitchMin: 4, pitchMax: 12, edgeSensitivity: 'medium' },
  metal: { pitchMin: 3, pitchMax: 18, edgeSensitivity: 'high' },
  tile_clay: { pitchMin: 4, pitchMax: 12, edgeSensitivity: 'high' },
  tile_concrete: { pitchMin: 4, pitchMax: 12, edgeSensitivity: 'high' },
  slate: { pitchMin: 4, pitchMax: 12, edgeSensitivity: 'high' },
  wood_shake: { pitchMin: 4, pitchMax: 12, edgeSensitivity: 'medium' },
  flat_membrane: { pitchMin: 0, pitchMax: 2, edgeSensitivity: 'low' },
  tpo: { pitchMin: 0, pitchMax: 3, edgeSensitivity: 'low' },
  epdm: { pitchMin: 0, pitchMax: 3, edgeSensitivity: 'low' },
  unknown: { pitchMin: 0, pitchMax: 18, edgeSensitivity: 'medium' }
};

export function detectRoofMaterial(colorAnalysis: { dominant: string; brightness: number }, textureAnalysis: { pattern: string; uniformity: number }): MaterialDetectionResult {
  let material: RoofMaterial = 'unknown';
  let confidence = 0.5;

  // Color-based detection
  if (colorAnalysis.dominant.includes('gray') || colorAnalysis.dominant.includes('black')) {
    if (textureAnalysis.uniformity > 0.8) {
      material = colorAnalysis.brightness < 30 ? 'flat_membrane' : 'asphalt_shingle';
      confidence = 0.7;
    }
  } else if (colorAnalysis.dominant.includes('terracotta') || colorAnalysis.dominant.includes('orange')) {
    material = 'tile_clay';
    confidence = 0.8;
  } else if (colorAnalysis.dominant.includes('silver') || colorAnalysis.dominant.includes('metallic')) {
    material = 'metal';
    confidence = 0.75;
  }

  const specs = MATERIAL_SPECS[material];
  
  return {
    detectedMaterial: material,
    confidence,
    colorDetected: colorAnalysis.dominant,
    texturePattern: textureAnalysis.pattern,
    expectedPitchRange: { min: specs.pitchMin, max: specs.pitchMax },
    edgeSensitivity: specs.edgeSensitivity
  };
}

export function validateMaterialVsPitch(material: RoofMaterial, pitchStr: string): { valid: boolean; warning?: string } {
  const match = pitchStr.match(/(\d+)\/12/);
  if (!match) return { valid: true };
  
  const pitch = parseInt(match[1]);
  const specs = MATERIAL_SPECS[material];
  
  if (pitch < specs.pitchMin || pitch > specs.pitchMax) {
    return {
      valid: false,
      warning: `${material} typically requires ${specs.pitchMin}/12 to ${specs.pitchMax}/12 pitch, detected ${pitch}/12`
    };
  }
  return { valid: true };
}
