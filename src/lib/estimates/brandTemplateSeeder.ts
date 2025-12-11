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
  name: string;
  description: string;
  unit: string;
  unitCost: number;
  qty: string; // Smart tag formula
  skuPattern: string;
  manufacturer: string;
  measurementType?: string;
}

export const BRAND_TEMPLATES: BrandTemplate[] = [
  // 1. GAF Timberline HDZ
  {
    name: 'GAF Timberline HDZ',
    description: 'Premium architectural shingle system with GAF accessories. Auto-calculates quantities from roof measurements.',
    brand: 'GAF',
    productLine: 'Timberline HDZ',
    roofType: 'shingle',
    materials: [
      { name: 'GAF Timberline HDZ Shingles', description: 'Premium architectural shingles', unit: 'bundle', unitCost: 0, qty: '{{ ceil(waste.10pct.squares * 3) }}', skuPattern: 'GAF-THDZ-*', manufacturer: 'GAF', measurementType: 'roof_squares' },
      { name: 'GAF Pro-Start Starter Strip', description: 'Starter strip shingles', unit: 'bundle', unitCost: 0, qty: '{{ ceil((lf.eave + lf.rake) / 120) }}', skuPattern: 'GAF-PROST', manufacturer: 'GAF', measurementType: 'linear_eave' },
      { name: 'GAF Seal-A-Ridge Ridge Cap', description: 'Hip and ridge cap shingles', unit: 'bundle', unitCost: 0, qty: '{{ ceil((lf.ridge + lf.hip) / 33) }}', skuPattern: 'GAF-SAR-*', manufacturer: 'GAF', measurementType: 'linear_ridge' },
      { name: 'GAF Cobra Ridge Vent', description: '4ft ridge vent sections', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.ridge / 4) }}', skuPattern: 'GAF-COBRA', manufacturer: 'GAF', measurementType: 'linear_ridge' },
      { name: 'GAF FeltBuster Underlayment', description: 'Synthetic underlayment 10sq roll', unit: 'roll', unitCost: 0, qty: '{{ ceil(waste.10pct.squares / 10) }}', skuPattern: 'GAF-FB10', manufacturer: 'GAF', measurementType: 'roof_squares' },
      { name: 'GAF StormGuard Ice & Water', description: 'Ice and water shield 200sqft roll', unit: 'roll', unitCost: 0, qty: '{{ ceil((lf.eave * 6 + lf.valley * 6) / 200) }}', skuPattern: 'GAF-STORM', manufacturer: 'GAF', measurementType: 'linear_valley' },
      { name: 'Drip Edge - Eave', description: '10ft galvanized drip edge', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.eave / 10) }}', skuPattern: 'DRP-EAVE', manufacturer: 'Generic', measurementType: 'linear_eave' },
      { name: 'Drip Edge - Rake', description: '10ft galvanized drip edge', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.rake / 10) }}', skuPattern: 'DRP-RAKE', manufacturer: 'Generic', measurementType: 'linear_rake' },
      { name: 'Valley Metal W-Style', description: '10ft w-style valley metal', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.valley / 10) }}', skuPattern: 'VLY-W', manufacturer: 'Generic', measurementType: 'linear_valley' },
      { name: 'Step Flashing 4x4', description: '4x4 step flashing pieces', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.step / 2) }}', skuPattern: 'STEP-4X4', manufacturer: 'Generic', measurementType: 'linear_step' },
      { name: 'Pipe Boot 1-3"', description: 'Small pipe boot flashing', unit: 'each', unitCost: 0, qty: '{{ pen.pipe_vent }}', skuPattern: 'BOOT-SM', manufacturer: 'Generic', measurementType: 'penetrations' },
      { name: 'Coil Nails 1-1/4"', description: 'Roofing coil nails box', unit: 'box', unitCost: 0, qty: '{{ ceil(roof.squares / 4) }}', skuPattern: 'NAIL-COIL', manufacturer: 'Generic', measurementType: 'roof_squares' },
      { name: 'Roofing Cement', description: 'Roof sealant tube', unit: 'tube', unitCost: 0, qty: '{{ ceil(roof.squares / 15) }}', skuPattern: 'CEMENT', manufacturer: 'Generic', measurementType: 'roof_squares' },
      { name: 'OSB 7/16 Sheets', description: 'Decking repair sheets', unit: 'sheet', unitCost: 0, qty: '{{ ceil(roof.total_sqft * 0.03 / 32) }}', skuPattern: 'OSB-716', manufacturer: 'Generic', measurementType: 'roof_area' },
    ],
    labor: [
      { name: 'Tear Off', description: 'Remove existing roofing', unit: 'sq', unitCost: 0, qty: '{{ roof.squares }}', skuPattern: 'LABOR-TEAR', manufacturer: '' },
      { name: 'Underlayment Install', description: 'Install synthetic underlayment', unit: 'sq', unitCost: 0, qty: '{{ roof.squares }}', skuPattern: 'LABOR-UL', manufacturer: '' },
      { name: 'Shingle Install', description: 'Install architectural shingles', unit: 'sq', unitCost: 0, qty: '{{ roof.squares }}', skuPattern: 'LABOR-SHING', manufacturer: '' },
      { name: 'Ridge/Hip Work', description: 'Install ridge and hip cap', unit: 'lf', unitCost: 0, qty: '{{ lf.ridge + lf.hip }}', skuPattern: 'LABOR-RIDGE', manufacturer: '' },
      { name: 'Flashing/Details', description: 'Install step flashing and details', unit: 'lf', unitCost: 0, qty: '{{ lf.step + lf.valley }}', skuPattern: 'LABOR-FLASH', manufacturer: '' },
      { name: 'Cleanup/Haul', description: 'Debris removal and dump runs', unit: 'load', unitCost: 0, qty: '{{ ceil(roof.squares / 10) }}', skuPattern: 'LABOR-CLEAN', manufacturer: '' },
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
      { name: 'OC Duration Shingles', description: 'SureNail Technology shingles', unit: 'bundle', unitCost: 0, qty: '{{ ceil(waste.10pct.squares * 3) }}', skuPattern: 'OC-DUR-*', manufacturer: 'Owens Corning', measurementType: 'roof_squares' },
      { name: 'OC Starter Shingle Roll', description: 'Starter strip roll', unit: 'roll', unitCost: 0, qty: '{{ ceil((lf.eave + lf.rake) / 65) }}', skuPattern: 'OC-STRT', manufacturer: 'Owens Corning', measurementType: 'linear_eave' },
      { name: 'OC DecoRidge Ridge Cap', description: 'Hip and ridge cap', unit: 'bundle', unitCost: 0, qty: '{{ ceil((lf.ridge + lf.hip) / 33) }}', skuPattern: 'OC-DECO-*', manufacturer: 'Owens Corning', measurementType: 'linear_ridge' },
      { name: 'OC Deck Defense Underlayment', description: 'Synthetic underlayment 10sq roll', unit: 'roll', unitCost: 0, qty: '{{ ceil(waste.10pct.squares / 10) }}', skuPattern: 'OC-DECK', manufacturer: 'Owens Corning', measurementType: 'roof_squares' },
      { name: 'OC WeatherLock Ice & Water', description: 'Ice and water shield 200sqft roll', unit: 'roll', unitCost: 0, qty: '{{ ceil((lf.eave * 6 + lf.valley * 6) / 200) }}', skuPattern: 'OC-WLOCK', manufacturer: 'Owens Corning', measurementType: 'linear_valley' },
      { name: 'Drip Edge - Eave', description: '10ft galvanized drip edge', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.eave / 10) }}', skuPattern: 'DRP-EAVE', manufacturer: 'Generic', measurementType: 'linear_eave' },
      { name: 'Drip Edge - Rake', description: '10ft galvanized drip edge', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.rake / 10) }}', skuPattern: 'DRP-RAKE', manufacturer: 'Generic', measurementType: 'linear_rake' },
      { name: 'Valley Metal W-Style', description: '10ft w-style valley metal', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.valley / 10) }}', skuPattern: 'VLY-W', manufacturer: 'Generic', measurementType: 'linear_valley' },
      { name: 'Pipe Boot 1-3"', description: 'Small pipe boot flashing', unit: 'each', unitCost: 0, qty: '{{ pen.pipe_vent }}', skuPattern: 'BOOT-SM', manufacturer: 'Generic', measurementType: 'penetrations' },
      { name: 'Coil Nails 1-1/4"', description: 'Roofing coil nails box', unit: 'box', unitCost: 0, qty: '{{ ceil(roof.squares / 4) }}', skuPattern: 'NAIL-COIL', manufacturer: 'Generic', measurementType: 'roof_squares' },
    ],
    labor: [
      { name: 'Tear Off', description: 'Remove existing roofing', unit: 'sq', unitCost: 0, qty: '{{ roof.squares }}', skuPattern: 'LABOR-TEAR', manufacturer: '' },
      { name: 'Shingle Install', description: 'Install architectural shingles', unit: 'sq', unitCost: 0, qty: '{{ roof.squares }}', skuPattern: 'LABOR-SHING', manufacturer: '' },
      { name: 'Ridge/Hip Work', description: 'Install ridge and hip cap', unit: 'lf', unitCost: 0, qty: '{{ lf.ridge + lf.hip }}', skuPattern: 'LABOR-RIDGE', manufacturer: '' },
      { name: 'Cleanup/Haul', description: 'Debris removal', unit: 'load', unitCost: 0, qty: '{{ ceil(roof.squares / 10) }}', skuPattern: 'LABOR-CLEAN', manufacturer: '' },
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
      { name: 'OC Oakridge Shingles', description: 'Affordable architectural shingles', unit: 'bundle', unitCost: 0, qty: '{{ ceil(waste.10pct.squares * 3) }}', skuPattern: 'OC-OAK-*', manufacturer: 'Owens Corning', measurementType: 'roof_squares' },
      { name: 'OC Starter Shingle Roll', description: 'Starter strip roll', unit: 'roll', unitCost: 0, qty: '{{ ceil((lf.eave + lf.rake) / 65) }}', skuPattern: 'OC-STRT', manufacturer: 'Owens Corning', measurementType: 'linear_eave' },
      { name: 'OC DecoRidge Ridge Cap', description: 'Hip and ridge cap', unit: 'bundle', unitCost: 0, qty: '{{ ceil((lf.ridge + lf.hip) / 33) }}', skuPattern: 'OC-DECO-*', manufacturer: 'Owens Corning', measurementType: 'linear_ridge' },
      { name: 'OC ProArmor Underlayment', description: 'Synthetic underlayment 10sq roll', unit: 'roll', unitCost: 0, qty: '{{ ceil(waste.10pct.squares / 10) }}', skuPattern: 'OC-PROARM', manufacturer: 'Owens Corning', measurementType: 'roof_squares' },
      { name: 'Drip Edge - Eave', description: '10ft galvanized drip edge', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.eave / 10) }}', skuPattern: 'DRP-EAVE', manufacturer: 'Generic', measurementType: 'linear_eave' },
      { name: 'Drip Edge - Rake', description: '10ft galvanized drip edge', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.rake / 10) }}', skuPattern: 'DRP-RAKE', manufacturer: 'Generic', measurementType: 'linear_rake' },
      { name: 'Pipe Boot 1-3"', description: 'Small pipe boot flashing', unit: 'each', unitCost: 0, qty: '{{ pen.pipe_vent }}', skuPattern: 'BOOT-SM', manufacturer: 'Generic', measurementType: 'penetrations' },
      { name: 'Coil Nails 1-1/4"', description: 'Roofing coil nails box', unit: 'box', unitCost: 0, qty: '{{ ceil(roof.squares / 4) }}', skuPattern: 'NAIL-COIL', manufacturer: 'Generic', measurementType: 'roof_squares' },
    ],
    labor: [
      { name: 'Tear Off', description: 'Remove existing roofing', unit: 'sq', unitCost: 0, qty: '{{ roof.squares }}', skuPattern: 'LABOR-TEAR', manufacturer: '' },
      { name: 'Shingle Install', description: 'Install architectural shingles', unit: 'sq', unitCost: 0, qty: '{{ roof.squares }}', skuPattern: 'LABOR-SHING', manufacturer: '' },
      { name: 'Cleanup/Haul', description: 'Debris removal', unit: 'load', unitCost: 0, qty: '{{ ceil(roof.squares / 10) }}', skuPattern: 'LABOR-CLEAN', manufacturer: '' },
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
      { name: 'CT Landmark Shingles', description: 'Max Def color technology shingles', unit: 'bundle', unitCost: 0, qty: '{{ ceil(waste.10pct.squares * 3) }}', skuPattern: 'CT-LM-*', manufacturer: 'CertainTeed', measurementType: 'roof_squares' },
      { name: 'CT SwiftStart Starter', description: 'Starter strip shingles', unit: 'bundle', unitCost: 0, qty: '{{ ceil((lf.eave + lf.rake) / 120) }}', skuPattern: 'CT-SWFT', manufacturer: 'CertainTeed', measurementType: 'linear_eave' },
      { name: 'CT Shadow Ridge Cap', description: 'Hip and ridge cap', unit: 'bundle', unitCost: 0, qty: '{{ ceil((lf.ridge + lf.hip) / 33) }}', skuPattern: 'CT-SHAD-*', manufacturer: 'CertainTeed', measurementType: 'linear_ridge' },
      { name: 'CT DiamondDeck Underlayment', description: 'Synthetic underlayment 10sq roll', unit: 'roll', unitCost: 0, qty: '{{ ceil(waste.10pct.squares / 10) }}', skuPattern: 'CT-DIAM', manufacturer: 'CertainTeed', measurementType: 'roof_squares' },
      { name: 'CT WinterGuard Ice & Water', description: 'Ice and water shield 200sqft roll', unit: 'roll', unitCost: 0, qty: '{{ ceil((lf.eave * 6 + lf.valley * 6) / 200) }}', skuPattern: 'CT-WGRD', manufacturer: 'CertainTeed', measurementType: 'linear_valley' },
      { name: 'Drip Edge - Eave', description: '10ft galvanized drip edge', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.eave / 10) }}', skuPattern: 'DRP-EAVE', manufacturer: 'Generic', measurementType: 'linear_eave' },
      { name: 'Drip Edge - Rake', description: '10ft galvanized drip edge', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.rake / 10) }}', skuPattern: 'DRP-RAKE', manufacturer: 'Generic', measurementType: 'linear_rake' },
      { name: 'Valley Metal W-Style', description: '10ft w-style valley metal', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.valley / 10) }}', skuPattern: 'VLY-W', manufacturer: 'Generic', measurementType: 'linear_valley' },
      { name: 'Pipe Boot 1-3"', description: 'Small pipe boot flashing', unit: 'each', unitCost: 0, qty: '{{ pen.pipe_vent }}', skuPattern: 'BOOT-SM', manufacturer: 'Generic', measurementType: 'penetrations' },
      { name: 'Coil Nails 1-1/4"', description: 'Roofing coil nails box', unit: 'box', unitCost: 0, qty: '{{ ceil(roof.squares / 4) }}', skuPattern: 'NAIL-COIL', manufacturer: 'Generic', measurementType: 'roof_squares' },
    ],
    labor: [
      { name: 'Tear Off', description: 'Remove existing roofing', unit: 'sq', unitCost: 0, qty: '{{ roof.squares }}', skuPattern: 'LABOR-TEAR', manufacturer: '' },
      { name: 'Shingle Install', description: 'Install architectural shingles', unit: 'sq', unitCost: 0, qty: '{{ roof.squares }}', skuPattern: 'LABOR-SHING', manufacturer: '' },
      { name: 'Ridge/Hip Work', description: 'Install ridge and hip cap', unit: 'lf', unitCost: 0, qty: '{{ lf.ridge + lf.hip }}', skuPattern: 'LABOR-RIDGE', manufacturer: '' },
      { name: 'Cleanup/Haul', description: 'Debris removal', unit: 'load', unitCost: 0, qty: '{{ ceil(roof.squares / 10) }}', skuPattern: 'LABOR-CLEAN', manufacturer: '' },
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
      { name: '5V Metal Panels 26ga Painted', description: '26-gauge painted 5V crimp panels', unit: 'panel', unitCost: 0, qty: '{{ ceil(waste.12pct.sqft / 20) }}', skuPattern: '5V-26-*', manufacturer: '5V Metal', measurementType: 'roof_area' },
      { name: 'Polyglass XFR Underlayment', description: 'High-temp synthetic underlayment 4sq roll', unit: 'roll', unitCost: 0, qty: '{{ ceil(roof.squares / 4) }}', skuPattern: 'POLY-XFR', manufacturer: 'Polyglass', measurementType: 'roof_squares' },
      { name: 'Metal Ridge Cap', description: '10ft metal ridge cap', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.ridge / 10) }}', skuPattern: 'MR-RIDGE', manufacturer: 'Generic', measurementType: 'linear_ridge' },
      { name: 'Metal Hip Cap', description: '10ft metal hip cap', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.hip / 10) }}', skuPattern: 'MR-HIP', manufacturer: 'Generic', measurementType: 'linear_hip' },
      { name: 'Eave Closure Strip', description: '3ft foam closure strip', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.eave / 3) }}', skuPattern: 'CLS-EAVE-5V', manufacturer: 'Generic', measurementType: 'linear_eave' },
      { name: 'Ridge Closure Strip', description: '3ft foam closure strip', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.ridge / 3) }}', skuPattern: 'CLS-RDG-5V', manufacturer: 'Generic', measurementType: 'linear_ridge' },
      { name: 'Metal Rake Trim', description: '10ft metal rake trim', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.rake / 10) }}', skuPattern: 'MR-RAKE', manufacturer: 'Generic', measurementType: 'linear_rake' },
      { name: 'Pancake Screws #10 x 1"', description: 'Metal roofing screws', unit: 'each', unitCost: 0, qty: '{{ ceil(roof.squares * 80) }}', skuPattern: 'SCR-PAN-10', manufacturer: 'Generic', measurementType: 'roof_squares' },
      { name: 'Butyl Tape 1"', description: 'Sealing tape roll', unit: 'roll', unitCost: 0, qty: '{{ ceil(roof.squares / 5) }}', skuPattern: 'BTL-TAPE', manufacturer: 'Generic', measurementType: 'roof_squares' },
      { name: 'Metal Pipe Boot', description: 'Metal roof pipe flashing', unit: 'each', unitCost: 0, qty: '{{ pen.pipe_vent }}', skuPattern: 'BOOT-MTL', manufacturer: 'Generic', measurementType: 'penetrations' },
    ],
    labor: [
      { name: 'Tear Off', description: 'Remove existing roofing', unit: 'sq', unitCost: 0, qty: '{{ roof.squares }}', skuPattern: 'LABOR-TEAR', manufacturer: '' },
      { name: 'Deck Prep', description: 'Prepare deck for metal', unit: 'sq', unitCost: 0, qty: '{{ roof.squares }}', skuPattern: 'LABOR-PREP', manufacturer: '' },
      { name: 'Panel Install', description: 'Install 5V metal panels', unit: 'sq', unitCost: 0, qty: '{{ roof.squares }}', skuPattern: 'LABOR-MTL', manufacturer: '' },
      { name: 'Trim Install', description: 'Install all metal trim', unit: 'lf', unitCost: 0, qty: '{{ lf.eave + lf.rake + lf.ridge + lf.hip }}', skuPattern: 'LABOR-TRIM', manufacturer: '' },
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
      { name: '1" SnapLok Panels 24ga', description: '24-gauge standing seam panels', unit: 'panel', unitCost: 0, qty: '{{ ceil(waste.12pct.sqft / 16) }}', skuPattern: 'SNAP-1-24-*', manufacturer: 'Standing Seam', measurementType: 'roof_area' },
      { name: 'Polyglass XFR Underlayment', description: 'High-temp synthetic underlayment 4sq roll', unit: 'roll', unitCost: 0, qty: '{{ ceil(roof.squares / 4) }}', skuPattern: 'POLY-XFR', manufacturer: 'Polyglass', measurementType: 'roof_squares' },
      { name: 'SnapLok Ridge Cap', description: '10.5ft ridge cap', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.ridge / 10.5) }}', skuPattern: 'SNAP-RIDGE', manufacturer: 'Standing Seam', measurementType: 'linear_ridge' },
      { name: 'SnapLok Hip Cap', description: '10.5ft hip cap', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.hip / 10.5) }}', skuPattern: 'SNAP-HIP', manufacturer: 'Standing Seam', measurementType: 'linear_hip' },
      { name: 'SnapLok Eave Trim', description: '10.5ft eave trim', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.eave / 10.5) }}', skuPattern: 'SNAP-EAVE', manufacturer: 'Standing Seam', measurementType: 'linear_eave' },
      { name: 'SnapLok Rake Trim', description: '10.5ft rake trim', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.rake / 10.5) }}', skuPattern: 'SNAP-RAKE', manufacturer: 'Standing Seam', measurementType: 'linear_rake' },
      { name: 'Inside Closure Strip', description: '3ft inside closure', unit: 'piece', unitCost: 0, qty: '{{ ceil((lf.eave + lf.rake) / 3) }}', skuPattern: 'CLS-IN-SS', manufacturer: 'Generic', measurementType: 'linear_eave' },
      { name: 'Pancake Screws #12 x 1.5"', description: 'Concealed fastener screws', unit: 'each', unitCost: 0, qty: '{{ ceil(roof.squares * 70) }}', skuPattern: 'SCR-PAN-12', manufacturer: 'Generic', measurementType: 'roof_squares' },
      { name: 'Metal Pipe Boot', description: 'Standing seam pipe flashing', unit: 'each', unitCost: 0, qty: '{{ pen.pipe_vent }}', skuPattern: 'BOOT-SS', manufacturer: 'Generic', measurementType: 'penetrations' },
    ],
    labor: [
      { name: 'Tear Off', description: 'Remove existing roofing', unit: 'sq', unitCost: 0, qty: '{{ roof.squares }}', skuPattern: 'LABOR-TEAR', manufacturer: '' },
      { name: 'Panel Install', description: 'Install SnapLok panels', unit: 'sq', unitCost: 0, qty: '{{ roof.squares }}', skuPattern: 'LABOR-SS', manufacturer: '' },
      { name: 'Trim Install', description: 'Install all SnapLok trim', unit: 'lf', unitCost: 0, qty: '{{ lf.eave + lf.rake + lf.ridge + lf.hip }}', skuPattern: 'LABOR-TRIM', manufacturer: '' },
    ],
  },
  // 7. Worthouse Dura Profile
  {
    name: 'Worthouse Dura Profile',
    description: 'Stone coated steel Dura Profile panels with synthetic underlayment.',
    brand: 'Worthouse',
    productLine: 'Dura Profile',
    roofType: 'stone_coated',
    materials: [
      { name: 'Worthouse Dura Profile Panels', description: 'Stone coated steel panels (5.6 sqft each)', unit: 'panel', unitCost: 0, qty: '{{ ceil(waste.10pct.sqft / 5.6) }}', skuPattern: 'WH-DURA-*', manufacturer: 'Worthouse', measurementType: 'roof_area' },
      { name: 'Synthetic Underlayment', description: 'Synthetic underlayment 10sq roll', unit: 'roll', unitCost: 0, qty: '{{ ceil(roof.squares / 10) }}', skuPattern: 'SYNTH-UL', manufacturer: 'Generic', measurementType: 'roof_squares' },
      { name: 'Dura Ridge Cap', description: '3.5ft stone coated ridge cap', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.ridge / 3.5) }}', skuPattern: 'WH-DURA-RDG', manufacturer: 'Worthouse', measurementType: 'linear_ridge' },
      { name: 'Dura Hip Cap', description: '3.5ft stone coated hip cap', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.hip / 3.5) }}', skuPattern: 'WH-DURA-HIP', manufacturer: 'Worthouse', measurementType: 'linear_hip' },
      { name: 'Dura Starter Panel', description: '4ft starter panels', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.eave / 4) }}', skuPattern: 'WH-DURA-STR', manufacturer: 'Worthouse', measurementType: 'linear_eave' },
      { name: 'Dura Rake Trim', description: '4ft rake trim', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.rake / 4) }}', skuPattern: 'WH-DURA-RK', manufacturer: 'Worthouse', measurementType: 'linear_rake' },
      { name: 'Color Match Nails 1.5"', description: 'Stone coated matching nails', unit: 'each', unitCost: 0, qty: '{{ ceil(roof.squares * 80) }}', skuPattern: 'NAIL-WH-*', manufacturer: 'Worthouse', measurementType: 'roof_squares' },
      { name: 'Stone Coated Pipe Boot', description: 'Stone coated pipe flashing', unit: 'each', unitCost: 0, qty: '{{ pen.pipe_vent }}', skuPattern: 'BOOT-SC', manufacturer: 'Worthouse', measurementType: 'penetrations' },
    ],
    labor: [
      { name: 'Tear Off', description: 'Remove existing roofing', unit: 'sq', unitCost: 0, qty: '{{ roof.squares }}', skuPattern: 'LABOR-TEAR', manufacturer: '' },
      { name: 'Panel Install', description: 'Install Dura Profile panels', unit: 'sq', unitCost: 0, qty: '{{ roof.squares }}', skuPattern: 'LABOR-DURA', manufacturer: '' },
      { name: 'Trim Install', description: 'Install all Dura Profile trim', unit: 'lf', unitCost: 0, qty: '{{ lf.eave + lf.rake + lf.ridge + lf.hip }}', skuPattern: 'LABOR-TRIM', manufacturer: '' },
    ],
  },
  // 8. Worthouse Supre Profile
  {
    name: 'Worthouse Supre Profile',
    description: 'Premium stone coated steel Supre Profile panels with synthetic underlayment.',
    brand: 'Worthouse',
    productLine: 'Supre Profile',
    roofType: 'stone_coated',
    materials: [
      { name: 'Worthouse Supre Profile Panels', description: 'Premium stone coated steel panels (5.8 sqft each)', unit: 'panel', unitCost: 0, qty: '{{ ceil(waste.10pct.sqft / 5.8) }}', skuPattern: 'WH-SUPRE-*', manufacturer: 'Worthouse', measurementType: 'roof_area' },
      { name: 'Synthetic Underlayment', description: 'Synthetic underlayment 10sq roll', unit: 'roll', unitCost: 0, qty: '{{ ceil(roof.squares / 10) }}', skuPattern: 'SYNTH-UL', manufacturer: 'Generic', measurementType: 'roof_squares' },
      { name: 'Supre Ridge Cap', description: '3.5ft stone coated ridge cap', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.ridge / 3.5) }}', skuPattern: 'WH-SUPRE-RDG', manufacturer: 'Worthouse', measurementType: 'linear_ridge' },
      { name: 'Supre Hip Cap', description: '3.5ft stone coated hip cap', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.hip / 3.5) }}', skuPattern: 'WH-SUPRE-HIP', manufacturer: 'Worthouse', measurementType: 'linear_hip' },
      { name: 'Supre Starter Panel', description: '4ft starter panels', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.eave / 4) }}', skuPattern: 'WH-SUPRE-STR', manufacturer: 'Worthouse', measurementType: 'linear_eave' },
      { name: 'Supre Rake Trim', description: '4ft rake trim', unit: 'piece', unitCost: 0, qty: '{{ ceil(lf.rake / 4) }}', skuPattern: 'WH-SUPRE-RK', manufacturer: 'Worthouse', measurementType: 'linear_rake' },
      { name: 'Color Match Nails 1.5"', description: 'Stone coated matching nails', unit: 'each', unitCost: 0, qty: '{{ ceil(roof.squares * 80) }}', skuPattern: 'NAIL-WH-*', manufacturer: 'Worthouse', measurementType: 'roof_squares' },
      { name: 'Stone Coated Pipe Boot', description: 'Stone coated pipe flashing', unit: 'each', unitCost: 0, qty: '{{ pen.pipe_vent }}', skuPattern: 'BOOT-SC', manufacturer: 'Worthouse', measurementType: 'penetrations' },
    ],
    labor: [
      { name: 'Tear Off', description: 'Remove existing roofing', unit: 'sq', unitCost: 0, qty: '{{ roof.squares }}', skuPattern: 'LABOR-TEAR', manufacturer: '' },
      { name: 'Panel Install', description: 'Install Supre Profile panels', unit: 'sq', unitCost: 0, qty: '{{ roof.squares }}', skuPattern: 'LABOR-SUPRE', manufacturer: '' },
      { name: 'Trim Install', description: 'Install all Supre Profile trim', unit: 'lf', unitCost: 0, qty: '{{ lf.eave + lf.rake + lf.ridge + lf.hip }}', skuPattern: 'LABOR-TRIM', manufacturer: '' },
    ],
  },
];

