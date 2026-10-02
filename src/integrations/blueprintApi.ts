import { supabase } from "@/integrations/supabase/client";
import { edgeApi } from "@/lib/edgeApi";

// Blueprint upload remains on the legacy plan_documents storage model.
// Generic blueprint parsing now routes through parse-blueprint-f1 so uploads,
// re-parses, and measurement uploads all receive F1 + roofing workbench output.
// The grouped document-worker routes remain available for vendor report parsing
// and as a legacy fallback; no CRM estimate write is enabled here.

export async function uploadBlueprintDocument(payload: {
  property_address?: string;
  file_name: string;
  file_path: string;
  tenant_id?: string;
  contact_id?: string;
  pipeline_entry_id?: string;
}) {
  const { data, error } = await supabase.functions.invoke("upload-blueprint-document", { body: payload });
  if (error) throw error;
  return data;
}

export async function classifyBlueprintPages(document_id: string) {
  const { data, error } = await edgeApi("document-worker", "/classify-pages", { document_id });
  if (error) throw new Error(error);
  return data;
}

export async function extractRoofPlanGeometry(input: { document_id?: string; page_id?: string }) {
  const { data, error } = await supabase.functions.invoke("extract-roof-plan-geometry", { body: input });
  if (error) throw error;
  return data;
}

export async function extractBlueprintSpecs(document_id: string) {
  const { data, error } = await supabase.functions.invoke("extract-blueprint-specs", { body: { document_id } });
  if (error) throw error;
  return data;
}

export async function linkBlueprintDetails(document_id: string) {
  const { data, error } = await supabase.functions.invoke("link-blueprint-details", { body: { document_id } });
  if (error) throw error;
  return data;
}

export async function reviewBlueprintPage(page_id: string, review_status: "approved" | "rejected" | "pending") {
  const { data, error } = await supabase.functions.invoke("review-blueprint-page", {
    body: { page_id, review_status },
  });
  if (error) throw error;
  return data;
}

export async function getBlueprintDocument(document_id: string) {
  const { data, error } = await supabase.functions.invoke("get-blueprint-document", { body: { document_id } });
  if (error) throw error;
  return data;
}

export interface BlueprintF1ParseResult {
  ok: boolean;
  document_id: string;
  session_id: string;
  source_document_id: string;
  requires_review: boolean;
  f1: {
    runtime_version: string;
    summary: Record<string, number>;
    missing_indexed_sheets: string[];
    unresolved_reference_targets: string[];
  };
  roofing: null | {
    summary: Record<string, unknown>;
    review_flags: Array<Record<string, unknown>>;
  };
  push_to_estimate_enabled: false;
}

export async function parseBlueprintDocument(document_id: string, tenant_id?: string) {
  const { data, error } = await supabase.functions.invoke<BlueprintF1ParseResult>("parse-blueprint-f1", {
    body: { document_id },
    headers: tenant_id ? { "x-tenant-id": tenant_id } : undefined,
  });
  if (error) throw error;
  if (!data?.ok) throw new Error((data as any)?.error ?? "Blueprint F1 parse failed");
  return data;
}

export async function describeBlueprintDocument(document_id: string) {
  const { data, error } = await supabase.functions.invoke("describe-blueprint-document", {
    body: { document_id },
  });
  if (error) throw error;
  return data;
}

export async function rasterizeBlueprintPages(input: {
  document_id?: string;
  page_id?: string;
  force?: boolean;
}) {
  const { data, error } = await supabase.functions.invoke("rasterize-blueprint-pages", {
    body: input,
  });
  if (error) throw error;
  return data;
}
