// ============================================================
// Canonical Insurance Line Item Taxonomy
// Cross-carrier standardized item definitions
// ============================================================

export interface CanonicalItem {
  id?: string;
  canonical_key: string;
  display_name: string;
  category: string;
  subcategory?: string;
  xactimate_selector?: string;
  standard_unit: string;
  alternate_units?: string[];
  is_labor?: boolean;
  is_material?: boolean;
  is_overhead?: boolean;
}

export interface ScopeLineItem {
  id: string;
  header_id: string;
  document_id: string;
  raw_code?: string;
  raw_description: string;
  raw_category?: string;
  quantity?: number;
  unit?: string;
  unit_price?: number;
  total_rcv?: number;
  depreciation_percent?: number;
  depreciation_amount?: number;
  total_acv?: number;
  is_taxable?: boolean;
  tax_amount?: number;
  labor_amount?: number;
  material_amount?: number;
  canonical_item_id?: string;
  mapping_confidence?: number;
  mapping_method?: 'exact' | 'fuzzy' | 'ai' | 'manual';
  line_order?: number;
  section_name?: string;
  canonical_item?: CanonicalItem;
}

export interface ScopeHeader {
  id: string;
  document_id: string;
  total_rcv?: number;
  total_acv?: number;
  total_depreciation?: number;
  recoverable_depreciation?: number;
  non_recoverable_depreciation?: number;
  deductible?: number;
  tax_amount?: number;
  overhead_amount?: number;
  profit_amount?: number;
  total_net_claim?: number;
  supplement_count?: number;
  total_supplement_amount?: number;
  price_list_name?: string;
  price_list_region?: string;
  price_list_effective_date?: string;
  estimate_date?: string;
  property_address?: string;
  property_city?: string;
  property_state?: string;
  property_zip?: string;
}

export interface ScopeDocument {
  id: string;
  tenant_id: string;
  insurance_claim_id?: string;
  job_id?: string;
  document_type: 'estimate' | 'supplement' | 'denial' | 'policy' | 'reinspection' | 'final_settlement';
  file_name: string;
  file_hash: string;
  file_size_bytes?: number;
  storage_path: string;
  carrier_name?: string;
  carrier_normalized?: string;
  adjuster_name?: string;
  claim_number_detected?: string;
  loss_date_detected?: string;
  format_family?: 'xactimate' | 'symbility' | 'corelogic' | 'generic';
  parse_status: 'pending' | 'extracting' | 'parsing' | 'mapping' | 'complete' | 'failed' | 'needs_review';
  parse_started_at?: string;
  parse_completed_at?: string;
  parse_error?: string;
  parser_version?: string;
  raw_text_content?: string;
  raw_json_output?: any;
  created_at: string;
  created_by?: string;
  updated_at: string;
}

export interface LineItemEvidence {
  id: string;
  line_item_id: string;
  document_id: string;
  page_number: number;
  table_index?: number;
  row_index?: number;
  bbox_x?: number;
  bbox_y?: number;
  bbox_width?: number;
  bbox_height?: number;
  snippet_text: string;
  snippet_hash: string;
  field_type: 'code' | 'description' | 'quantity' | 'unit' | 'unit_price' | 'total' | 'depreciation';
}

// Category definitions for grouping
export const ITEM_CATEGORIES = [
  { key: 'Roofing', label: 'Roofing', icon: 'Home' },
  { key: 'Gutters', label: 'Gutters', icon: 'Droplets' },
  { key: 'Siding', label: 'Siding', icon: 'Square' },
  { key: 'Windows', label: 'Windows', icon: 'Grid' },
  { key: 'Interior', label: 'Interior', icon: 'DoorOpen' },
  { key: 'Solar', label: 'Solar', icon: 'Sun' },
  { key: 'General', label: 'General', icon: 'Package' },
] as const;

// Unit normalization map
export const UNIT_NORMALIZATIONS: Record<string, string> = {
  'sq': 'SQ',
  'square': 'SQ',
  'squares': 'SQ',
  'sf': 'SF',
  'sqft': 'SF',
  'sq ft': 'SF',
  'square feet': 'SF',
  'lf': 'LF',
  'lineal feet': 'LF',
  'linear feet': 'LF',
  'ea': 'EA',
  'each': 'EA',
  'hr': 'HR',
  'hour': 'HR',
  'hours': 'HR',
  'bdl': 'BDL',
  'bundle': 'BDL',
  'bundles': 'BDL',
  'rl': 'RL',
  'roll': 'RL',
  'rolls': 'RL',
};

export function normalizeUnit(unit: string | undefined): string {
  if (!unit) return 'EA';
  const lower = unit.toLowerCase().trim();
  return UNIT_NORMALIZATIONS[lower] || unit.toUpperCase();
}

// Carrier display names
export const CARRIER_DISPLAY_NAMES: Record<string, string> = {
  'state_farm': 'State Farm',
  'allstate': 'Allstate',
  'farmers': 'Farmers Insurance',
  'usaa': 'USAA',
  'liberty_mutual': 'Liberty Mutual',
  'progressive': 'Progressive',
  'nationwide': 'Nationwide',
  'travelers': 'Travelers',
  'american_family': 'American Family',
  'geico': 'GEICO',
  'erie': 'Erie Insurance',
  'auto_owners': 'Auto-Owners',
  'citizens': 'Citizens',
  'upcic': 'UPCIC',
  'fednat': 'FedNat',
  'kin': 'Kin Insurance',
  'hippo': 'Hippo',
  'lemonade': 'Lemonade',
};

export function getCarrierDisplayName(normalized: string | undefined): string {
  if (!normalized) return 'Unknown Carrier';
  return CARRIER_DISPLAY_NAMES[normalized] || normalized.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Parse status helpers
export const PARSE_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  'pending': { label: 'Pending', color: 'bg-muted text-muted-foreground' },
  'extracting': { label: 'Extracting...', color: 'bg-blue-100 text-blue-700' },
  'parsing': { label: 'Parsing...', color: 'bg-blue-100 text-blue-700' },
  'mapping': { label: 'Mapping Items...', color: 'bg-amber-100 text-amber-700' },
  'complete': { label: 'Complete', color: 'bg-green-100 text-green-700' },
  'failed': { label: 'Failed', color: 'bg-destructive/10 text-destructive' },
  'needs_review': { label: 'Needs Review', color: 'bg-amber-100 text-amber-700' },
};

export function getParseStatusInfo(status: string): { label: string; color: string } {
  return PARSE_STATUS_LABELS[status] || { label: status, color: 'bg-muted text-muted-foreground' };
}

// Document type labels
export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  'estimate': 'Initial Estimate',
  'supplement': 'Supplement',
  'denial': 'Denial Letter',
  'policy': 'Policy Document',
  'reinspection': 'Re-inspection',
  'final_settlement': 'Final Settlement',
};

export function getDocumentTypeLabel(type: string): string {
  return DOCUMENT_TYPE_LABELS[type] || type;
}
