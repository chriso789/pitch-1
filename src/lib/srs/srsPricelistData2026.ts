// SRS Distribution Pricelist - Effective 01-09-2026
// Representative: Hunter Prussel
// Cell: 321-624-4885
// Email: hunter.prussel@srsbuildingproducts.com

export interface SRSPricelistItem {
  category: string;
  brand?: string;
  product: string;
  item_code: string;
  unit_of_measure: string;
  unit_cost: number;
  metadata?: Record<string, any>;
}

export const SRS_PRICELIST_2026: SRSPricelistItem[] = [
  // ==================== SHINGLES ====================
  { category: 'Shingles', brand: 'GAF', product: 'GAF Timberline HDZ', item_code: 'SRS-HDZ-2026', unit_of_measure: 'SQ', unit_cost: 115.00, metadata: { bundles_per_sq: 3, per_bundle: 38.33 }},
  { category: 'Shingles', brand: 'Owens Corning', product: 'Owens Corning Oakridge', item_code: 'SRS-OC-OAK-2026', unit_of_measure: 'SQ', unit_cost: 105.00, metadata: { bundles_per_sq: 3, per_bundle: 35.00 }},
  { category: 'Shingles', brand: 'Owens Corning', product: 'Owens Corning Duration', item_code: 'SRS-OC-DUR-2026', unit_of_measure: 'SQ', unit_cost: 114.00, metadata: { bundles_per_sq: 3, per_bundle: 38.00 }},
  { category: 'Shingles', brand: 'CertainTeed', product: 'CertainTeed Landmark', item_code: 'SRS-CT-LM-2026', unit_of_measure: 'SQ', unit_cost: 113.00, metadata: { bundles_per_sq: 3, per_bundle: 37.67 }},
  { category: 'Shingles', brand: 'CertainTeed', product: 'CertainTeed Landmark Pro', item_code: 'SRS-CT-LMP-2026', unit_of_measure: 'SQ', unit_cost: 129.00, metadata: { bundles_per_sq: 3, per_bundle: 43.00 }},
  { category: 'Shingles', brand: 'IKO', product: 'IKO Cambridge', item_code: 'SRS-IKO-CAM-2026', unit_of_measure: 'SQ', unit_cost: 105.00, metadata: { bundles_per_sq: 3, per_bundle: 35.00 }},
  { category: 'Shingles', brand: 'IKO', product: 'IKO Dynasty', item_code: 'SRS-IKO-DYN-2026', unit_of_measure: 'SQ', unit_cost: 109.00, metadata: { bundles_per_sq: 3, per_bundle: 36.33 }},
  { category: 'Shingles', brand: 'Atlas', product: 'Atlas Pinnacle', item_code: 'SRS-ATL-PIN-2026', unit_of_measure: 'SQ', unit_cost: 115.00, metadata: { bundles_per_sq: 3, per_bundle: 38.33 }},
  { category: 'Shingles', brand: 'TAMKO', product: 'TAMKO Heritage', item_code: 'SRS-TAM-HER-2026', unit_of_measure: 'SQ', unit_cost: 106.00, metadata: { bundles_per_sq: 3, per_bundle: 35.33 }},
  { category: 'Shingles', brand: 'TAMKO', product: 'TAMKO TITAN XT', item_code: 'SRS-TAM-TIT-2026', unit_of_measure: 'SQ', unit_cost: 112.00, metadata: { bundles_per_sq: 3, per_bundle: 37.33 }},

  // ==================== HIP AND RIDGE ====================
  { category: 'Hip and Ridge', brand: 'GAF', product: 'GAF S-A-R Hip and Ridge', item_code: 'SRS-GAF-SAR-2026', unit_of_measure: 'BD', unit_cost: 59.00, metadata: { lf_per_bundle: 25 }},
  { category: 'Hip and Ridge', brand: 'Owens Corning', product: 'Owens Corning Proedge Hip and Ridge', item_code: 'SRS-OC-PRO-2026', unit_of_measure: 'BD', unit_cost: 74.00, metadata: { lf_per_bundle: 33 }},
  { category: 'Hip and Ridge', brand: 'CertainTeed', product: 'CertainTeed Shadow Hip and Ridge', item_code: 'SRS-CT-SHD-2026', unit_of_measure: 'BD', unit_cost: 69.75, metadata: { lf_per_bundle: 30 }},
  { category: 'Hip and Ridge', brand: 'IKO', product: 'IKO Hip and Ridge', item_code: 'SRS-IKO-HR-2026', unit_of_measure: 'BD', unit_cost: 68.50, metadata: { lf_per_bundle: 33 }},
  { category: 'Hip and Ridge', brand: 'Atlas', product: 'Atlas Pro-Cut Hip and Ridge', item_code: 'SRS-ATL-HR-2026', unit_of_measure: 'BD', unit_cost: 67.50, metadata: { lf_per_bundle: 31 }},
  { category: 'Hip and Ridge', brand: 'TAMKO', product: 'TAMKO Hip and Ridge', item_code: 'SRS-TAM-HR-2026', unit_of_measure: 'BD', unit_cost: 67.00, metadata: { lf_per_bundle: 33.3 }},

  // ==================== STARTER ====================
  { category: 'Starter', brand: 'GAF', product: 'GAF Pro-Start Starter', item_code: 'SRS-GAF-PST-2026', unit_of_measure: 'BD', unit_cost: 54.50, metadata: { lf_per_bundle: 120 }},
  { category: 'Starter', brand: 'Owens Corning', product: 'Owens Corning Starter Strip Plus', item_code: 'SRS-OC-STP-2026', unit_of_measure: 'BD', unit_cost: 54.00, metadata: { lf_per_bundle: 105 }},
  { category: 'Starter', brand: 'CertainTeed', product: 'CertainTeed SwiftStart Starter', item_code: 'SRS-CT-SWF-2026', unit_of_measure: 'BD', unit_cost: 55.00, metadata: { lf_per_bundle: 116 }},
  { category: 'Starter', brand: 'IKO', product: 'IKO Starter', item_code: 'SRS-IKO-ST-2026', unit_of_measure: 'BD', unit_cost: 55.00, metadata: { lf_per_bundle: 123 }},
  { category: 'Starter', brand: 'Atlas', product: 'Atlas Pro-Starter', item_code: 'SRS-ATL-ST-2026', unit_of_measure: 'BD', unit_cost: 68.25, metadata: { lf_per_bundle: 140 }},
  { category: 'Starter', brand: 'TAMKO', product: 'Tamko Starter', item_code: 'SRS-TAM-ST-2026', unit_of_measure: 'BD', unit_cost: 59.50, metadata: { lf_per_bundle: 105 }},
  { category: 'Starter', brand: 'Top Shield', product: 'Top Shield Starter', item_code: 'SRS-TS-ST-2026', unit_of_measure: 'BD', unit_cost: 47.50, metadata: { lf_per_bundle: 105 }},

  // ==================== MECHANICALLY FASTENED UNDERLAYMENTS ====================
  { category: 'Underlayment', brand: 'Top Shield', product: 'SG-30 Underlayment', item_code: 'SRS-TS-SG30-2026', unit_of_measure: 'RL', unit_cost: 67.00, metadata: { sq_per_roll: 10 }},
  { category: 'Underlayment', brand: 'Top Shield', product: 'TS-20 Underlayment', item_code: 'SRS-TS-20-2026', unit_of_measure: 'RL', unit_cost: 72.50, metadata: { sq_per_roll: 10 }},
  { category: 'Underlayment', brand: 'Top Shield', product: 'Storm Gear Underlayment', item_code: 'SRS-TS-SG-2026', unit_of_measure: 'RL', unit_cost: 67.00, metadata: { sq_per_roll: 10 }},
  { category: 'Underlayment', brand: 'GAF', product: 'GAF Feltbuster', item_code: 'SRS-GAF-FB-2026', unit_of_measure: 'RL', unit_cost: 95.00, metadata: { sq_per_roll: 10 }},
  { category: 'Underlayment', brand: 'CertainTeed', product: 'CertainTeed Roofrunner', item_code: 'SRS-CT-RR-2026', unit_of_measure: 'RL', unit_cost: 85.00, metadata: { sq_per_roll: 10 }},
  { category: 'Underlayment', brand: 'Owens Corning', product: 'Titanium UDL / Rhinoroof U20', item_code: 'SRS-OC-TIT-2026', unit_of_measure: 'RL', unit_cost: 68.00, metadata: { sq_per_roll: 10 }},
  { category: 'Underlayment', brand: 'Atlas', product: 'Atlas Summit 60', item_code: 'SRS-ATL-S60-2026', unit_of_measure: 'RL', unit_cost: 74.00, metadata: { sq_per_roll: 10 }},
  { category: 'Underlayment', brand: 'CMI', product: 'CMI X-Weather Warrior Synthetic', item_code: 'SRS-CMI-XWW-2026', unit_of_measure: 'RL', unit_cost: 57.50, metadata: { sq_per_roll: 10 }},
  { category: 'Underlayment', brand: 'Polyglass', product: 'Polyglass Polyanchor HV Base', item_code: 'SRS-PG-PHV-2026', unit_of_measure: 'RL', unit_cost: 86.00, metadata: { sq_per_roll: 2 }},

  // ==================== SELF ADHERED UNDERLAYMENTS ====================
  { category: 'Ice & Water', brand: 'CMI', product: 'CMI Securegrip', item_code: 'SRS-CMI-SG-2026', unit_of_measure: 'RL', unit_cost: 59.50, metadata: { sq_per_roll: 2 }},
  { category: 'Ice & Water', brand: 'Resisto', product: 'Resisto LB1236 / Top Shield Defender', item_code: 'SRS-RES-LB-2026', unit_of_measure: 'RL', unit_cost: 61.50, metadata: { sq_per_roll: 2 }},
  { category: 'Ice & Water', brand: 'Tarco', product: 'Tarco MS300 / Top Shield G300', item_code: 'SRS-TAR-MS-2026', unit_of_measure: 'RL', unit_cost: 61.50, metadata: { sq_per_roll: 2 }},
  { category: 'Ice & Water', brand: 'Owens Corning', product: 'Titanium Rhinoroof Granulated', item_code: 'SRS-OC-TITR-2026', unit_of_measure: 'RL', unit_cost: 70.00, metadata: { sq_per_roll: 2 }},

  // ==================== RESIDENTIAL LOW SLOPE ====================
  { category: 'Low Slope', brand: 'GAF', product: 'GAF Weatherwatch', item_code: 'SRS-GAF-WW-2026', unit_of_measure: 'RL', unit_cost: 81.00, metadata: { sq_per_roll: 2 }},
  { category: 'Low Slope', brand: 'GAF', product: 'GAF Stormguard', item_code: 'SRS-GAF-STG-2026', unit_of_measure: 'RL', unit_cost: 107.50, metadata: { sq_per_roll: 2 }},
  { category: 'Low Slope', brand: 'CertainTeed', product: 'CertainTeed Dryroof', item_code: 'SRS-CT-DRY-2026', unit_of_measure: 'RL', unit_cost: 79.00, metadata: { sq_per_roll: 2 }},
  { category: 'Low Slope', brand: 'CertainTeed', product: 'CertainTeed Winterguard Sand', item_code: 'SRS-CT-WGS-2026', unit_of_measure: 'RL', unit_cost: 97.50, metadata: { sq_per_roll: 2 }},
  { category: 'Low Slope', brand: 'Atlas', product: 'Atlas Weathermaster 200', item_code: 'SRS-ATL-WM-2026', unit_of_measure: 'RL', unit_cost: 72.00, metadata: { sq_per_roll: 2 }},
  { category: 'Low Slope', brand: 'Polyglass', product: 'Polyglass Tu-Plus Hi-Temp', item_code: 'SRS-PG-TUP-2026', unit_of_measure: 'RL', unit_cost: 115.00, metadata: { sq_per_roll: 2 }},
  { category: 'Low Slope', brand: 'Polyglass', product: 'Polyglass MTS-Plus Hi-Temp', item_code: 'SRS-PG-MTS-2026', unit_of_measure: 'RL', unit_cost: 115.00, metadata: { sq_per_roll: 2 }},
  { category: 'Low Slope', brand: 'Polyglass', product: 'Polyglass TU-Max Hi-Temp', item_code: 'SRS-PG-TUM-2026', unit_of_measure: 'RL', unit_cost: 104.00, metadata: { sq_per_roll: 2 }},
  { category: 'Low Slope', brand: 'Owens Corning', product: 'Titanium PSU-30 Hi-Temp', item_code: 'SRS-OC-PSU-2026', unit_of_measure: 'RL', unit_cost: 108.00, metadata: { sq_per_roll: 2 }},
  { category: 'Low Slope', brand: 'CMI', product: 'CMI Securegrip PS Max HT', item_code: 'SRS-CMI-PSM-2026', unit_of_measure: 'RL', unit_cost: 99.00, metadata: { sq_per_roll: 2 }},

  // ==================== SELF ADHERED (MODIFIED BITUMEN) ====================
  { category: 'Modified Bitumen', brand: 'CertainTeed', product: 'CertainTeed Flintlastic Plybase SA', item_code: 'SRS-CT-FPB-2026', unit_of_measure: 'RL', unit_cost: 118.00, metadata: { sq_per_roll: 2 }},
  { category: 'Modified Bitumen', brand: 'CertainTeed', product: 'CertainTeed Flintlastic CAP SA', item_code: 'SRS-CT-FCP-2026', unit_of_measure: 'RL', unit_cost: 112.95, metadata: { sq_per_roll: 1 }},
  { category: 'Modified Bitumen', brand: 'Polyglass', product: 'Polyglass Elastoflex SA-V Base', item_code: 'SRS-PG-EFB-2026', unit_of_measure: 'RL', unit_cost: 122.00, metadata: { sq_per_roll: 2 }},
  { category: 'Modified Bitumen', brand: 'Polyglass', product: 'Polyglass Polyflex SA-P CAP', item_code: 'SRS-PG-PFC-2026', unit_of_measure: 'RL', unit_cost: 108.33, metadata: { sq_per_roll: 1 }},
  { category: 'Modified Bitumen', brand: 'GAF', product: 'GAF Liberty SA Base', item_code: 'SRS-GAF-LSB-2026', unit_of_measure: 'RL', unit_cost: 131.00, metadata: { sq_per_roll: 2 }},
  { category: 'Modified Bitumen', brand: 'GAF', product: 'GAF Liberty SA Cap', item_code: 'SRS-GAF-LSC-2026', unit_of_measure: 'RL', unit_cost: 131.00, metadata: { sq_per_roll: 1 }},
  { category: 'Modified Bitumen', brand: 'Owens Corning', product: 'OC Deckseal SA Base', item_code: 'SRS-OC-DSB-2026', unit_of_measure: 'RL', unit_cost: 124.00, metadata: { sq_per_roll: 2 }},
  { category: 'Modified Bitumen', brand: 'Owens Corning', product: 'OC Deckseal SA CAP', item_code: 'SRS-OC-DSC-2026', unit_of_measure: 'RL', unit_cost: 124.00, metadata: { sq_per_roll: 1 }},

  // ==================== CONCRETE TILE ====================
  { category: 'Concrete Tile', brand: 'Eagle', product: 'Eagle Field Tile (Bel Air, Malibu, Capistrano)', item_code: 'SRS-EAG-FT-2026', unit_of_measure: 'SQ', unit_cost: 120.00 },
  { category: 'Concrete Tile', brand: 'Westlake', product: 'Westlake Field Tile (Barcelona, Villa, Estate, Saxony)', item_code: 'SRS-WL-FT-2026', unit_of_measure: 'SQ', unit_cost: 120.00 },
  { category: 'Concrete Tile', brand: 'Crown', product: 'Crown Field Tile (Sanibel, Tuscany, Windsor)', item_code: 'SRS-CRN-FT-2026', unit_of_measure: 'SQ', unit_cost: 120.00, metadata: { valid_before: 'July 1st' }},
  { category: 'Concrete Tile', brand: 'Eagle', product: 'Eagle Hip and Ridge or Rake Trim', item_code: 'SRS-EAG-TR-2026', unit_of_measure: 'PC', unit_cost: 3.72 },
  { category: 'Concrete Tile', brand: 'Eagle', product: 'Eagle Oxide', item_code: 'SRS-EAG-OX-2026', unit_of_measure: 'BAG', unit_cost: 32.00 },
  { category: 'Concrete Tile', brand: 'Westlake', product: 'Westlake Hip and Ridge or Rake Trim', item_code: 'SRS-WL-TR-2026', unit_of_measure: 'PC', unit_cost: 3.72 },
  { category: 'Concrete Tile', brand: 'Westlake', product: 'Westlake Oxide', item_code: 'SRS-WL-OX-2026', unit_of_measure: 'BAG', unit_cost: 32.00 },
  { category: 'Concrete Tile', brand: 'Crown', product: 'Crown Hip and Ridge or Rake Trim', item_code: 'SRS-CRN-TR-2026', unit_of_measure: 'PC', unit_cost: 3.72, metadata: { valid_before: 'July 1st' }},
  { category: 'Concrete Tile', brand: 'Crown', product: 'Crown Oxide', item_code: 'SRS-CRN-OX-2026', unit_of_measure: 'BAG', unit_cost: 32.00, metadata: { valid_before: 'July 1st' }},

  // ==================== METAL FLASHING ====================
  { category: 'Metal Flashing', brand: 'Multiple', product: 'Drip Edge 26GA 2.5" Face Painted', item_code: 'SRS-DRP-25-2026', unit_of_measure: 'PC', unit_cost: 10.50, metadata: { length: "10'" }},
  { category: 'Metal Flashing', brand: 'Multiple', product: 'L-Flashing 26GA 4" x 5"', item_code: 'SRS-LFL-45-2026', unit_of_measure: 'PC', unit_cost: 11.95, metadata: { length: "10'" }},
  { category: 'Metal Flashing', brand: 'Multiple', product: 'Valley Roll 26GA 16" X 50\'', item_code: 'SRS-VAL-16-2026', unit_of_measure: 'RL', unit_cost: 65.00, metadata: { length: "50'" }},
  { category: 'Metal Flashing', brand: 'Multiple', product: 'Tile Eave Closure (Birdstop) 26GA Painted', item_code: 'SRS-TEC-2026', unit_of_measure: 'PC', unit_cost: 12.75, metadata: { length: "10'" }},
  { category: 'Metal Flashing', brand: 'Multiple', product: 'Tile W Valley Preformed 26GA Mill', item_code: 'SRS-TWV-2026', unit_of_measure: 'PC', unit_cost: 52.50, metadata: { length: "10'" }},
  { category: 'Metal Flashing', brand: 'Multiple', product: 'Tile Pan-Flashing 26GA 5"x6"x1" Mill', item_code: 'SRS-TPF-2026', unit_of_measure: 'PC', unit_cost: 23.30, metadata: { length: "10'" }},
  { category: 'Metal Flashing', brand: 'Multiple', product: 'Tile Hip/Ridge Channel Metal 26GA', item_code: 'SRS-THR-2026', unit_of_measure: 'RL', unit_cost: 24.20, metadata: { length: "50'" }},

  // ==================== VENTILATION ====================
  { category: 'Ventilation', brand: 'GAF', product: 'GAF Cobra Shingle Over Ridge Vent 12"', item_code: 'SRS-GAF-CBR-2026', unit_of_measure: 'PC', unit_cost: 12.00, metadata: { length: "4'" }},
  { category: 'Ventilation', brand: 'Owens Corning', product: 'OC Ventsure Shingle Over Ridge Vent 12"', item_code: 'SRS-OC-VSR-2026', unit_of_measure: 'PC', unit_cost: 12.00, metadata: { length: "4'" }},
  { category: 'Ventilation', brand: 'CertainTeed', product: 'CertainTeed Shingle Over Ridge Vent 12"', item_code: 'SRS-CT-SRV-2026', unit_of_measure: 'PC', unit_cost: 11.00, metadata: { length: "4'" }},
  { category: 'Ventilation', brand: 'Top Shield', product: 'Top Shield Omni Ridge Vent', item_code: 'SRS-TS-ORV-2026', unit_of_measure: 'PC', unit_cost: 11.00, metadata: { length: "4'" }},
  { category: 'Ventilation', brand: 'Lomanco', product: 'Lomanco Omni Roll', item_code: 'SRS-LOM-OR-2026', unit_of_measure: 'RL', unit_cost: 97.00, metadata: { length: "30'" }},
  { category: 'Ventilation', brand: 'TAMCO', product: 'TAMCO Gooseneck with Damper 4" Painted', item_code: 'SRS-TAM-GN4-2026', unit_of_measure: 'EA', unit_cost: 38.25 },
  { category: 'Ventilation', brand: 'Millennium', product: 'Millennium Gooseneck with Damper 4" Painted', item_code: 'SRS-MIL-GN4-2026', unit_of_measure: 'EA', unit_cost: 35.00 },
  { category: 'Ventilation', brand: 'TAMCO', product: 'TAMCO Gooseneck with Damper 10" Painted', item_code: 'SRS-TAM-GN10-2026', unit_of_measure: 'EA', unit_cost: 42.50 },
  { category: 'Ventilation', brand: 'Millennium', product: 'Millennium Gooseneck with Damper 10" Painted', item_code: 'SRS-MIL-GN10-2026', unit_of_measure: 'EA', unit_cost: 40.00 },

  // ==================== PENETRATIONS ====================
  { category: 'Penetrations', brand: 'Multiple', product: 'Electrical Split Boot', item_code: 'SRS-ESB-2026', unit_of_measure: 'EA', unit_cost: 28.25 },
  { category: 'Penetrations', brand: 'Multiple', product: 'Lead Boot 1.5"', item_code: 'SRS-LB-15-2026', unit_of_measure: 'EA', unit_cost: 11.95 },
  { category: 'Penetrations', brand: 'Multiple', product: 'Lead Boot 2"', item_code: 'SRS-LB-20-2026', unit_of_measure: 'EA', unit_cost: 12.50 },
  { category: 'Penetrations', brand: 'Multiple', product: 'Lead Boot 3"', item_code: 'SRS-LB-30-2026', unit_of_measure: 'EA', unit_cost: 16.25 },
  { category: 'Penetrations', brand: 'Multiple', product: 'Lead Boot 4"', item_code: 'SRS-LB-40-2026', unit_of_measure: 'EA', unit_cost: 22.75 },
  { category: 'Penetrations', brand: 'Multiple', product: 'Off Ridge Vent 4\' Painted', item_code: 'SRS-ORV-4-2026', unit_of_measure: 'EA', unit_cost: 70.00 },
  { category: 'Penetrations', brand: 'Multiple', product: 'Tile Lead Boot 1.5"', item_code: 'SRS-TLB-15-2026', unit_of_measure: 'EA', unit_cost: 31.75 },
  { category: 'Penetrations', brand: 'Multiple', product: 'Tile Lead Boot 2"', item_code: 'SRS-TLB-20-2026', unit_of_measure: 'EA', unit_cost: 35.00 },
  { category: 'Penetrations', brand: 'Multiple', product: 'Tile Lead Boot 3"', item_code: 'SRS-TLB-30-2026', unit_of_measure: 'EA', unit_cost: 38.25 },
  { category: 'Penetrations', brand: 'Multiple', product: 'Tile Lead Boot 4"', item_code: 'SRS-TLB-40-2026', unit_of_measure: 'EA', unit_cost: 43.50 },
  { category: 'Penetrations', brand: 'Multiple', product: 'Tile Gooseneck 4" - Mill', item_code: 'SRS-TGN-4-2026', unit_of_measure: 'EA', unit_cost: 42.50 },
  { category: 'Penetrations', brand: 'Multiple', product: 'Tile Gooseneck 10" - Mill', item_code: 'SRS-TGN-10-2026', unit_of_measure: 'EA', unit_cost: 45.50 },
  { category: 'Penetrations', brand: 'Multiple', product: 'Tile Off Ridge Vent 4\' - Mill', item_code: 'SRS-TORV-4-2026', unit_of_measure: 'EA', unit_cost: 92.50 },
  { category: 'Penetrations', brand: 'Ohagin', product: 'Ohagin Ventilation (Matches Tile Profile) - Mill', item_code: 'SRS-OHA-2026', unit_of_measure: 'EA', unit_cost: 56.50 },

  // ==================== ADHESIVES/LIQUIDS ====================
  { category: 'Adhesives', brand: 'Polyglass', product: 'PG400 Adhesive', item_code: 'SRS-PG-400-2026', unit_of_measure: 'GAL', unit_cost: 39.00, metadata: { size: '5gal' }},
  { category: 'Adhesives', brand: 'Polyglass', product: 'PG500 Modified Adhesive', item_code: 'SRS-PG-500-2026', unit_of_measure: 'GAL', unit_cost: 48.00, metadata: { size: '5gal' }},
  { category: 'Adhesives', brand: 'Multiple', product: 'Asphalt Spray Primer', item_code: 'SRS-ASP-2026', unit_of_measure: 'EA', unit_cost: 18.50, metadata: { size: '14oz' }},
  { category: 'Adhesives', brand: 'Multiple', product: 'Spray Paint', item_code: 'SRS-SPY-2026', unit_of_measure: 'EA', unit_cost: 7.35, metadata: { size: '12oz' }},
  { category: 'Adhesives', brand: 'Multiple', product: 'Roof Tile Mortar', item_code: 'SRS-RTM-2026', unit_of_measure: 'BAG', unit_cost: 10.00, metadata: { weight: '80LB' }},
  { category: 'Adhesives', brand: 'NP1', product: 'NP1 Caulking', item_code: 'SRS-NP1-2026', unit_of_measure: 'EA', unit_cost: 10.50, metadata: { size: '10oz' }},
  { category: 'Adhesives', brand: 'Titebond', product: 'Titebond Tile Caulking', item_code: 'SRS-TBC-2026', unit_of_measure: 'EA', unit_cost: 11.75, metadata: { size: '9.5oz' }},
  { category: 'Adhesives', brand: 'Dow', product: 'Tile Bond Kit', item_code: 'SRS-TBK-2026', unit_of_measure: 'EA', unit_cost: 234.00, metadata: { weight: '23LB' }},

  // ==================== FASTENERS/NAILS ====================
  { category: 'Fasteners', brand: 'Multiple', product: '1" Plastic Cap Nails', item_code: 'SRS-PCN-1-2026', unit_of_measure: 'PAIL', unit_cost: 20.50, metadata: { count: 3000 }},
  { category: 'Fasteners', brand: 'Multiple', product: '1" Metal Cap Nails', item_code: 'SRS-MCN-1-2026', unit_of_measure: 'PAIL', unit_cost: 53.90, metadata: { weight: '25#' }},
  { category: 'Fasteners', brand: 'Multiple', product: '2 3/8" 8D BRT RS Coil Nails', item_code: 'SRS-CN-238-2026', unit_of_measure: 'BOX', unit_cost: 55.00, metadata: { count: 4500 }},
  { category: 'Fasteners', brand: 'Multiple', product: '1 1/4" Coil Nails', item_code: 'SRS-CN-125-2026', unit_of_measure: 'BOX', unit_cost: 40.00, metadata: { count: 7200 }},
  { category: 'Fasteners', brand: 'Stinger', product: 'Stinger 1" Cap Nail Pack', item_code: 'SRS-STI-1-2026', unit_of_measure: 'BOX', unit_cost: 57.75, metadata: { count: 2000 }},
  { category: 'Fasteners', brand: 'Simpson', product: 'Quickdrive 2.5" Tile Fastener Galv.', item_code: 'SRS-SIM-QD-2026', unit_of_measure: 'BOX', unit_cost: 98.00, metadata: { count: 1500 }},

  // ==================== ACCESSORIES ====================
  { category: 'Accessories', brand: 'Multiple', product: 'Wood Batten 1"x2"x4\'', item_code: 'SRS-WB-124-2026', unit_of_measure: 'BD', unit_cost: 11.68, metadata: { pcs_per_bundle: 12, sq_coverage: 1.5 }},
  { category: 'Accessories', brand: 'Westlake', product: 'Wakaflex 11" Black', item_code: 'SRS-WKF-11-2026', unit_of_measure: 'RL', unit_cost: 250.00, metadata: { length: "33'" }},
  { category: 'Accessories', brand: 'Westlake', product: 'Wakaflex 22" Black', item_code: 'SRS-WKF-22-2026', unit_of_measure: 'RL', unit_cost: 300.00, metadata: { length: "16.5'" }},
  { category: 'Accessories', brand: 'Multiple', product: '1/2" CDX Plywood', item_code: 'SRS-CDX-12-2026', unit_of_measure: 'SH', unit_cost: 30.00, metadata: { size: "4'x8'" }},

  // ==================== DELIVERY ====================
  { category: 'Delivery', brand: 'Suncoast', product: 'Local Delivery Charge (Per Delivery)', item_code: 'SRS-DEL-2026', unit_of_measure: 'EA', unit_cost: 75.00 },
];

export const SRS_EFFECTIVE_DATE = '2026-01-09';
export const SRS_REP_NAME = 'Hunter Prussel';
export const SRS_REP_PHONE = '321-624-4885';
export const SRS_REP_EMAIL = 'hunter.prussel@srsbuildingproducts.com';
