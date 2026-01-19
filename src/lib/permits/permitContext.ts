/**
 * Permit Context Builder
 * 
 * Fetches all required data from Supabase and builds a PermitContext
 * object for template field resolution.
 */

import { supabase } from '@/integrations/supabase/client';
import type { PermitContext, ProductInfo } from './types';

interface BuildContextOptions {
  jobId: string;
  estimateId?: string | null;
}

/**
 * Build a complete PermitContext from job and related data
 */
export async function buildPermitContext(
  options: BuildContextOptions
): Promise<PermitContext> {
  const { jobId, estimateId } = options;

  // Fetch job with contact data
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select(`
      id,
      job_number,
      address_street,
      tenant_id,
      contact_id,
      contacts (
        id,
        first_name,
        last_name,
        address_street,
        address_city,
        address_state,
        address_zip,
        latitude,
        longitude,
        phone,
        email
      )
    `)
    .eq('id', jobId)
    .single();

  if (jobError || !job) {
    throw new Error(`Failed to fetch job: ${jobError?.message || 'Not found'}`);
  }

  // Fetch property parcel cache
  const { data: parcel } = await supabase
    .from('property_parcel_cache')
    .select('*')
    .eq('job_id', jobId)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Fetch job measurements
  const { data: measurements } = await supabase
    .from('permit_job_measurements')
    .select('*')
    .eq('job_id', jobId)
    .order('measured_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Get address from contact or job
  const contact = job.contacts;
  const fullAddress = [
    contact?.address_street || job.address_street,
    contact?.address_city,
    contact?.address_state,
    contact?.address_zip
  ].filter(Boolean).join(', ') || '';

  const context: PermitContext = {
    job: {
      id: job.id,
      address: {
        full: fullAddress,
        street: contact?.address_street || job.address_street || undefined,
        city: contact?.address_city || undefined,
        state: contact?.address_state || undefined,
        zip: contact?.address_zip || undefined,
      },
      lat: contact?.latitude || undefined,
      lng: contact?.longitude || undefined,
    },
    permit_case: {
      jurisdiction_type: null,
      status: 'NOT_STARTED',
    },
    authority: {
      county_name: '',
      city_name: null,
    },
    parcel: {
      parcel_id: parcel?.parcel_id || null,
      folio: parcel?.folio || null,
      owner_name: parcel?.owner_name || null,
      owner_mailing_address: parcel?.owner_mailing_address || null,
      legal_description: parcel?.legal_description || null,
      subdivision: parcel?.subdivision || null,
    },
    contact_owner: {
      full_name: parcel?.owner_name || 'Unknown',
    },
    measurements: {
      source: measurements?.source,
      total_roof_area_sqft: measurements?.total_roof_area_sqft ? Number(measurements.total_roof_area_sqft) : null,
      predominant_pitch: measurements?.predominant_pitch || null,
      squares: measurements?.squares ? Number(measurements.squares) : null,
      stories: measurements?.stories || null,
      eaves_ft: measurements?.eaves_ft ? Number(measurements.eaves_ft) : null,
      rakes_ft: measurements?.rakes_ft ? Number(measurements.rakes_ft) : null,
      ridges_ft: measurements?.ridges_ft ? Number(measurements.ridges_ft) : null,
      valleys_ft: measurements?.valleys_ft ? Number(measurements.valleys_ft) : null,
      hips_ft: measurements?.hips_ft ? Number(measurements.hips_ft) : null,
    },
    estimate: {
      contract_total: 0,
      primary_roof_system: {
        display_name: 'Roofing System',
      },
    },
    products: {
      primary: {
        fl_product_approval_no: null,
        miami_dade_noa_no: null,
        extracted_fields: {},
      },
      all: [],
    },
  };

  return context;
}

/**
 * Create an empty/default permit context (for testing or previews)
 */
export function createEmptyContext(): PermitContext {
  return {
    job: {
      id: '',
      address: { full: '' },
    },
    permit_case: {
      jurisdiction_type: null,
    },
    authority: {
      county_name: '',
      city_name: null,
    },
    parcel: {
      parcel_id: null,
      folio: null,
      owner_name: null,
      owner_mailing_address: null,
      legal_description: null,
      subdivision: null,
    },
    contact_owner: {
      full_name: '',
    },
    measurements: {
      total_roof_area_sqft: null,
      predominant_pitch: null,
      squares: null,
      stories: null,
      eaves_ft: null,
      rakes_ft: null,
      ridges_ft: null,
      valleys_ft: null,
      hips_ft: null,
    },
    estimate: {
      contract_total: 0,
      primary_roof_system: {
        display_name: '',
      },
    },
    products: {
      primary: {
        fl_product_approval_no: null,
        miami_dade_noa_no: null,
        extracted_fields: {},
      },
      all: [],
    },
  };
}

/**
 * Create a mock context with sample data (for testing)
 */
export function createMockContext(): PermitContext {
  return {
    job: {
      id: 'mock-job-id',
      address: {
        full: '4063 Fonsica Avenue, North Port, FL 34286',
        street: '4063 Fonsica Avenue',
        city: 'North Port',
        state: 'FL',
        zip: '34286',
      },
      lat: 27.0442,
      lng: -82.2359,
    },
    permit_case: {
      id: 'mock-case-id',
      jurisdiction_type: 'CITY',
      status: 'NOT_STARTED',
    },
    authority: {
      id: 'mock-authority-id',
      county_name: 'Sarasota',
      city_name: 'North Port',
      portal_type: 'ACCELA',
    },
    parcel: {
      parcel_id: '0457-12-0034',
      folio: '0457120034',
      owner_name: 'John & Jane Smith',
      owner_mailing_address: '4063 Fonsica Avenue, North Port, FL 34286',
      legal_description: 'LOT 34, BLOCK 12, NORTH PORT SUBDIVISION, UNIT 5',
      subdivision: 'North Port Subdivision Unit 5',
    },
    contact_owner: {
      full_name: 'John Smith',
      first_name: 'John',
      last_name: 'Smith',
      email: 'john.smith@email.com',
      phone: '(941) 555-1234',
    },
    measurements: {
      source: 'ROOFR',
      total_roof_area_sqft: 3077,
      predominant_pitch: '6/12',
      squares: 30.77,
      stories: 1,
      eaves_ft: 180,
      rakes_ft: 120,
      ridges_ft: 85,
      valleys_ft: 24,
      hips_ft: 48,
    },
    estimate: {
      id: 'mock-estimate-id',
      contract_total: 28500,
      primary_roof_system: {
        display_name: 'GAF Timberline HDZ Architectural Shingles',
        category: 'ARCHITECTURAL_SHINGLE',
      },
    },
    products: {
      primary: {
        id: 'mock-product-id',
        name: 'GAF Timberline HDZ',
        fl_product_approval_no: 'FL12345',
        miami_dade_noa_no: 'NOA-21-0123.05',
        approval_expires_on: '2027-12-31',
        hvhz_approved: true,
        extracted_fields: {
          fastener_spacing: { default: '6" o.c.', hvhz: '4" o.c.' },
          approved_substrates: ['plywood', 'osb'],
          wind_rating: '130 mph',
        },
      },
      all: [
        {
          id: 'mock-product-id',
          name: 'GAF Timberline HDZ',
          category: 'SHINGLE',
          fl_product_approval_no: 'FL12345',
          miami_dade_noa_no: 'NOA-21-0123.05',
          approval_expires_on: '2027-12-31',
          hvhz_approved: true,
        },
      ],
    },
  };
}
