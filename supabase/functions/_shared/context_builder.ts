// ============================================
// PERMIT CONTEXT BUILDER
// Builds the canonical PermitContext following exact resolution rules
// ============================================

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { nowIso, buildFullAddress, splitOwnerName, isStale } from './util.ts';
import type {
  CanonicalPermitContext,
  MissingItem,
  ProductApprovalInfo,
  ComponentProductInfo,
  ApprovalDocumentInfo,
} from './permit_types.ts';
import { MISSING_ITEM_KEYS } from './permit_types.ts';

interface BuildContextArgs {
  tenant_id: string;
  permit_case_id: string;
  job_id: string;
  estimate_id: string | null;
  options: {
    auto_fetch_parcel?: boolean;
    parcel_cache_ttl_days?: number;
    auto_link_approvals?: boolean;
  };
}

interface BuildContextResult {
  context: CanonicalPermitContext;
  missing: MissingItem[];
}

/**
 * Build the canonical Permit Context following exact resolution rules from spec.
 */
export async function buildPermitContext(
  sb: SupabaseClient,
  args: BuildContextArgs
): Promise<BuildContextResult> {
  const sources_used: string[] = [];
  const warnings: string[] = [];
  const missing: MissingItem[] = [];

  // 1. Get permit_case record
  const { data: permitCaseRow, error: pcErr } = await sb
    .from('permit_cases')
    .select('*')
    .eq('id', args.permit_case_id)
    .eq('tenant_id', args.tenant_id)
    .single();

  if (pcErr || !permitCaseRow) {
    throw new Error(`Permit case not found: ${pcErr?.message || 'unknown'}`);
  }
  sources_used.push('permit_cases');

  // 2. Get job with contact for address/geo
  const { data: jobData, error: jobErr } = await sb
    .from('jobs')
    .select(`
      id,
      job_number,
      status,
      notes,
      contact_id,
      contacts!jobs_contact_id_fkey (
        id,
        first_name,
        last_name,
        email,
        phone,
        address_street,
        address_city,
        address_state,
        address_zip,
        latitude,
        longitude
      )
    `)
    .eq('id', args.job_id)
    .eq('tenant_id', args.tenant_id)
    .single();

  if (jobErr || !jobData) {
    throw new Error(`Job not found: ${jobErr?.message || 'unknown'}`);
  }
  sources_used.push('jobs');
  sources_used.push('contacts');

  const contact = jobData.contacts as any;

  // Build job block (Resolution Rule A)
  const jobAddress = {
    line1: contact?.address_street || null,
    line2: null,
    city: contact?.address_city || null,
    state: contact?.address_state || 'FL',
    zip: contact?.address_zip || null,
    full: buildFullAddress(contact),
  };

  if (!jobAddress.full) {
    missing.push({ key: MISSING_ITEM_KEYS.JOB_ADDRESS, severity: 'error', message: 'Job address is missing.' });
  }

  const jobGeo = {
    lat: contact?.latitude ? Number(contact.latitude) : null,
    lng: contact?.longitude ? Number(contact.longitude) : null,
  };

  if (!jobGeo.lat || !jobGeo.lng) {
    missing.push({ key: MISSING_ITEM_KEYS.JOB_GEO, severity: 'warning', message: 'Property coordinates missing for accurate jurisdiction detection.' });
  }

  // 3. Get authority if set on permit_case
  let authority: CanonicalPermitContext['authority'] = null;
  if (permitCaseRow.authority_id) {
    const { data: authData } = await sb
      .from('permitting_authorities')
      .select('*')
      .eq('id', permitCaseRow.authority_id)
      .eq('tenant_id', args.tenant_id)
      .single();

    if (authData) {
      sources_used.push('permitting_authorities');
      authority = {
        id: authData.id,
        jurisdiction_type: authData.jurisdiction_type,
        state: authData.state,
        county_name: authData.county_name,
        city_name: authData.city_name,
        portal_type: authData.portal_type,
        portal_url: authData.portal_url,
        application_modes: authData.application_modes || [],
        default_required_attachments: authData.default_required_attachments || [],
        notes: authData.notes,
      };
    }
  }

  if (!authority) {
    missing.push({ key: MISSING_ITEM_KEYS.AUTHORITY_NOT_CONFIGURED, severity: 'error', message: 'No permitting authority configured for this jurisdiction.' });
  }

  // 4. Get template if authority is set
  let template: any = null;
  if (authority?.id) {
    const { data: tplData } = await sb
      .from('permit_application_templates')
      .select('*')
      .eq('authority_id', authority.id)
      .eq('tenant_id', args.tenant_id)
      .eq('is_active', true)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tplData) {
      sources_used.push('permit_application_templates');
      template = tplData;
    }
  }

  // 5. Get parcel cache (Resolution Rule D)
  let parcel: CanonicalPermitContext['parcel'] = null;
  const countyName = permitCaseRow.county_name || authority?.county_name;
  
  if (countyName) {
    const { data: parcelData } = await sb
      .from('property_parcel_cache')
      .select('*')
      .eq('tenant_id', args.tenant_id)
      .eq('job_id', args.job_id)
      .eq('county_name', countyName)
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (parcelData) {
      const ttlDays = args.options.parcel_cache_ttl_days ?? 7;
      if (isStale(parcelData.fetched_at, ttlDays)) {
        warnings.push('Parcel data is stale - consider refreshing');
      }
      sources_used.push('property_parcel_cache');
      parcel = {
        county_name: parcelData.county_name,
        parcel_id: parcelData.parcel_id,
        folio: parcelData.folio,
        owner_name: parcelData.owner_name,
        owner_mailing_address: parcelData.owner_mailing_address,
        situs_address: parcelData.situs_address,
        legal_description: parcelData.legal_description,
        subdivision: parcelData.subdivision,
        land_use: parcelData.land_use,
        source_name: parcelData.source_name,
        source_url: parcelData.source_url,
        fetched_at: parcelData.fetched_at,
      };
    }
  }

  if (!parcel?.legal_description) {
    missing.push({ key: MISSING_ITEM_KEYS.PARCEL_LEGAL_DESCRIPTION, severity: 'warning', message: 'Legal description not found in property data.' });
  }
  if (!parcel?.parcel_id) {
    missing.push({ key: MISSING_ITEM_KEYS.PARCEL_ID, severity: 'warning', message: 'Parcel ID not found.' });
  }

  // 6. Build owner contact block (Resolution Rule B)
  const ownerName = parcel?.owner_name || (contact ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() : null);
  const { firstName, lastName } = splitOwnerName(ownerName);
  
  const ownerMailingAddress = {
    line1: null as string | null,
    line2: null as string | null,
    city: null as string | null,
    state: null as string | null,
    zip: null as string | null,
    full: parcel?.owner_mailing_address || jobAddress.full,
  };

  if (!ownerName) {
    missing.push({ key: MISSING_ITEM_KEYS.OWNER_NAME, severity: 'warning', message: 'Owner name not found.' });
  }
  if (!ownerMailingAddress.full) {
    missing.push({ key: MISSING_ITEM_KEYS.OWNER_MAILING_ADDRESS, severity: 'warning', message: 'Owner mailing address not found.' });
  }

  // 7. Get measurements (Resolution Rule C) - Priority: ROOFR > EAGLEVIEW > MANUAL
  let measurements: CanonicalPermitContext['measurements'] = null;
  
  const { data: measurementData } = await sb
    .from('permit_job_measurements')
    .select('*')
    .eq('tenant_id', args.tenant_id)
    .eq('job_id', args.job_id)
    .order('measured_at', { ascending: false });

  if (measurementData && measurementData.length > 0) {
    // Sort by source priority then by measured_at
    const priorityOrder = { 'ROOFR': 0, 'EAGLEVIEW': 1, 'MANUAL': 2, 'AI_GENERATED': 3 };
    const sorted = measurementData.sort((a, b) => {
      const priorityDiff = (priorityOrder[a.source as keyof typeof priorityOrder] ?? 99) - 
                           (priorityOrder[b.source as keyof typeof priorityOrder] ?? 99);
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(b.measured_at).getTime() - new Date(a.measured_at).getTime();
    });
    
    const m = sorted[0];
    sources_used.push('permit_job_measurements');
    measurements = {
      source: m.source as any,
      measured_at: m.measured_at,
      total_roof_area_sqft: m.total_roof_area_sqft,
      predominant_pitch: m.predominant_pitch,
      squares: m.squares,
      stories: m.stories,
      eaves_ft: m.eaves_ft,
      rakes_ft: m.rakes_ft,
      ridges_ft: m.ridges_ft,
      valleys_ft: m.valleys_ft,
      report: {
        bucket: m.report_bucket,
        path: m.report_path,
      },
    };
  }

  if (!measurements?.total_roof_area_sqft) {
    missing.push({ key: MISSING_ITEM_KEYS.MEASUREMENTS_TOTAL_ROOF_AREA, severity: 'error', message: 'Total roof area measurement is required.' });
  }
  if (!measurements?.report?.path) {
    missing.push({ key: MISSING_ITEM_KEYS.MEASUREMENTS_REPORT, severity: 'warning', message: 'Measurement report file not linked.' });
  }

  // 8. Get estimate (Resolution Rule E)
  let estimate: CanonicalPermitContext['estimate'] = null;
  
  if (args.estimate_id) {
    const { data: estData } = await sb
      .from('estimates')
      .select('*')
      .eq('id', args.estimate_id)
      .eq('tenant_id', args.tenant_id)
      .single();

    if (estData) {
      sources_used.push('estimates');
      estimate = {
        id: estData.id,
        contract_total: estData.total || estData.grand_total || null,
        scope: estData.scope || null,
        permit_type: estData.permit_type || 'ROOF_REPLACEMENT',
        primary_roof_system: {
          category: estData.primary_roof_category || null,
          display_name: estData.primary_roof_display_name || null,
        },
      };
    }
  }

  if (!estimate?.id) {
    missing.push({ key: MISSING_ITEM_KEYS.ESTIMATE_SELECTED, severity: 'error', message: 'No estimate selected for permit build.' });
  }

  // 9. Get products + approvals (Resolution Rule F)
  const products: CanonicalPermitContext['products'] = {
    primary: createEmptyProductInfo(),
    components: [],
  };
  const approvals: CanonicalPermitContext['approvals'] = { documents: [] };

  // TODO: Implement product mapping from estimate line items
  // For now, check if primary product is mapped
  if (!products.primary.product_id) {
    missing.push({ key: MISSING_ITEM_KEYS.PRODUCT_MAPPING_PRIMARY, severity: 'error', message: 'Primary roof system not mapped to product library.' });
  }

  // 10. Get company info
  let company: CanonicalPermitContext['company'] = null;
  
  const { data: tenantData } = await sb
    .from('tenants')
    .select('*')
    .eq('id', args.tenant_id)
    .single();

  if (tenantData) {
    sources_used.push('tenants');
    company = {
      legal_name: tenantData.company_name || null,
      dba_name: tenantData.dba_name || null,
      license_number: tenantData.license_number || null,
      address: {
        full: tenantData.address_full || null,
      },
      phone: tenantData.phone || null,
      email: tenantData.email || null,
      insurance: {
        certificate_doc_id: tenantData.insurance_certificate_doc_id || null,
      },
      signature: {
        signer_name: tenantData.signer_name || null,
        title: tenantData.signer_title || null,
      },
    };
  }

  if (!company?.license_number) {
    missing.push({ key: MISSING_ITEM_KEYS.COMPANY_LICENSE, severity: 'warning', message: 'Company license number not configured.' });
  }
  if (!company?.insurance?.certificate_doc_id) {
    missing.push({ key: MISSING_ITEM_KEYS.COMPANY_INSURANCE, severity: 'warning', message: 'Company insurance certificate not uploaded.' });
  }

  // Build the canonical context
  const context: CanonicalPermitContext = {
    meta: {
      schema_version: 1,
      tenant_id: args.tenant_id,
      permit_case_id: args.permit_case_id,
      job_id: args.job_id,
      estimate_id: args.estimate_id,
      built_at: nowIso(),
      template_id: template?.id || null,
      template_pdf_bucket: template?.template_pdf_bucket || null,
      template_pdf_path: template?.template_pdf_path || null,
      template_json: template?.template_json || null,
      sources_used,
      warnings,
    },
    permit_case: {
      id: permitCaseRow.id,
      status: permitCaseRow.status,
      jurisdiction_type: permitCaseRow.jurisdiction_type,
      state: permitCaseRow.state || 'FL',
      county_name: permitCaseRow.county_name,
      city_name: permitCaseRow.city_name,
    },
    authority,
    job: {
      id: jobData.id,
      status: jobData.status,
      address: jobAddress,
      geo: jobGeo,
      year_built: parcel?.year_built || null,
      stories: measurements?.stories || null,
      structure_type: null,
      roof_deck_type: null,
      notes: jobData.notes,
    },
    contacts: {
      owner: {
        contact_id: contact?.id || null,
        full_name: ownerName,
        first_name: firstName,
        last_name: lastName,
        phone: contact?.phone || null,
        email: contact?.email || null,
        mailing_address: ownerMailingAddress,
      },
    },
    parcel,
    measurements,
    estimate,
    products,
    approvals,
    company,
  };

  return { context, missing };
}

function createEmptyProductInfo(): ProductApprovalInfo {
  return {
    product_id: null,
    category: null,
    manufacturer: null,
    model: null,
    fl_product_approval_no: null,
    miami_dade_noa_no: null,
    approval_expires_on: null,
    extracted_fields: {},
  };
}
