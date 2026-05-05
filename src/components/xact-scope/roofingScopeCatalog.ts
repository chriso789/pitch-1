// Roofing scope catalog - common Xactimate-style line items for roofing
export interface CatalogItem {
  xactimate_code: string;
  description: string;
  trade: string;
  unit: string;
  default_waste_percent: number;
  category: string;
}

export const ROOFING_SCOPE_CATALOG: CatalogItem[] = [
  // Tear-off
  { xactimate_code: 'RFG TEAR', description: 'Remove roofing - comp. shingle', trade: 'roofing', unit: 'SQ', default_waste_percent: 0, category: 'Tear-off' },
  { xactimate_code: 'RFG TEARHVY', description: 'Remove roofing - heavy/multiple layers', trade: 'roofing', unit: 'SQ', default_waste_percent: 0, category: 'Tear-off' },
  
  // Underlayment
  { xactimate_code: 'RFG FELT15', description: 'Roofing felt - 15 lb.', trade: 'roofing', unit: 'SQ', default_waste_percent: 10, category: 'Underlayment' },
  { xactimate_code: 'RFG FELT30', description: 'Roofing felt - 30 lb.', trade: 'roofing', unit: 'SQ', default_waste_percent: 10, category: 'Underlayment' },
  { xactimate_code: 'RFG SYNTH', description: 'Synthetic underlayment', trade: 'roofing', unit: 'SQ', default_waste_percent: 10, category: 'Underlayment' },
  { xactimate_code: 'RFG ICE', description: 'Ice & water shield membrane', trade: 'roofing', unit: 'LF', default_waste_percent: 5, category: 'Underlayment' },
  
  // Shingles
  { xactimate_code: 'RFG 25YR', description: '25 year - 3 tab comp. shingle', trade: 'roofing', unit: 'SQ', default_waste_percent: 10, category: 'Shingles' },
  { xactimate_code: 'RFG 30YR', description: '30 year - laminated comp. shingle', trade: 'roofing', unit: 'SQ', default_waste_percent: 10, category: 'Shingles' },
  { xactimate_code: 'RFG ARCH', description: 'Architectural/dimensional shingle', trade: 'roofing', unit: 'SQ', default_waste_percent: 10, category: 'Shingles' },
  { xactimate_code: 'RFG PREM', description: 'Premium designer shingle', trade: 'roofing', unit: 'SQ', default_waste_percent: 10, category: 'Shingles' },
  
  // Accessories
  { xactimate_code: 'RFG STRTR', description: 'Starter strip', trade: 'roofing', unit: 'LF', default_waste_percent: 5, category: 'Accessories' },
  { xactimate_code: 'RFG RIDGE', description: 'Ridge cap shingles', trade: 'roofing', unit: 'LF', default_waste_percent: 5, category: 'Accessories' },
  { xactimate_code: 'RFG HIP', description: 'Hip cap shingles', trade: 'roofing', unit: 'LF', default_waste_percent: 5, category: 'Accessories' },
  { xactimate_code: 'RFG VENT', description: 'Ridge vent', trade: 'roofing', unit: 'LF', default_waste_percent: 0, category: 'Accessories' },
  
  // Flashing & Metal
  { xactimate_code: 'RFG DRIP', description: 'Drip edge - aluminum', trade: 'roofing', unit: 'LF', default_waste_percent: 5, category: 'Flashing' },
  { xactimate_code: 'RFG FLASH', description: 'Step flashing - aluminum', trade: 'roofing', unit: 'LF', default_waste_percent: 5, category: 'Flashing' },
  { xactimate_code: 'RFG VALLEY', description: 'Valley metal', trade: 'roofing', unit: 'LF', default_waste_percent: 5, category: 'Flashing' },
  { xactimate_code: 'RFG PIPE', description: 'Pipe boot/jack', trade: 'roofing', unit: 'EA', default_waste_percent: 0, category: 'Flashing' },
  { xactimate_code: 'RFG CFLASH', description: 'Counter flashing', trade: 'roofing', unit: 'LF', default_waste_percent: 5, category: 'Flashing' },
  
  // Decking
  { xactimate_code: 'RFG DECK', description: 'Plywood decking - 1/2" CDX', trade: 'roofing', unit: 'SF', default_waste_percent: 10, category: 'Decking' },
  { xactimate_code: 'RFG DECK58', description: 'Plywood decking - 5/8" CDX', trade: 'roofing', unit: 'SF', default_waste_percent: 10, category: 'Decking' },
  { xactimate_code: 'RFG OSBD', description: 'OSB decking - 7/16"', trade: 'roofing', unit: 'SF', default_waste_percent: 10, category: 'Decking' },
  
  // Ventilation
  { xactimate_code: 'RFG BOXV', description: 'Box vent / static vent', trade: 'roofing', unit: 'EA', default_waste_percent: 0, category: 'Ventilation' },
  { xactimate_code: 'RFG TURBV', description: 'Turbine vent', trade: 'roofing', unit: 'EA', default_waste_percent: 0, category: 'Ventilation' },
  { xactimate_code: 'RFG POWV', description: 'Power vent / attic fan', trade: 'roofing', unit: 'EA', default_waste_percent: 0, category: 'Ventilation' },
  
  // Detach & Reset
  { xactimate_code: 'RFG DRSAT', description: 'Detach & reset satellite dish', trade: 'roofing', unit: 'EA', default_waste_percent: 0, category: 'Detach/Reset' },
  { xactimate_code: 'RFG DRSOL', description: 'Detach & reset solar panels', trade: 'roofing', unit: 'EA', default_waste_percent: 0, category: 'Detach/Reset' },
  
  // Gutters
  { xactimate_code: 'GTR REM', description: 'Remove gutter', trade: 'gutter', unit: 'LF', default_waste_percent: 0, category: 'Gutters' },
  { xactimate_code: 'GTR INST', description: 'Install gutter - aluminum 5"', trade: 'gutter', unit: 'LF', default_waste_percent: 5, category: 'Gutters' },
  { xactimate_code: 'GTR DOWN', description: 'Downspout - aluminum', trade: 'gutter', unit: 'LF', default_waste_percent: 5, category: 'Gutters' },
  { xactimate_code: 'GTR GUARD', description: 'Gutter guard/screen', trade: 'gutter', unit: 'LF', default_waste_percent: 5, category: 'Gutters' },
  
  // Charges
  { xactimate_code: 'GEN STEEP', description: 'Steep charge (7/12-9/12)', trade: 'roofing', unit: 'SQ', default_waste_percent: 0, category: 'Charges' },
  { xactimate_code: 'GEN STEEPH', description: 'Steep charge (10/12+)', trade: 'roofing', unit: 'SQ', default_waste_percent: 0, category: 'Charges' },
  { xactimate_code: 'GEN HIGH', description: 'High charge (2+ stories)', trade: 'roofing', unit: 'SQ', default_waste_percent: 0, category: 'Charges' },
  { xactimate_code: 'GEN DUMP', description: 'Dumpster / haul-off', trade: 'roofing', unit: 'EA', default_waste_percent: 0, category: 'Charges' },
  { xactimate_code: 'GEN PERMIT', description: 'Building permit', trade: 'roofing', unit: 'EA', default_waste_percent: 0, category: 'Charges' },
  { xactimate_code: 'GEN CODE', description: 'Code upgrade', trade: 'roofing', unit: 'EA', default_waste_percent: 0, category: 'Charges' },
];

// Group catalog items by category
export const CATALOG_BY_CATEGORY = ROOFING_SCOPE_CATALOG.reduce((acc, item) => {
  if (!acc[item.category]) acc[item.category] = [];
  acc[item.category].push(item);
  return acc;
}, {} as Record<string, CatalogItem[]>);
