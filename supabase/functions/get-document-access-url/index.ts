import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

function extractStorageRef(value?: string | null): { bucket: string; path: string } | null {
  if (!value || !/^https?:\/\//i.test(value)) return null;
  const match = value.match(
    /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/?]+)\/(.+?)(?:\?|$)/,
  );
  if (!match) return null;
  return { bucket: match[1], path: decodeURIComponent(match[2]) };
}

function resolveStorageBucket(documentType?: string | null, filePath?: string | null): string {
  const fromUrl = extractStorageRef(filePath);
  if (fromUrl) return fromUrl.bucket;
  if (documentType === "company_resource") return "smartdoc-assets";
  if (filePath?.startsWith("company-docs/")) return "smartdoc-assets";
  if (documentType?.startsWith("invoice_") || documentType === "supplier_quote") {
    return "project-invoices";
  }
  if (
    documentType === "photo" ||
    documentType === "inspection_photo" ||
    documentType === "required_photos" ||
    filePath?.includes("/leads/")
  ) {
    return filePath?.includes("/leads/") ? "customer-photos" : "documents";
  }
  return "documents";
}


Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { document_id, expires_in = 3600 } = await req.json();
    if (!document_id || typeof document_id !== "string") {
      return json({ error: "document_id_required" }, 400);
    }

    const { data: doc, error: docError } = await admin
      .from("documents")
      .select("id, tenant_id, pipeline_entry_id, document_type, file_path, filename, mime_type")
      .eq("id", document_id)
      .maybeSingle();

    if (docError) {
      console.error("[get-document-access-url] document lookup failed", docError);
      return json({ error: "document_lookup_failed" }, 500);
    }
    if (!doc) return json({ error: "document_not_found" }, 404);

    const userId = userData.user.id;
    const { data: profile } = await admin
      .from("profiles")
      .select("tenant_id, active_tenant_id, role")
      .eq("id", userId)
      .maybeSingle();

    let allowed = profile?.tenant_id === doc.tenant_id || profile?.active_tenant_id === doc.tenant_id;
    if (!allowed) {
      const { data: access } = await admin
        .from("user_company_access")
        .select("tenant_id")
        .eq("user_id", userId)
        .eq("tenant_id", doc.tenant_id)
        .maybeSingle();
      allowed = !!access;
    }
    if (!allowed && profile?.role !== "master") {
      const { data: masterRole } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "master")
        .maybeSingle();
      allowed = !!masterRole;
    }
    if (!allowed) return json({ error: "forbidden" }, 403);

    const storageRef = extractStorageRef(doc.file_path);
    const bucket = resolveStorageBucket(doc.document_type, doc.file_path);
    const basePath = storageRef?.path ?? doc.file_path;

    // (bucket, path) candidates — stored URLs, raw paths, and legacy tenant-prefixed paths
    const candidates: Array<{ bucket: string; path: string }> = [{ bucket, path: basePath }];

    if (doc.tenant_id && basePath) {
      const parts = basePath.split("/").filter(Boolean);
      const first = parts[0];
      if (first && isUuid(first) && first !== doc.tenant_id && doc.pipeline_entry_id && first === doc.pipeline_entry_id) {
        candidates.push({ bucket, path: `${doc.tenant_id}/${basePath}` });
      }
    }

    // Fallback buckets in case the document row was written with a stale bucket mapping
    for (const fallback of ["documents", "project-invoices", "customer-photos", "smartdoc-assets"]) {
      if (fallback !== bucket) candidates.push({ bucket: fallback, path: basePath });
    }

    for (const candidate of candidates) {
      const { data: signed, error: signedError } = await admin.storage
        .from(candidate.bucket)
        .createSignedUrl(candidate.path, Number(expires_in) || 3600);
      if (!signedError && signed?.signedUrl) {
        return json({
          signedUrl: signed.signedUrl,
          bucket: candidate.bucket,
          path: candidate.path,
          filename: doc.filename,
          mime_type: doc.mime_type,
        });
      }
    }

    // Last resort: the stored path is stale — locate the object anywhere by filename
    if (doc.filename) {
      const { data: matches } = await admin.rpc("find_storage_object_by_filename", {
        p_filename: doc.filename,
        p_limit: 5,
      });
      for (const match of (matches ?? []) as Array<{ bucket_id: string; name: string }>) {
        const { data: signed } = await admin.storage
          .from(match.bucket_id)
          .createSignedUrl(match.name, Number(expires_in) || 3600);
        if (signed?.signedUrl) {
          return json({
            signedUrl: signed.signedUrl,
            bucket: match.bucket_id,
            path: match.name,
            filename: doc.filename,
            mime_type: doc.mime_type,
            recovered_by_filename: true,
          });
        }
      }
    }

    console.warn("[get-document-access-url] no accessible storage object", {
      document_id,
      bucket,
      candidates,
    });
    // Return 200 so the client can surface a readable message instead of "non-2xx status code"
    return json({
      error: "storage_object_not_found",
      message: "This file is no longer in storage — the record exists but the PDF was removed. Re-generate or re-upload it.",
      bucket,
      path: basePath,
    });


  } catch (error) {
    console.error("[get-document-access-url] unexpected error", error);
    return json({ error: "unexpected_error" }, 500);
  }
});
