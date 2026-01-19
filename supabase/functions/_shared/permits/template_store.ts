// =========================================================
// Template Store - Select Active Templates
// =========================================================

import { TemplateRow } from "./types.ts";

export async function selectTemplate(
  supabase: any,
  args: { tenant_id: string; authority_id: string; permit_type: string },
): Promise<TemplateRow | null> {
  const { data, error } = await supabase
    .from("permit_application_templates")
    .select("id,tenant_id,authority_id,template_key,permit_type,version,template_json")
    .eq("tenant_id", args.tenant_id)
    .eq("authority_id", args.authority_id)
    .eq("permit_type", args.permit_type)
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}
