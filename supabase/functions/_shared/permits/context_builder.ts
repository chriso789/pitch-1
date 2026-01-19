// =========================================================
// Permit Context Builder
// =========================================================

type BuildArgs = {
  tenant_id: string;
  permit_case_id: string;
  job_id: string;
  estimate_id: string | null;
  authority_id: string | null;
  template_id: string | null;
  options: {
    auto_fetch_parcel: boolean;
    parcel_cache_ttl_days: number;
    auto_link_approvals: boolean;
    auto_extract_approval_fields: boolean;
  };
};

export async function buildPermitContext(supabase: any, args: BuildArgs) {
  const warnings: string[] = [];
  const sources_used: string[] = [];

  // --- JOB ---
  const job = await mustGetJob(supabase, args.tenant_id, args.job_id);
  sources_used.push("jobs");

  // --- AUTHORITY ---
  const authority = args.authority_id
    ? await supabase
        .from("permitting_authorities")
        .select("*")
        .eq("tenant_id", args.tenant_id)
        .eq("id", args.authority_id)
        .maybeSingle()
        .then((r: any) => (r.error ? Promise.reject(r.error) : r.data))
    : null;
  if (authority) sources_used.push("permitting_authorities");

  // --- PERMIT CASE (fresh) ---
  const permit_case = await supabase
    .from("permit_cases")
    .select("id,status,jurisdiction_type,state,county_name,city_name")
    .eq("tenant_id", args.tenant_id)
    .eq("id", args.permit_case_id)
    .single()
    .then((r: any) => (r.error ? Promise.reject(r.error) : r.data));
  sources_used.push("permit_cases");

  // --- OWNER CONTACT ---
  const ownerContactId = job?.contact_id ?? null;
  const owner = ownerContactId
    ? await supabase
        .from("contacts")
        .select("*")
        .eq("tenant_id", args.tenant_id)
        .eq("id", ownerContactId)
        .maybeSingle()
        .then((r: any) => (r.error ? Promise.reject(r.error) : r.data))
    : null;
  if (owner) sources_used.push("contacts");

  // --- MEASUREMENTS ---
  const measurements = await getBestMeasurements(supabase, args.tenant_id, args.job_id);
  if (measurements) sources_used.push("job_measurements");

  // --- PARCEL CACHE ---
  const parcel = await getParcelCache(supabase, args.tenant_id, args.job_id, permit_case?.county_name ?? null);
  if (parcel) sources_used.push("property_parcel_cache");

  // --- ESTIMATE ---
  const estimate = args.estimate_id
    ? await supabase
        .from("estimates")
        .select("id,total,permit_type,scope")
        .eq("tenant_id", args.tenant_id)
        .eq("id", args.estimate_id)
        .maybeSingle()
        .then((r: any) => (r.error ? Promise.reject(r.error) : r.data))
    : null;
  if (estimate) sources_used.push("estimates");

  // --- PRODUCTS (stub) ---
  const products = await getProductsForEstimateStub(supabase, args.tenant_id, args.estimate_id);

  // --- APPROVAL DOCS ---
  const approvals = products?.documents?.length ? products.documents : [];
  if (approvals.length) sources_used.push("product_approval_documents");

  // --- TENANT/COMPANY PROFILE ---
  const tenant = await supabase
    .from("tenants")
    .select("name,dba,company_name,license_number,phone,email,address")
    .eq("id", args.tenant_id)
    .single()
    .then((r: any) => (r.error ? Promise.reject(r.error) : r.data));
  sources_used.push("tenants");

  return {
    meta: {
      schema_version: 1,
      tenant_id: args.tenant_id,
      permit_case_id: args.permit_case_id,
      job_id: args.job_id,
      estimate_id: args.estimate_id,
      built_at: new Date().toISOString(),
      sources_used,
      warnings,
    },

    permit_case: {
      id: permit_case.id,
      status: permit_case.status,
      jurisdiction_type: permit_case.jurisdiction_type,
      state: permit_case.state ?? "FL",
      county_name: permit_case.county_name,
      city_name: permit_case.city_name,
    },

    authority: authority
      ? {
          id: authority.id,
          jurisdiction_type: authority.jurisdiction_type,
          state: authority.state,
          county_name: authority.county_name,
          city_name: authority.city_name,
          portal_type: authority.portal_type,
          portal_url: authority.portal_url,
          application_modes: authority.application_modes ?? [],
          default_required_attachments: authority.default_required_attachments ?? [],
          notes: authority.notes ?? null,
        }
      : null,

    job: {
      id: job.id,
      status: job.status ?? null,
      address: {
        line1: job.address_line1 ?? job.address_street ?? null,
        line2: job.address_line2 ?? null,
        city: job.address_city ?? null,
        state: job.address_state ?? "FL",
        zip: job.address_zip ?? null,
        full: job.address_full ?? buildFullAddress(job),
      },
      geo: {
        lat: job.lat ?? null,
        lng: job.lng ?? null,
      },
      year_built: job.year_built ?? null,
      stories: job.stories ?? null,
      structure_type: job.structure_type ?? null,
      roof_deck_type: job.roof_deck_type ?? null,
      notes: job.notes ?? null,
    },

    contacts: {
      owner: owner
        ? {
            contact_id: owner.id,
            full_name: owner.full_name ?? `${owner.first_name ?? ''} ${owner.last_name ?? ''}`.trim() || null,
            first_name: owner.first_name ?? null,
            last_name: owner.last_name ?? null,
            phone: owner.phone ?? null,
            email: owner.email ?? null,
            mailing_address: normalizeMailing(owner),
          }
        : {
            contact_id: null,
            full_name: null,
            first_name: null,
            last_name: null,
            phone: null,
            email: null,
            mailing_address: {
              line1: null,
              line2: null,
              city: null,
              state: null,
              zip: null,
              full: null,
            },
          },
    },

    parcel: parcel
      ? {
          county_name: parcel.county_name,
          parcel_id: parcel.parcel_id ?? null,
          folio: parcel.folio ?? null,
          owner_name: parcel.owner_name ?? null,
          owner_mailing_address: parcel.owner_mailing_address ?? null,
          situs_address: parcel.situs_address ?? null,
          legal_description: parcel.legal_description ?? null,
          subdivision: parcel.subdivision ?? null,
          land_use: parcel.land_use ?? null,
          source_name: parcel.source_name ?? null,
          source_url: parcel.source_url ?? null,
          fetched_at: parcel.fetched_at ?? null,
        }
      : {
          county_name: permit_case?.county_name ?? null,
          parcel_id: null,
          folio: null,
          owner_name: null,
          owner_mailing_address: null,
          situs_address: null,
          legal_description: null,
          subdivision: null,
          land_use: null,
          source_name: null,
          source_url: null,
          fetched_at: null,
        },

    measurements: measurements
      ? {
          source: measurements.source,
          measured_at: measurements.measured_at,
          total_roof_area_sqft: measurements.total_roof_area_sqft ?? null,
          predominant_pitch: measurements.predominant_pitch ?? null,
          squares: measurements.squares ?? null,
          stories: measurements.stories ?? null,
          eaves_ft: measurements.eaves_ft ?? null,
          rakes_ft: measurements.rakes_ft ?? null,
          ridges_ft: measurements.ridges_ft ?? null,
          valleys_ft: measurements.valleys_ft ?? null,
          report: {
            bucket: measurements.report_bucket ?? null,
            path: measurements.report_path ?? null,
          },
        }
      : {
          source: null,
          measured_at: null,
          total_roof_area_sqft: null,
          predominant_pitch: null,
          squares: null,
          stories: null,
          eaves_ft: null,
          rakes_ft: null,
          ridges_ft: null,
          valleys_ft: null,
          report: { bucket: null, path: null },
        },

    estimate: estimate
      ? {
          id: estimate.id,
          contract_total: estimate.total ?? null,
          scope: estimate.scope ?? null,
          permit_type: estimate.permit_type ?? null,
          primary_roof_system: {
            category: products?.primary?.category ?? null,
            display_name: products?.primary?.display_name ?? null,
          },
        }
      : {
          id: null,
          contract_total: null,
          scope: null,
          permit_type: null,
          primary_roof_system: { category: null, display_name: null },
        },

    products: {
      primary: products?.primary ?? {
        product_id: null,
        category: null,
        manufacturer: null,
        model: null,
        fl_product_approval_no: null,
        miami_dade_noa_no: null,
        approval_expires_on: null,
        extracted_fields: {},
      },
      components: products?.components ?? [],
    },

    approvals: {
      documents: approvals ?? [],
    },

    company: {
      legal_name: tenant.company_name ?? tenant.name ?? null,
      dba_name: tenant.dba ?? null,
      license_number: tenant.license_number ?? null,
      address: { full: tenant.address ?? null },
      phone: tenant.phone ?? null,
      email: tenant.email ?? null,
      insurance: { certificate_doc_id: null },
      signature: { signer_name: null, title: null },
    },
  };
}

