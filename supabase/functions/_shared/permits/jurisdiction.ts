// =========================================================
// Jurisdiction Detection
// =========================================================

type JurisdictionResult = {
  county_name: string | null;
  city_name: string | null;
  jurisdiction_type: "CITY" | "COUNTY" | null;
  authority_id: string | null;
};

export async function detectJurisdictionAndAuthority(
  supabase: any,
  args: { tenant_id: string; job_id: string },
): Promise<JurisdictionResult> {
  const { data: job, error } = await supabase
    .from("jobs")
    .select("id,address_city,address_county,address_state,lat,lng")
    .eq("id", args.job_id)
    .eq("tenant_id", args.tenant_id)
    .single();

  if (error) throw error;

  const county = job?.address_county ?? null;
  const city = job?.address_city ?? null;
  const jurisdiction_type: "CITY" | "COUNTY" | null = city ? "CITY" : county ? "COUNTY" : null;

  if (!county) return { county_name: null, city_name: null, jurisdiction_type, authority_id: null };

  const { data: auths, error: aerr } = await supabase
    .from("permitting_authorities")
    .select("id,county_name,city_name,jurisdiction_type,is_active")
    .eq("tenant_id", args.tenant_id)
    .eq("state", job?.address_state ?? "FL")
    .eq("county_name", county)
    .eq("is_active", true);

  if (aerr) throw aerr;

  const match = jurisdiction_type === "CITY"
    ? auths?.find((a: any) => a.jurisdiction_type === "CITY" && (a.city_name ?? "") === (city ?? ""))
    : auths?.find((a: any) => a.jurisdiction_type === "COUNTY");

  return {
    county_name: county,
    city_name: city,
    jurisdiction_type,
    authority_id: match?.id ?? null,
  };
}
