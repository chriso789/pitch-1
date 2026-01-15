// Formula Builder Constants for Estimate Template Items

export interface MeasurementTag {
  tag: string;
  label: string;
  category: 'area' | 'linear' | 'count';
  sampleValue: number;
  unit: string;
}

export interface ConversionPreset {
  label: string;
  multiplier: number | null;
  operation: 'multiply' | 'divide' | 'custom';
}

export interface WasteOption {
  label: string;
  value: number; // -1 means custom
}

export interface RoundingOption {
  label: string;
  value: 'ceil' | 'floor' | 'round' | 'none';
}

// Available measurement sources
export const MEASUREMENT_TAGS: MeasurementTag[] = [
  // Area measurements
  { tag: 'roof.squares', label: 'Roof Area (Squares)', category: 'area', sampleValue: 28, unit: 'SQ' },
  { tag: 'roof.total_sqft', label: 'Roof Area (Sq Ft)', category: 'area', sampleValue: 2800, unit: 'SQFT' },
  
  // Area with waste pre-calculated
  { tag: 'waste.10pct.squares', label: 'Roof + 10% Waste (SQ)', category: 'area', sampleValue: 30.8, unit: 'SQ' },
  { tag: 'waste.12pct.squares', label: 'Roof + 12% Waste (SQ)', category: 'area', sampleValue: 31.36, unit: 'SQ' },
  { tag: 'waste.15pct.squares', label: 'Roof + 15% Waste (SQ)', category: 'area', sampleValue: 32.2, unit: 'SQ' },
  { tag: 'waste.10pct.sqft', label: 'Roof + 10% Waste (Sqft)', category: 'area', sampleValue: 3080, unit: 'SQFT' },
  { tag: 'waste.12pct.sqft', label: 'Roof + 12% Waste (Sqft)', category: 'area', sampleValue: 3136, unit: 'SQFT' },
  { tag: 'waste.15pct.sqft', label: 'Roof + 15% Waste (Sqft)', category: 'area', sampleValue: 3220, unit: 'SQFT' },
  
  // Linear measurements
  { tag: 'lf.ridge', label: 'Ridge Length', category: 'linear', sampleValue: 45, unit: 'LF' },
  { tag: 'lf.hip', label: 'Hip Length', category: 'linear', sampleValue: 32, unit: 'LF' },
  { tag: 'lf.valley', label: 'Valley Length', category: 'linear', sampleValue: 28, unit: 'LF' },
  { tag: 'lf.rake', label: 'Rake Length', category: 'linear', sampleValue: 68, unit: 'LF' },
  { tag: 'lf.eave', label: 'Eave Length', category: 'linear', sampleValue: 92, unit: 'LF' },
  { tag: 'lf.drip', label: 'Drip Edge Length', category: 'linear', sampleValue: 160, unit: 'LF' },
  { tag: 'lf.step', label: 'Step Flashing Length', category: 'linear', sampleValue: 24, unit: 'LF' },
  { tag: 'lf.ridge_hip', label: 'Ridge + Hip (Combined)', category: 'linear', sampleValue: 77, unit: 'LF' },
  { tag: 'lf.eave_rake', label: 'Eave + Rake (Combined)', category: 'linear', sampleValue: 160, unit: 'LF' },
  
  // Count measurements
  { tag: 'count.pipe_vent', label: 'Pipe Vents', category: 'count', sampleValue: 3, unit: 'EA' },
  { tag: 'count.chimney', label: 'Chimneys', category: 'count', sampleValue: 1, unit: 'EA' },
  { tag: 'count.skylight', label: 'Skylights', category: 'count', sampleValue: 2, unit: 'EA' },
];

