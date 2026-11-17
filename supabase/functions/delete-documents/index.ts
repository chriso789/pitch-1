import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-pitch-tenant",
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

Deno.serve(async (req) => {
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
      console.error("[delete-documents] Profile error:", profileError);
      return new Response(
        JSON.stringify({ error: "Profile not found" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log user context for debugging
    console.log(`[delete-documents] User context: id=${user.id}, role=${profile.role}, tenant_id=${profile.tenant_id}`);

    // Enforce role-based access. Office admins, regional managers and corporate
    // may delete documents, matching who may delete project cost invoices.
    const allowedRoles = ["manager", "admin", "master", "owner", "corporate", "office_admin", "regional_manager"];
    if (!allowedRoles.includes(profile.role)) {
      console.log(`[delete-documents] Access denied: role '${profile.role}' not in allowed roles`);
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

    // The Documents tab also lists Profit-section cost invoices that have no
    // documents row, using the id "invoice-<uuid>". Those entries are the cost
    // invoice itself, so deleting one deletes that project_cost_invoices row.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const invoiceIds: string[] = [];
    const realDocIds: string[] = [];
    const invalidIds: string[] = [];
    for (const raw of document_ids) {
      const id = String(raw ?? "");
      if (id.startsWith("invoice-") && UUID_RE.test(id.slice("invoice-".length))) {
        invoiceIds.push(id.slice("invoice-".length));
      } else if (UUID_RE.test(id)) {
        realDocIds.push(id);
      } else {
        invalidIds.push(id);
      }
    }
    if (invalidIds.length > 0) {
      return new Response(
        JSON.stringify({ error: "Invalid document id", errors: ["One or more selected items could not be identified. Refresh and try again."] }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    document_ids.length = 0;
    document_ids.push(...realDocIds);

    // Tenancy: callers act within their own company. Master can act anywhere;
    // owner can act in companies granted through user_company_access.
    async function findForbiddenTenants(tenantIds: string[]): Promise<string[]> {
      const foreign = Array.from(new Set(tenantIds.filter(t => t !== profile!.tenant_id)));
      if (foreign.length === 0) return [];
      if (profile!.role === "master") return [];
      if (profile!.role !== "owner") return foreign;
      const { data: accessRows } = await adminClient
        .from("user_company_access")
        .select("tenant_id")
        .eq("user_id", user!.id)
        .in("tenant_id", foreign);
      const ok = new Set((accessRows || []).map((r: any) => r.tenant_id));
      return foreign.filter(t => !ok.has(t));
    }

    // Step 1: Fetch documents and verify they belong to the caller's tenant
    let documents: any[] = [];
    if (realDocIds.length > 0) {
      const { data, error: docsError } = await adminClient
        .from("documents")
        .select("id, file_path, tenant_id, filename, document_type, linked_invoice_id, created_at")
        .in("id", realDocIds);
      if (docsError) {
        console.error("Error fetching documents:", docsError);
        return new Response(
          JSON.stringify({ error: "Failed to fetch documents", errors: ["Couldn't load the selected documents. Please try again."] }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      documents = data || [];
    }

    let invoices: any[] = [];
    if (invoiceIds.length > 0) {
      const { data, error: invError } = await adminClient
        .from("project_cost_invoices")
        .select("id, tenant_id, pipeline_entry_id")
        .in("id", invoiceIds);
      if (invError) {
        console.error("Error fetching invoices:", invError);
        return new Response(
          JSON.stringify({ error: "Failed to fetch invoices", errors: ["Couldn't load the selected invoice. Please try again."] }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      invoices = data || [];
    }

    if (documents.length === 0 && invoices.length === 0) {
      return new Response(
        JSON.stringify({ error: "No documents found", errors: ["This item was already deleted. Refresh the page."] }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const forbidden = await findForbiddenTenants([
      ...documents.map(d => d.tenant_id),
      ...invoices.map(i => i.tenant_id),
    ]);
    if (forbidden.length > 0) {
      console.log(`[delete-documents] ${profile.role} blocked from tenants:`, forbidden);
      return new Response(
        JSON.stringify({ error: "Some documents do not belong to your organization", errors: ["Some selected items belong to a company you don't have access to."] }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 1b: Delete invoice-only entries (cost invoices without a file row)
    let invoicesDeleted = 0;
    const invoiceErrors: string[] = [];
    if (invoices.length > 0 && !dry_run) {
      const { data: removed, error: delInvErr } = await adminClient
        .from("project_cost_invoices")
        .delete()
        .in("id", invoices.map(i => i.id))
        .select("id");
      if (delInvErr) {
        console.error("Error deleting invoices:", delInvErr);
        invoiceErrors.push(`Invoice could not be deleted: ${delInvErr.message}`);
      } else {
        invoicesDeleted = removed?.length || 0;
        console.log(`[delete-documents] Deleted ${invoicesDeleted} invoice-only cost records`);
      }
    }

    // Step 2: Find approvals referencing these documents
    const { data: linkedApprovals, error: approvalsError } = document_ids.length === 0
      ? { data: [] as any[], error: null }
      : await adminClient
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
      errors: [...invoiceErrors],
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
        if (nonReferencedDocIds.length === 0 && invoicesDeleted === 0) {
          // Return 200 with success:false to avoid FunctionsHttpError on client
          // The blocked_ids and errors fields indicate which docs couldn't be deleted
          result.success = false;
          return new Response(
            JSON.stringify(result),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

        // Step 4b: Remove project costs that were created FROM these documents
        // (legacy Documents-tab invoice uploads). A cost created from a document
        // is recognisable because the document existed before the cost record.
        // Costs added in the Profit section create their document afterwards and
        // stay in place; they are managed from the Profit section.
        const linked = docsToDelete.filter((d: any) => d.linked_invoice_id);
        if (linked.length > 0) {
          const { data: invoices } = await adminClient
            .from("project_cost_invoices")
            .select("id, tenant_id, created_at")
            .in("id", linked.map((d: any) => d.linked_invoice_id));
          const byId = new Map((invoices || []).map((i: any) => [i.id, i]));
          const costIds = linked
            .filter((d: any) => {
              const inv: any = byId.get(d.linked_invoice_id);
              return inv && inv.tenant_id === d.tenant_id &&
                new Date(d.created_at).getTime() < new Date(inv.created_at).getTime();
            })
            .map((d: any) => d.linked_invoice_id);
          if (costIds.length > 0) {
            const { error: costErr } = await adminClient
              .from("project_cost_invoices")
              .delete()
              .in("id", costIds);
            if (costErr) {
              console.error("Error removing document-created costs:", costErr);
              result.errors.push(`Document deleted but its cost could not be removed: ${costErr.message}`);
            } else {
              (result as any).costs_removed = costIds.length;
              console.log(`[delete-documents] Removed ${costIds.length} document-created cost records`);
            }
          }
        }
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

    (result as any).invoices_deleted = invoicesDeleted;

    result.success = result.errors.length === 0 || result.docs_deleted > 0 || invoicesDeleted > 0;

    console.log(`[delete-documents] Complete:`, result);

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[delete-documents] Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
