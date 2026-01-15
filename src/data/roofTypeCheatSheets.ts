// Material Cheat Sheets for Different Roof Types

export interface CheatSheetItem {
  material: string;
  formula: string;
  unit: string;
  coverage: string;
  exampleCalc: (squares: number, measurements: RoofMeasurements) => string;
}

export interface RoofMeasurements {
  squares: number;
  sqft: number;
  ridgeLF: number;
  hipLF: number;
  valleyLF: number;
  rakeLF: number;
  eaveLF: number;
  stepLF: number;
  pipeVents: number;
}

export interface RoofTypeCheatSheet {
  roofType: string;
  name: string;
  description: string;
  wasteRecommendation: string;
  items: CheatSheetItem[];
}

// Default sample measurements for examples
export const SAMPLE_MEASUREMENTS: RoofMeasurements = {
  squares: 28,
  sqft: 2800,
  ridgeLF: 45,
  hipLF: 32,
  valleyLF: 28,
  rakeLF: 68,
  eaveLF: 92,
  stepLF: 24,
  pipeVents: 3,
};

export const ROOF_TYPE_CHEAT_SHEETS: Record<string, RoofTypeCheatSheet> = {
  'metal-5v': {
    roofType: 'metal-5v',
    name: '5V Painted Metal',
    description: '26 gauge painted 5V crimp metal panels with exposed fasteners',
    wasteRecommendation: '10-12% for standard, 15% for complex roofs',
    items: [
      {
        material: '5V Metal Panels 26ga',
        formula: '{{ ceil(roof.total_sqft / 20 * 1.12) }}',
        unit: 'PC',
        coverage: '20 sqft per panel',
        exampleCalc: (sq, m) => `${m.sqft} ÷ 20 × 1.12 = ${Math.ceil(m.sqft / 20 * 1.12)} panels`,
      },
      {
        material: 'Polyglass XFR Underlayment',
        formula: '{{ ceil(roof.squares / 4) }}',
        unit: 'RL',
        coverage: '4 SQ per roll',
        exampleCalc: (sq) => `${sq} ÷ 4 = ${Math.ceil(sq / 4)} rolls`,
      },
      {
        material: 'Metal Ridge Cap 10ft',
        formula: '{{ ceil(lf.ridge / 10) }}',
        unit: 'PC',
        coverage: '10 LF per piece',
        exampleCalc: (sq, m) => `${m.ridgeLF} ÷ 10 = ${Math.ceil(m.ridgeLF / 10)} pieces`,
      },
      {
        material: 'Metal Hip Cap 10ft',
        formula: '{{ ceil(lf.hip / 10) }}',
        unit: 'PC',
        coverage: '10 LF per piece',
        exampleCalc: (sq, m) => `${m.hipLF} ÷ 10 = ${Math.ceil(m.hipLF / 10)} pieces`,
      },
      {
        material: 'Eave Closure Strip 3ft',
        formula: '{{ ceil(lf.eave / 3) }}',
        unit: 'PC',
        coverage: '3 LF per piece',
        exampleCalc: (sq, m) => `${m.eaveLF} ÷ 3 = ${Math.ceil(m.eaveLF / 3)} pieces`,
      },
      {
        material: 'Ridge Closure Strip 3ft',
        formula: '{{ ceil(lf.ridge / 3) }}',
        unit: 'PC',
        coverage: '3 LF per piece',
        exampleCalc: (sq, m) => `${m.ridgeLF} ÷ 3 = ${Math.ceil(m.ridgeLF / 3)} pieces`,
      },
      {
        material: 'Metal Rake Trim 10ft',
        formula: '{{ ceil(lf.rake / 10) }}',
        unit: 'PC',
        coverage: '10 LF per piece',
        exampleCalc: (sq, m) => `${m.rakeLF} ÷ 10 = ${Math.ceil(m.rakeLF / 10)} pieces`,
      },
      {
        material: 'Pancake Screws #10x1" (250/box)',
        formula: '{{ ceil(roof.squares * 80 / 250) }}',
        unit: 'BX',
        coverage: '80 screws per SQ, 250 per box',
        exampleCalc: (sq) => `${sq} × 80 ÷ 250 = ${Math.ceil(sq * 80 / 250)} boxes`,
      },
      {
        material: 'Butyl Tape 1"',
        formula: '{{ ceil(roof.squares / 5) }}',
        unit: 'RL',
        coverage: '1 roll per 5 SQ',
        exampleCalc: (sq) => `${sq} ÷ 5 = ${Math.ceil(sq / 5)} rolls`,
      },
      {
        material: 'Metal Pipe Boot',
        formula: '{{ count.pipe_vent }}',
        unit: 'EA',
        coverage: '1 per penetration',
        exampleCalc: (sq, m) => `${m.pipeVents} vents = ${m.pipeVents} boots`,
      },
    ],
  },
  
  'metal-standing-seam': {
    roofType: 'metal-standing-seam',
    name: 'Standing Seam Metal',
    description: 'Concealed fastener standing seam metal panels',
    wasteRecommendation: '10% for standard, 15% for complex roofs',
    items: [
      {
        material: 'Standing Seam Panels',
        formula: '{{ ceil(roof.total_sqft / 16 * 1.10) }}',
        unit: 'PC',
        coverage: '16 sqft per panel (16" wide)',
        exampleCalc: (sq, m) => `${m.sqft} ÷ 16 × 1.10 = ${Math.ceil(m.sqft / 16 * 1.10)} panels`,
      },
      {
        material: 'Synthetic Underlayment',
        formula: '{{ ceil(roof.squares / 10) }}',
        unit: 'RL',
        coverage: '10 SQ per roll',
        exampleCalc: (sq) => `${sq} ÷ 10 = ${Math.ceil(sq / 10)} rolls`,
      },
      {
        material: 'Standing Seam Clips',
        formula: '{{ ceil(roof.squares * 12) }}',
        unit: 'EA',
        coverage: '12 clips per SQ',
        exampleCalc: (sq) => `${sq} × 12 = ${Math.ceil(sq * 12)} clips`,
      },
      {
        material: 'Ridge Cap',
        formula: '{{ ceil(lf.ridge / 10) }}',
        unit: 'PC',
        coverage: '10 LF per piece',
        exampleCalc: (sq, m) => `${m.ridgeLF} ÷ 10 = ${Math.ceil(m.ridgeLF / 10)} pieces`,
      },
      {
        material: 'Z-Bar Closure',
        formula: '{{ ceil(lf.eave / 10) }}',
        unit: 'PC',
        coverage: '10 LF per piece',
        exampleCalc: (sq, m) => `${m.eaveLF} ÷ 10 = ${Math.ceil(m.eaveLF / 10)} pieces`,
      },
    ],
  },
  
  shingle: {
    roofType: 'shingle',
    name: 'Architectural Shingles',
    description: 'Standard architectural asphalt shingles',
    wasteRecommendation: '10% for simple, 15% for complex/hip roofs',
    items: [
      {
        material: 'Architectural Shingles',
        formula: '{{ ceil(roof.squares * 3 * 1.10) }}',
        unit: 'BDL',
        coverage: '3 bundles per SQ',
        exampleCalc: (sq) => `${sq} × 3 × 1.10 = ${Math.ceil(sq * 3 * 1.10)} bundles`,
      },
      {
        material: 'Synthetic Underlayment',
        formula: '{{ ceil(roof.squares / 10) }}',
        unit: 'RL',
        coverage: '10 SQ per roll',
        exampleCalc: (sq) => `${sq} ÷ 10 = ${Math.ceil(sq / 10)} rolls`,
      },
      {
        material: 'Ice & Water Shield',
        formula: '{{ ceil(lf.eave * 3 / 66) }}',
        unit: 'RL',
        coverage: '66 sqft per roll, 3ft up from eave',
        exampleCalc: (sq, m) => `${m.eaveLF} × 3 ÷ 66 = ${Math.ceil(m.eaveLF * 3 / 66)} rolls`,
      },
      {
        material: 'Starter Strip',
        formula: '{{ ceil((lf.eave + lf.rake) / 100) }}',
        unit: 'BDL',
        coverage: '~100 LF per bundle',
        exampleCalc: (sq, m) => `(${m.eaveLF} + ${m.rakeLF}) ÷ 100 = ${Math.ceil((m.eaveLF + m.rakeLF) / 100)} bundles`,
      },
      {
        material: 'Hip & Ridge Cap',
        formula: '{{ ceil((lf.ridge + lf.hip) / 25) }}',
        unit: 'BDL',
        coverage: '25 LF per bundle',
        exampleCalc: (sq, m) => `(${m.ridgeLF} + ${m.hipLF}) ÷ 25 = ${Math.ceil((m.ridgeLF + m.hipLF) / 25)} bundles`,
      },
      {
        material: 'Drip Edge',
        formula: '{{ ceil((lf.eave + lf.rake) / 10) }}',
        unit: 'PC',
        coverage: '10 LF per piece',
        exampleCalc: (sq, m) => `(${m.eaveLF} + ${m.rakeLF}) ÷ 10 = ${Math.ceil((m.eaveLF + m.rakeLF) / 10)} pieces`,
      },
      {
        material: 'Roofing Nails 1.25" (5lb box)',
        formula: '{{ ceil(roof.squares * 2 / 5) }}',
        unit: 'BX',
        coverage: '~2 lbs per SQ, 5lb box',
        exampleCalc: (sq) => `${sq} × 2 ÷ 5 = ${Math.ceil(sq * 2 / 5)} boxes`,
      },
      {
        material: 'Pipe Boot',
        formula: '{{ count.pipe_vent }}',
        unit: 'EA',
        coverage: '1 per penetration',
        exampleCalc: (sq, m) => `${m.pipeVents} vents = ${m.pipeVents} boots`,
      },
      {
        material: 'Step Flashing 4x4',
        formula: '{{ ceil(lf.step / 0.5) }}',
        unit: 'EA',
        coverage: '1 piece per 6" (0.5 LF)',
        exampleCalc: (sq, m) => `${m.stepLF} ÷ 0.5 = ${Math.ceil(m.stepLF / 0.5)} pieces`,
      },
    ],
  },
  
  tile: {
    roofType: 'tile',
    name: 'Concrete/Clay Tile',
    description: 'Standard concrete or clay roofing tiles',
    wasteRecommendation: '10-15% depending on complexity',
    items: [
      {
        material: 'Roof Tiles',
        formula: '{{ ceil(roof.squares * 90 * 1.12) }}',
        unit: 'EA',
        coverage: '~90 tiles per SQ',
        exampleCalc: (sq) => `${sq} × 90 × 1.12 = ${Math.ceil(sq * 90 * 1.12)} tiles`,
      },
      {
        material: 'Tile Underlayment (40lb)',
        formula: '{{ ceil(roof.squares / 2) }}',
        unit: 'RL',
        coverage: '2 SQ per roll',
        exampleCalc: (sq) => `${sq} ÷ 2 = ${Math.ceil(sq / 2)} rolls`,
      },
      {
        material: 'Hip & Ridge Tiles',
        formula: '{{ ceil((lf.ridge + lf.hip) * 12 / 10) }}',
        unit: 'EA',
        coverage: '~12 per 10 LF',
        exampleCalc: (sq, m) => `(${m.ridgeLF} + ${m.hipLF}) × 12 ÷ 10 = ${Math.ceil((m.ridgeLF + m.hipLF) * 12 / 10)} tiles`,
      },
      {
        material: 'Battens 1x2 (8ft)',
        formula: '{{ ceil(roof.squares * 10) }}',
        unit: 'PC',
        coverage: '~10 battens per SQ',
        exampleCalc: (sq) => `${sq} × 10 = ${Math.ceil(sq * 10)} battens`,
      },
      {
        material: 'Tile Nails (10lb box)',
        formula: '{{ ceil(roof.squares / 5) }}',
        unit: 'BX',
        coverage: '1 box per 5 SQ',
        exampleCalc: (sq) => `${sq} ÷ 5 = ${Math.ceil(sq / 5)} boxes`,
      },
    ],
  },
  
  flat: {
    roofType: 'flat',
    name: 'Flat/Low Slope (TPO/EPDM)',
    description: 'Single-ply membrane roofing for flat or low-slope applications',
    wasteRecommendation: '5-10% for membrane, varies by detail work',
    items: [
      {
        material: 'TPO Membrane 60mil',
        formula: '{{ ceil(roof.total_sqft * 1.10 / 500) }}',
        unit: 'RL',
        coverage: '500 sqft per roll (10x50)',
        exampleCalc: (sq, m) => `${m.sqft} × 1.10 ÷ 500 = ${Math.ceil(m.sqft * 1.10 / 500)} rolls`,
      },
      {
        material: 'ISO Insulation 2"',
        formula: '{{ ceil(roof.total_sqft / 32) }}',
        unit: 'BD',
        coverage: '32 sqft per board (4x8)',
        exampleCalc: (sq, m) => `${m.sqft} ÷ 32 = ${Math.ceil(m.sqft / 32)} boards`,
      },
      {
        material: 'Cover Board',
        formula: '{{ ceil(roof.total_sqft / 32) }}',
        unit: 'BD',
        coverage: '32 sqft per board (4x8)',
        exampleCalc: (sq, m) => `${m.sqft} ÷ 32 = ${Math.ceil(m.sqft / 32)} boards`,
      },
      {
        material: 'Membrane Adhesive (5 gal)',
        formula: '{{ ceil(roof.total_sqft / 500) }}',
        unit: 'PL',
        coverage: '~500 sqft per pail',
        exampleCalc: (sq, m) => `${m.sqft} ÷ 500 = ${Math.ceil(m.sqft / 500)} pails`,
      },
      {
        material: 'Perimeter Edge Metal',
        formula: '{{ ceil((lf.eave + lf.rake) / 10) }}',
        unit: 'PC',
        coverage: '10 LF per piece',
        exampleCalc: (sq, m) => `(${m.eaveLF} + ${m.rakeLF}) ÷ 10 = ${Math.ceil((m.eaveLF + m.rakeLF) / 10)} pieces`,
      },
      {
        material: 'Pipe Boot Flashing',
        formula: '{{ count.pipe_vent }}',
        unit: 'EA',
        coverage: '1 per penetration',
        exampleCalc: (sq, m) => `${m.pipeVents} vents = ${m.pipeVents} flashings`,
      },
    ],
  },
};

// Get cheat sheet by roof type
export const getCheatSheet = (roofType: string): RoofTypeCheatSheet | null => {
  return ROOF_TYPE_CHEAT_SHEETS[roofType] || null;
};

// Get all available cheat sheet types
export const getAvailableCheatSheets = (): { value: string; label: string }[] => {
  return Object.values(ROOF_TYPE_CHEAT_SHEETS).map(sheet => ({
    value: sheet.roofType,
    label: sheet.name,
  }));
};
