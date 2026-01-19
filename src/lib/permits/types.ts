/**
 * Permit Expediter Module - Type Definitions
 */

// ========================================
// ENUMS (matching database)
// ========================================

export type JurisdictionType = 'COUNTY' | 'CITY';

export type PortalType = 'ACCELA' | 'ENERGOV' | 'ETRAKIT' | 'CUSTOM' | 'UNKNOWN';

export type PermitCaseStatus =
  | 'NOT_STARTED'
  | 'DRAFT_BUILT'
  | 'WAITING_ON_DOCS'
  | 'READY_TO_SUBMIT'
  | 'SUBMITTED'
  | 'IN_REVIEW'
  | 'CORRECTIONS_REQUIRED'
  | 'APPROVED'
  | 'REJECTED'
  | 'VOID';

export type PermitEventType =
  | 'CREATED'
  | 'JURISDICTION_DETECTED'
  | 'TEMPLATE_SELECTED'
  | 'PROPERTY_DATA_FETCHED'
  | 'APPROVALS_LINKED'
  | 'CALCS_RUN'
  | 'APPLICATION_GENERATED'
  | 'PACKET_GENERATED'
  | 'SUBMITTED'
  | 'CORRECTION_NOTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'ERROR';

export type PermitDocKind =
  | 'PERMIT_APPLICATION'
  | 'PERMIT_PACKET'
  | 'CHECKLIST'
  | 'NOTICE_OF_COMMENCEMENT'
  | 'PRODUCT_APPROVAL'
  | 'MEASUREMENT_REPORT'
  | 'OTHER';

// ========================================
// PERMITTING AUTHORITY
// ========================================

