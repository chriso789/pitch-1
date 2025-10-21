// SRS Pricelist Data - Parsed from PDF (Effective 07-24-2025)
// Representative: Hunter Prussel (321-624-4885, hunter.prussel@suncoastrooferssupply.com)

export interface SRSPricelistItem {
  category: string;
  brand: string;
  product: string;
  item_code: string;
  unit_of_measure: string;
  unit_cost: number;
  metadata?: {
    bundles_per_square?: string;
    length_per_unit?: string;
    valid_condition?: string;
  };
}

export const SRS_PRICELIST: SRSPricelistItem[] = [
  // Shingles
  { category: 'Shingles', brand: 'GAF', product: 'GAF Timberline HDZ', item_code: 'GAF-HDZ', unit_of_measure: 'SQ', unit_cost: 121.00, metadata: { bundles_per_square: '3BD/SQ' } },
  { category: 'Shingles', brand: 'Owens Corning', product: 'Owens Corning Oakridge', item_code: 'OC-OAKRIDGE', unit_of_measure: 'SQ', unit_cost: 116.00, metadata: { bundles_per_square: '3BD/SQ' } },
  { category: 'Shingles', brand: 'Owens Corning', product: 'Owens Corning Duration', item_code: 'OC-DURATION', unit_of_measure: 'SQ', unit_cost: 118.00, metadata: { bundles_per_square: '3BD/SQ' } },
  { category: 'Shingles', brand: 'CertainTeed', product: 'CertainTeed Landmark', item_code: 'CT-LANDMARK', unit_of_measure: 'SQ', unit_cost: 117.00, metadata: { bundles_per_square: '3BD/SQ' } },
  { category: 'Shingles', brand: 'CertainTeed', product: 'CertainTeed Landmark Pro', item_code: 'CT-LANDMARK-PRO', unit_of_measure: 'SQ', unit_cost: 129.00, metadata: { bundles_per_square: '3BD/SQ' } },
  { category: 'Shingles', brand: 'IKO', product: 'IKO Cambridge', item_code: 'IKO-CAMBRIDGE', unit_of_measure: 'SQ', unit_cost: 110.00, metadata: { bundles_per_square: '3BD/SQ' } },
  { category: 'Shingles', brand: 'IKO', product: 'IKO Dynasty', item_code: 'IKO-DYNASTY', unit_of_measure: 'SQ', unit_cost: 115.00, metadata: { bundles_per_square: '3BD/SQ' } },
  { category: 'Shingles', brand: 'Atlas', product: 'Atlas Pinnacle', item_code: 'ATLAS-PINNACLE', unit_of_measure: 'SQ', unit_cost: 120.00, metadata: { bundles_per_square: '3BD/SQ' } },
  { category: 'Shingles', brand: 'TAMKO', product: 'TAMKO Heritage', item_code: 'TAMKO-HERITAGE', unit_of_measure: 'SQ', unit_cost: 113.00, metadata: { bundles_per_square: '3BD/SQ' } },
  { category: 'Shingles', brand: 'TAMKO', product: 'TAMKO TITAN XT', item_code: 'TAMKO-TITAN-XT', unit_of_measure: 'SQ', unit_cost: 116.00, metadata: { bundles_per_square: '3BD/SQ' } },

  // Hip & Ridge / Starter
  { category: 'Hip & Ridge', brand: 'GAF', product: 'GAF S-A-R Hip and Ridge', item_code: 'GAF-SAR-HR', unit_of_measure: 'BD', unit_cost: 59.00, metadata: { length_per_unit: '25LF/BD' } },
  { category: 'Hip & Ridge', brand: 'Owens Corning', product: 'Owens Corning Proedge Hip and Ridge', item_code: 'OC-PROEDGE-HR', unit_of_measure: 'BD', unit_cost: 74.00, metadata: { length_per_unit: '33LF/BD' } },
  { category: 'Hip & Ridge', brand: 'CertainTeed', product: 'CertainTeed Shadow Hip and Ridge', item_code: 'CT-SHADOW-HR', unit_of_measure: 'BD', unit_cost: 69.75, metadata: { length_per_unit: '30LF/BD' } },
  { category: 'Hip & Ridge', brand: 'IKO', product: 'IKO Hip and Ridge', item_code: 'IKO-HR', unit_of_measure: 'BD', unit_cost: 68.50, metadata: { length_per_unit: '33LF/BD' } },
  { category: 'Hip & Ridge', brand: 'Atlas', product: 'Atlas Pro-Cut Hip and Ridge', item_code: 'ATLAS-PROCUT-HR', unit_of_measure: 'BD', unit_cost: 67.50, metadata: { length_per_unit: '31LF/BD' } },
  { category: 'Hip & Ridge', brand: 'TAMKO', product: 'TAMKO Hip and Ridge', item_code: 'TAMKO-HR', unit_of_measure: 'BD', unit_cost: 67.00, metadata: { length_per_unit: '33.3LF/BD' } },
  { category: 'Starter', brand: 'GAF', product: 'GAF Pro-Start Starter', item_code: 'GAF-PROSTART', unit_of_measure: 'BD', unit_cost: 54.50, metadata: { length_per_unit: '120LF/BD' } },
  { category: 'Starter', brand: 'Owens Corning', product: 'Owens Corning Starter Strip Plus', item_code: 'OC-STARTER-PLUS', unit_of_measure: 'BD', unit_cost: 60.00, metadata: { length_per_unit: '105LF/BD' } },
  { category: 'Starter', brand: 'CertainTeed', product: 'CertainTeed SwiftStart Starter', item_code: 'CT-SWIFTSTART', unit_of_measure: 'BD', unit_cost: 55.00, metadata: { length_per_unit: '116LF/BD' } },
  { category: 'Starter', brand: 'IKO', product: 'IKO Starter', item_code: 'IKO-STARTER', unit_of_measure: 'BD', unit_cost: 55.00, metadata: { length_per_unit: '123LF/BD' } },
  { category: 'Starter', brand: 'Atlas', product: 'Atlas Pro-Starter', item_code: 'ATLAS-PROSTARTER', unit_of_measure: 'BD', unit_cost: 68.25, metadata: { length_per_unit: '140LF/BD' } },
  { category: 'Starter', brand: 'TAMKO', product: 'TAMKO Starter', item_code: 'TAMKO-STARTER', unit_of_measure: 'BD', unit_cost: 59.50, metadata: { length_per_unit: '105LF/BD' } },
  { category: 'Starter', brand: 'Top Shield', product: 'Top Shield Starter', item_code: 'TOPSHIELD-STARTER', unit_of_measure: 'BD', unit_cost: 47.50, metadata: { length_per_unit: '105LF/BD' } },

  // Mechanically Fastened Underlayments
  { category: 'Underlayment', brand: 'Top Shield', product: 'SG-30 (Top Shield)(CMI)', item_code: 'SG-30', unit_of_measure: 'RL', unit_cost: 67.00, metadata: { bundles_per_square: '10SQ/RL' } },
  { category: 'Underlayment', brand: 'Top Shield', product: 'TS-20 (Top Shield) (OC)', item_code: 'TS-20', unit_of_measure: 'RL', unit_cost: 72.50, metadata: { bundles_per_square: '10SQ/RL' } },
  { category: 'Underlayment', brand: 'Top Shield', product: 'Storm Gear (Top Shield) (Maxfelt)', item_code: 'STORM-GEAR', unit_of_measure: 'RL', unit_cost: 67.00, metadata: { bundles_per_square: '10SQ/RL' } },
  { category: 'Underlayment', brand: 'GAF', product: 'GAF Feltbuster', item_code: 'GAF-FELTBUSTER', unit_of_measure: 'RL', unit_cost: 95.00, metadata: { bundles_per_square: '10SQ/RL' } },
  { category: 'Underlayment', brand: 'CertainTeed', product: 'CertainTeed Roofrunner', item_code: 'CT-ROOFRUNNER', unit_of_measure: 'RL', unit_cost: 85.00, metadata: { bundles_per_square: '10SQ/RL' } },
  { category: 'Underlayment', brand: 'Owens Corning', product: 'Titanium UDL (OC) Rhinoroof U20', item_code: 'TITANIUM-UDL-U20', unit_of_measure: 'RL', unit_cost: 68.00, metadata: { bundles_per_square: '10SQ/RL' } },
  { category: 'Underlayment', brand: 'Atlas', product: 'Atlas Summit 60', item_code: 'ATLAS-SUMMIT-60', unit_of_measure: 'RL', unit_cost: 74.00, metadata: { bundles_per_square: '10SQ/RL' } },
  { category: 'Underlayment', brand: 'CMI', product: 'CMI X-Weather Warrior Synthetic', item_code: 'CMI-XWEATHER', unit_of_measure: 'RL', unit_cost: 57.50, metadata: { bundles_per_square: '10SQ/RL' } },
  { category: 'Underlayment', brand: 'Polyglass', product: 'Polyglass Polyanchor HV Base', item_code: 'POLYGLASS-POLYANCHOR-HV', unit_of_measure: 'RL', unit_cost: 86.00, metadata: { bundles_per_square: '2SQ/RL' } },

  // Self-Adhered Underlayments
  { category: 'Self-Adhered Underlayment', brand: 'CMI', product: 'CMI Securegrip', item_code: 'CMI-SECUREGRIP', unit_of_measure: 'RL', unit_cost: 59.50, metadata: { bundles_per_square: '2SQ/RL' } },
  { category: 'Self-Adhered Underlayment', brand: 'Resisto', product: 'Resisto LB1236/Top Shield Defender', item_code: 'RESISTO-LB1236', unit_of_measure: 'RL', unit_cost: 61.50, metadata: { bundles_per_square: '2SQ/RL' } },
  { category: 'Self-Adhered Underlayment', brand: 'Tarco', product: 'Tarco MS300/Top Shield G300', item_code: 'TARCO-MS300', unit_of_measure: 'RL', unit_cost: 61.50, metadata: { bundles_per_square: '2SQ/RL' } },
  { category: 'Self-Adhered Underlayment', brand: 'Owens Corning', product: 'Titanium (OC) Rhinoroof Granulated', item_code: 'TITANIUM-RHINOROOF-GRAN', unit_of_measure: 'RL', unit_cost: 70.00, metadata: { bundles_per_square: '2SQ/RL' } },

  // Ice & Water Shield
  { category: 'Ice & Water', brand: 'GAF', product: 'GAF Weatherwatch', item_code: 'GAF-WEATHERWATCH', unit_of_measure: 'RL', unit_cost: 81.00, metadata: { bundles_per_square: '2SQ/RL' } },
  { category: 'Ice & Water', brand: 'GAF', product: 'GAF Stormguard', item_code: 'GAF-STORMGUARD', unit_of_measure: 'RL', unit_cost: 107.50, metadata: { bundles_per_square: '2SQ/RL' } },
  { category: 'Ice & Water', brand: 'CertainTeed', product: 'CertainTeed Dryroof', item_code: 'CT-DRYROOF', unit_of_measure: 'RL', unit_cost: 79.00, metadata: { bundles_per_square: '2SQ/RL' } },
  { category: 'Ice & Water', brand: 'CertainTeed', product: 'CertainTeed Winterguard Sand', item_code: 'CT-WINTERGUARD', unit_of_measure: 'RL', unit_cost: 97.50, metadata: { bundles_per_square: '2SQ/RL' } },
  { category: 'Ice & Water', brand: 'Atlas', product: 'Atlas Weathermaster 200', item_code: 'ATLAS-WEATHERMASTER-200', unit_of_measure: 'RL', unit_cost: 72.00, metadata: { bundles_per_square: '2SQ/RL' } },
  { category: 'Ice & Water', brand: 'Polyglass', product: 'Polyglass Tu-Plus Hi-Temp', item_code: 'POLYGLASS-TU-PLUS-HT', unit_of_measure: 'RL', unit_cost: 115.00, metadata: { bundles_per_square: '2SQ/RL' } },
  { category: 'Ice & Water', brand: 'Polyglass', product: 'Polyglass MTS-Plus Hi-Temp', item_code: 'POLYGLASS-MTS-PLUS-HT', unit_of_measure: 'RL', unit_cost: 115.00, metadata: { bundles_per_square: '2SQ/RL' } },
  { category: 'Ice & Water', brand: 'Polyglass', product: 'Polyglass TU-Max Hi-Temp', item_code: 'POLYGLASS-TU-MAX-HT', unit_of_measure: 'RL', unit_cost: 104.00, metadata: { bundles_per_square: '2SQ/RL' } },
  { category: 'Ice & Water', brand: 'Owens Corning', product: 'Titanium (OC) PSU-30 Hi-Temp', item_code: 'TITANIUM-PSU-30-HT', unit_of_measure: 'RL', unit_cost: 108.00, metadata: { bundles_per_square: '2SQ/RL' } },
  { category: 'Ice & Water', brand: 'CMI', product: 'CMI Securegrip PS Max HT', item_code: 'CMI-SECUREGRIP-PS-HT', unit_of_measure: 'RL', unit_cost: 99.00, metadata: { bundles_per_square: '2SQ/RL' } },

  // Low Slope Products
  { category: 'Low Slope', brand: 'CertainTeed', product: 'CertainTeed Flintlastic Plybase (Self Adhered)', item_code: 'CT-FLINTLASTIC-BASE', unit_of_measure: 'RL', unit_cost: 118.00, metadata: { bundles_per_square: '2SQ/RL' } },
  { category: 'Low Slope', brand: 'CertainTeed', product: 'CertainTeed Flintlastic CAP (Self Adhered)', item_code: 'CT-FLINTLASTIC-CAP', unit_of_measure: 'RL', unit_cost: 112.95, metadata: { bundles_per_square: '1SQ/RL' } },
  { category: 'Low Slope', brand: 'Polyglass', product: 'Polyglass Elastoflex SA-V Base(Self Adhered)', item_code: 'POLYGLASS-ELASTOFLEX-BASE', unit_of_measure: 'RL', unit_cost: 122.00, metadata: { bundles_per_square: '2SQ/RL' } },
  { category: 'Low Slope', brand: 'Polyglass', product: 'Polyglass Polyflex SA-P CAP(Self Adhered)', item_code: 'POLYGLASS-POLYFLEX-CAP', unit_of_measure: 'RL', unit_cost: 108.33, metadata: { bundles_per_square: '1SQ/RL' } },
  { category: 'Low Slope', brand: 'GAF', product: 'GAF Liberty SA Base(Self Adhered)', item_code: 'GAF-LIBERTY-SA-BASE', unit_of_measure: 'RL', unit_cost: 131.00, metadata: { bundles_per_square: '2SQ/RL' } },
  { category: 'Low Slope', brand: 'GAF', product: 'GAF Liberty SA Cap (Self Adhered)', item_code: 'GAF-LIBERTY-SA-CAP', unit_of_measure: 'RL', unit_cost: 131.00, metadata: { bundles_per_square: '1SQ/RL' } },
  { category: 'Low Slope', brand: 'Owens Corning', product: 'OC Deckseal SA Base (self Adhered)', item_code: 'OC-DECKSEAL-SA-BASE', unit_of_measure: 'RL', unit_cost: 124.00, metadata: { bundles_per_square: '2SQ/RL' } },
  { category: 'Low Slope', brand: 'Owens Corning', product: 'OC Deckseal SA CAP (self Adhered)', item_code: 'OC-DECKSEAL-SA-CAP', unit_of_measure: 'RL', unit_cost: 124.00, metadata: { bundles_per_square: '1SQ/RL' } },

  // Concrete Tile
  { category: 'Concrete Tile', brand: 'Eagle', product: 'Eagle Field Tile - (Bel Air, Malibu, Capistrano)', item_code: 'EAGLE-FIELD-TILE', unit_of_measure: 'SQ', unit_cost: 120.00 },
  { category: 'Concrete Tile', brand: 'Westlake', product: 'Westlake - Barcelona, Villa, Estate, Saxony, Saxony Split', item_code: 'WESTLAKE-TILE', unit_of_measure: 'SQ', unit_cost: 120.00 },
  { category: 'Concrete Tile', brand: 'Crown', product: 'Crown - Sanibel, Tuscany, Windsor Standard', item_code: 'CROWN-TILE', unit_of_measure: 'SQ', unit_cost: 120.00, metadata: { valid_condition: 'Before July 1st' } },
  { category: 'Concrete Tile', brand: 'Eagle', product: 'Trim - Eagle - Hip and Ridge or Rake', item_code: 'EAGLE-TRIM', unit_of_measure: 'PC', unit_cost: 3.72 },
  { category: 'Concrete Tile', brand: 'Eagle', product: 'Oxide - Eagle', item_code: 'EAGLE-OXIDE', unit_of_measure: 'BAG', unit_cost: 32.00 },
  { category: 'Concrete Tile', brand: 'Westlake', product: 'Trim - Westlake - Hip and Ridge or Rake', item_code: 'WESTLAKE-TRIM', unit_of_measure: 'PC', unit_cost: 3.72 },
  { category: 'Concrete Tile', brand: 'Westlake', product: 'Oxide - Westlake', item_code: 'WESTLAKE-OXIDE', unit_of_measure: 'BAG', unit_cost: 32.00 },
  { category: 'Concrete Tile', brand: 'Crown', product: 'Trim - Crown - Hip and Ridge or Rake', item_code: 'CROWN-TRIM', unit_of_measure: 'PC', unit_cost: 3.72, metadata: { valid_condition: 'Before July 1st' } },
  { category: 'Concrete Tile', brand: 'Crown', product: 'Oxide - Crown', item_code: 'CROWN-OXIDE', unit_of_measure: 'BAG', unit_cost: 32.00, metadata: { valid_condition: 'Before July 1st' } },

  // Metal
  { category: 'Metal', brand: 'Multiple', product: 'Drip Edge 26GA 2.5" Face Painted', item_code: 'DRIP-EDGE-26GA-2.5', unit_of_measure: 'PC', unit_cost: 10.50, metadata: { length_per_unit: '10\'/PC' } },
  { category: 'Metal', brand: 'Multiple', product: 'L-Flashing 26GA 4" x 5"', item_code: 'L-FLASHING-26GA-4X5', unit_of_measure: 'PC', unit_cost: 11.95, metadata: { length_per_unit: '10\'/PC' } },
  { category: 'Metal', brand: 'Multiple', product: 'Valley Roll 26GA 16" X 50\'', item_code: 'VALLEY-ROLL-26GA-16X50', unit_of_measure: 'RL', unit_cost: 65.00, metadata: { length_per_unit: '50\'/RL' } },
  { category: 'Metal', brand: 'Multiple', product: 'Tile Eave Closure (Birdstop) 26GA Painted', item_code: 'TILE-EAVE-CLOSURE-26GA', unit_of_measure: 'PC', unit_cost: 12.75, metadata: { length_per_unit: '10\'/PC' } },
  { category: 'Metal', brand: 'Multiple', product: 'Tile W Valley Preformed 26GA Mill', item_code: 'TILE-W-VALLEY-26GA', unit_of_measure: 'PC', unit_cost: 52.50, metadata: { length_per_unit: '10\'/PC' } },
  { category: 'Metal', brand: 'Multiple', product: 'Tile Pan-Flashing 26GA 5"x6"x1" Mill', item_code: 'TILE-PAN-FLASH-26GA', unit_of_measure: 'PC', unit_cost: 23.30, metadata: { length_per_unit: '10\'/PC' } },
  { category: 'Metal', brand: 'Multiple', product: 'Tile Preformed Hip/Ridge Channel Metal 26GA', item_code: 'TILE-HR-CHANNEL-26GA', unit_of_measure: 'RL', unit_cost: 24.20, metadata: { length_per_unit: '50\'/RL' } },

  // Ventilation
  { category: 'Ventilation', brand: 'GAF', product: 'GAF Cobra Shingle Over Ridge Vent 12"', item_code: 'GAF-COBRA-RIDGE-12', unit_of_measure: 'PC', unit_cost: 12.00, metadata: { length_per_unit: '4\'/PC' } },
  { category: 'Ventilation', brand: 'Owens Corning', product: 'OC Ventsure Shingle Over Ridge Vent 12"', item_code: 'OC-VENTSURE-RIDGE-12', unit_of_measure: 'PC', unit_cost: 12.00, metadata: { length_per_unit: '4\'/PC' } },
  { category: 'Ventilation', brand: 'CertainTeed', product: 'CertainTeed Shingle Over Ridge Vent 12"', item_code: 'CT-RIDGE-VENT-12', unit_of_measure: 'PC', unit_cost: 11.00, metadata: { length_per_unit: '4\'/PC' } },
  { category: 'Ventilation', brand: 'Top Shield', product: 'Top Shield Omni Ridge Vent', item_code: 'TOPSHIELD-OMNI-RIDGE', unit_of_measure: 'PC', unit_cost: 11.00, metadata: { length_per_unit: '4\'/PC' } },
  { category: 'Ventilation', brand: 'Lomanco', product: 'Lomanco LO Omni Roll', item_code: 'LOMANCO-OMNI-ROLL', unit_of_measure: 'Roll', unit_cost: 97.00, metadata: { length_per_unit: '30\'/Roll' } },
  { category: 'Ventilation', brand: 'TAMCO', product: 'TAMCO Gooseneck with Damper 4" Painted', item_code: 'TAMCO-GOOSENECK-4', unit_of_measure: 'EA', unit_cost: 38.25 },
  { category: 'Ventilation', brand: 'Millennium', product: 'Millennium Gooseneck with Damper 4" Painted', item_code: 'MILLENNIUM-GOOSENECK-4', unit_of_measure: 'EA', unit_cost: 35.00 },
  { category: 'Ventilation', brand: 'TAMCO', product: 'TAMCO Gooseneck with Damper 10" Painted', item_code: 'TAMCO-GOOSENECK-10', unit_of_measure: 'EA', unit_cost: 42.50 },
  { category: 'Ventilation', brand: 'Millennium', product: 'Millennium Gooseneck with Damper 10" Painted', item_code: 'MILLENNIUM-GOOSENECK-10', unit_of_measure: 'EA', unit_cost: 40.00 },
  { category: 'Ventilation', brand: 'Multiple', product: 'Electrical Split Boot', item_code: 'ELECTRICAL-SPLIT-BOOT', unit_of_measure: 'EA', unit_cost: 28.25 },
  { category: 'Ventilation', brand: 'Multiple', product: 'Lead Boot 1.5"', item_code: 'LEAD-BOOT-1.5', unit_of_measure: 'EA', unit_cost: 11.95 },
  { category: 'Ventilation', brand: 'Multiple', product: 'Lead Boot 2"', item_code: 'LEAD-BOOT-2', unit_of_measure: 'EA', unit_cost: 12.50 },
  { category: 'Ventilation', brand: 'Multiple', product: 'Lead Boot 3"', item_code: 'LEAD-BOOT-3', unit_of_measure: 'EA', unit_cost: 16.25 },
  { category: 'Ventilation', brand: 'Multiple', product: 'Lead Boot 4"', item_code: 'LEAD-BOOT-4', unit_of_measure: 'EA', unit_cost: 22.75 },
  { category: 'Ventilation', brand: 'Multiple', product: 'Off Ridge Vent 4\' Painted', item_code: 'OFF-RIDGE-VENT-4', unit_of_measure: 'EA', unit_cost: 70.00 },
  { category: 'Ventilation', brand: 'Multiple', product: 'Tile Lead Boot 1.5"', item_code: 'TILE-LEAD-BOOT-1.5', unit_of_measure: 'EA', unit_cost: 31.75 },
  { category: 'Ventilation', brand: 'Multiple', product: 'Tile Lead Boot 2"', item_code: 'TILE-LEAD-BOOT-2', unit_of_measure: 'EA', unit_cost: 35.00 },
  { category: 'Ventilation', brand: 'Multiple', product: 'Tile Lead Boot 3"', item_code: 'TILE-LEAD-BOOT-3', unit_of_measure: 'EA', unit_cost: 38.25 },
  { category: 'Ventilation', brand: 'Multiple', product: 'Tile Lead Boot 4"', item_code: 'TILE-LEAD-BOOT-4', unit_of_measure: 'EA', unit_cost: 43.50 },
  { category: 'Ventilation', brand: 'Multiple', product: 'Tile Gooseneck 4" - Mill', item_code: 'TILE-GOOSENECK-4-MILL', unit_of_measure: 'EA', unit_cost: 42.50 },
  { category: 'Ventilation', brand: 'Multiple', product: 'Tile Gooseneck 10" - Mill', item_code: 'TILE-GOOSENECK-10-MILL', unit_of_measure: 'EA', unit_cost: 45.50 },
  { category: 'Ventilation', brand: 'Multiple', product: 'Tile Off Ridge Vent 4\' - Mill', item_code: 'TILE-OFF-RIDGE-4-MILL', unit_of_measure: 'EA', unit_cost: 92.50 },
  { category: 'Ventilation', brand: 'Multiple', product: 'Ohagin Ventilation (Matches Tile Profile) - Mill', item_code: 'OHAGIN-VENT-MILL', unit_of_measure: 'EA', unit_cost: 56.50 },

  // Adhesives/Liquids
  { category: 'Adhesives', brand: 'Polyglass', product: 'PG400 (Polyglass)', item_code: 'POLYGLASS-PG400', unit_of_measure: 'BKT', unit_cost: 39.00, metadata: { bundles_per_square: '5gal' } },
  { category: 'Adhesives', brand: 'Polyglass', product: 'PG500 Modified (Polyglass)', item_code: 'POLYGLASS-PG500', unit_of_measure: 'BKT', unit_cost: 48.00, metadata: { bundles_per_square: '5gal' } },
  { category: 'Adhesives', brand: 'Multiple', product: 'Asphalt Spray Primer', item_code: 'ASPHALT-SPRAY-PRIMER', unit_of_measure: 'Can', unit_cost: 18.50, metadata: { bundles_per_square: '14 oz' } },
  { category: 'Adhesives', brand: 'Multiple', product: 'Spray Paint', item_code: 'SPRAY-PAINT', unit_of_measure: 'Can', unit_cost: 7.35, metadata: { bundles_per_square: '12 oz' } },
  { category: 'Adhesives', brand: 'Multiple', product: 'Roof Tile Mortar', item_code: 'ROOF-TILE-MORTAR', unit_of_measure: 'Bag', unit_cost: 10.00, metadata: { bundles_per_square: '80LB' } },
  { category: 'Adhesives', brand: 'BUSTER', product: 'NP1 Caulking', item_code: 'NP1-CAULKING', unit_of_measure: 'EA', unit_cost: 10.50, metadata: { bundles_per_square: '10 OZ' } },
  { category: 'Adhesives', brand: 'Titebond', product: 'Titebond Tile Caulking', item_code: 'TITEBOND-TILE-CAULK', unit_of_measure: 'EA', unit_cost: 11.75, metadata: { bundles_per_square: '9.5 OZ' } },
  { category: 'Adhesives', brand: 'Dow', product: 'Tile Bond Kit', item_code: 'DOW-TILE-BOND-KIT', unit_of_measure: 'EA', unit_cost: 234.00, metadata: { bundles_per_square: '23LB' } },

  // Fasteners/Nails
  { category: 'Fasteners', brand: 'Multiple', product: '1" Plastic Cap Nails', item_code: 'CAP-NAIL-1-PLASTIC', unit_of_measure: 'Pail', unit_cost: 20.50, metadata: { bundles_per_square: '3000/Pail' } },
  { category: 'Fasteners', brand: 'Multiple', product: '1" Metal Cap Nails', item_code: 'CAP-NAIL-1-METAL', unit_of_measure: 'Pail', unit_cost: 53.90, metadata: { bundles_per_square: '25#/Pail' } },
  { category: 'Fasteners', brand: 'Multiple', product: '2 3/8" 8D BRT RS Coil Nails', item_code: 'COIL-NAIL-2-3-8-8D', unit_of_measure: 'BOX', unit_cost: 55.00, metadata: { bundles_per_square: '4500/BOX' } },
  { category: 'Fasteners', brand: 'Multiple', product: '1 1/4" Coil Nails', item_code: 'COIL-NAIL-1-1-4', unit_of_measure: 'BOX', unit_cost: 40.00, metadata: { bundles_per_square: '7200/BOX' } },
  { category: 'Fasteners', brand: 'Stinger', product: 'Stinger 1" Cap Nail Pack', item_code: 'STINGER-CAP-NAIL-1', unit_of_measure: 'BOX', unit_cost: 57.75, metadata: { bundles_per_square: '2000/box' } },
  { category: 'Fasteners', brand: 'Simpson', product: 'Quickdrive 2.5" Tile Fastener Galv.', item_code: 'SIMPSON-QUICKDRIVE-2.5', unit_of_measure: 'BOX', unit_cost: 98.00, metadata: { bundles_per_square: '1500/box' } },

  // Accessories
  { category: 'Accessories', brand: 'Multiple', product: 'Wood Batten 1"x2"x4\' (1.5 bd/sq)', item_code: 'WOOD-BATTEN-1X2X4', unit_of_measure: 'BD', unit_cost: 11.68, metadata: { bundles_per_square: '12pc/bd' } },
  { category: 'Accessories', brand: 'Westlake', product: 'Wakaflex 11" Black', item_code: 'WAKAFLEX-11-BLACK', unit_of_measure: 'Roll', unit_cost: 250.00, metadata: { length_per_unit: '33\'' } },
  { category: 'Accessories', brand: 'Westlake', product: 'Wakaflex 22" Black', item_code: 'WAKAFLEX-22-BLACK', unit_of_measure: 'Roll', unit_cost: 300.00, metadata: { length_per_unit: '16.5\'' } },
  { category: 'Accessories', brand: 'Multiple', product: '1/2" CDX Plywood', item_code: 'PLYWOOD-CDX-0.5-4X8', unit_of_measure: 'EA', unit_cost: 30.00, metadata: { length_per_unit: '4\'x8\'' } },

  // Freight
  { category: 'Freight', brand: 'Suncoast', product: 'Local Delivery Charge (Per Delivery)', item_code: 'FREIGHT-LOCAL-DELIVERY', unit_of_measure: 'EA', unit_cost: 75.00 },
];

export const SRS_VENDOR_INFO = {
  name: 'SRS Distribution / Suncoast Roofers Supply',
  rep_name: 'Hunter Prussel',
  phone: '321-624-4885',
  email: 'hunter.prussel@suncoastrooferssupply.com',
  effective_date: '2025-07-24'
};
