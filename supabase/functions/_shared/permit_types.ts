// ============================================
// PERMIT BUILD CASE TYPES
// ============================================

// === STANDARD MISSING ITEM KEYS ===
export const MISSING_ITEM_KEYS = {
  // Jurisdiction
  JOB_ADDRESS: 'missing.job_address',
  JOB_GEO: 'missing.job_geo',
  AUTHORITY_NOT_CONFIGURED: 'missing.authority_not_configured',
  // Owner / parcel
  OWNER_NAME: 'missing.owner_name',
  OWNER_MAILING_ADDRESS: 'missing.owner_mailing_address',
  PARCEL_LEGAL_DESCRIPTION: 'missing.parcel_legal_description',
  PARCEL_ID: 'missing.parcel_id',
  // Measurements
  MEASUREMENTS_TOTAL_ROOF_AREA: 'missing.measurements_total_roof_area',
  MEASUREMENTS_REPORT: 'missing.measurements_report',
  // Estimate / products
  ESTIMATE_SELECTED: 'missing.estimate_selected',
  PRODUCT_MAPPING_PRIMARY: 'missing.product_mapping_primary',
  PRODUCT_MAPPING_COMPONENTS: 'missing.product_mapping_components',
  PRODUCT_APPROVAL_PRIMARY: 'missing.product_approval_primary',
  PRODUCT_APPROVAL_COMPONENT: 'missing.product_approval_component',
  // Company docs
  COMPANY_LICENSE: 'missing.company_license',
  COMPANY_INSURANCE: 'missing.company_insurance',
  // Outputs
  TEMPLATE_PDF: 'missing.template_pdf',
  TEMPLATE_FIELD_MAP: 'missing.template_field_map',
} as const;

export type MissingItemKey = typeof MISSING_ITEM_KEYS[keyof typeof MISSING_ITEM_KEYS];

// === REQUEST ===
export type PermitBuildCaseRequest = {
  job_id: string;
  estimate_id?: string | null;
  options?: {
    force_rebuild?: boolean;
    auto_detect_jurisdiction?: boolean;
    auto_fetch_parcel?: boolean;
    parcel_cache_ttl_days?: number;
    auto_link_approvals?: boolean;
    auto_extract_approval_fields?: boolean;
    generate_application_pdf?: boolean;
    generate_packet_zip?: boolean;
    include_checklist_pdf?: boolean;
    dry_run?: boolean;
  };
};

// === RESPONSE TYPES ===
export type MissingItem = {
  key: string;
  severity: 'error' | 'warning';
  message: string;
};

export type ValidationError = {
  key: string;
  severity: 'error' | 'warning';
  message: string;
};

export type PermitBuildCaseResponse = {
  permit_case: {
    id: string;
    status: string;
    job_id: string;
    estimate_id: string | null;
    authority_id: string | null;
    template_id: string | null;
    jurisdiction: {
      state: string;
      county_name: string | null;
      city_name: string | null;
      jurisdiction_type: 'CITY' | 'COUNTY' | null;
    };
  };
  missing_items: MissingItem[];
  validation_errors: ValidationError[];
  application_field_values: Record<string, unknown>;
  calculation_results: Record<string, unknown>;
  documents: PermitDocumentOutput[];
  next_actions: NextAction[];
  context_preview: ContextPreview;
};

export type PermitDocumentOutput = {
  id: string;
  kind: string;
  title: string;
  bucket: string;
  path: string;
  signed_url: string;
  content_type: string;
};

export type NextAction = {
  action: 'OPEN_PERMITTING_PORTAL' | 'FIX_MISSING_ITEMS' | 'GENERATE_DOCUMENTS';
  label: string;
  url?: string;
  items?: string[];
  when?: { status_in: string[] };
};

export type ContextPreview = {
  authority: {
    county_name: string | null;
    city_name: string | null;
    portal_type: string | null;
  } | null;
  measurements: {
    total_roof_area_sqft: number | null;
    predominant_pitch: string | null;
  };
  products: {
    primary: {
      manufacturer: string | null;
      model: string | null;
    };
  };
};

