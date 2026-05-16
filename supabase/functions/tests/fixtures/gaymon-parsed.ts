// ============================================================
// Mocked parsed line items for the Gaymon documents.
// Shape matches the rows returned by `insurance_scope_line_items`
// (the comparer accepts these directly via toNormalizedItem).
// Numbers are derived from gaymon-expected.json — totals match
// carrier RCV $14,718.16 and contractor RCV $29,417.87.
// ============================================================

export const gaymonCarrierHeader = {
  total_rcv: 14718.16,
  total_acv: 9906.11,
  deductible: 5760.0,
  total_net_claim: 4146.11,
  tax_amount: 0,
  price_list_name: 'FLTA8X_OCT24',
  estimate_date: '2024-10-15',
};

export const gaymonContractorHeader = {
  total_rcv: 29417.87,
  total_acv: 29417.87,
  total_net_claim: 29417.87,
  tax_amount: 0,
  price_list_name: 'FLTA8X_NOV24',
  estimate_date: '2024-11-20',
};

const li = (over: Record<string, unknown>) => ({
  id: crypto.randomUUID(),
  line_order: 0,
  raw_code: null,
  raw_description: '',
  raw_category: 'ROOF',
  section_name: 'ROOF',
  quantity: null,
  unit: null,
  unit_price: null,
  effective_unit_price: null,
  total_rcv: null,
  total_acv: null,
  depreciation_amount: null,
  remove_price: null,
  replace_price: null,
  page_number: 1,
  raw_line: null,
  layout_type: 'A',
  parser_layout: 'A',
  ...over,
});

// Carrier omits roofing felt/underlayment (triggers ROOF_REPLACEMENT_BASE_ASSEMBLY finding)
// Sums to 14,718.16 to match gaymonCarrierHeader.total_rcv.
export const gaymonCarrierLineItems = [
  li({ raw_description: 'Tear off, haul and dispose of comp. shingles - Laminated', quantity: 30.77, unit: 'SQ', total_rcv: 1384.65 }),
  li({ raw_description: 'Laminated - comp. shingle rfg. - w/out felt', quantity: 30.77, unit: 'SQ', total_rcv: 6500.00 }),
  li({ raw_description: 'Drip edge', quantity: 224, unit: 'LF', total_rcv: 380.00 }),
  li({ raw_description: 'Asphalt starter - universal starter course', quantity: 224, unit: 'LF', total_rcv: 810.00 }),
  li({ raw_description: 'Hip / Ridge cap - composition shingles', quantity: 88, unit: 'LF', total_rcv: 600.00 }),
  li({ raw_description: 'Flashing - pipe jack', quantity: 2, unit: 'EA', total_rcv: 110.00 }),
  li({ raw_description: 'Valley metal', quantity: 22, unit: 'LF', total_rcv: 185.43 }),
  li({ raw_description: 'Clean with pressure / chemical spray', section_name: 'RIGHT ELEVATION', raw_category: 'RIGHT ELEVATION', quantity: 400, unit: 'SF', total_rcv: 250.00 }),
  li({ raw_description: 'Seal & paint stucco', section_name: 'RIGHT ELEVATION', raw_category: 'RIGHT ELEVATION', quantity: 400, unit: 'SF', total_rcv: 600.00 }),
  li({ raw_description: 'Clean with pressure / chemical spray', section_name: 'BACK ELEVATION', raw_category: 'BACK ELEVATION', quantity: 500, unit: 'SF', total_rcv: 312.50 }),
  li({ raw_description: 'Seal & paint stucco', section_name: 'BACK ELEVATION', raw_category: 'BACK ELEVATION', quantity: 500, unit: 'SF', total_rcv: 750.00 }),
  li({ raw_description: 'Clean with pressure / chemical spray', section_name: 'LEFT ELEVATION', raw_category: 'LEFT ELEVATION', quantity: 400, unit: 'SF', total_rcv: 250.00 }),
  li({ raw_description: 'Seal & paint stucco', section_name: 'LEFT ELEVATION', raw_category: 'LEFT ELEVATION', quantity: 400, unit: 'SF', total_rcv: 600.00 }),
  li({ raw_description: 'Roof vent - turtle type', quantity: 4, unit: 'EA', total_rcv: 120.00 }),
  li({ raw_description: 'Step flashing', quantity: 30, unit: 'LF', total_rcv: 165.58 }),
  li({ raw_description: 'Continuous ridge vent - shingle-over style', quantity: 30, unit: 'LF', total_rcv: 300.00 }),
  li({ raw_description: 'R&R Fascia - 1" x 6" - #1 pine', quantity: 24, unit: 'LF', total_rcv: 600.00 }),
  li({ raw_description: 'General laborer - per hour', quantity: 4, unit: 'HR', total_rcv: 200.00 }),
  li({ raw_description: 'Additional charge for roof pitch >= 7/12', quantity: 30.77, unit: 'SQ', total_rcv: 600.00 }),
];

