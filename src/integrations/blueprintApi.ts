import { supabase } from "@/integrations/supabase/client";

export async function uploadBlueprintDocument(payload: {
  property_address?: string;
  file_name: string;
  file_path: string;
  contact_id?: string;
  pipeline_entry_id?: string;
}) {
  const { data, error } = await supabase.functions.invoke("upload-blueprint-document", { body: payload });
  if (error) throw error;
  return data;
}

export async function classifyBlueprintPages(document_id: string) {
  const { data, error } = await supabase.functions.invoke("classify-blueprint-pages", { body: { document_id } });
  if (error) throw error;
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

export async function parseBlueprintDocument(document_id: string) {
  const { data, error } = await supabase.functions.invoke("parse-blueprint-document", { body: { document_id } });
  if (error) throw error;
  return data;
}
