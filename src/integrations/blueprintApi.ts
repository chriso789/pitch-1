import { supabase } from "@/integrations/supabase/client";
import { edgeApi } from "@/lib/edgeApi";

// NOTE (Slice 2B):
// - parseBlueprintDocument + classifyBlueprintPages now route through the
//   grouped `document-worker` function via edgeApi. Legacy folder names
//   (parse-blueprint-document, classify-blueprint-pages) remain as forwarding
//   shims and must not be invoked directly from new code.
// - uploadBlueprintDocument still calls upload-blueprint-document because it
//   writes to the legacy plan_documents/plan_parse_jobs tables, which are
//   distinct from the documents table that `document-api /ingest/upload`
//   manages. Migrating upload requires a table-merge migration and belongs
//   to a later slice.

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

export async function parseBlueprintDocument(document_id: string, tenant_id?: string) {
  const { data, error } = await edgeApi(
    "document-worker",
    "/parse/blueprint",
    { document_id },
    tenant_id ? { headers: { "x-tenant-id": tenant_id } } : undefined,
  );
  if (error) throw new Error(error);
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

