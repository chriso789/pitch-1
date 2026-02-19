/**
 * Brand-Specific Template Seeder
 * Seeds 8 brand templates for a tenant with full material/labor components
 * Uses the NEW estimate_calc_template_groups and estimate_calc_template_items tables
 */

import { supabase } from '@/integrations/supabase/client';

export interface BrandTemplate {
  name: string;
  description: string;
  brand: string;
  productLine: string;
  roofType: 'shingle' | 'metal' | 'stone_coated' | 'tile';
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
      { item_name: 'GAF Timberline HDZ Shingles', description: 'Remove old roof and install new premium architectural shingles for lasting weather protection and curb appeal', unit: 'bundle', unit_cost: 42.50, qty_formula: '{{ ceil(waste.10pct.squares * 3) }}', sku_pattern: 'GAF-THDZ-*', manufacturer: 'GAF', measurement_type: 'roof_squares' },
      { item_name: 'GAF Pro-Start Starter Strip', description: 'Adhesive starter row installed along eaves and rakes to seal the first course of shingles against wind uplift', unit: 'bundle', unit_cost: 35.00, qty_formula: '{{ ceil((lf.eave + lf.rake) / 120) }}', sku_pattern: 'GAF-PROST', manufacturer: 'GAF', measurement_type: 'linear_eave' },
      { item_name: 'GAF Seal-A-Ridge Ridge Cap', description: 'Specially shaped shingles installed along the peak and hip lines of your roof for a finished, watertight seal', unit: 'bundle', unit_cost: 52.00, qty_formula: '{{ ceil((lf.ridge + lf.hip) / 33) }}', sku_pattern: 'GAF-SAR-*', manufacturer: 'GAF', measurement_type: 'linear_ridge' },
      { item_name: 'GAF Cobra Ridge Vent', description: 'Ventilation installed along the roof peak to allow hot air to escape from the attic, reducing energy costs and preventing moisture damage', unit: 'piece', unit_cost: 18.00, qty_formula: '{{ ceil(lf.ridge / 4) }}', sku_pattern: 'GAF-COBRA', manufacturer: 'GAF', measurement_type: 'linear_ridge' },
      { item_name: 'GAF FeltBuster Underlayment', description: 'Waterproof barrier installed over the roof deck beneath the shingles as a secondary layer of leak protection', unit: 'roll', unit_cost: 85.00, qty_formula: '{{ ceil(waste.10pct.squares / 10) }}', sku_pattern: 'GAF-FB10', manufacturer: 'GAF', measurement_type: 'roof_squares' },
      { item_name: 'GAF StormGuard Ice & Water', description: 'Self-adhering waterproof membrane applied to vulnerable areas (eaves and valleys) to prevent ice dam and wind-driven rain leaks', unit: 'roll', unit_cost: 125.00, qty_formula: '{{ ceil((lf.eave * 6 + lf.valley * 6) / 200) }}', sku_pattern: 'GAF-STORM', manufacturer: 'GAF', measurement_type: 'linear_valley' },
      { item_name: 'Drip Edge', description: 'Metal edge flashing installed along the roof perimeter to direct water away from the fascia and into gutters', unit: 'piece', unit_cost: 8.75, qty_formula: '{{ ceil((lf.eave + lf.rake) / 10) }}', sku_pattern: 'DRP-EDGE', manufacturer: 'Generic', measurement_type: 'linear_perimeter' },
      { item_name: 'Valley Metal W-Style', description: 'Metal channel installed where two roof slopes meet to direct heavy water flow and prevent valley leaks', unit: 'piece', unit_cost: 22.00, qty_formula: '{{ ceil(lf.valley / 10) }}', sku_pattern: 'VLY-W', manufacturer: 'Generic', measurement_type: 'linear_valley' },
      { item_name: 'Step Flashing 4x4', description: 'L-shaped metal pieces woven into shingles where the roof meets a wall to prevent water from seeping behind the siding', unit: 'piece', unit_cost: 1.25, qty_formula: '{{ ceil(lf.step / 2) }}', sku_pattern: 'STEP-4X4', manufacturer: 'Generic', measurement_type: 'linear_step' },
      { item_name: 'Pipe Boot 1-3"', description: 'Rubber-sealed flashing fitted around plumbing vent pipes to prevent leaks at roof penetrations', unit: 'each', unit_cost: 12.00, qty_formula: '{{ pen.pipe_vent }}', sku_pattern: 'BOOT-SM', manufacturer: 'Generic', measurement_type: 'penetrations' },
      { item_name: 'Coil Nails 1-1/4"', description: 'Galvanized roofing nails used to secure shingles to the roof deck per manufacturer specifications', unit: 'box', unit_cost: 48.00, qty_formula: '{{ ceil(roof.squares / 4) }}', sku_pattern: 'NAIL-COIL', manufacturer: 'Generic', measurement_type: 'roof_squares' },
      { item_name: 'Roofing Cement', description: 'Sealant applied to flashings, edges, and penetrations for additional waterproofing', unit: 'tube', unit_cost: 8.00, qty_formula: '{{ ceil(roof.squares / 15) }}', sku_pattern: 'CEMENT', manufacturer: 'Generic', measurement_type: 'roof_squares' },
      { item_name: 'OSB 7/16 Sheets', description: 'Replacement plywood decking boards for any rotted or damaged sections discovered during tear-off', unit: 'sheet', unit_cost: 32.00, qty_formula: '{{ ceil(roof.total_sqft * 0.03 / 32) }}', sku_pattern: 'OSB-716', manufacturer: 'Generic', measurement_type: 'roof_area' },
    ],
    labor: [
      { item_name: 'Tear Off', description: 'Remove and dispose of all existing roofing materials down to the bare deck', unit: 'sq', unit_cost: 45.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-TEAR', manufacturer: '' },
      { item_name: 'Underlayment Install', description: 'Install waterproof underlayment over the entire roof deck for secondary weather protection', unit: 'sq', unit_cost: 15.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-UL', manufacturer: '' },
      { item_name: 'Shingle Install', description: 'Professionally install new shingles per manufacturer specifications to maintain full warranty coverage', unit: 'sq', unit_cost: 85.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-SHING', manufacturer: '' },
      { item_name: 'Ridge/Hip Work', description: 'Install ridge cap and hip cap shingles along all peaks and hip lines for a watertight, finished appearance', unit: 'lf', unit_cost: 3.50, qty_formula: '{{ lf.ridge + lf.hip }}', sku_pattern: 'LABOR-RIDGE', manufacturer: '' },
      { item_name: 'Flashing/Details', description: 'Install step flashing, valley metal, and detail work at all roof-to-wall transitions and penetrations', unit: 'lf', unit_cost: 4.00, qty_formula: '{{ lf.step + lf.valley }}', sku_pattern: 'LABOR-FLASH', manufacturer: '' },
      { item_name: 'Cleanup/Haul', description: 'Complete job-site cleanup, magnetic nail sweep of yard and driveway, and haul all debris to the dump', unit: 'job', unit_cost: 350.00, qty_formula: '1', sku_pattern: 'LABOR-CLEAN', manufacturer: '' },
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
      { item_name: 'OC Duration Shingles', description: 'Remove old roof and install new architectural shingles with patented SureNail grip for superior wind resistance', unit: 'bundle', unit_cost: 44.00, qty_formula: '{{ ceil(waste.10pct.squares * 3) }}', sku_pattern: 'OC-DUR-*', manufacturer: 'Owens Corning', measurement_type: 'roof_squares' },
      { item_name: 'OC Starter Shingle Roll', description: 'Adhesive starter row installed along eaves and rakes to seal the first course of shingles against wind uplift', unit: 'roll', unit_cost: 36.00, qty_formula: '{{ ceil((lf.eave + lf.rake) / 65) }}', sku_pattern: 'OC-STRT', manufacturer: 'Owens Corning', measurement_type: 'linear_eave' },
      { item_name: 'OC DecoRidge Ridge Cap', description: 'Specially shaped shingles installed along the peak and hip lines of your roof for a finished, watertight seal', unit: 'bundle', unit_cost: 55.00, qty_formula: '{{ ceil((lf.ridge + lf.hip) / 33) }}', sku_pattern: 'OC-DECO-*', manufacturer: 'Owens Corning', measurement_type: 'linear_ridge' },
      { item_name: 'OC Deck Defense Underlayment', description: 'Waterproof barrier installed over the roof deck beneath the shingles as a secondary layer of leak protection', unit: 'roll', unit_cost: 95.00, qty_formula: '{{ ceil(waste.10pct.squares / 10) }}', sku_pattern: 'OC-DECK', manufacturer: 'Owens Corning', measurement_type: 'roof_squares' },
      { item_name: 'OC WeatherLock Ice & Water', description: 'Self-adhering waterproof membrane applied to vulnerable areas (eaves and valleys) to prevent ice dam and wind-driven rain leaks', unit: 'roll', unit_cost: 130.00, qty_formula: '{{ ceil((lf.eave * 6 + lf.valley * 6) / 200) }}', sku_pattern: 'OC-WLOCK', manufacturer: 'Owens Corning', measurement_type: 'linear_valley' },
      { item_name: 'Drip Edge', description: 'Metal edge flashing installed along the roof perimeter to direct water away from the fascia and into gutters', unit: 'piece', unit_cost: 8.75, qty_formula: '{{ ceil((lf.eave + lf.rake) / 10) }}', sku_pattern: 'DRP-EDGE', manufacturer: 'Generic', measurement_type: 'linear_perimeter' },
      { item_name: 'Valley Metal W-Style', description: 'Metal channel installed where two roof slopes meet to direct heavy water flow and prevent valley leaks', unit: 'piece', unit_cost: 22.00, qty_formula: '{{ ceil(lf.valley / 10) }}', sku_pattern: 'VLY-W', manufacturer: 'Generic', measurement_type: 'linear_valley' },
      { item_name: 'Pipe Boot 1-3"', description: 'Rubber-sealed flashing fitted around plumbing vent pipes to prevent leaks at roof penetrations', unit: 'each', unit_cost: 12.00, qty_formula: '{{ pen.pipe_vent }}', sku_pattern: 'BOOT-SM', manufacturer: 'Generic', measurement_type: 'penetrations' },
      { item_name: 'Coil Nails 1-1/4"', description: 'Galvanized roofing nails used to secure shingles to the roof deck per manufacturer specifications', unit: 'box', unit_cost: 48.00, qty_formula: '{{ ceil(roof.squares / 4) }}', sku_pattern: 'NAIL-COIL', manufacturer: 'Generic', measurement_type: 'roof_squares' },
    ],
    labor: [
      { item_name: 'Tear Off', description: 'Remove and dispose of all existing roofing materials down to the bare deck', unit: 'sq', unit_cost: 45.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-TEAR', manufacturer: '' },
      { item_name: 'Shingle Install', description: 'Professionally install new shingles per manufacturer specifications to maintain full warranty coverage', unit: 'sq', unit_cost: 85.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-SHING', manufacturer: '' },
      { item_name: 'Ridge/Hip Work', description: 'Install ridge cap and hip cap shingles along all peaks and hip lines for a watertight, finished appearance', unit: 'lf', unit_cost: 3.50, qty_formula: '{{ lf.ridge + lf.hip }}', sku_pattern: 'LABOR-RIDGE', manufacturer: '' },
      { item_name: 'Cleanup/Haul', description: 'Complete job-site cleanup, magnetic nail sweep of yard and driveway, and haul all debris to the dump', unit: 'job', unit_cost: 350.00, qty_formula: '1', sku_pattern: 'LABOR-CLEAN', manufacturer: '' },
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
      { item_name: 'OC Oakridge Shingles', description: 'Remove old roof and install new architectural shingles for reliable weather protection at an affordable price point', unit: 'bundle', unit_cost: 38.00, qty_formula: '{{ ceil(waste.10pct.squares * 3) }}', sku_pattern: 'OC-OAK-*', manufacturer: 'Owens Corning', measurement_type: 'roof_squares' },
      { item_name: 'OC Starter Shingle Roll', description: 'Adhesive starter row installed along eaves and rakes to seal the first course of shingles against wind uplift', unit: 'roll', unit_cost: 36.00, qty_formula: '{{ ceil((lf.eave + lf.rake) / 65) }}', sku_pattern: 'OC-STRT', manufacturer: 'Owens Corning', measurement_type: 'linear_eave' },
      { item_name: 'OC DecoRidge Ridge Cap', description: 'Specially shaped shingles installed along the peak and hip lines of your roof for a finished, watertight seal', unit: 'bundle', unit_cost: 55.00, qty_formula: '{{ ceil((lf.ridge + lf.hip) / 33) }}', sku_pattern: 'OC-DECO-*', manufacturer: 'Owens Corning', measurement_type: 'linear_ridge' },
      { item_name: 'OC ProArmor Underlayment', description: 'Waterproof barrier installed over the roof deck beneath the shingles as a secondary layer of leak protection', unit: 'roll', unit_cost: 75.00, qty_formula: '{{ ceil(waste.10pct.squares / 10) }}', sku_pattern: 'OC-PROARM', manufacturer: 'Owens Corning', measurement_type: 'roof_squares' },
      { item_name: 'Drip Edge', description: 'Metal edge flashing installed along the roof perimeter to direct water away from the fascia and into gutters', unit: 'piece', unit_cost: 8.75, qty_formula: '{{ ceil((lf.eave + lf.rake) / 10) }}', sku_pattern: 'DRP-EDGE', manufacturer: 'Generic', measurement_type: 'linear_perimeter' },
      { item_name: 'Pipe Boot 1-3"', description: 'Rubber-sealed flashing fitted around plumbing vent pipes to prevent leaks at roof penetrations', unit: 'each', unit_cost: 12.00, qty_formula: '{{ pen.pipe_vent }}', sku_pattern: 'BOOT-SM', manufacturer: 'Generic', measurement_type: 'penetrations' },
      { item_name: 'Coil Nails 1-1/4"', description: 'Galvanized roofing nails used to secure shingles to the roof deck per manufacturer specifications', unit: 'box', unit_cost: 48.00, qty_formula: '{{ ceil(roof.squares / 4) }}', sku_pattern: 'NAIL-COIL', manufacturer: 'Generic', measurement_type: 'roof_squares' },
    ],
    labor: [
      { item_name: 'Tear Off', description: 'Remove and dispose of all existing roofing materials down to the bare deck', unit: 'sq', unit_cost: 45.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-TEAR', manufacturer: '' },
      { item_name: 'Shingle Install', description: 'Professionally install new shingles per manufacturer specifications to maintain full warranty coverage', unit: 'sq', unit_cost: 80.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-SHING', manufacturer: '' },
      { item_name: 'Cleanup/Haul', description: 'Complete job-site cleanup, magnetic nail sweep of yard and driveway, and haul all debris to the dump', unit: 'job', unit_cost: 300.00, qty_formula: '1', sku_pattern: 'LABOR-CLEAN', manufacturer: '' },
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
      { item_name: 'CT Landmark Shingles', description: 'Remove old roof and install new architectural shingles with vibrant Max Def color for a rich, dimensional look', unit: 'bundle', unit_cost: 40.00, qty_formula: '{{ ceil(waste.10pct.squares * 3) }}', sku_pattern: 'CT-LM-*', manufacturer: 'CertainTeed', measurement_type: 'roof_squares' },
      { item_name: 'CT SwiftStart Starter', description: 'Adhesive starter row installed along eaves and rakes to seal the first course of shingles against wind uplift', unit: 'bundle', unit_cost: 34.00, qty_formula: '{{ ceil((lf.eave + lf.rake) / 120) }}', sku_pattern: 'CT-SWFT', manufacturer: 'CertainTeed', measurement_type: 'linear_eave' },
      { item_name: 'CT Shadow Ridge Cap', description: 'Specially shaped shingles installed along the peak and hip lines of your roof for a finished, watertight seal', unit: 'bundle', unit_cost: 50.00, qty_formula: '{{ ceil((lf.ridge + lf.hip) / 33) }}', sku_pattern: 'CT-SHAD-*', manufacturer: 'CertainTeed', measurement_type: 'linear_ridge' },
      { item_name: 'CT DiamondDeck Underlayment', description: 'Waterproof barrier installed over the roof deck beneath the shingles as a secondary layer of leak protection', unit: 'roll', unit_cost: 90.00, qty_formula: '{{ ceil(waste.10pct.squares / 10) }}', sku_pattern: 'CT-DIAM', manufacturer: 'CertainTeed', measurement_type: 'roof_squares' },
      { item_name: 'CT WinterGuard Ice & Water', description: 'Self-adhering waterproof membrane applied to vulnerable areas (eaves and valleys) to prevent ice dam and wind-driven rain leaks', unit: 'roll', unit_cost: 120.00, qty_formula: '{{ ceil((lf.eave * 6 + lf.valley * 6) / 200) }}', sku_pattern: 'CT-WGRD', manufacturer: 'CertainTeed', measurement_type: 'linear_valley' },
      { item_name: 'Drip Edge', description: 'Metal edge flashing installed along the roof perimeter to direct water away from the fascia and into gutters', unit: 'piece', unit_cost: 8.75, qty_formula: '{{ ceil((lf.eave + lf.rake) / 10) }}', sku_pattern: 'DRP-EDGE', manufacturer: 'Generic', measurement_type: 'linear_perimeter' },
      { item_name: 'Valley Metal W-Style', description: 'Metal channel installed where two roof slopes meet to direct heavy water flow and prevent valley leaks', unit: 'piece', unit_cost: 22.00, qty_formula: '{{ ceil(lf.valley / 10) }}', sku_pattern: 'VLY-W', manufacturer: 'Generic', measurement_type: 'linear_valley' },
      { item_name: 'Pipe Boot 1-3"', description: 'Rubber-sealed flashing fitted around plumbing vent pipes to prevent leaks at roof penetrations', unit: 'each', unit_cost: 12.00, qty_formula: '{{ pen.pipe_vent }}', sku_pattern: 'BOOT-SM', manufacturer: 'Generic', measurement_type: 'penetrations' },
      { item_name: 'Coil Nails 1-1/4"', description: 'Galvanized roofing nails used to secure shingles to the roof deck per manufacturer specifications', unit: 'box', unit_cost: 48.00, qty_formula: '{{ ceil(roof.squares / 4) }}', sku_pattern: 'NAIL-COIL', manufacturer: 'Generic', measurement_type: 'roof_squares' },
    ],
    labor: [
      { item_name: 'Tear Off', description: 'Remove and dispose of all existing roofing materials down to the bare deck', unit: 'sq', unit_cost: 45.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-TEAR', manufacturer: '' },
      { item_name: 'Shingle Install', description: 'Professionally install new shingles per manufacturer specifications to maintain full warranty coverage', unit: 'sq', unit_cost: 82.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-SHING', manufacturer: '' },
      { item_name: 'Ridge/Hip Work', description: 'Install ridge cap and hip cap shingles along all peaks and hip lines for a watertight, finished appearance', unit: 'lf', unit_cost: 3.50, qty_formula: '{{ lf.ridge + lf.hip }}', sku_pattern: 'LABOR-RIDGE', manufacturer: '' },
      { item_name: 'Cleanup/Haul', description: 'Complete job-site cleanup, magnetic nail sweep of yard and driveway, and haul all debris to the dump', unit: 'job', unit_cost: 325.00, qty_formula: '1', sku_pattern: 'LABOR-CLEAN', manufacturer: '' },
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
      { item_name: '5V Metal Panels 26ga Painted', description: 'Remove old roof and install new painted metal panels for long-lasting, low-maintenance weather protection', unit: 'panel', unit_cost: 38.00, qty_formula: '{{ ceil(waste.12pct.sqft / 20) }}', sku_pattern: '5V-26-*', manufacturer: '5V Metal', measurement_type: 'roof_area' },
      { item_name: 'Polyglass XFR Underlayment', description: 'High-temperature synthetic barrier installed beneath metal panels for secondary leak protection and noise reduction', unit: 'roll', unit_cost: 125.00, qty_formula: '{{ ceil(roof.squares / 4) }}', sku_pattern: 'POLY-XFR', manufacturer: 'Polyglass', measurement_type: 'roof_squares' },
      { item_name: 'Metal Ridge Cap', description: 'Pre-formed metal cap installed along the roof peak to seal the top where panels meet and prevent water entry', unit: 'piece', unit_cost: 28.00, qty_formula: '{{ ceil(lf.ridge / 10) }}', sku_pattern: 'MR-RIDGE', manufacturer: 'Generic', measurement_type: 'linear_ridge' },
      { item_name: 'Metal Hip Cap', description: 'Pre-formed metal cap installed along hip lines where two roof slopes meet at an angle', unit: 'piece', unit_cost: 28.00, qty_formula: '{{ ceil(lf.hip / 10) }}', sku_pattern: 'MR-HIP', manufacturer: 'Generic', measurement_type: 'linear_hip' },
      { item_name: 'Eave Closure Strip', description: 'Foam seal placed at the eave edge to block insects, birds, and wind-driven rain from entering under the panels', unit: 'piece', unit_cost: 4.50, qty_formula: '{{ ceil(lf.eave / 3) }}', sku_pattern: 'CLS-EAVE-5V', manufacturer: 'Generic', measurement_type: 'linear_eave' },
      { item_name: 'Ridge Closure Strip', description: 'Foam seal placed at the ridge to close the gap between the panel profile and the ridge cap', unit: 'piece', unit_cost: 4.50, qty_formula: '{{ ceil(lf.ridge / 3) }}', sku_pattern: 'CLS-RDG-5V', manufacturer: 'Generic', measurement_type: 'linear_ridge' },
      { item_name: 'Metal Rake Trim', description: 'Finished metal trim installed along the sloped edges of the roof for a clean, sealed appearance', unit: 'piece', unit_cost: 18.00, qty_formula: '{{ ceil(lf.rake / 10) }}', sku_pattern: 'MR-RAKE', manufacturer: 'Generic', measurement_type: 'linear_rake' },
      { item_name: 'Pancake Screws #10 x 1"', description: 'Color-matched metal roofing screws with rubber washers to fasten panels securely while preventing leaks', unit: 'box', unit_cost: 45.00, qty_formula: '{{ ceil(roof.squares * 80 / 250) }}', sku_pattern: 'SCR-PAN-10', manufacturer: 'Generic', measurement_type: 'roof_squares' },
      { item_name: 'Butyl Tape 1"', description: 'Adhesive sealing tape applied between overlapping metal pieces to create a watertight bond', unit: 'roll', unit_cost: 18.00, qty_formula: '{{ ceil(roof.squares / 5) }}', sku_pattern: 'BTL-TAPE', manufacturer: 'Generic', measurement_type: 'roof_squares' },
      { item_name: 'Metal Pipe Boot', description: 'Metal-compatible flashing fitted around plumbing vent pipes to prevent leaks at roof penetrations', unit: 'each', unit_cost: 35.00, qty_formula: '{{ pen.pipe_vent }}', sku_pattern: 'BOOT-MTL', manufacturer: 'Generic', measurement_type: 'penetrations' },
    ],
    labor: [
      { item_name: 'Tear Off', description: 'Remove and dispose of all existing roofing materials down to the bare deck', unit: 'sq', unit_cost: 55.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-TEAR', manufacturer: '' },
      { item_name: 'Deck Prep', description: 'Inspect and prepare the roof deck surface, replacing any damaged boards to ensure a solid base for the new metal roof', unit: 'sq', unit_cost: 20.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-PREP', manufacturer: '' },
      { item_name: 'Panel Install', description: 'Professionally install new metal panels with proper overlap, fastening, and alignment per manufacturer specifications', unit: 'sq', unit_cost: 120.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-MTL', manufacturer: '' },
      { item_name: 'Trim Install', description: 'Install all metal trim pieces (eave, rake, ridge, hip) for a finished, weather-sealed edge around the entire roof', unit: 'lf', unit_cost: 4.00, qty_formula: '{{ lf.eave + lf.rake + lf.ridge + lf.hip }}', sku_pattern: 'LABOR-TRIM', manufacturer: '' },
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
      { item_name: '1" SnapLok Panels 24ga', description: 'Remove old roof and install new premium standing seam metal panels that snap-lock together for a sleek, concealed-fastener finish', unit: 'panel', unit_cost: 85.00, qty_formula: '{{ ceil(waste.12pct.sqft / 16) }}', sku_pattern: 'SNAP-1-24-*', manufacturer: 'Standing Seam', measurement_type: 'roof_area' },
      { item_name: 'Polyglass XFR Underlayment', description: 'High-temperature synthetic barrier installed beneath metal panels for secondary leak protection and noise reduction', unit: 'roll', unit_cost: 125.00, qty_formula: '{{ ceil(roof.squares / 4) }}', sku_pattern: 'POLY-XFR', manufacturer: 'Polyglass', measurement_type: 'roof_squares' },
      { item_name: 'SnapLok Ridge Cap', description: 'Pre-formed metal cap installed along the roof peak to seal the top where panels meet and prevent water entry', unit: 'piece', unit_cost: 65.00, qty_formula: '{{ ceil(lf.ridge / 10.5) }}', sku_pattern: 'SNAP-RIDGE', manufacturer: 'Standing Seam', measurement_type: 'linear_ridge' },
      { item_name: 'SnapLok Hip Cap', description: 'Pre-formed metal cap installed along hip lines where two roof slopes meet at an angle', unit: 'piece', unit_cost: 65.00, qty_formula: '{{ ceil(lf.hip / 10.5) }}', sku_pattern: 'SNAP-HIP', manufacturer: 'Standing Seam', measurement_type: 'linear_hip' },
      { item_name: 'SnapLok Eave Trim', description: 'Finished metal trim installed along the lower edge of the roof to direct water into gutters and provide a clean edge', unit: 'piece', unit_cost: 42.00, qty_formula: '{{ ceil(lf.eave / 10.5) }}', sku_pattern: 'SNAP-EAVE', manufacturer: 'Standing Seam', measurement_type: 'linear_eave' },
      { item_name: 'SnapLok Rake Trim', description: 'Finished metal trim installed along the sloped edges of the roof for a clean, sealed appearance', unit: 'piece', unit_cost: 42.00, qty_formula: '{{ ceil(lf.rake / 10.5) }}', sku_pattern: 'SNAP-RAKE', manufacturer: 'Standing Seam', measurement_type: 'linear_rake' },
      { item_name: 'Pancake Screws #12 x 1.5"', description: 'Heavy-duty metal roofing screws with rubber washers to fasten clips and trim while preventing leaks', unit: 'box', unit_cost: 55.00, qty_formula: '{{ ceil(roof.squares * 70 / 250) }}', sku_pattern: 'SCR-PAN-12', manufacturer: 'Generic', measurement_type: 'roof_squares' },
      { item_name: 'SS Pipe Boot', description: 'Metal-compatible flashing fitted around plumbing vent pipes to prevent leaks at roof penetrations', unit: 'each', unit_cost: 55.00, qty_formula: '{{ pen.pipe_vent }}', sku_pattern: 'BOOT-SS', manufacturer: 'Generic', measurement_type: 'penetrations' },
    ],
    labor: [
      { item_name: 'Tear Off', description: 'Remove and dispose of all existing roofing materials down to the bare deck', unit: 'sq', unit_cost: 60.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-TEAR', manufacturer: '' },
      { item_name: 'Deck Prep', description: 'Inspect and prepare the roof deck surface, replacing any damaged boards to ensure a solid base for the new metal roof', unit: 'sq', unit_cost: 25.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-PREP', manufacturer: '' },
      { item_name: 'Standing Seam Install', description: 'Professionally install new standing seam panels with concealed clips and snap-lock seaming for a watertight finish', unit: 'sq', unit_cost: 175.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-SS', manufacturer: '' },
      { item_name: 'Trim Install', description: 'Install all metal trim pieces (eave, rake, ridge, hip) for a finished, weather-sealed edge around the entire roof', unit: 'lf', unit_cost: 5.50, qty_formula: '{{ lf.eave + lf.rake + lf.ridge + lf.hip }}', sku_pattern: 'LABOR-TRIM', manufacturer: '' },
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
      { item_name: 'Worthouse Dura Profile Panels', description: 'Remove old roof and install new stone-coated steel panels that combine the beauty of tile with the strength and light weight of metal', unit: 'panel', unit_cost: 48.75, qty_formula: '{{ ceil(waste.10pct.sqft / 5.6) }}', sku_pattern: 'WH-DURA-*', manufacturer: 'Worthouse', measurement_type: 'roof_area' },
      { item_name: 'Synthetic Underlayment', description: 'Waterproof barrier installed over the roof deck beneath the panels as a secondary layer of leak protection', unit: 'roll', unit_cost: 75.00, qty_formula: '{{ ceil(roof.squares / 10) }}', sku_pattern: 'SYNTH-UL', manufacturer: 'Generic', measurement_type: 'roof_squares' },
      { item_name: 'Dura Ridge Cap', description: 'Stone-coated steel cap installed along the roof peak to seal the top where panels meet and match the roof finish', unit: 'piece', unit_cost: 28.00, qty_formula: '{{ ceil(lf.ridge / 3.5) }}', sku_pattern: 'WH-DURA-RDG', manufacturer: 'Worthouse', measurement_type: 'linear_ridge' },
      { item_name: 'Dura Hip Cap', description: 'Stone-coated steel cap installed along hip lines where two roof slopes meet, matching the panel finish', unit: 'piece', unit_cost: 28.00, qty_formula: '{{ ceil(lf.hip / 3.5) }}', sku_pattern: 'WH-DURA-HIP', manufacturer: 'Worthouse', measurement_type: 'linear_hip' },
      { item_name: 'Dura Starter Panel', description: 'First-course panel installed along the eave to provide a secure base and proper alignment for the field panels above', unit: 'piece', unit_cost: 18.00, qty_formula: '{{ ceil(lf.eave / 4) }}', sku_pattern: 'WH-DURA-STR', manufacturer: 'Worthouse', measurement_type: 'linear_eave' },
      { item_name: 'Dura Rake Trim', description: 'Finished trim installed along the sloped edges of the roof for a clean, sealed appearance', unit: 'piece', unit_cost: 22.00, qty_formula: '{{ ceil(lf.rake / 4) }}', sku_pattern: 'WH-DURA-RK', manufacturer: 'Worthouse', measurement_type: 'linear_rake' },
      { item_name: 'Stone Coated Nails', description: 'Color-matched nails designed for stone-coated steel to blend seamlessly with the panel finish', unit: 'box', unit_cost: 55.00, qty_formula: '{{ ceil(roof.squares * 80 / 250) }}', sku_pattern: 'NAIL-WH-*', manufacturer: 'Worthouse', measurement_type: 'roof_squares' },
      { item_name: 'Touch-Up Stone Chips', description: 'Matching stone granules used to repair any chips or scratches from cutting and handling during installation', unit: 'bag', unit_cost: 25.00, qty_formula: '{{ max(1, ceil(roof.squares / 40)) }}', sku_pattern: 'WH-CHIP-*', manufacturer: 'Worthouse', measurement_type: 'roof_squares' },
      { item_name: 'Stone Coated Pipe Boot', description: 'Color-matched flashing fitted around plumbing vent pipes to prevent leaks at roof penetrations', unit: 'each', unit_cost: 45.00, qty_formula: '{{ pen.pipe_vent }}', sku_pattern: 'BOOT-SC', manufacturer: 'Worthouse', measurement_type: 'penetrations' },
    ],
    labor: [
      { item_name: 'Tear Off', description: 'Remove and dispose of all existing roofing materials down to the bare deck', unit: 'sq', unit_cost: 55.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-TEAR', manufacturer: '' },
      { item_name: 'Deck Prep', description: 'Inspect and prepare the roof deck surface, replacing any damaged boards to ensure a solid base for the new roof', unit: 'sq', unit_cost: 18.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-PREP', manufacturer: '' },
      { item_name: 'Stone Coated Install', description: 'Professionally install new stone-coated steel panels per manufacturer specifications to maintain full warranty coverage', unit: 'sq', unit_cost: 145.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-SC', manufacturer: '' },
      { item_name: 'Trim Install', description: 'Install all trim pieces (eave, rake, ridge, hip) for a finished, weather-sealed edge around the entire roof', unit: 'lf', unit_cost: 4.50, qty_formula: '{{ lf.eave + lf.rake + lf.ridge + lf.hip }}', sku_pattern: 'LABOR-TRIM', manufacturer: '' },
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
      { item_name: 'Worthouse Supre Profile Panels', description: 'Remove old roof and install new premium stone-coated steel panels with a shake-style profile for upscale curb appeal and metal durability', unit: 'panel', unit_cost: 55.00, qty_formula: '{{ ceil(waste.10pct.sqft / 5.2) }}', sku_pattern: 'WH-SUPRE-*', manufacturer: 'Worthouse', measurement_type: 'roof_area' },
      { item_name: 'Synthetic Underlayment', description: 'Waterproof barrier installed over the roof deck beneath the panels as a secondary layer of leak protection', unit: 'roll', unit_cost: 75.00, qty_formula: '{{ ceil(roof.squares / 10) }}', sku_pattern: 'SYNTH-UL', manufacturer: 'Generic', measurement_type: 'roof_squares' },
      { item_name: 'Supre Ridge Cap', description: 'Stone-coated steel cap installed along the roof peak to seal the top where panels meet and match the roof finish', unit: 'piece', unit_cost: 32.00, qty_formula: '{{ ceil(lf.ridge / 3.5) }}', sku_pattern: 'WH-SUPRE-RDG', manufacturer: 'Worthouse', measurement_type: 'linear_ridge' },
      { item_name: 'Supre Hip Cap', description: 'Stone-coated steel cap installed along hip lines where two roof slopes meet, matching the panel finish', unit: 'piece', unit_cost: 32.00, qty_formula: '{{ ceil(lf.hip / 3.5) }}', sku_pattern: 'WH-SUPRE-HIP', manufacturer: 'Worthouse', measurement_type: 'linear_hip' },
      { item_name: 'Supre Starter Panel', description: 'First-course panel installed along the eave to provide a secure base and proper alignment for the field panels above', unit: 'piece', unit_cost: 20.00, qty_formula: '{{ ceil(lf.eave / 4) }}', sku_pattern: 'WH-SUPRE-STR', manufacturer: 'Worthouse', measurement_type: 'linear_eave' },
      { item_name: 'Supre Rake Trim', description: 'Finished trim installed along the sloped edges of the roof for a clean, sealed appearance', unit: 'piece', unit_cost: 25.00, qty_formula: '{{ ceil(lf.rake / 4) }}', sku_pattern: 'WH-SUPRE-RK', manufacturer: 'Worthouse', measurement_type: 'linear_rake' },
      { item_name: 'Stone Coated Nails', description: 'Color-matched nails designed for stone-coated steel to blend seamlessly with the panel finish', unit: 'box', unit_cost: 55.00, qty_formula: '{{ ceil(roof.squares * 80 / 250) }}', sku_pattern: 'NAIL-WH-*', manufacturer: 'Worthouse', measurement_type: 'roof_squares' },
      { item_name: 'Touch-Up Stone Chips', description: 'Matching stone granules used to repair any chips or scratches from cutting and handling during installation', unit: 'bag', unit_cost: 28.00, qty_formula: '{{ max(1, ceil(roof.squares / 40)) }}', sku_pattern: 'WH-CHIP-*', manufacturer: 'Worthouse', measurement_type: 'roof_squares' },
      { item_name: 'Stone Coated Pipe Boot', description: 'Color-matched flashing fitted around plumbing vent pipes to prevent leaks at roof penetrations', unit: 'each', unit_cost: 48.00, qty_formula: '{{ pen.pipe_vent }}', sku_pattern: 'BOOT-SC', manufacturer: 'Worthouse', measurement_type: 'penetrations' },
    ],
    labor: [
      { item_name: 'Tear Off', description: 'Remove and dispose of all existing roofing materials down to the bare deck', unit: 'sq', unit_cost: 55.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-TEAR', manufacturer: '' },
      { item_name: 'Deck Prep', description: 'Inspect and prepare the roof deck surface, replacing any damaged boards to ensure a solid base for the new roof', unit: 'sq', unit_cost: 18.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-PREP', manufacturer: '' },
      { item_name: 'Stone Coated Install', description: 'Professionally install new stone-coated steel panels per manufacturer specifications to maintain full warranty coverage', unit: 'sq', unit_cost: 155.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-SC', manufacturer: '' },
      { item_name: 'Trim Install', description: 'Install all trim pieces (eave, rake, ridge, hip) for a finished, weather-sealed edge around the entire roof', unit: 'lf', unit_cost: 4.50, qty_formula: '{{ lf.eave + lf.rake + lf.ridge + lf.hip }}', sku_pattern: 'LABOR-TRIM', manufacturer: '' },
    ],
  },
  // 9. Boral Flat Tile
  {
    name: 'Boral Flat Tile',
    description: 'Boral flat profile concrete tile system.',
    brand: 'Boral',
    productLine: 'Flat Tile',
    roofType: 'tile',
    materials: [
      { item_name: 'Boral Flat Tile', description: 'Remove old roof and install new flat-profile concrete tiles for a clean, modern look with decades of durability', unit: 'piece', unit_cost: 2.85, qty_formula: '{{ ceil(waste.15pct.sqft * 0.9) }}', sku_pattern: 'BORAL-FLAT-*', manufacturer: 'Boral', measurement_type: 'roof_area' },
      { item_name: 'Boral Ridge Tile', description: 'Concrete cap tiles installed along the peak and hip lines of your roof for a finished, watertight seal', unit: 'piece', unit_cost: 8.50, qty_formula: '{{ ceil((lf.ridge + lf.hip) / 1.5) }}', sku_pattern: 'BORAL-RDG', manufacturer: 'Boral', measurement_type: 'linear_ridge' },
      { item_name: '30# Felt Underlayment', description: 'Heavy-duty felt paper installed over the deck as a waterproof barrier beneath the tiles', unit: 'roll', unit_cost: 45.00, qty_formula: '{{ ceil(roof.squares / 4) }}', sku_pattern: 'FELT-30', manufacturer: 'Generic', measurement_type: 'roof_squares' },
      { item_name: 'Tile Battens 1x2', description: 'Treated wood strips fastened across the deck to provide a secure nailing surface and proper spacing for each row of tiles', unit: 'lf', unit_cost: 0.45, qty_formula: '{{ ceil(roof.total_sqft / 12) }}', sku_pattern: 'BATTEN-1X2', manufacturer: 'Generic', measurement_type: 'roof_area' },
      { item_name: 'Drip Edge', description: 'Metal edge flashing installed along the roof perimeter to direct water away from the fascia and into gutters', unit: 'piece', unit_cost: 9.00, qty_formula: '{{ ceil((lf.eave + lf.rake) / 10) }}', sku_pattern: 'DRP-EDGE', manufacturer: 'Generic', measurement_type: 'linear_perimeter' },
      { item_name: 'Tile Adhesive', description: 'High-strength adhesive used to bond ridge and hip tiles securely in place for long-term wind resistance', unit: 'tube', unit_cost: 12.00, qty_formula: '{{ ceil(roof.squares / 3) }}', sku_pattern: 'TILE-ADH', manufacturer: 'Generic', measurement_type: 'roof_squares' },
      { item_name: 'Tile Nails', description: 'Corrosion-resistant stainless steel nails used to fasten each tile securely to the battens', unit: 'box', unit_cost: 55.00, qty_formula: '{{ ceil(roof.squares / 5) }}', sku_pattern: 'NAIL-TILE-SS', manufacturer: 'Generic', measurement_type: 'roof_squares' },
    ],
    labor: [
      { item_name: 'Tile Tear Off', description: 'Remove and dispose of all existing tile, underlayment, and battens down to the bare deck', unit: 'sq', unit_cost: 75.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-TEAR-TILE', manufacturer: '' },
      { item_name: 'Batten Install', description: 'Install treated wood battens across the entire deck to create a level nailing grid for the new tiles', unit: 'sq', unit_cost: 25.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-BATTEN', manufacturer: '' },
      { item_name: 'Tile Install', description: 'Professionally install new concrete tiles per manufacturer specifications to maintain full warranty coverage', unit: 'sq', unit_cost: 165.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-TILE', manufacturer: '' },
      { item_name: 'Hip/Ridge Install', description: 'Install ridge and hip cap tiles with adhesive along all peaks and hip lines for a watertight, finished appearance', unit: 'lf', unit_cost: 8.00, qty_formula: '{{ lf.ridge + lf.hip }}', sku_pattern: 'LABOR-RIDGE-TILE', manufacturer: '' },
      { item_name: 'Cleanup/Haul', description: 'Complete job-site cleanup and haul all old tile and debris to the dump (tile is heavier than other roofing materials)', unit: 'job', unit_cost: 450.00, qty_formula: '1', sku_pattern: 'LABOR-CLEAN', manufacturer: '' },
    ],
  },
  // 10. Eagle Flat Tile
  {
    name: 'Eagle Flat Tile',
    description: 'Eagle flat profile concrete tile system.',
    brand: 'Eagle',
    productLine: 'Flat Tile',
    roofType: 'tile',
    materials: [
      { item_name: 'Eagle Flat Tile', description: 'Remove old roof and install new flat-profile concrete tiles for a clean, modern look with decades of durability', unit: 'piece', unit_cost: 2.95, qty_formula: '{{ ceil(waste.15pct.sqft * 0.9) }}', sku_pattern: 'EAGLE-FLAT-*', manufacturer: 'Eagle', measurement_type: 'roof_area' },
      { item_name: 'Eagle Ridge Tile', description: 'Concrete cap tiles installed along the peak and hip lines of your roof for a finished, watertight seal', unit: 'piece', unit_cost: 8.75, qty_formula: '{{ ceil((lf.ridge + lf.hip) / 1.5) }}', sku_pattern: 'EAGLE-RDG', manufacturer: 'Eagle', measurement_type: 'linear_ridge' },
      { item_name: '30# Felt Underlayment', description: 'Heavy-duty felt paper installed over the deck as a waterproof barrier beneath the tiles', unit: 'roll', unit_cost: 45.00, qty_formula: '{{ ceil(roof.squares / 4) }}', sku_pattern: 'FELT-30', manufacturer: 'Generic', measurement_type: 'roof_squares' },
      { item_name: 'Tile Battens 1x2', description: 'Treated wood strips fastened across the deck to provide a secure nailing surface and proper spacing for each row of tiles', unit: 'lf', unit_cost: 0.45, qty_formula: '{{ ceil(roof.total_sqft / 12) }}', sku_pattern: 'BATTEN-1X2', manufacturer: 'Generic', measurement_type: 'roof_area' },
      { item_name: 'Drip Edge', description: 'Metal edge flashing installed along the roof perimeter to direct water away from the fascia and into gutters', unit: 'piece', unit_cost: 9.00, qty_formula: '{{ ceil((lf.eave + lf.rake) / 10) }}', sku_pattern: 'DRP-EDGE', manufacturer: 'Generic', measurement_type: 'linear_perimeter' },
      { item_name: 'Tile Adhesive', description: 'High-strength adhesive used to bond ridge and hip tiles securely in place for long-term wind resistance', unit: 'tube', unit_cost: 12.00, qty_formula: '{{ ceil(roof.squares / 3) }}', sku_pattern: 'TILE-ADH', manufacturer: 'Generic', measurement_type: 'roof_squares' },
      { item_name: 'Tile Nails', description: 'Corrosion-resistant stainless steel nails used to fasten each tile securely to the battens', unit: 'box', unit_cost: 55.00, qty_formula: '{{ ceil(roof.squares / 5) }}', sku_pattern: 'NAIL-TILE-SS', manufacturer: 'Generic', measurement_type: 'roof_squares' },
    ],
    labor: [
      { item_name: 'Tile Tear Off', description: 'Remove and dispose of all existing tile, underlayment, and battens down to the bare deck', unit: 'sq', unit_cost: 75.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-TEAR-TILE', manufacturer: '' },
      { item_name: 'Batten Install', description: 'Install treated wood battens across the entire deck to create a level nailing grid for the new tiles', unit: 'sq', unit_cost: 25.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-BATTEN', manufacturer: '' },
      { item_name: 'Tile Install', description: 'Professionally install new concrete tiles per manufacturer specifications to maintain full warranty coverage', unit: 'sq', unit_cost: 170.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-TILE', manufacturer: '' },
      { item_name: 'Hip/Ridge Install', description: 'Install ridge and hip cap tiles with adhesive along all peaks and hip lines for a watertight, finished appearance', unit: 'lf', unit_cost: 8.00, qty_formula: '{{ lf.ridge + lf.hip }}', sku_pattern: 'LABOR-RIDGE-TILE', manufacturer: '' },
      { item_name: 'Cleanup/Haul', description: 'Complete job-site cleanup and haul all old tile and debris to the dump (tile is heavier than other roofing materials)', unit: 'job', unit_cost: 450.00, qty_formula: '1', sku_pattern: 'LABOR-CLEAN', manufacturer: '' },
    ],
  },
  // 11. Boral W Tile
  {
    name: 'Boral W Tile',
    description: 'Boral W-profile concrete tile system.',
    brand: 'Boral',
    productLine: 'W Tile',
    roofType: 'tile',
    materials: [
      { item_name: 'Boral W Tile', description: 'Remove old roof and install new W-profile concrete tiles for a classic, wave-shaped appearance with superior durability', unit: 'piece', unit_cost: 3.15, qty_formula: '{{ ceil(waste.15pct.sqft * 0.85) }}', sku_pattern: 'BORAL-W-*', manufacturer: 'Boral', measurement_type: 'roof_area' },
      { item_name: 'Boral W Ridge Tile', description: 'Concrete cap tiles installed along the peak and hip lines of your roof for a finished, watertight seal', unit: 'piece', unit_cost: 9.50, qty_formula: '{{ ceil((lf.ridge + lf.hip) / 1.5) }}', sku_pattern: 'BORAL-W-RDG', manufacturer: 'Boral', measurement_type: 'linear_ridge' },
      { item_name: '30# Felt Underlayment', description: 'Heavy-duty felt paper installed over the deck as a waterproof barrier beneath the tiles', unit: 'roll', unit_cost: 45.00, qty_formula: '{{ ceil(roof.squares / 4) }}', sku_pattern: 'FELT-30', manufacturer: 'Generic', measurement_type: 'roof_squares' },
      { item_name: 'Tile Battens 1x2', description: 'Treated wood strips fastened across the deck to provide a secure nailing surface and proper spacing for each row of tiles', unit: 'lf', unit_cost: 0.45, qty_formula: '{{ ceil(roof.total_sqft / 12) }}', sku_pattern: 'BATTEN-1X2', manufacturer: 'Generic', measurement_type: 'roof_area' },
      { item_name: 'Drip Edge', description: 'Metal edge flashing installed along the roof perimeter to direct water away from the fascia and into gutters', unit: 'piece', unit_cost: 9.00, qty_formula: '{{ ceil((lf.eave + lf.rake) / 10) }}', sku_pattern: 'DRP-EDGE', manufacturer: 'Generic', measurement_type: 'linear_perimeter' },
      { item_name: 'Tile Adhesive', description: 'High-strength adhesive used to bond ridge and hip tiles securely in place for long-term wind resistance', unit: 'tube', unit_cost: 12.00, qty_formula: '{{ ceil(roof.squares / 3) }}', sku_pattern: 'TILE-ADH', manufacturer: 'Generic', measurement_type: 'roof_squares' },
      { item_name: 'Tile Nails', description: 'Corrosion-resistant stainless steel nails used to fasten each tile securely to the battens', unit: 'box', unit_cost: 55.00, qty_formula: '{{ ceil(roof.squares / 5) }}', sku_pattern: 'NAIL-TILE-SS', manufacturer: 'Generic', measurement_type: 'roof_squares' },
    ],
    labor: [
      { item_name: 'Tile Tear Off', description: 'Remove and dispose of all existing tile, underlayment, and battens down to the bare deck', unit: 'sq', unit_cost: 75.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-TEAR-TILE', manufacturer: '' },
      { item_name: 'Batten Install', description: 'Install treated wood battens across the entire deck to create a level nailing grid for the new tiles', unit: 'sq', unit_cost: 25.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-BATTEN', manufacturer: '' },
      { item_name: 'Tile Install', description: 'Professionally install new concrete tiles per manufacturer specifications to maintain full warranty coverage', unit: 'sq', unit_cost: 175.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-TILE', manufacturer: '' },
      { item_name: 'Hip/Ridge Install', description: 'Install ridge and hip cap tiles with adhesive along all peaks and hip lines for a watertight, finished appearance', unit: 'lf', unit_cost: 9.00, qty_formula: '{{ lf.ridge + lf.hip }}', sku_pattern: 'LABOR-RIDGE-TILE', manufacturer: '' },
      { item_name: 'Cleanup/Haul', description: 'Complete job-site cleanup and haul all old tile and debris to the dump (tile is heavier than other roofing materials)', unit: 'job', unit_cost: 475.00, qty_formula: '1', sku_pattern: 'LABOR-CLEAN', manufacturer: '' },
    ],
  },
  // 12. Eagle W Tile
  {
    name: 'Eagle W Tile',
    description: 'Eagle W-profile concrete tile system.',
    brand: 'Eagle',
    productLine: 'W Tile',
    roofType: 'tile',
    materials: [
      { item_name: 'Eagle W Tile', description: 'Remove old roof and install new W-profile concrete tiles for a classic, wave-shaped appearance with superior durability', unit: 'piece', unit_cost: 3.25, qty_formula: '{{ ceil(waste.15pct.sqft * 0.85) }}', sku_pattern: 'EAGLE-W-*', manufacturer: 'Eagle', measurement_type: 'roof_area' },
      { item_name: 'Eagle W Ridge Tile', description: 'Concrete cap tiles installed along the peak and hip lines of your roof for a finished, watertight seal', unit: 'piece', unit_cost: 9.75, qty_formula: '{{ ceil((lf.ridge + lf.hip) / 1.5) }}', sku_pattern: 'EAGLE-W-RDG', manufacturer: 'Eagle', measurement_type: 'linear_ridge' },
      { item_name: '30# Felt Underlayment', description: 'Heavy-duty felt paper installed over the deck as a waterproof barrier beneath the tiles', unit: 'roll', unit_cost: 45.00, qty_formula: '{{ ceil(roof.squares / 4) }}', sku_pattern: 'FELT-30', manufacturer: 'Generic', measurement_type: 'roof_squares' },
      { item_name: 'Tile Battens 1x2', description: 'Treated wood strips fastened across the deck to provide a secure nailing surface and proper spacing for each row of tiles', unit: 'lf', unit_cost: 0.45, qty_formula: '{{ ceil(roof.total_sqft / 12) }}', sku_pattern: 'BATTEN-1X2', manufacturer: 'Generic', measurement_type: 'roof_area' },
      { item_name: 'Drip Edge', description: 'Metal edge flashing installed along the roof perimeter to direct water away from the fascia and into gutters', unit: 'piece', unit_cost: 9.00, qty_formula: '{{ ceil((lf.eave + lf.rake) / 10) }}', sku_pattern: 'DRP-EDGE', manufacturer: 'Generic', measurement_type: 'linear_perimeter' },
      { item_name: 'Tile Adhesive', description: 'High-strength adhesive used to bond ridge and hip tiles securely in place for long-term wind resistance', unit: 'tube', unit_cost: 12.00, qty_formula: '{{ ceil(roof.squares / 3) }}', sku_pattern: 'TILE-ADH', manufacturer: 'Generic', measurement_type: 'roof_squares' },
      { item_name: 'Tile Nails', description: 'Corrosion-resistant stainless steel nails used to fasten each tile securely to the battens', unit: 'box', unit_cost: 55.00, qty_formula: '{{ ceil(roof.squares / 5) }}', sku_pattern: 'NAIL-TILE-SS', manufacturer: 'Generic', measurement_type: 'roof_squares' },
    ],
    labor: [
      { item_name: 'Tile Tear Off', description: 'Remove and dispose of all existing tile, underlayment, and battens down to the bare deck', unit: 'sq', unit_cost: 75.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-TEAR-TILE', manufacturer: '' },
      { item_name: 'Batten Install', description: 'Install treated wood battens across the entire deck to create a level nailing grid for the new tiles', unit: 'sq', unit_cost: 25.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-BATTEN', manufacturer: '' },
      { item_name: 'Tile Install', description: 'Professionally install new concrete tiles per manufacturer specifications to maintain full warranty coverage', unit: 'sq', unit_cost: 180.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-TILE', manufacturer: '' },
      { item_name: 'Hip/Ridge Install', description: 'Install ridge and hip cap tiles with adhesive along all peaks and hip lines for a watertight, finished appearance', unit: 'lf', unit_cost: 9.00, qty_formula: '{{ lf.ridge + lf.hip }}', sku_pattern: 'LABOR-RIDGE-TILE', manufacturer: '' },
      { item_name: 'Cleanup/Haul', description: 'Complete job-site cleanup and haul all old tile and debris to the dump (tile is heavier than other roofing materials)', unit: 'job', unit_cost: 475.00, qty_formula: '1', sku_pattern: 'LABOR-CLEAN', manufacturer: '' },
    ],
  },
  // 13. Boral S Tile (Mission Style)
  {
    name: 'Boral S Tile',
    description: 'Boral S-profile (barrel/mission) concrete tile system.',
    brand: 'Boral',
    productLine: 'S Tile',
    roofType: 'tile',
    materials: [
      { item_name: 'Boral S Tile', description: 'Remove old roof and install new barrel-shaped concrete tiles for a traditional Spanish/Mediterranean look with lasting durability', unit: 'piece', unit_cost: 3.45, qty_formula: '{{ ceil(waste.15pct.sqft * 0.8) }}', sku_pattern: 'BORAL-S-*', manufacturer: 'Boral', measurement_type: 'roof_area' },
      { item_name: 'Boral S Ridge Tile', description: 'Barrel-shaped cap tiles installed along the peak and hip lines of your roof for a finished, watertight seal', unit: 'piece', unit_cost: 10.50, qty_formula: '{{ ceil((lf.ridge + lf.hip) / 1.5) }}', sku_pattern: 'BORAL-S-RDG', manufacturer: 'Boral', measurement_type: 'linear_ridge' },
      { item_name: '30# Felt Underlayment', description: 'Heavy-duty felt paper installed over the deck as a waterproof barrier beneath the tiles', unit: 'roll', unit_cost: 45.00, qty_formula: '{{ ceil(roof.squares / 4) }}', sku_pattern: 'FELT-30', manufacturer: 'Generic', measurement_type: 'roof_squares' },
      { item_name: 'Tile Battens 1x2', description: 'Treated wood strips fastened across the deck to provide a secure nailing surface and proper spacing for each row of tiles', unit: 'lf', unit_cost: 0.45, qty_formula: '{{ ceil(roof.total_sqft / 12) }}', sku_pattern: 'BATTEN-1X2', manufacturer: 'Generic', measurement_type: 'roof_area' },
      { item_name: 'Drip Edge', description: 'Metal edge flashing installed along the roof perimeter to direct water away from the fascia and into gutters', unit: 'piece', unit_cost: 9.00, qty_formula: '{{ ceil((lf.eave + lf.rake) / 10) }}', sku_pattern: 'DRP-EDGE', manufacturer: 'Generic', measurement_type: 'linear_perimeter' },
      { item_name: 'Tile Mortar', description: 'Mortar mix used to set and seal barrel ridge and hip tiles for a permanent, weatherproof bond', unit: 'bag', unit_cost: 18.00, qty_formula: '{{ ceil(roof.squares / 3) }}', sku_pattern: 'MORTAR-TILE', manufacturer: 'Generic', measurement_type: 'roof_squares' },
      { item_name: 'Tile Nails', description: 'Corrosion-resistant stainless steel nails used to fasten each tile securely to the battens', unit: 'box', unit_cost: 55.00, qty_formula: '{{ ceil(roof.squares / 5) }}', sku_pattern: 'NAIL-TILE-SS', manufacturer: 'Generic', measurement_type: 'roof_squares' },
    ],
    labor: [
      { item_name: 'Tile Tear Off', description: 'Remove and dispose of all existing tile, mortar, underlayment, and battens down to the bare deck', unit: 'sq', unit_cost: 85.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-TEAR-TILE', manufacturer: '' },
      { item_name: 'Batten Install', description: 'Install treated wood battens across the entire deck to create a level nailing grid for the new tiles', unit: 'sq', unit_cost: 28.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-BATTEN', manufacturer: '' },
      { item_name: 'Tile Install', description: 'Professionally install new barrel concrete tiles per manufacturer specifications to maintain full warranty coverage', unit: 'sq', unit_cost: 195.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-TILE', manufacturer: '' },
      { item_name: 'Hip/Ridge Install', description: 'Install ridge and hip cap tiles with mortar along all peaks and hip lines for a watertight, finished appearance', unit: 'lf', unit_cost: 12.00, qty_formula: '{{ lf.ridge + lf.hip }}', sku_pattern: 'LABOR-RIDGE-TILE', manufacturer: '' },
      { item_name: 'Cleanup/Haul', description: 'Complete job-site cleanup and haul all old tile, mortar, and debris to the dump (tile is heavier than other roofing materials)', unit: 'job', unit_cost: 500.00, qty_formula: '1', sku_pattern: 'LABOR-CLEAN', manufacturer: '' },
    ],
  },
  // 14. Eagle S Tile
  {
    name: 'Eagle S Tile',
    description: 'Eagle S-profile (barrel/mission) concrete tile system.',
    brand: 'Eagle',
    productLine: 'S Tile',
    roofType: 'tile',
    materials: [
      { item_name: 'Eagle S Tile', description: 'Remove old roof and install new barrel-shaped concrete tiles for a traditional Spanish/Mediterranean look with lasting durability', unit: 'piece', unit_cost: 3.55, qty_formula: '{{ ceil(waste.15pct.sqft * 0.8) }}', sku_pattern: 'EAGLE-S-*', manufacturer: 'Eagle', measurement_type: 'roof_area' },
      { item_name: 'Eagle S Ridge Tile', description: 'Barrel-shaped cap tiles installed along the peak and hip lines of your roof for a finished, watertight seal', unit: 'piece', unit_cost: 10.75, qty_formula: '{{ ceil((lf.ridge + lf.hip) / 1.5) }}', sku_pattern: 'EAGLE-S-RDG', manufacturer: 'Eagle', measurement_type: 'linear_ridge' },
      { item_name: '30# Felt Underlayment', description: 'Heavy-duty felt paper installed over the deck as a waterproof barrier beneath the tiles', unit: 'roll', unit_cost: 45.00, qty_formula: '{{ ceil(roof.squares / 4) }}', sku_pattern: 'FELT-30', manufacturer: 'Generic', measurement_type: 'roof_squares' },
      { item_name: 'Tile Battens 1x2', description: 'Treated wood strips fastened across the deck to provide a secure nailing surface and proper spacing for each row of tiles', unit: 'lf', unit_cost: 0.45, qty_formula: '{{ ceil(roof.total_sqft / 12) }}', sku_pattern: 'BATTEN-1X2', manufacturer: 'Generic', measurement_type: 'roof_area' },
      { item_name: 'Drip Edge', description: 'Metal edge flashing installed along the roof perimeter to direct water away from the fascia and into gutters', unit: 'piece', unit_cost: 9.00, qty_formula: '{{ ceil((lf.eave + lf.rake) / 10) }}', sku_pattern: 'DRP-EDGE', manufacturer: 'Generic', measurement_type: 'linear_perimeter' },
      { item_name: 'Tile Mortar', description: 'Mortar mix used to set and seal barrel ridge and hip tiles for a permanent, weatherproof bond', unit: 'bag', unit_cost: 18.00, qty_formula: '{{ ceil(roof.squares / 3) }}', sku_pattern: 'MORTAR-TILE', manufacturer: 'Generic', measurement_type: 'roof_squares' },
      { item_name: 'Tile Nails', description: 'Corrosion-resistant stainless steel nails used to fasten each tile securely to the battens', unit: 'box', unit_cost: 55.00, qty_formula: '{{ ceil(roof.squares / 5) }}', sku_pattern: 'NAIL-TILE-SS', manufacturer: 'Generic', measurement_type: 'roof_squares' },
    ],
    labor: [
      { item_name: 'Tile Tear Off', description: 'Remove and dispose of all existing tile, mortar, underlayment, and battens down to the bare deck', unit: 'sq', unit_cost: 85.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-TEAR-TILE', manufacturer: '' },
      { item_name: 'Batten Install', description: 'Install treated wood battens across the entire deck to create a level nailing grid for the new tiles', unit: 'sq', unit_cost: 28.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-BATTEN', manufacturer: '' },
      { item_name: 'Tile Install', description: 'Professionally install new barrel concrete tiles per manufacturer specifications to maintain full warranty coverage', unit: 'sq', unit_cost: 200.00, qty_formula: '{{ roof.squares }}', sku_pattern: 'LABOR-TILE', manufacturer: '' },
      { item_name: 'Hip/Ridge Install', description: 'Install ridge and hip cap tiles with mortar along all peaks and hip lines for a watertight, finished appearance', unit: 'lf', unit_cost: 12.00, qty_formula: '{{ lf.ridge + lf.hip }}', sku_pattern: 'LABOR-RIDGE-TILE', manufacturer: '' },
      { item_name: 'Cleanup/Haul', description: 'Complete job-site cleanup and haul all old tile, mortar, and debris to the dump (tile is heavier than other roofing materials)', unit: 'job', unit_cost: 500.00, qty_formula: '1', sku_pattern: 'LABOR-CLEAN', manufacturer: '' },
    ],
  },
];

/**
 * Add items to an estimate_calculation_template using the NEW tables
 * (estimate_calc_template_groups and estimate_calc_template_items)
 */
async function addTemplateItemsNew(
  calcTemplateId: string, 
  tenantId: string, 
  templateDef: BrandTemplate
): Promise<{ groupsCreated: number; itemsCreated: number; errors: string[] }> {
  const errors: string[] = [];
  let groupsCreated = 0;
  let itemsCreated = 0;

  // First, delete any existing groups and items for this template (clean slate)
  await supabase
    .from('estimate_calc_template_items')
    .delete()
    .eq('calc_template_id', calcTemplateId);
  
  await supabase
    .from('estimate_calc_template_groups')
    .delete()
    .eq('calc_template_id', calcTemplateId);

  // Create Materials group
  let materialsGroupId: string | null = null;
  const { data: matGroup, error: matGroupError } = await supabase
    .from('estimate_calc_template_groups')
    .insert({
      calc_template_id: calcTemplateId,
      tenant_id: tenantId,
      name: 'Materials',
      group_type: 'material',
      sort_order: 1,
    })
    .select('id')
    .single();

  if (matGroupError) {
    errors.push(`Materials group: ${matGroupError.message}`);
  } else {
    materialsGroupId = matGroup.id;
    groupsCreated++;
  }

  // Create Labor group
  let laborGroupId: string | null = null;
  const { data: labGroup, error: labGroupError } = await supabase
    .from('estimate_calc_template_groups')
    .insert({
      calc_template_id: calcTemplateId,
      tenant_id: tenantId,
      name: 'Labor',
      group_type: 'labor',
      sort_order: 2,
    })
    .select('id')
    .single();

  if (labGroupError) {
    errors.push(`Labor group: ${labGroupError.message}`);
  } else {
    laborGroupId = labGroup.id;
    groupsCreated++;
  }

  // Insert material items (proceed even if group creation failed)
  const materialItems = templateDef.materials.map((item, idx) => ({
    calc_template_id: calcTemplateId,
    tenant_id: tenantId,
    group_id: materialsGroupId,
    item_name: item.item_name,
    description: item.description,
    unit: item.unit,
    unit_cost: item.unit_cost,
    qty_formula: item.qty_formula,
    sku_pattern: item.sku_pattern,
    manufacturer: item.manufacturer,
    measurement_type: item.measurement_type,
    sort_order: idx + 1,
    item_type: 'material' as const,
    active: true,
  }));

  if (materialItems.length > 0) {
    const { data: insertedMaterials, error: matItemsError } = await supabase
      .from('estimate_calc_template_items')
      .insert(materialItems)
      .select('id');

    if (matItemsError) {
      errors.push(`Material items: ${matItemsError.message}`);
    } else {
      itemsCreated += insertedMaterials?.length || 0;
    }
  }

  // Insert labor items
  const laborItems = templateDef.labor.map((item, idx) => ({
    calc_template_id: calcTemplateId,
    tenant_id: tenantId,
    group_id: laborGroupId,
    item_name: item.item_name,
    description: item.description,
    unit: item.unit,
    unit_cost: item.unit_cost,
    qty_formula: item.qty_formula,
    sku_pattern: item.sku_pattern,
    manufacturer: item.manufacturer || null,
    measurement_type: item.measurement_type || null,
    sort_order: idx + 1,
    item_type: 'labor' as const,
    active: true,
  }));

  if (laborItems.length > 0) {
    const { data: insertedLabor, error: labItemsError } = await supabase
      .from('estimate_calc_template_items')
      .insert(laborItems)
      .select('id');

    if (labItemsError) {
      errors.push(`Labor items: ${labItemsError.message}`);
    } else {
      itemsCreated += insertedLabor?.length || 0;
    }
  }

  return { groupsCreated, itemsCreated, errors };
}

/**
 * Seed brand templates for a tenant
 * Uses the NEW estimate_calc_template_items table (correct FK)
 */
export async function seedBrandTemplates(tenantId: string): Promise<{ 
  success: boolean; 
  templatesCreated: number; 
  itemsCreated: number;
  error?: string 
}> {
  try {
    let templatesCreated = 0;
    let totalItemsCreated = 0;
    const allErrors: string[] = [];

    for (const templateDef of BRAND_TEMPLATES) {
      // Check if template already exists for this tenant
      const { data: existing } = await supabase
        .from('estimate_calculation_templates')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('name', templateDef.name)
        .maybeSingle();

      let calcTemplateId: string;

      if (existing) {
        // Template exists - we'll re-populate its items
        calcTemplateId = existing.id;
        console.log(`Template "${templateDef.name}" exists, refreshing items...`);
      } else {
        // Create the template
        const roofTypeMap: Record<string, 'shingle' | 'metal' | 'tile'> = {
          'shingle': 'shingle',
          'metal': 'metal',
          'stone_coated': 'tile',
          'tile': 'tile',
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
          allErrors.push(`Template "${templateDef.name}": ${templateError.message}`);
          continue;
        }
        
        calcTemplateId = template.id;
        templatesCreated++;
        console.log(`Created template: ${templateDef.name}`);
      }

      // Add items using the NEW tables
      const result = await addTemplateItemsNew(calcTemplateId, tenantId, templateDef);
      totalItemsCreated += result.itemsCreated;
      
      if (result.errors.length > 0) {
        allErrors.push(...result.errors.map(e => `${templateDef.name}: ${e}`));
      }
      
      console.log(`  → ${result.itemsCreated} items, ${result.groupsCreated} groups`);
    }

    if (totalItemsCreated === 0 && allErrors.length > 0) {
      return { 
        success: false, 
        templatesCreated, 
        itemsCreated: totalItemsCreated,
        error: allErrors.join('; ') 
      };
    }

    return { 
      success: true, 
      templatesCreated, 
      itemsCreated: totalItemsCreated 
    };
  } catch (error) {
    console.error('Error seeding brand templates:', error);
    return { 
      success: false, 
      templatesCreated: 0, 
      itemsCreated: 0,
      error: String(error) 
    };
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