// Unit-specific conversion presets
export const CONVERSION_PRESETS: Record<string, ConversionPreset[]> = {
  BDL: [
    { label: '× 3 bundles per square', multiplier: 3, operation: 'multiply' },
    { label: '÷ 33.33 sqft per bundle', multiplier: 33.33, operation: 'divide' },
    { label: 'Direct (1:1)', multiplier: 1, operation: 'multiply' },
    { label: 'Custom multiplier...', multiplier: null, operation: 'custom' },
  ],
  SQ: [
    { label: 'Direct (1:1)', multiplier: 1, operation: 'multiply' },
    { label: '÷ 100 from sqft', multiplier: 100, operation: 'divide' },
    { label: 'Custom multiplier...', multiplier: null, operation: 'custom' },
  ],
  RL: [
    { label: '÷ 4 squares per roll', multiplier: 4, operation: 'divide' },
    { label: '÷ 5 squares per roll (butyl)', multiplier: 5, operation: 'divide' },
    { label: '÷ 10 squares per roll (synthetic)', multiplier: 10, operation: 'divide' },
    { label: '÷ 400 sqft per roll', multiplier: 400, operation: 'divide' },
    { label: '÷ 500 sqft per roll (TPO)', multiplier: 500, operation: 'divide' },
    { label: 'Direct (1:1)', multiplier: 1, operation: 'multiply' },
    { label: 'Custom multiplier...', multiplier: null, operation: 'custom' },
  ],
  PC: [
    { label: '÷ 3 LF per piece', multiplier: 3, operation: 'divide' },
    { label: '÷ 10 LF per piece', multiplier: 10, operation: 'divide' },
    { label: '÷ 20 sqft per panel (5V metal)', multiplier: 20, operation: 'divide' },
    { label: '÷ 16 sqft per panel (standing seam)', multiplier: 16, operation: 'divide' },
    { label: 'Direct (1:1)', multiplier: 1, operation: 'multiply' },
    { label: 'Custom multiplier...', multiplier: null, operation: 'custom' },
  ],
  LF: [
    { label: 'Direct (1:1)', multiplier: 1, operation: 'multiply' },
    { label: 'Custom multiplier...', multiplier: null, operation: 'custom' },
  ],
  EA: [
    { label: 'Direct (1:1)', multiplier: 1, operation: 'multiply' },
    { label: '× 80 screws per square', multiplier: 80, operation: 'multiply' },
    { label: '× 90 tiles per square', multiplier: 90, operation: 'multiply' },
    { label: '× 12 clips per square', multiplier: 12, operation: 'multiply' },
    { label: 'Custom multiplier...', multiplier: null, operation: 'custom' },
  ],
  BX: [
    { label: '× 80 screws/SQ ÷ 250/box', multiplier: null, operation: 'custom' },
    { label: '÷ 250 per box', multiplier: 250, operation: 'divide' },
    { label: '÷ 5 (lbs per SQ)', multiplier: 5, operation: 'divide' },
    { label: 'Direct (1:1)', multiplier: 1, operation: 'multiply' },
    { label: 'Custom multiplier...', multiplier: null, operation: 'custom' },
  ],
  GL: [
    { label: 'Direct (1:1)', multiplier: 1, operation: 'multiply' },
    { label: 'Custom multiplier...', multiplier: null, operation: 'custom' },
  ],
  BD: [
    { label: '÷ 32 sqft per board (4x8)', multiplier: 32, operation: 'divide' },
    { label: 'Direct (1:1)', multiplier: 1, operation: 'multiply' },
    { label: 'Custom multiplier...', multiplier: null, operation: 'custom' },
  ],
  PL: [
    { label: '÷ 500 sqft per pail', multiplier: 500, operation: 'divide' },
    { label: 'Direct (1:1)', multiplier: 1, operation: 'multiply' },
    { label: 'Custom multiplier...', multiplier: null, operation: 'custom' },
  ],
};

// Waste factor options
export const WASTE_OPTIONS: WasteOption[] = [
  { label: 'None (0%)', value: 0 },
  { label: '+ 5%', value: 5 },
  { label: '+ 10%', value: 10 },
  { label: '+ 12%', value: 12 },
  { label: '+ 15%', value: 15 },
  { label: 'Custom...', value: -1 },
];

// Rounding options
export const ROUNDING_OPTIONS: RoundingOption[] = [
  { label: 'Round Up (recommended)', value: 'ceil' },
  { label: 'Round Down', value: 'floor' },
  { label: 'Round Nearest', value: 'round' },
  { label: 'No Rounding (exact)', value: 'none' },
];

// Get default presets for a unit
export const getPresetsForUnit = (unit: string): ConversionPreset[] => {
  return CONVERSION_PRESETS[unit] || CONVERSION_PRESETS['EA'];
};