export const gaymonContractorLineItems = [
  // base roof
  li({ raw_description: 'Tear off, haul and dispose of comp. shingles - Laminated', quantity: 30.77, unit: 'SQ', total_rcv: 1830.00 }),
  li({ raw_description: 'Laminated - comp. shingle rfg. - w/out felt', quantity: 30.77, unit: 'SQ', total_rcv: 8199.00 }),
  li({ raw_description: 'Synthetic underlayment', quantity: 30.77, unit: 'SQ', total_rcv: 600.00 }),
  li({ raw_description: 'Drip edge', quantity: 227.95, unit: 'LF', total_rcv: 410.00 }),
  li({ raw_description: 'Asphalt starter - universal starter course', quantity: 227.95, unit: 'LF', total_rcv: 380.00 }),
  li({ raw_description: 'Hip / Ridge cap - composition shingles', quantity: 118, unit: 'LF', total_rcv: 1170.00 }),
  li({ raw_description: 'Flashing - pipe jack', quantity: 3, unit: 'EA', total_rcv: 170.00 }),
  li({ raw_description: 'Valley metal', quantity: 42, unit: 'LF', total_rcv: 360.00 }),
  // Items missing on carrier
  li({ raw_description: 'Water barrier joint taping - Mod. bitumen - 4" seam tape', quantity: 60, unit: 'LF', total_rcv: 420.00 }),
  li({ raw_description: 'Dumpster load - Approx. 20 yards, 4 tons of debris', quantity: 1, unit: 'EA', total_rcv: 750.00 }),
  li({ raw_description: 'R&R Flat roof exhaust vent / cap - gooseneck 8"', quantity: 2, unit: 'EA', total_rcv: 360.00 }),
  li({ raw_description: 'Re-nailing of roof sheathing - complete re-nail', quantity: 30.77, unit: 'SQ', total_rcv: 1500.00 }),
  li({ raw_description: 'Caulking - butyl rubber', quantity: 30, unit: 'LF', total_rcv: 120.00 }),
  li({ raw_description: 'Final cleaning - construction - Residential', quantity: 1, unit: 'EA', total_rcv: 200.00 }),
  li({ raw_description: 'Additional charge for roof pitch >= 7/12', quantity: 30.77, unit: 'SQ', total_rcv: 700.00 }),
  li({ raw_description: 'Continuous ridge vent - shingle-over style', quantity: 30, unit: 'LF', total_rcv: 330.00 }),
  li({ raw_description: 'Roof vent - turtle type', quantity: 4, unit: 'EA', total_rcv: 140.00 }),
  li({ raw_description: 'Step flashing', quantity: 30, unit: 'LF', total_rcv: 195.00 }),
  li({ raw_description: 'R&R Fascia - 1" x 6" - #1 pine', quantity: 24, unit: 'LF', total_rcv: 1300.00 }),
  li({ raw_description: 'R&R Soffit - metal', section_name: 'FRONT ELEVATION', raw_category: 'FRONT ELEVATION', quantity: 12, unit: 'LF', total_rcv: 1800.00 }),
  li({ raw_description: 'Roofing felt - 15 lb.', quantity: 30.77, unit: 'SQ', total_rcv: 477.21 }),
  // Tarp / temporary
  li({ raw_description: 'Tarp - all-purpose poly - per sq ft (lab/mat) - after hrs', quantity: 800, unit: 'SF', total_rcv: 1704.60 }),
  // Gutters by elevation
  li({ raw_description: 'R&R Gutter / downspout - aluminum - 6"', section_name: 'FRONT', raw_category: 'FRONT', quantity: 30, unit: 'LF', total_rcv: 480.00 }),
  li({ raw_description: 'R&R Gutter / downspout - aluminum - 6"', section_name: 'LEFT', raw_category: 'LEFT', quantity: 30, unit: 'LF', total_rcv: 480.00 }),
  li({ raw_description: 'R&R Gutter / downspout - aluminum - 6"', section_name: 'REAR', raw_category: 'REAR', quantity: 30, unit: 'LF', total_rcv: 480.00 }),
  li({ raw_description: 'R&R Gutter / downspout - aluminum - 6"', section_name: 'RIGHT', raw_category: 'RIGHT', quantity: 30, unit: 'LF', total_rcv: 480.00 }),
  // Exterior elevations with patch (extra vs carrier)
  li({ raw_description: 'Clean with pressure / chemical spray', section_name: 'RIGHT ELEVATION', raw_category: 'RIGHT ELEVATION', quantity: 400, unit: 'SF', total_rcv: 270.00 }),
  li({ raw_description: 'Seal & paint stucco', section_name: 'RIGHT ELEVATION', raw_category: 'RIGHT ELEVATION', quantity: 400, unit: 'SF', total_rcv: 650.00 }),
  li({ raw_description: 'Stucco patch / small repair - ready for color', section_name: 'RIGHT ELEVATION', raw_category: 'RIGHT ELEVATION', quantity: 4, unit: 'EA', total_rcv: 480.00 }),
  li({ raw_description: 'Clean with pressure / chemical spray', section_name: 'BACK ELEVATION', raw_category: 'BACK ELEVATION', quantity: 500, unit: 'SF', total_rcv: 340.00 }),
  li({ raw_description: 'Seal & paint stucco', section_name: 'BACK ELEVATION', raw_category: 'BACK ELEVATION', quantity: 500, unit: 'SF', total_rcv: 810.00 }),
  li({ raw_description: 'Clean with pressure / chemical spray', section_name: 'LEFT ELEVATION', raw_category: 'LEFT ELEVATION', quantity: 400, unit: 'SF', total_rcv: 270.00 }),
  li({ raw_description: 'Seal & paint stucco', section_name: 'LEFT ELEVATION', raw_category: 'LEFT ELEVATION', quantity: 400, unit: 'SF', total_rcv: 650.00 }),
  li({ raw_description: 'Clean with pressure / chemical spray', section_name: 'FRONT ELEVATION', raw_category: 'FRONT ELEVATION', quantity: 400, unit: 'SF', total_rcv: 270.00 }),
  li({ raw_description: 'Seal & paint stucco', section_name: 'FRONT ELEVATION', raw_category: 'FRONT ELEVATION', quantity: 400, unit: 'SF', total_rcv: 642.06 }),
];
