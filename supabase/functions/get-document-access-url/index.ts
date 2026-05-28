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

function resolveStorageBucket(documentType?: string | null, filePath?: string | null): string {
  if (documentType === "company_resource") return "smartdoc-assets";
  if (filePath?.startsWith("company-docs/")) return "smartdoc-assets";
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

    const bucket = resolveStorageBucket(doc.document_type, doc.file_path);
    const candidatePaths = new Set<string>([doc.file_path]);

    if (bucket === "documents" && doc.tenant_id && doc.file_path) {
      const parts = doc.file_path.split("/").filter(Boolean);
      const first = parts[0];
      if (first && isUuid(first) && first !== doc.tenant_id && doc.pipeline_entry_id && first === doc.pipeline_entry_id) {
        candidatePaths.add(`${doc.tenant_id}/${doc.file_path}`);
      }
    }

    let resolvedPath: string | null = null;
    for (const path of candidatePaths) {
      const { data: signed, error: signedError } = await admin.storage
        .from(bucket)
        .createSignedUrl(path, Number(expires_in) || 3600);
      if (!signedError && signed?.signedUrl) {
        resolvedPath = path;
        return json({
          signedUrl: signed.signedUrl,
          bucket,
          path,
          filename: doc.filename,
          mime_type: doc.mime_type,
        });
      }
    }

    console.warn("[get-document-access-url] no accessible storage object", {
      document_id,
      bucket,
      paths: Array.from(candidatePaths),
    });
    return json({ error: "storage_object_not_found", bucket, path: resolvedPath ?? doc.file_path }, 404);
  } catch (error) {
    console.error("[get-document-access-url] unexpected error", error);
    return json({ error: "unexpected_error" }, 500);
  }
});