// Build formula string from builder state
export const buildFormula = (
  measurementTag: string,
  conversionMultiplier: number,
  conversionOperation: 'multiply' | 'divide',
  wastePercent: number,
  rounding: 'ceil' | 'floor' | 'round' | 'none'
): string => {
  if (!measurementTag) return '';
  
  let formula = measurementTag;
  
  // Apply conversion
  if (conversionMultiplier !== 1) {
    if (conversionOperation === 'multiply') {
      formula = `${formula} * ${conversionMultiplier}`;
    } else {
      formula = `${formula} / ${conversionMultiplier}`;
    }
  }
  
  // Apply waste factor
  if (wastePercent > 0) {
    const wasteFactor = 1 + (wastePercent / 100);
    formula = `(${formula}) * ${wasteFactor.toFixed(2)}`;
  }
  
  // Apply rounding
  if (rounding !== 'none') {
    formula = `${rounding}(${formula})`;
  }
  
  return `{{ ${formula} }}`;
};

// Parse existing formula to extract builder state
export const parseFormula = (formula: string): {
  measurementTag: string;
  conversionMultiplier: number;
  conversionOperation: 'multiply' | 'divide';
  wastePercent: number;
  rounding: 'ceil' | 'floor' | 'round' | 'none';
} | null => {
  if (!formula) return null;
  
  // Remove {{ and }} wrapper
  let inner = formula.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '').trim();
  
  // Detect rounding function
  let rounding: 'ceil' | 'floor' | 'round' | 'none' = 'none';
  const roundingMatch = inner.match(/^(ceil|floor|round)\((.*)\)$/);
  if (roundingMatch) {
    rounding = roundingMatch[1] as 'ceil' | 'floor' | 'round';
    inner = roundingMatch[2];
  }
  
  // Detect waste factor (multiplication by 1.xx at the end)
  let wastePercent = 0;
  const wasteMatch = inner.match(/\((.+)\)\s*\*\s*(1\.\d+)$/);
  if (wasteMatch) {
    const wasteFactor = parseFloat(wasteMatch[2]);
    wastePercent = Math.round((wasteFactor - 1) * 100);
    inner = wasteMatch[1];
  }
  
  // Detect conversion operation
  let conversionMultiplier = 1;
  let conversionOperation: 'multiply' | 'divide' = 'multiply';
  
  const multiplyMatch = inner.match(/^(.+?)\s*\*\s*(\d+\.?\d*)$/);
  const divideMatch = inner.match(/^(.+?)\s*\/\s*(\d+\.?\d*)$/);
  
  if (multiplyMatch) {
    conversionMultiplier = parseFloat(multiplyMatch[2]);
    conversionOperation = 'multiply';
    inner = multiplyMatch[1].trim();
  } else if (divideMatch) {
    conversionMultiplier = parseFloat(divideMatch[2]);
    conversionOperation = 'divide';
    inner = divideMatch[1].trim();
  }
  
  // What remains should be the measurement tag
  const measurementTag = inner.trim();
  
  return {
    measurementTag,
    conversionMultiplier,
    conversionOperation,
    wastePercent,
    rounding,
  };
};

// Calculate preview value
export const calculatePreview = (
  measurementTag: string,
  conversionMultiplier: number,
  conversionOperation: 'multiply' | 'divide',
  wastePercent: number,
  rounding: 'ceil' | 'floor' | 'round' | 'none'
): { steps: string; result: number } => {
  const tag = MEASUREMENT_TAGS.find(t => t.tag === measurementTag);
  if (!tag) return { steps: '', result: 0 };
  
  let value = tag.sampleValue;
  let steps = `${value} ${tag.unit}`;
  
  // Apply conversion
  if (conversionMultiplier !== 1) {
    if (conversionOperation === 'multiply') {
      value = value * conversionMultiplier;
      steps += ` × ${conversionMultiplier}`;
    } else {
      value = value / conversionMultiplier;
      steps += ` ÷ ${conversionMultiplier}`;
    }
  }
  
  // Apply waste
  if (wastePercent > 0) {
    const wasteFactor = 1 + (wastePercent / 100);
    value = value * wasteFactor;
    steps += ` × ${wasteFactor.toFixed(2)}`;
  }
  
  // Apply rounding
  if (rounding === 'ceil') {
    value = Math.ceil(value);
  } else if (rounding === 'floor') {
    value = Math.floor(value);
  } else if (rounding === 'round') {
    value = Math.round(value);
  }
  
  steps += ` = ${value.toFixed(rounding === 'none' ? 2 : 0)}`;
  
  return { steps, result: value };
};