// === CANONICAL PERMIT CONTEXT (exact shape from spec) ===
export type CanonicalPermitContext = {
  meta: {
    schema_version: number;
    tenant_id: string;
    permit_case_id: string;
    job_id: string;
    estimate_id: string | null;
    built_at: string;
    template_id: string | null;
    template_pdf_bucket: string | null;
    template_pdf_path: string | null;
    template_json: unknown;
    sources_used: string[];
    warnings: string[];
  };

  permit_case: {
    id: string;
    status: string;
    jurisdiction_type: 'CITY' | 'COUNTY' | null;
    state: string;
    county_name: string | null;
    city_name: string | null;
  };

  authority: {
    id: string;
    jurisdiction_type: 'CITY' | 'COUNTY';
    state: string;
    county_name: string;
    city_name: string | null;
    portal_type: string;
    portal_url: string | null;
    application_modes: string[];
    default_required_attachments: string[];
    notes: string | null;
  } | null;

  job: {
    id: string;
    status: string | null;
    address: {
      line1: string | null;
      line2: string | null;
      city: string | null;
      state: string;
      zip: string | null;
      full: string | null;
    };
    geo: {
      lat: number | null;
      lng: number | null;
    };
    year_built: number | null;
    stories: number | null;
    structure_type: string | null;
    roof_deck_type: string | null;
    notes: string | null;
  };

  contacts: {
    owner: {
      contact_id: string | null;
      full_name: string | null;
      first_name: string | null;
      last_name: string | null;
      phone: string | null;
      email: string | null;
      mailing_address: {
        line1: string | null;
        line2: string | null;
        city: string | null;
        state: string | null;
        zip: string | null;
        full: string | null;
      };
    };
  };

  parcel: {
    county_name: string | null;
    parcel_id: string | null;
    folio: string | null;
    owner_name: string | null;
    owner_mailing_address: string | null;
    situs_address: string | null;
    legal_description: string | null;
    subdivision: string | null;
    land_use: string | null;
    source_name: string | null;
    source_url: string | null;
    fetched_at: string | null;
  } | null;

  measurements: {
    source: 'ROOFR' | 'EAGLEVIEW' | 'MANUAL' | null;
    measured_at: string | null;
    total_roof_area_sqft: number | null;
    predominant_pitch: string | null;
    squares: number | null;
    stories: number | null;
    eaves_ft: number | null;
    rakes_ft: number | null;
    ridges_ft: number | null;
    valleys_ft: number | null;
    report: {
      bucket: string | null;
      path: string | null;
    };
  } | null;

  estimate: {
    id: string | null;
    contract_total: number | null;
    scope: string | null;
    permit_type: string;
    primary_roof_system: {
      category: string | null;
      display_name: string | null;
    };
  } | null;

  products: {
    primary: ProductApprovalInfo;
    components: ComponentProductInfo[];
  };

  approvals: {
    documents: ApprovalDocumentInfo[];
  };

  company: {
    legal_name: string | null;
    dba_name: string | null;
    license_number: string | null;
    address: {
      full: string | null;
    };
    phone: string | null;
    email: string | null;
    insurance: {
      certificate_doc_id: string | null;
    };
    signature: {
      signer_name: string | null;
      title: string | null;
    };
  } | null;
};

export type ProductApprovalInfo = {
  product_id: string | null;
  category: string | null;
  manufacturer: string | null;
  model: string | null;
  fl_product_approval_no: string | null;
  miami_dade_noa_no: string | null;
  approval_expires_on: string | null;
  extracted_fields: Record<string, unknown>;
};

export type ComponentProductInfo = ProductApprovalInfo & {
  role: string;
};

export type ApprovalDocumentInfo = {
  approval_kind: 'FL_PRODUCT_APPROVAL' | 'MIAMI_DADE_NOA' | 'OTHER';
  approval_number: string;
  revision: string | null;
  expires_on: string | null;
  bucket: string;
  path: string;
  source_url: string | null;
  fetched_at: string | null;
  extracted_fields: Record<string, unknown>;
};