export interface PermittingAuthority {
  id: string;
  tenant_id: string;
  state: string;
  county_name: string;
  city_name: string | null;
  jurisdiction_type: JurisdictionType;
  portal_type: PortalType;
  portal_url: string | null;
  application_modes: string[];
  contact_email: string | null;
  contact_phone: string | null;
  contact_address: string | null;
  office_hours: string | null;
  default_required_attachments: string[];
  fee_structure: FeeStructure | null;
  processing_days_standard: number | null;
  processing_days_expedited: number | null;
  expedite_available: boolean;
  expedite_requirements: string[] | null;
  special_requirements: string[] | null;
  notes: string | null;
  boundary_geojson: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FeeStructure {
  base_fee?: number;
  per_sqft?: number;
  minimum?: number;
  maximum?: number;
}

// ========================================
// PERMIT APPLICATION TEMPLATE
// ========================================

export interface PermitApplicationTemplate {
  id: string;
  tenant_id: string;
  authority_id: string;
  template_key: string;
  permit_type: string;
  version: number;
  template_json: TemplateDefinition;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TemplateDefinition {
  schema_version: number;
  template_key: string;
  permit_type: string;
  display: {
    title: string;
    subtitle?: string;
    language?: string;
  };
  routing?: {
    authority_id?: string;
    jurisdiction_type?: string;
  };
  required_sources: {
    job?: boolean;
    contact_owner?: boolean;
    measurements?: string;
    property_parcel_cache?: boolean;
    estimate?: boolean;
    products?: boolean;
  };
  attachments: {
    required: string[];
    conditional?: ConditionalAttachment[];
  };
  fields: TemplateField[];
  validations: TemplateValidation[];
  outputs: TemplateOutputs;
}

export interface ConditionalAttachment {
  key: string;
  when: ExpressionCondition;
}

export interface TemplateField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'textarea' | 'date' | 'select' | 'checkbox';
  required: boolean;
  source?: { ref: string };
  calc?: { expr: string };
  options?: { label: string; value: string }[];
  placeholder?: string;
  help_text?: string;
}

export interface TemplateValidation {
  key: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  when: ExpressionCondition;
}

export interface ExpressionCondition {
  op: string;
  left?: ExpressionValue;
  right?: ExpressionValue;
  value?: ExpressionValue;
  args?: ExpressionCondition[];
}

export interface ExpressionValue {
  ref?: string;
  literal?: string | number | boolean;
}

export interface TemplateOutputs {
  application_pdf?: {
    renderer: string;
    input_pdf_storage: {
      bucket: string;
      path: string;
    };
    field_map: PDFFieldMapping[];
  };
  packet_zip?: {
    include: string[];
  };
}

export interface PDFFieldMapping {
  pdf_field: string;
  value_key: string;
}

// ========================================
// PERMIT CASE
// ========================================

export interface PermitCase {
  id: string;
  tenant_id: string;
  job_id: string;
  estimate_id: string | null;
  authority_id: string | null;
  template_id: string | null;
  status: PermitCaseStatus;
  state: string;
  county_name: string | null;
  city_name: string | null;
  jurisdiction_type: JurisdictionType | null;
  application_field_values: Record<string, unknown>;
  calculation_results: Record<string, unknown>;
  missing_items: string[];
  validation_errors: ValidationError[];
  noc_required: boolean | null;
  noc_generated_at: string | null;
  noc_recorded_at: string | null;
  noc_instrument_number: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  permit_number: string | null;
  fee_estimate: number | null;
  fee_actual: number | null;
  fee_paid: boolean;
  expires_at: string | null;
  packet_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined data
  authority?: PermittingAuthority;
  template?: PermitApplicationTemplate;
  job?: {
    id: string;
    address: string;
    contact_id: string;
  };
}

export interface ValidationError {
  field: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

// ========================================
// PERMIT CASE EVENT
// ========================================

export interface PermitCaseEvent {
  id: string;
  tenant_id: string;
  permit_case_id: string;
  event_type: PermitEventType;
  message: string | null;
  details: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
}

// ========================================
// PERMIT DOCUMENT
// ========================================

export interface PermitDocument {
  id: string;
  tenant_id: string;
  permit_case_id: string;
  kind: PermitDocKind;
  title: string;
  storage_bucket: string;
  storage_path: string;
  file_size_bytes: number | null;
  meta: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
}

// ========================================
// PROPERTY PARCEL CACHE
// ========================================

export interface PropertyParcelCache {
  id: string;
  tenant_id: string;
  job_id: string;
  county_name: string;
  parcel_id: string | null;
  folio: string | null;
  owner_name: string | null;
  owner_mailing_address: string | null;
  situs_address: string | null;
  legal_description: string | null;
  subdivision: string | null;
  land_use: string | null;
  year_built: number | null;
  assessed_value: number | null;
  source_name: string;
  source_url: string | null;
  fetched_at: string;
  raw_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ========================================
// PRODUCT APPROVAL
// ========================================

export interface ProductApprovalDocument {
  id: string;
  tenant_id: string;
  product_id: string;
  approval_kind: 'FL_PRODUCT_APPROVAL' | 'MIAMI_DADE_NOA' | 'TAS_TEST' | 'ASTM' | 'OTHER';
  approval_number: string;
  revision: string | null;
  expires_on: string | null;
  storage_bucket: string;
  storage_path: string;
  source_url: string | null;
  fetched_at: string;
  extracted_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ========================================
// PERMIT CONTEXT (for expression evaluation)
// ========================================

export interface PermitContext {
  job: {
    id: string;
    address: {
      full: string;
      street?: string;
      city?: string;
      state?: string;
      zip?: string;
    };
    lat?: number;
    lng?: number;
  };
  permit_case: {
    id?: string;
    jurisdiction_type: JurisdictionType | null;
    status?: PermitCaseStatus;
  };
  authority: {
    id?: string;
    county_name: string;
    city_name: string | null;
    portal_type?: PortalType;
  };
  parcel: {
    parcel_id: string | null;
    folio: string | null;
    owner_name: string | null;
    owner_mailing_address: string | null;
    legal_description: string | null;
    subdivision: string | null;
  };
  contact_owner: {
    full_name: string;
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
  };
  measurements: {
    source?: string;
    total_roof_area_sqft: number | null;
    predominant_pitch: string | null;
    squares: number | null;
    stories: number | null;
    eaves_ft: number | null;
    rakes_ft: number | null;
    ridges_ft: number | null;
    valleys_ft: number | null;
    hips_ft: number | null;
  };
  estimate: {
    id?: string;
    contract_total: number;
    primary_roof_system: {
      display_name: string;
      category?: string;
    };
  };
  products: {
    primary: {
      id?: string;
      name?: string;
      fl_product_approval_no: string | null;
      miami_dade_noa_no: string | null;
      approval_expires_on?: string | null;
      hvhz_approved?: boolean;
      extracted_fields: Record<string, unknown>;
    };
    all: ProductInfo[];
  };
}

export interface ProductInfo {
  id: string;
  name: string;
  category: string;
  fl_product_approval_no: string | null;
  miami_dade_noa_no: string | null;
  approval_expires_on: string | null;
  hvhz_approved: boolean;
}

// ========================================
// EXPRESSION EVALUATION RESULTS
// ========================================

export interface EvalResult {
  value: unknown;
  errors: string[];
}

export interface ResolvedFields {
  values: Record<string, unknown>;
  errors: ValidationError[];
  missingRequired: string[];
}

// ========================================
// eRECORDING
// ========================================

export interface ERecordSubmission {
  id: string;
  tenant_id: string;
  permit_case_id: string | null;
  job_id: string | null;
  document_type: 'NOC' | 'LIEN_RELEASE' | 'SATISFACTION';
  county_clerk_office: string | null;
  submission_status: 'pending' | 'submitted' | 'processing' | 'recorded' | 'rejected';
  simplifile_reference_id: string | null;
  submitted_at: string | null;
  recorded_at: string | null;
  instrument_number: string | null;
  book: string | null;
  page: string | null;
  recorded_document_url: string | null;
  rejection_reason: string | null;
  fee_amount: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// ========================================
// PERMIT JOB MEASUREMENTS
// ========================================

export interface PermitJobMeasurement {
  id: string;
  tenant_id: string;
  job_id: string;
  source: 'ROOFR' | 'EAGLEVIEW' | 'MANUAL' | 'AI_GENERATED';
  measured_at: string;
  total_roof_area_sqft: number | null;
  predominant_pitch: string | null;
  squares: number | null;
  stories: number | null;
  eaves_ft: number | null;
  rakes_ft: number | null;
  ridges_ft: number | null;
  valleys_ft: number | null;
  hips_ft: number | null;
  raw_json: Record<string, unknown>;
  report_bucket: string | null;
  report_path: string | null;
  created_at: string;
  updated_at: string;
}

// ========================================
// UI DISPLAY TYPES
// ========================================

export interface PermitExpediterJob {
  id: string;
  job_id: string;
  job_number?: string;
  address: string;
  parcel_id: string | null;
  jurisdiction_type: JurisdictionType | null;
  county_name: string | null;
  city_name: string | null;
  portal_type: PortalType | null;
  status: PermitCaseStatus;
  missing_items: string[];
  has_measurements: boolean;
  has_product_approvals: boolean;
  has_parcel_data: boolean;
  contact_name: string;
  created_at: string;
}

export const PERMIT_STATUS_LABELS: Record<PermitCaseStatus, string> = {
  NOT_STARTED: 'Not Started',
  DRAFT_BUILT: 'Draft Built',
  WAITING_ON_DOCS: 'Waiting on Docs',
  READY_TO_SUBMIT: 'Ready to Submit',
  SUBMITTED: 'Submitted',
  IN_REVIEW: 'In Review',
  CORRECTIONS_REQUIRED: 'Corrections Required',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  VOID: 'Void',
};

export const PERMIT_STATUS_COLORS: Record<PermitCaseStatus, string> = {
  NOT_STARTED: 'bg-muted text-muted-foreground',
  DRAFT_BUILT: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  WAITING_ON_DOCS: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  READY_TO_SUBMIT: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  SUBMITTED: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  IN_REVIEW: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
  CORRECTIONS_REQUIRED: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  APPROVED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  REJECTED: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  VOID: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
};

export const PORTAL_TYPE_LABELS: Record<PortalType, string> = {
  ACCELA: 'Accela',
  ENERGOV: 'EnerGov',
  ETRAKIT: 'eTRAKiT',
  CUSTOM: 'Custom Portal',
  UNKNOWN: 'Unknown',
};