/**
 * Seed all 8 brand templates for a tenant
 */
export async function seedBrandTemplates(tenantId: string): Promise<{ success: boolean; templatesCreated: number; error?: string }> {
  let templatesCreated = 0;

  try {
    for (const template of BRAND_TEMPLATES) {
      // Check if template already exists
      const { data: existing } = await supabase
        .from('templates')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('name', template.name)
        .maybeSingle();

      if (existing) continue;

      // Create template
      const { data: newTemplate, error: templateError } = await supabase
        .from('templates')
        .insert({
          tenant_id: tenantId,
          name: template.name,
          template_description: template.description,
          brand: template.brand,
          product_line: template.productLine,
          roof_type: template.roofType,
          is_system_default: true,
          profit_margin_percent: 30,
          status: 'active',
          template_type: template.roofType === 'shingle' ? 'steep_slope' : 'metal',
        })
        .select()
        .single();

      if (templateError) throw templateError;

      // Create Materials group
      const { data: materialsGroup, error: matGroupError } = await supabase
        .from('template_groups')
        .insert({
          template_id: newTemplate.id,
          name: 'Materials',
          sort_order: 0,
        })
        .select()
        .single();

      if (matGroupError) throw matGroupError;

      // Create Labor group
      const { data: laborGroup, error: labGroupError } = await supabase
        .from('template_groups')
        .insert({
          template_id: newTemplate.id,
          name: 'Labor',
          sort_order: 1,
        })
        .select()
        .single();

      if (labGroupError) throw labGroupError;

      // Insert material items
      const materialItems = template.materials.map((item, index) => ({
        group_id: materialsGroup.id,
        name: item.name,
        description: item.description,
        unit: item.unit,
        unit_cost: item.unitCost,
        qty: item.qty,
        sku_pattern: item.skuPattern,
        manufacturer: item.manufacturer,
        measurement_type: item.measurementType,
        sort_order: index,
        item_type: 'material',
      }));

      const { error: matItemsError } = await supabase
        .from('template_items')
        .insert(materialItems);

      if (matItemsError) throw matItemsError;

      // Insert labor items
      const laborItems = template.labor.map((item, index) => ({
        group_id: laborGroup.id,
        name: item.name,
        description: item.description,
        unit: item.unit,
        unit_cost: item.unitCost,
        qty: item.qty,
        sku_pattern: item.skuPattern,
        sort_order: index,
        item_type: 'labor',
      }));

      const { error: labItemsError } = await supabase
        .from('template_items')
        .insert(laborItems);

      if (labItemsError) throw labItemsError;

      templatesCreated++;
    }

    return { success: true, templatesCreated };
  } catch (error: any) {
    console.error('Error seeding brand templates:', error);
    return { success: false, templatesCreated, error: error.message };
  }
}