async function mustGetJob(supabase: any, tenantId: string, jobId: string) {
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", jobId)
    .single();
  if (error) throw error;
  return data;
}

async function getBestMeasurements(supabase: any, tenantId: string, jobId: string) {
  const { data, error } = await supabase
    .from("job_measurements")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("job_id", jobId)
    .order("measured_at", { ascending: false });

  if (error) throw error;
  if (!data?.length) return null;

  const preference = ["ROOFR", "EAGLEVIEW", "MANUAL"];
  for (const src of preference) {
    const hit = data.find((m: any) => m.source === src);
    if (hit) return hit;
  }
  return data[0];
}

async function getParcelCache(supabase: any, tenantId: string, jobId: string, countyName: string | null) {
  if (!countyName) return null;
  const { data, error } = await supabase
    .from("property_parcel_cache")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("job_id", jobId)
    .eq("county_name", countyName)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

function buildFullAddress(job: any): string | null {
  const parts = [
    job.address_street ?? job.address_line1,
    job.address_city,
    job.address_state,
    job.address_zip
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

function normalizeMailing(owner: any) {
  const line1 = owner.mailing_line1 ?? owner.address_line1 ?? owner.address_street ?? null;
  const line2 = owner.mailing_line2 ?? owner.address_line2 ?? null;
  const city = owner.mailing_city ?? owner.address_city ?? null;
  const state = owner.mailing_state ?? owner.address_state ?? null;
  const zip = owner.mailing_zip ?? owner.address_zip ?? null;
  const full = [line1, line2, city, state, zip].filter(Boolean).join(", ") || null;
  return { line1, line2, city, state, zip, full };
}

async function getProductsForEstimateStub(
  _supabase: any,
  _tenantId: string,
  estimateId: string | null,
): Promise<any | null> {
  if (!estimateId) return null;

  // Stub: return empty structure to force missing items
  return {
    primary: {
      product_id: null,
      category: null,
      display_name: null,
      manufacturer: null,
      model: null,
      fl_product_approval_no: null,
      miami_dade_noa_no: null,
      approval_expires_on: null,
      extracted_fields: {},
    },
    components: [],
    documents: [],
  };
}
