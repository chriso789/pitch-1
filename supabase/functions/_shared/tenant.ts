// =========================================================
// Tenant Resolution
// =========================================================

export async function getActiveTenantId(supabase: any, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  const tenantId = data?.tenant_id;
  if (!tenantId) throw new Error("No active tenant found for user");
  return tenantId;
}
