import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DeleteRequest {
  document_ids: string[];
  mode: 'delete_only' | 'detach_approvals' | 'cascade_approvals';
  dry_run?: boolean;
}

interface DeleteResult {
  success: boolean;
  docs_deleted: number;
  approvals_detached: number;
  approvals_deleted: number;
  storage_deleted: number;
  storage_skipped: number;
  blocked_ids: string[];
  errors: string[];
  referenced_docs?: { doc_id: string; approval_ids: string[] }[];
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Get the JWT from Authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create admin client for operations
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    
    // Create user client to verify the caller
    const userClient = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } }
    });
    
    // Verify the user
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      console.error("Auth error:", authError);
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the user's profile for tenant_id and role
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("tenant_id, role")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      console.error("Profile error:", profileError);
      return new Response(
        JSON.stringify({ error: "Profile not found" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Enforce role-based access (manager, admin, master can delete)
    const allowedRoles = ["manager", "admin", "master", "owner"];
    if (!allowedRoles.includes(profile.role)) {
      return new Response(
        JSON.stringify({ error: "Insufficient permissions" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: DeleteRequest = await req.json();
    const { document_ids, mode, dry_run = false } = body;

    if (!document_ids || !Array.isArray(document_ids) || document_ids.length === 0) {
      return new Response(
        JSON.stringify({ error: "document_ids array is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!["delete_only", "detach_approvals", "cascade_approvals"].includes(mode)) {
      return new Response(
        JSON.stringify({ error: "mode must be one of: delete_only, detach_approvals, cascade_approvals" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[delete-documents] User ${user.id} requesting to delete ${document_ids.length} docs, mode: ${mode}, dry_run: ${dry_run}`);

    // Helper to resolve storage bucket based on document properties
    function resolveStorageBucket(documentType?: string | null, filePath?: string | null): string {
      if (documentType === 'company_resource') return 'smartdoc-assets';
      if (filePath?.startsWith('company-docs/')) return 'smartdoc-assets';
      return 'documents';
    }

    // Step 1: Fetch documents and verify they belong to the caller's tenant
    const { data: documents, error: docsError } = await adminClient
      .from("documents")
      .select("id, file_path, tenant_id, filename, document_type")
      .in("id", document_ids);

    if (docsError) {
      console.error("Error fetching documents:", docsError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch documents" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!documents || documents.length === 0) {
      return new Response(
        JSON.stringify({ error: "No documents found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify all documents belong to the caller's tenant
    const unauthorizedDocs = documents.filter(d => d.tenant_id !== profile.tenant_id);
    if (unauthorizedDocs.length > 0) {
      return new Response(
        JSON.stringify({ error: "Some documents do not belong to your organization" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 2: Find approvals referencing these documents
    const { data: linkedApprovals, error: approvalsError } = await adminClient
      .from("measurement_approvals")
      .select("id, report_document_id")
      .in("report_document_id", document_ids);

    if (approvalsError) {
      console.error("Error checking approvals:", approvalsError);
      return new Response(
        JSON.stringify({ error: "Failed to check approval references" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build reference map
    const referencedDocsMap = new Map<string, string[]>();
    for (const approval of linkedApprovals || []) {
      if (approval.report_document_id) {
        const existing = referencedDocsMap.get(approval.report_document_id) || [];
        existing.push(approval.id);
        referencedDocsMap.set(approval.report_document_id, existing);
      }
    }

    const referencedDocIds = Array.from(referencedDocsMap.keys());
    const referenced_docs = referencedDocIds.map(doc_id => ({
      doc_id,
      approval_ids: referencedDocsMap.get(doc_id) || []
    }));

    const result: DeleteResult = {
      success: false,
      docs_deleted: 0,
      approvals_detached: 0,
      approvals_deleted: 0,
      storage_deleted: 0,
      storage_skipped: 0,
      blocked_ids: [],
      errors: [],
      referenced_docs: dry_run ? referenced_docs : undefined
    };

    // If dry_run, just return what would happen
    if (dry_run) {
      result.success = true;
      if (mode === "delete_only" && referencedDocIds.length > 0) {
        result.blocked_ids = referencedDocIds;
        result.errors.push(`${referencedDocIds.length} document(s) are linked to measurement approvals. Choose 'detach_approvals' or 'cascade_approvals' mode.`);
      }
      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 3: Handle approvals based on mode
    if (referencedDocIds.length > 0) {
      if (mode === "delete_only") {
        // Block deletion for referenced docs
        result.blocked_ids = referencedDocIds;
        result.errors.push(`Cannot delete ${referencedDocIds.length} document(s) - they are linked to measurement approvals`);
        
        // Only delete non-referenced docs
        const nonReferencedDocIds = document_ids.filter(id => !referencedDocIds.includes(id));
        if (nonReferencedDocIds.length === 0) {
          result.success = false;
          return new Response(
            JSON.stringify(result),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        // Continue with non-referenced docs only
        document_ids.length = 0;
        document_ids.push(...nonReferencedDocIds);
      } else if (mode === "detach_approvals") {
        // Detach approvals (set report_document_id to null)
        const allApprovalIds = Array.from(referencedDocsMap.values()).flat();
        const { error: detachError } = await adminClient
          .from("measurement_approvals")
          .update({ report_document_id: null })
          .in("id", allApprovalIds);

        if (detachError) {
          console.error("Error detaching approvals:", detachError);
          result.errors.push("Failed to detach some approvals");
        } else {
          result.approvals_detached = allApprovalIds.length;
          console.log(`[delete-documents] Detached ${allApprovalIds.length} approvals`);
        }
      } else if (mode === "cascade_approvals") {
        // Delete the approvals first
        const allApprovalIds = Array.from(referencedDocsMap.values()).flat();
        const { error: deleteApprovalsError } = await adminClient
          .from("measurement_approvals")
          .delete()
          .in("id", allApprovalIds);

        if (deleteApprovalsError) {
          console.error("Error deleting approvals:", deleteApprovalsError);
          result.errors.push("Failed to delete some approvals");
        } else {
          result.approvals_deleted = allApprovalIds.length;
          console.log(`[delete-documents] Deleted ${allApprovalIds.length} approvals`);
        }
      }
    }

    // Step 4: Delete document rows
    const docsToDelete = documents.filter(d => document_ids.includes(d.id));
    const docIdsToDelete = docsToDelete.map(d => d.id);

    if (docIdsToDelete.length > 0) {
      const { error: deleteDocsError, count } = await adminClient
        .from("documents")
        .delete()
        .in("id", docIdsToDelete);

      if (deleteDocsError) {
        console.error("Error deleting documents:", deleteDocsError);
        result.errors.push(`Database error: ${deleteDocsError.message}`);
      } else {
        result.docs_deleted = count || docIdsToDelete.length;
        console.log(`[delete-documents] Deleted ${result.docs_deleted} document rows`);
      }
    }

    // Step 5: Storage cleanup - only delete files that are no longer referenced
    // Get all file paths from deleted docs (excluding external URLs)
    const deletedFilePaths = docsToDelete
      .map(d => ({ path: d.file_path, documentType: d.document_type }))
      .filter(d => !d.path.startsWith("http://") && !d.path.startsWith("https://") && !d.path.startsWith("data:"));

    // Check if any remaining documents reference the same file paths
    const uniquePaths = [...new Map(deletedFilePaths.map(d => [d.path, d])).values()];
    
    for (const { path, documentType } of uniquePaths) {
      // Count remaining documents with this path
      const { count: remainingCount, error: countError } = await adminClient
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("file_path", path);

      if (countError) {
        console.error(`Error checking remaining refs for ${path}:`, countError);
        result.storage_skipped++;
        continue;
      }

      if ((remainingCount || 0) === 0) {
        // Determine which bucket to delete from
        const bucket = resolveStorageBucket(documentType, path);
        console.log(`[delete-documents] Deleting from bucket "${bucket}": ${path}`);
        
        // Safe to delete from storage
        const { error: storageError } = await adminClient.storage
          .from(bucket)
          .remove([path]);

        if (storageError) {
          // Not found is okay - file may already be deleted
          if (!storageError.message?.includes("not found")) {
            console.error(`Error deleting storage file ${path}:`, storageError);
            result.errors.push(`Storage error for ${path}: ${storageError.message}`);
          }
        } else {
          result.storage_deleted++;
          console.log(`[delete-documents] Deleted storage file: ${path}`);
        }
      } else {
        result.storage_skipped++;
        console.log(`[delete-documents] Skipped storage file ${path} - still referenced by ${remainingCount} doc(s)`);
      }
    }

    result.success = result.errors.length === 0 || result.docs_deleted > 0;

    console.log(`[delete-documents] Complete:`, result);

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[delete-documents] Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
