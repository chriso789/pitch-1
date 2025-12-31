/**
 * Brand-Specific Template Seeder
 * Seeds 8 brand templates for a tenant with full material/labor components
 */

import { supabase } from '@/integrations/supabase/client';

export interface BrandTemplate {
  name: string;
  description: string;
  brand: string;
  productLine: string;
  roofType: 'shingle' | 'metal' | 'stone_coated';
  materials: TemplateItem[];
  labor: TemplateItem[];
}

export interface TemplateItem {
  item_name: string;
  description: string;
  unit: string;
  unit_cost: number;
  qty_formula: string;
  sku_pattern: string;
  manufacturer: string;
  measurement_type?: string;
}

export const BRAND_TEMPLATES: BrandTemplate[] = [
  // 1. GAF Timberline HDZ
  {
    name: 'GAF Timberline HDZ',
    description: 'Premium architectural shingle system with GAF accessories.',
    brand: 'GAF',
    productLine: 'Timberline HDZ',
    roofType: 'shingle',
    materials: [
      { item_name: 'GAF Timberline HDZ Shingles', description: 'Premium architectural shingles', unit: 'bundle', unit_cost: 42.50, qty_formula: '{{ ceil(waste.10pct.squares * 3) }}', sku_pattern: 'GAF-THDZ-*', manufacturer: 'GAF', measurement_type: 'roof_squares' },
      { item_name: 'GAF Pro-Start Starter Strip', description: 'Starter strip shingles', unit: 'bundle', unit_cost: 35.00, qty_formula: '{{ ceil((lf.eave + lf.rake) / 120) }}', sku_pattern: 'GAF-PROST', manufacturer: 'GAF', measurement_type: 'linear_eave' },
      { item_name: 'GAF Seal-A-Ridge Ridge Cap', description: 'Hip and ridge cap shingles', unit: 'bundle', unit_cost: 52.00, qty_formula: '{{ ceil((lf.ridge + lf.hip) / 33) }}', sku_pattern: 'GAF-SAR-*', manufacturer: 'GAF', measurement_type: 'linear_ridge' },
      { item_name: 'GAF Cobra Ridge Vent', description: '4ft ridge vent sections', unit: 'piece', unit_cost: 18.00, qty_formula: '{{ ceil(lf.ridge / 4) }}', sku_pattern: 'GAF-COBRA', manufacturer: 'GAF', measurement_type: 'linear_ridge' },
      { item_name: 'GAF FeltBuster Underlayment', description: 'Synthetic underlayment 10sq roll', unit: 'roll', unit_cost: 85.00, qty_formula: '{{ ceil(waste.10pct.squares / 10) }}', sku_pattern: 'GAF-FB10', manufacturer: 'GAF', measurement_type: 'roof_squares' },
      { item_name: 'GAF StormGuard Ice & Water', description: 'Ice and water shield 200sqft roll', unit: 'roll', unit_cost: 125.00, qty_formula: '{{ ceil((lf.eave * 6 + lf.valley * 6) / 200) }}', sku_pattern: 'GAF-STORM', manufacturer: 'GAF', measurement_type: 'linear_valley' },
      { item_name: 'Drip Edge - Eave', description: '10ft galvanized drip edge', unit: 'piece', unit_cost: 8.50, qty_formula: '{{ ceil(lf.eave / 10) }}', sku_pattern: 'DRP-EAVE', manufacturer: 'Generic', measurement_type: 'linear_eave' },
      { item_name: 'Drip Edge - Rake', description: '10ft galvanized drip edge', unit: 'piece', unit_cost: 9.00, qty_formula: '{{ ceil(lf.rake / 10) }}', sku_pattern: 'DRP-RAKE', manufacturer: 'Generic', measurement_type: 'linear_rake' },
      { item_name: 'Valley Metal W-Style', description: '10ft w-style valley metal', unit: 'piece', unit_cost: 22.00, qty_formula: '{{ ceil(lf.valley / 10) }}', sku_pattern: 'VLY-W', manufacturer: 'Generic', measurement_type: 'linear_valley' },
      { item_name: 'Step Flashing 4x4', description: '4x4 step flashing pieces', unit: 'piece', unit_cost: 1.25, qty_formula: '{{ ceil(lf.step / 2) }}', sku_pattern: 'STEP-4X4', manufacturer: 'Generic', measurement_type: 'linear_step' },
      { item_name: 'Pipe Boot 1-3"', description: 'Small pipe boot flashing', unit: 'each', unit_cost: 12.00, qty_formula: '{{ pen.pipe_vent }}', sku_pattern: 'BOOT-SM', manufacturer: 'Generic', measurement_type: 'penetrations' },
      { item_name: 'Coil Nails 1-1/4"', description: 'Roofing coil nails box', unit: 'box', unit_cost: 48.00, qty_formula: '{{ ceil(roof.squares / 4) }}', sku_pattern: 'NAIL-COIL', manufacturer: 'Generic', measurement_type: 'roof_squares' },
      { item_name: 'Roofing Cement', description: 'Roof sealant tube', unit: 'tube', unit_cost: 8.00, qty_formula: '{{ ceil(roof.squares / 15) }}', sku_pattern: 'CEMENT', manufacturer: 'Generic', measurement_type: 'roof_squares' },
      { item_name: 'OSB 7/16 Sheets', description: 'Decking repair sheets', unit: 'sheet', unit_cost: 32.00, qty_formula: '{{ ceil(roof.total_sqft * 0.03 / 32) }}', sku_pattern: 'OSB-716', manufacturer: 'Generic', measurement_type: 'roof_area' },
    ],
    labor: [
      { item_name: 'Tear Off', description: 'Remove existing roofing', unit: 'sq', unit_cost: 45.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-TEAR', manufacturer: '' },
      { item_name: 'Underlayment Install', description: 'Install synthetic underlayment', unit: 'sq', unit_cost: 15.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-UL', manufacturer: '' },
      { item_name: 'Shingle Install', description: 'Install architectural shingles', unit: 'sq', unit_cost: 85.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-SHING', manufacturer: '' },
      { item_name: 'Ridge/Hip Work', description: 'Install ridge and hip cap', unit: 'lf', unit_cost: 3.50, qty_formula: '{{ lf.ridge + lf.hip }}', sku_pattern: 'LABOR-RIDGE', manufacturer: '' },
      { item_name: 'Flashing/Details', description: 'Install step flashing and details', unit: 'lf', unit_cost: 4.00, qty_formula: '{{ lf.step + lf.valley }}', sku_pattern: 'LABOR-FLASH', manufacturer: '' },
      { item_name: 'Cleanup/Haul', description: 'Debris removal and dump runs', unit: 'job', unit_cost: 350.00, qty_formula: '1', sku_pattern: 'LABOR-CLEAN', manufacturer: '' },
    ],
  },
  // 2. Owens Corning Duration
  {
    name: 'Owens Corning Duration',
    description: 'SureNail Technology shingle system with OC accessories.',
    brand: 'Owens Corning',
    productLine: 'Duration',
    roofType: 'shingle',
    materials: [
      { item_name: 'OC Duration Shingles', description: 'SureNail Technology shingles', unit: 'bundle', unit_cost: 44.00, qty_formula: '{{ ceil(waste.10pct.squares * 3) }}', sku_pattern: 'OC-DUR-*', manufacturer: 'Owens Corning', measurement_type: 'roof_squares' },
      { item_name: 'OC Starter Shingle Roll', description: 'Starter strip roll', unit: 'roll', unit_cost: 36.00, qty_formula: '{{ ceil((lf.eave + lf.rake) / 65) }}', sku_pattern: 'OC-STRT', manufacturer: 'Owens Corning', measurement_type: 'linear_eave' },
      { item_name: 'OC DecoRidge Ridge Cap', description: 'Hip and ridge cap', unit: 'bundle', unit_cost: 55.00, qty_formula: '{{ ceil((lf.ridge + lf.hip) / 33) }}', sku_pattern: 'OC-DECO-*', manufacturer: 'Owens Corning', measurement_type: 'linear_ridge' },
      { item_name: 'OC Deck Defense Underlayment', description: 'Synthetic underlayment 10sq roll', unit: 'roll', unit_cost: 95.00, qty_formula: '{{ ceil(waste.10pct.squares / 10) }}', sku_pattern: 'OC-DECK', manufacturer: 'Owens Corning', measurement_type: 'roof_squares' },
      { item_name: 'OC WeatherLock Ice & Water', description: 'Ice and water shield 200sqft roll', unit: 'roll', unit_cost: 130.00, qty_formula: '{{ ceil((lf.eave * 6 + lf.valley * 6) / 200) }}', sku_pattern: 'OC-WLOCK', manufacturer: 'Owens Corning', measurement_type: 'linear_valley' },
      { item_name: 'Drip Edge - Eave', description: '10ft galvanized drip edge', unit: 'piece', unit_cost: 8.50, qty_formula: '{{ ceil(lf.eave / 10) }}', sku_pattern: 'DRP-EAVE', manufacturer: 'Generic', measurement_type: 'linear_eave' },
      { item_name: 'Drip Edge - Rake', description: '10ft galvanized drip edge', unit: 'piece', unit_cost: 9.00, qty_formula: '{{ ceil(lf.rake / 10) }}', sku_pattern: 'DRP-RAKE', manufacturer: 'Generic', measurement_type: 'linear_rake' },
      { item_name: 'Valley Metal W-Style', description: '10ft w-style valley metal', unit: 'piece', unit_cost: 22.00, qty_formula: '{{ ceil(lf.valley / 10) }}', sku_pattern: 'VLY-W', manufacturer: 'Generic', measurement_type: 'linear_valley' },
      { item_name: 'Pipe Boot 1-3"', description: 'Small pipe boot flashing', unit: 'each', unit_cost: 12.00, qty_formula: '{{ pen.pipe_vent }}', sku_pattern: 'BOOT-SM', manufacturer: 'Generic', measurement_type: 'penetrations' },
      { item_name: 'Coil Nails 1-1/4"', description: 'Roofing coil nails box', unit: 'box', unit_cost: 48.00, qty_formula: '{{ ceil(roof.squares / 4) }}', sku_pattern: 'NAIL-COIL', manufacturer: 'Generic', measurement_type: 'roof_squares' },
    ],
    labor: [
      { item_name: 'Tear Off', description: 'Remove existing roofing', unit: 'sq', unit_cost: 45.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-TEAR', manufacturer: '' },
      { item_name: 'Shingle Install', description: 'Install architectural shingles', unit: 'sq', unit_cost: 85.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-SHING', manufacturer: '' },
      { item_name: 'Ridge/Hip Work', description: 'Install ridge and hip cap', unit: 'lf', unit_cost: 3.50, qty_formula: '{{ lf.ridge + lf.hip }}', sku_pattern: 'LABOR-RIDGE', manufacturer: '' },
      { item_name: 'Cleanup/Haul', description: 'Debris removal', unit: 'job', unit_cost: 350.00, qty_formula: '1', sku_pattern: 'LABOR-CLEAN', manufacturer: '' },
    ],
  },
  // 3. Owens Corning Oakridge
  {
    name: 'Owens Corning Oakridge',
    description: 'Affordable architectural shingle system with OC accessories.',
    brand: 'Owens Corning',
    productLine: 'Oakridge',
    roofType: 'shingle',
    materials: [
      { item_name: 'OC Oakridge Shingles', description: 'Affordable architectural shingles', unit: 'bundle', unit_cost: 38.00, qty_formula: '{{ ceil(waste.10pct.squares * 3) }}', sku_pattern: 'OC-OAK-*', manufacturer: 'Owens Corning', measurement_type: 'roof_squares' },
      { item_name: 'OC Starter Shingle Roll', description: 'Starter strip roll', unit: 'roll', unit_cost: 36.00, qty_formula: '{{ ceil((lf.eave + lf.rake) / 65) }}', sku_pattern: 'OC-STRT', manufacturer: 'Owens Corning', measurement_type: 'linear_eave' },
      { item_name: 'OC DecoRidge Ridge Cap', description: 'Hip and ridge cap', unit: 'bundle', unit_cost: 55.00, qty_formula: '{{ ceil((lf.ridge + lf.hip) / 33) }}', sku_pattern: 'OC-DECO-*', manufacturer: 'Owens Corning', measurement_type: 'linear_ridge' },
      { item_name: 'OC ProArmor Underlayment', description: 'Synthetic underlayment 10sq roll', unit: 'roll', unit_cost: 75.00, qty_formula: '{{ ceil(waste.10pct.squares / 10) }}', sku_pattern: 'OC-PROARM', manufacturer: 'Owens Corning', measurement_type: 'roof_squares' },
      { item_name: 'Drip Edge - Eave', description: '10ft galvanized drip edge', unit: 'piece', unit_cost: 8.50, qty_formula: '{{ ceil(lf.eave / 10) }}', sku_pattern: 'DRP-EAVE', manufacturer: 'Generic', measurement_type: 'linear_eave' },
      { item_name: 'Drip Edge - Rake', description: '10ft galvanized drip edge', unit: 'piece', unit_cost: 9.00, qty_formula: '{{ ceil(lf.rake / 10) }}', sku_pattern: 'DRP-RAKE', manufacturer: 'Generic', measurement_type: 'linear_rake' },
      { item_name: 'Pipe Boot 1-3"', description: 'Small pipe boot flashing', unit: 'each', unit_cost: 12.00, qty_formula: '{{ pen.pipe_vent }}', sku_pattern: 'BOOT-SM', manufacturer: 'Generic', measurement_type: 'penetrations' },
      { item_name: 'Coil Nails 1-1/4"', description: 'Roofing coil nails box', unit: 'box', unit_cost: 48.00, qty_formula: '{{ ceil(roof.squares / 4) }}', sku_pattern: 'NAIL-COIL', manufacturer: 'Generic', measurement_type: 'roof_squares' },
    ],
    labor: [
      { item_name: 'Tear Off', description: 'Remove existing roofing', unit: 'sq', unit_cost: 45.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-TEAR', manufacturer: '' },
      { item_name: 'Shingle Install', description: 'Install architectural shingles', unit: 'sq', unit_cost: 80.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-SHING', manufacturer: '' },
      { item_name: 'Cleanup/Haul', description: 'Debris removal', unit: 'job', unit_cost: 300.00, qty_formula: '1', sku_pattern: 'LABOR-CLEAN', manufacturer: '' },
    ],
  },
  // 4. CertainTeed Landmark
  {
    name: 'CertainTeed Landmark',
    description: 'Max Def color technology shingle system with CT accessories.',
    brand: 'CertainTeed',
    productLine: 'Landmark',
    roofType: 'shingle',
    materials: [
      { item_name: 'CT Landmark Shingles', description: 'Max Def color technology shingles', unit: 'bundle', unit_cost: 40.00, qty_formula: '{{ ceil(waste.10pct.squares * 3) }}', sku_pattern: 'CT-LM-*', manufacturer: 'CertainTeed', measurement_type: 'roof_squares' },
      { item_name: 'CT SwiftStart Starter', description: 'Starter strip shingles', unit: 'bundle', unit_cost: 34.00, qty_formula: '{{ ceil((lf.eave + lf.rake) / 120) }}', sku_pattern: 'CT-SWFT', manufacturer: 'CertainTeed', measurement_type: 'linear_eave' },
      { item_name: 'CT Shadow Ridge Cap', description: 'Hip and ridge cap', unit: 'bundle', unit_cost: 50.00, qty_formula: '{{ ceil((lf.ridge + lf.hip) / 33) }}', sku_pattern: 'CT-SHAD-*', manufacturer: 'CertainTeed', measurement_type: 'linear_ridge' },
      { item_name: 'CT DiamondDeck Underlayment', description: 'Synthetic underlayment 10sq roll', unit: 'roll', unit_cost: 90.00, qty_formula: '{{ ceil(waste.10pct.squares / 10) }}', sku_pattern: 'CT-DIAM', manufacturer: 'CertainTeed', measurement_type: 'roof_squares' },
      { item_name: 'CT WinterGuard Ice & Water', description: 'Ice and water shield 200sqft roll', unit: 'roll', unit_cost: 120.00, qty_formula: '{{ ceil((lf.eave * 6 + lf.valley * 6) / 200) }}', sku_pattern: 'CT-WGRD', manufacturer: 'CertainTeed', measurement_type: 'linear_valley' },
      { item_name: 'Drip Edge - Eave', description: '10ft galvanized drip edge', unit: 'piece', unit_cost: 8.50, qty_formula: '{{ ceil(lf.eave / 10) }}', sku_pattern: 'DRP-EAVE', manufacturer: 'Generic', measurement_type: 'linear_eave' },
      { item_name: 'Drip Edge - Rake', description: '10ft galvanized drip edge', unit: 'piece', unit_cost: 9.00, qty_formula: '{{ ceil(lf.rake / 10) }}', sku_pattern: 'DRP-RAKE', manufacturer: 'Generic', measurement_type: 'linear_rake' },
      { item_name: 'Valley Metal W-Style', description: '10ft w-style valley metal', unit: 'piece', unit_cost: 22.00, qty_formula: '{{ ceil(lf.valley / 10) }}', sku_pattern: 'VLY-W', manufacturer: 'Generic', measurement_type: 'linear_valley' },
      { item_name: 'Pipe Boot 1-3"', description: 'Small pipe boot flashing', unit: 'each', unit_cost: 12.00, qty_formula: '{{ pen.pipe_vent }}', sku_pattern: 'BOOT-SM', manufacturer: 'Generic', measurement_type: 'penetrations' },
      { item_name: 'Coil Nails 1-1/4"', description: 'Roofing coil nails box', unit: 'box', unit_cost: 48.00, qty_formula: '{{ ceil(roof.squares / 4) }}', sku_pattern: 'NAIL-COIL', manufacturer: 'Generic', measurement_type: 'roof_squares' },
    ],
    labor: [
      { item_name: 'Tear Off', description: 'Remove existing roofing', unit: 'sq', unit_cost: 45.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-TEAR', manufacturer: '' },
      { item_name: 'Shingle Install', description: 'Install architectural shingles', unit: 'sq', unit_cost: 82.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-SHING', manufacturer: '' },
      { item_name: 'Ridge/Hip Work', description: 'Install ridge and hip cap', unit: 'lf', unit_cost: 3.50, qty_formula: '{{ lf.ridge + lf.hip }}', sku_pattern: 'LABOR-RIDGE', manufacturer: '' },
      { item_name: 'Cleanup/Haul', description: 'Debris removal', unit: 'job', unit_cost: 325.00, qty_formula: '1', sku_pattern: 'LABOR-CLEAN', manufacturer: '' },
    ],
  },
  // 5. 5V Painted Metal with Polyglass XFR
  {
    name: '5V Painted Metal with Polyglass XFR',
    description: '26-gauge painted 5V metal panels with Polyglass XFR underlayment.',
    brand: '5V Metal',
    productLine: 'Painted 26ga',
    roofType: 'metal',
    materials: [
      { item_name: '5V Metal Panels 26ga Painted', description: '26-gauge painted 5V crimp panels', unit: 'panel', unit_cost: 38.00, qty_formula: '{{ ceil(waste.12pct.sqft / 20) }}', sku_pattern: '5V-26-*', manufacturer: '5V Metal', measurement_type: 'roof_area' },
      { item_name: 'Polyglass XFR Underlayment', description: 'High-temp synthetic underlayment 4sq roll', unit: 'roll', unit_cost: 125.00, qty_formula: '{{ ceil(roof.squares / 4) }}', sku_pattern: 'POLY-XFR', manufacturer: 'Polyglass', measurement_type: 'roof_squares' },
      { item_name: 'Metal Ridge Cap', description: '10ft metal ridge cap', unit: 'piece', unit_cost: 28.00, qty_formula: '{{ ceil(lf.ridge / 10) }}', sku_pattern: 'MR-RIDGE', manufacturer: 'Generic', measurement_type: 'linear_ridge' },
      { item_name: 'Metal Hip Cap', description: '10ft metal hip cap', unit: 'piece', unit_cost: 28.00, qty_formula: '{{ ceil(lf.hip / 10) }}', sku_pattern: 'MR-HIP', manufacturer: 'Generic', measurement_type: 'linear_hip' },
      { item_name: 'Eave Closure Strip', description: '3ft foam closure strip', unit: 'piece', unit_cost: 4.50, qty_formula: '{{ ceil(lf.eave / 3) }}', sku_pattern: 'CLS-EAVE-5V', manufacturer: 'Generic', measurement_type: 'linear_eave' },
      { item_name: 'Ridge Closure Strip', description: '3ft foam closure strip', unit: 'piece', unit_cost: 4.50, qty_formula: '{{ ceil(lf.ridge / 3) }}', sku_pattern: 'CLS-RDG-5V', manufacturer: 'Generic', measurement_type: 'linear_ridge' },
      { item_name: 'Metal Rake Trim', description: '10ft metal rake trim', unit: 'piece', unit_cost: 18.00, qty_formula: '{{ ceil(lf.rake / 10) }}', sku_pattern: 'MR-RAKE', manufacturer: 'Generic', measurement_type: 'linear_rake' },
      { item_name: 'Pancake Screws #10 x 1"', description: 'Metal roofing screws box', unit: 'box', unit_cost: 45.00, qty_formula: '{{ ceil(roof.squares * 80 / 250) }}', sku_pattern: 'SCR-PAN-10', manufacturer: 'Generic', measurement_type: 'roof_squares' },
      { item_name: 'Butyl Tape 1"', description: 'Sealing tape roll', unit: 'roll', unit_cost: 18.00, qty_formula: '{{ ceil(roof.squares / 5) }}', sku_pattern: 'BTL-TAPE', manufacturer: 'Generic', measurement_type: 'roof_squares' },
      { item_name: 'Metal Pipe Boot', description: 'Metal roof pipe flashing', unit: 'each', unit_cost: 35.00, qty_formula: '{{ pen.pipe_vent }}', sku_pattern: 'BOOT-MTL', manufacturer: 'Generic', measurement_type: 'penetrations' },
    ],
    labor: [
      { item_name: 'Tear Off', description: 'Remove existing roofing', unit: 'sq', unit_cost: 55.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-TEAR', manufacturer: '' },
      { item_name: 'Deck Prep', description: 'Prepare deck for metal', unit: 'sq', unit_cost: 20.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-PREP', manufacturer: '' },
      { item_name: 'Panel Install', description: 'Install 5V metal panels', unit: 'sq', unit_cost: 120.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-MTL', manufacturer: '' },
      { item_name: 'Trim Install', description: 'Install all metal trim', unit: 'lf', unit_cost: 4.00, qty_formula: '{{ lf.eave + lf.rake + lf.ridge + lf.hip }}', sku_pattern: 'LABOR-TRIM', manufacturer: '' },
    ],
  },
  // 6. Standing Seam 1" SnapLok with Polyglass XFR
  {
    name: 'Standing Seam 1" SnapLok with Polyglass XFR',
    description: '24-gauge standing seam SnapLok panels with Polyglass XFR underlayment.',
    brand: 'Standing Seam',
    productLine: '1" SnapLok',
    roofType: 'metal',
    materials: [
      { item_name: '1" SnapLok Panels 24ga', description: '24-gauge standing seam panels', unit: 'panel', unit_cost: 85.00, qty_formula: '{{ ceil(waste.12pct.sqft / 16) }}', sku_pattern: 'SNAP-1-24-*', manufacturer: 'Standing Seam', measurement_type: 'roof_area' },
      { item_name: 'Polyglass XFR Underlayment', description: 'High-temp synthetic underlayment 4sq roll', unit: 'roll', unit_cost: 125.00, qty_formula: '{{ ceil(roof.squares / 4) }}', sku_pattern: 'POLY-XFR', manufacturer: 'Polyglass', measurement_type: 'roof_squares' },
      { item_name: 'SnapLok Ridge Cap', description: '10.5ft ridge cap', unit: 'piece', unit_cost: 65.00, qty_formula: '{{ ceil(lf.ridge / 10.5) }}', sku_pattern: 'SNAP-RIDGE', manufacturer: 'Standing Seam', measurement_type: 'linear_ridge' },
      { item_name: 'SnapLok Hip Cap', description: '10.5ft hip cap', unit: 'piece', unit_cost: 65.00, qty_formula: '{{ ceil(lf.hip / 10.5) }}', sku_pattern: 'SNAP-HIP', manufacturer: 'Standing Seam', measurement_type: 'linear_hip' },
      { item_name: 'SnapLok Eave Trim', description: '10.5ft eave trim', unit: 'piece', unit_cost: 42.00, qty_formula: '{{ ceil(lf.eave / 10.5) }}', sku_pattern: 'SNAP-EAVE', manufacturer: 'Standing Seam', measurement_type: 'linear_eave' },
      { item_name: 'SnapLok Rake Trim', description: '10.5ft rake trim', unit: 'piece', unit_cost: 42.00, qty_formula: '{{ ceil(lf.rake / 10.5) }}', sku_pattern: 'SNAP-RAKE', manufacturer: 'Standing Seam', measurement_type: 'linear_rake' },
      { item_name: 'Pancake Screws #12 x 1.5"', description: 'Metal roofing screws box', unit: 'box', unit_cost: 55.00, qty_formula: '{{ ceil(roof.squares * 70 / 250) }}', sku_pattern: 'SCR-PAN-12', manufacturer: 'Generic', measurement_type: 'roof_squares' },
      { item_name: 'SS Pipe Boot', description: 'Standing seam pipe flashing', unit: 'each', unit_cost: 55.00, qty_formula: '{{ pen.pipe_vent }}', sku_pattern: 'BOOT-SS', manufacturer: 'Generic', measurement_type: 'penetrations' },
    ],
    labor: [
      { item_name: 'Tear Off', description: 'Remove existing roofing', unit: 'sq', unit_cost: 60.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-TEAR', manufacturer: '' },
      { item_name: 'Deck Prep', description: 'Prepare deck for metal', unit: 'sq', unit_cost: 25.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-PREP', manufacturer: '' },
      { item_name: 'Standing Seam Install', description: 'Install standing seam panels', unit: 'sq', unit_cost: 175.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-SS', manufacturer: '' },
      { item_name: 'Trim Install', description: 'Install all metal trim', unit: 'lf', unit_cost: 5.50, qty_formula: '{{ lf.eave + lf.rake + lf.ridge + lf.hip }}', sku_pattern: 'LABOR-TRIM', manufacturer: '' },
    ],
  },
  // 7. Worthouse Dura Profile
  {
    name: 'Worthouse Dura Profile',
    description: 'Stone coated steel tile-profile panels.',
    brand: 'Worthouse',
    productLine: 'Dura Profile',
    roofType: 'stone_coated',
    materials: [
      { item_name: 'Worthouse Dura Profile Panels', description: 'Stone coated steel panels', unit: 'panel', unit_cost: 48.75, qty_formula: '{{ ceil(waste.10pct.sqft / 5.6) }}', sku_pattern: 'WH-DURA-*', manufacturer: 'Worthouse', measurement_type: 'roof_area' },
      { item_name: 'Synthetic Underlayment', description: 'Synthetic underlayment 10sq roll', unit: 'roll', unit_cost: 75.00, qty_formula: '{{ ceil(roof.squares / 10) }}', sku_pattern: 'SYNTH-UL', manufacturer: 'Generic', measurement_type: 'roof_squares' },
      { item_name: 'Dura Ridge Cap', description: 'Stone coated ridge cap', unit: 'piece', unit_cost: 28.00, qty_formula: '{{ ceil(lf.ridge / 3.5) }}', sku_pattern: 'WH-DURA-RDG', manufacturer: 'Worthouse', measurement_type: 'linear_ridge' },
      { item_name: 'Dura Hip Cap', description: 'Stone coated hip cap', unit: 'piece', unit_cost: 28.00, qty_formula: '{{ ceil(lf.hip / 3.5) }}', sku_pattern: 'WH-DURA-HIP', manufacturer: 'Worthouse', measurement_type: 'linear_hip' },
      { item_name: 'Dura Starter Panel', description: 'Starter panel', unit: 'piece', unit_cost: 18.00, qty_formula: '{{ ceil(lf.eave / 4) }}', sku_pattern: 'WH-DURA-STR', manufacturer: 'Worthouse', measurement_type: 'linear_eave' },
      { item_name: 'Dura Rake Trim', description: 'Rake trim', unit: 'piece', unit_cost: 22.00, qty_formula: '{{ ceil(lf.rake / 4) }}', sku_pattern: 'WH-DURA-RK', manufacturer: 'Worthouse', measurement_type: 'linear_rake' },
      { item_name: 'Stone Coated Nails', description: 'Color-match nails box', unit: 'box', unit_cost: 55.00, qty_formula: '{{ ceil(roof.squares * 80 / 250) }}', sku_pattern: 'NAIL-WH-*', manufacturer: 'Worthouse', measurement_type: 'roof_squares' },
      { item_name: 'Touch-Up Stone Chips', description: 'Stone chip touch-up bag', unit: 'bag', unit_cost: 25.00, qty_formula: '{{ max(1, ceil(roof.squares / 40)) }}', sku_pattern: 'WH-CHIP-*', manufacturer: 'Worthouse', measurement_type: 'roof_squares' },
      { item_name: 'Stone Coated Pipe Boot', description: 'Stone coated pipe flashing', unit: 'each', unit_cost: 45.00, qty_formula: '{{ pen.pipe_vent }}', sku_pattern: 'BOOT-SC', manufacturer: 'Worthouse', measurement_type: 'penetrations' },
    ],
    labor: [
      { item_name: 'Tear Off', description: 'Remove existing roofing', unit: 'sq', unit_cost: 55.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-TEAR', manufacturer: '' },
      { item_name: 'Deck Prep', description: 'Prepare deck', unit: 'sq', unit_cost: 18.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-PREP', manufacturer: '' },
      { item_name: 'Stone Coated Install', description: 'Install stone coated panels', unit: 'sq', unit_cost: 145.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-SC', manufacturer: '' },
      { item_name: 'Trim Install', description: 'Install all trim', unit: 'lf', unit_cost: 4.50, qty_formula: '{{ lf.eave + lf.rake + lf.ridge + lf.hip }}', sku_pattern: 'LABOR-TRIM', manufacturer: '' },
    ],
  },
  // 8. Worthouse Supre Profile
  {
    name: 'Worthouse Supre Profile',
    description: 'Premium stone coated steel shake-profile panels.',
    brand: 'Worthouse',
    productLine: 'Supre Profile',
    roofType: 'stone_coated',
    materials: [
      { item_name: 'Worthouse Supre Profile Panels', description: 'Premium stone coated steel panels', unit: 'panel', unit_cost: 55.00, qty_formula: '{{ ceil(waste.10pct.sqft / 5.2) }}', sku_pattern: 'WH-SUPRE-*', manufacturer: 'Worthouse', measurement_type: 'roof_area' },
      { item_name: 'Synthetic Underlayment', description: 'Synthetic underlayment 10sq roll', unit: 'roll', unit_cost: 75.00, qty_formula: '{{ ceil(roof.squares / 10) }}', sku_pattern: 'SYNTH-UL', manufacturer: 'Generic', measurement_type: 'roof_squares' },
      { item_name: 'Supre Ridge Cap', description: 'Stone coated ridge cap', unit: 'piece', unit_cost: 32.00, qty_formula: '{{ ceil(lf.ridge / 3.5) }}', sku_pattern: 'WH-SUPRE-RDG', manufacturer: 'Worthouse', measurement_type: 'linear_ridge' },
      { item_name: 'Supre Hip Cap', description: 'Stone coated hip cap', unit: 'piece', unit_cost: 32.00, qty_formula: '{{ ceil(lf.hip / 3.5) }}', sku_pattern: 'WH-SUPRE-HIP', manufacturer: 'Worthouse', measurement_type: 'linear_hip' },
      { item_name: 'Supre Starter Panel', description: 'Starter panel', unit: 'piece', unit_cost: 20.00, qty_formula: '{{ ceil(lf.eave / 4) }}', sku_pattern: 'WH-SUPRE-STR', manufacturer: 'Worthouse', measurement_type: 'linear_eave' },
      { item_name: 'Supre Rake Trim', description: 'Rake trim', unit: 'piece', unit_cost: 25.00, qty_formula: '{{ ceil(lf.rake / 4) }}', sku_pattern: 'WH-SUPRE-RK', manufacturer: 'Worthouse', measurement_type: 'linear_rake' },
      { item_name: 'Stone Coated Nails', description: 'Color-match nails box', unit: 'box', unit_cost: 55.00, qty_formula: '{{ ceil(roof.squares * 80 / 250) }}', sku_pattern: 'NAIL-WH-*', manufacturer: 'Worthouse', measurement_type: 'roof_squares' },
      { item_name: 'Touch-Up Stone Chips', description: 'Stone chip touch-up bag', unit: 'bag', unit_cost: 28.00, qty_formula: '{{ max(1, ceil(roof.squares / 40)) }}', sku_pattern: 'WH-CHIP-*', manufacturer: 'Worthouse', measurement_type: 'roof_squares' },
      { item_name: 'Stone Coated Pipe Boot', description: 'Stone coated pipe flashing', unit: 'each', unit_cost: 48.00, qty_formula: '{{ pen.pipe_vent }}', sku_pattern: 'BOOT-SC', manufacturer: 'Worthouse', measurement_type: 'penetrations' },
    ],
    labor: [
      { item_name: 'Tear Off', description: 'Remove existing roofing', unit: 'sq', unit_cost: 55.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-TEAR', manufacturer: '' },
      { item_name: 'Deck Prep', description: 'Prepare deck', unit: 'sq', unit_cost: 18.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-PREP', manufacturer: '' },
      { item_name: 'Stone Coated Install', description: 'Install stone coated panels', unit: 'sq', unit_cost: 155.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-SC', manufacturer: '' },
      { item_name: 'Trim Install', description: 'Install all trim', unit: 'lf', unit_cost: 4.50, qty_formula: '{{ lf.eave + lf.rake + lf.ridge + lf.hip }}', sku_pattern: 'LABOR-TRIM', manufacturer: '' },
    ],
  },
];

// Helper function to add items to an existing template
async function addTemplateItems(templateId: string, tenantId: string, templateDef: BrandTemplate) {
  // Create Materials group
  const { data: materialsGroup, error: matGroupError } = await supabase
    .from('estimate_template_groups')
    .insert({
      template_id: templateId,
      tenant_id: tenantId,
      name: 'Materials',
      group_type: 'material',
      sort_order: 1,
    })
    .select('id')
    .single();

  if (matGroupError) {
    console.error(`Error creating materials group:`, matGroupError);
    return;
  }

  // Create Labor group
  const { data: laborGroup, error: labGroupError } = await supabase
    .from('estimate_template_groups')
    .insert({
      template_id: templateId,
      tenant_id: tenantId,
      name: 'Labor',
      group_type: 'labor',
      sort_order: 2,
    })
    .select('id')
    .single();

  if (labGroupError) {
    console.error(`Error creating labor group:`, labGroupError);
    return;
  }

  // Insert material items
  const materialItems = templateDef.materials.map((item, idx) => ({
    template_id: templateId,
    group_id: materialsGroup.id,
    item_name: item.item_name,
    description: item.description,
    unit: item.unit,
    unit_cost: item.unit_cost,
    qty_formula: item.qty_formula,
    sku_pattern: item.sku_pattern,
    manufacturer: item.manufacturer,
    measurement_type: item.measurement_type,
    sort_order: idx + 1,
    item_type: 'material',
  }));

  const { error: matItemsError } = await supabase
    .from('template_items')
    .insert(materialItems);

  if (matItemsError) {
    console.error(`Error creating material items:`, matItemsError);
  }

  // Insert labor items
  const laborItems = templateDef.labor.map((item, idx) => ({
    template_id: templateId,
    group_id: laborGroup.id,
    item_name: item.item_name,
    description: item.description,
    unit: item.unit,
    unit_cost: item.unit_cost,
    qty_formula: item.qty_formula,
    sku_pattern: item.sku_pattern,
    sort_order: idx + 1,
    item_type: 'labor',
  }));

  const { error: labItemsError } = await supabase
    .from('template_items')
    .insert(laborItems);

  if (labItemsError) {
    console.error(`Error creating labor items:`, labItemsError);
  }
}

// Seed brand templates for a tenant
export async function seedBrandTemplates(tenantId: string): Promise<{ success: boolean; templatesCreated: number; error?: string }> {
  try {
    let templatesCreated = 0;

    for (const templateDef of BRAND_TEMPLATES) {
      // Check if template already exists for this tenant in estimate_calculation_templates
      const { data: existing } = await supabase
        .from('estimate_calculation_templates')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('name', templateDef.name)
        .maybeSingle();

      if (existing) {
        // Check if it has items - if not, add them
        const { data: existingItems } = await supabase
          .from('template_items')
          .select('id')
          .eq('template_id', existing.id)
          .limit(1);

        if (existingItems && existingItems.length > 0) {
          console.log(`Template "${templateDef.name}" already has items, skipping`);
          continue;
        }

        // Template exists but has no items - add them
        console.log(`Template "${templateDef.name}" exists but has no items, adding items...`);
        await addTemplateItems(existing.id, tenantId, templateDef);
        templatesCreated++;
        continue;
      }

      // Create the template in estimate_calculation_templates
      const roofTypeMap: Record<string, 'shingle' | 'metal' | 'tile'> = {
        'shingle': 'shingle',
        'metal': 'metal',
        'stone_coated': 'tile',
      };
      const { data: template, error: templateError } = await supabase
        .from('estimate_calculation_templates')
        .insert({
          tenant_id: tenantId,
          name: templateDef.name,
          roof_type: roofTypeMap[templateDef.roofType] || 'shingle',
          is_active: true,
          target_profit_percentage: 30,
        })
        .select('id')
        .single();

      if (templateError) {
        console.error(`Error creating template "${templateDef.name}":`, templateError);
        continue;
      }

      // Add template items
      await addTemplateItems(template.id, tenantId, templateDef);

      templatesCreated++;
      console.log(`Created template: ${templateDef.name}`);
    }

    return { success: true, templatesCreated };
  } catch (error) {
    console.error('Error seeding brand templates:', error);
    return { success: false, templatesCreated: 0, error: String(error) };
  }
}

// Calculate 30% margin selling price (Cost ÷ 0.70)
export function calculateSellingPrice(totalCost: number, marginPercent: number = 30): number {
  return totalCost / (1 - marginPercent / 100);
}

// Price lookup from company pricebook by SKU pattern
export async function lookupPrice(
  tenantId: string,
  skuPattern: string
): Promise<{ found: boolean; unitCost?: number; itemCode?: string }> {
  if (!skuPattern || skuPattern === '') {
    return { found: false };
  }

  const likePattern = skuPattern.replace(/\*/g, '%');

  const { data, error } = await supabase
    .from('supplier_pricebooks')
    .select('item_code, unit_cost')
    .eq('tenant_id', tenantId)
    .ilike('item_code', likePattern)
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return { found: false };
  }

  return {
    found: true,
    unitCost: data.unit_cost,
    itemCode: data.item_code,
  };
}
