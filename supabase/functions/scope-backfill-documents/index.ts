// ============================================================
// SCOPE BACKFILL DOCUMENTS
// Processes existing insurance documents from the documents table
// into the insurance_scope_documents pipeline
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface BackfillRequest {
  tenant_id?: string;  // Optional: limit to specific tenant
  limit?: number;      // Optional: max documents to process (default: 50)
  dry_run?: boolean;   // Optional: just count, don't process
}

interface ProcessResult {
  document_id: string;
  file_name: string;
  status: 'processed' | 'skipped' | 'failed';
  error?: string;
  scope_document_id?: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Use service role for cross-tenant access
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Validate user is authenticated
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    // Get user's role to check if admin
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id, active_tenant_id, role")
      .eq("id", user.id)
      .single();
    
    const userTenantId = profile?.active_tenant_id || profile?.tenant_id;
    const isAdmin = profile?.role === 'master' || profile?.role === 'admin';

    const body: BackfillRequest = await req.json().catch(() => ({}));
    const limit = Math.min(body.limit || 50, 100);
    const dryRun = body.dry_run || false;

    // Determine which tenant(s) to process
    let targetTenantId: string | null = null;
    if (body.tenant_id) {
      // If specific tenant requested, check authorization
      if (body.tenant_id !== userTenantId && !isAdmin) {
        throw new Error("Not authorized to backfill other tenants");
      }
      targetTenantId = body.tenant_id;
    } else if (!isAdmin) {
      // Non-admins can only process their own tenant
      targetTenantId = userTenantId;
    }
    // Admins with no tenant_id specified can process all tenants

    console.log("[scope-backfill] Starting backfill:", { 
      targetTenantId,
      limit,
      dryRun,
      isAdmin
    });

    // Find insurance documents that haven't been processed
    let query = supabase
      .from('documents')
      .select('id, file_path, filename, tenant_id, created_at')
      .eq('document_type', 'insurance')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (targetTenantId) {
      query = query.eq('tenant_id', targetTenantId);
    }

    const { data: documents, error: docsError } = await query;

    if (docsError) {
      throw new Error(`Failed to fetch documents: ${docsError.message}`);
    }

    console.log("[scope-backfill] Found documents:", documents?.length || 0);

    if (!documents || documents.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: "No insurance documents found to process",
        total_found: 0,
        processed: 0,
        skipped: 0,
        failed: 0,
        results: []
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Check which documents are already processed
    const filePaths = documents.map(d => d.file_path);
    const { data: existingScopes } = await supabase
      .from('insurance_scope_documents')
      .select('storage_path, source_document_id')
      .or(`storage_path.in.(${filePaths.map(p => `"${p}"`).join(',')}),source_document_id.in.(${documents.map(d => `"${d.id}"`).join(',')})`);

    const processedPaths = new Set(existingScopes?.map(s => s.storage_path) || []);
    const processedIds = new Set(existingScopes?.map(s => s.source_document_id) || []);

    const unprocessedDocs = documents.filter(d => 
      !processedPaths.has(d.file_path) && !processedIds.has(d.id)
    );

    console.log("[scope-backfill] Unprocessed documents:", unprocessedDocs.length);

    if (dryRun) {
      return new Response(JSON.stringify({
        success: true,
        dry_run: true,
        message: `Would process ${unprocessedDocs.length} documents`,
        total_found: documents.length,
        already_processed: documents.length - unprocessedDocs.length,
        to_process: unprocessedDocs.length,
        documents: unprocessedDocs.map(d => ({
          id: d.id,
          filename: d.filename,
          tenant_id: d.tenant_id
        }))
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Process each unprocessed document
    const results: ProcessResult[] = [];
    
    for (const doc of unprocessedDocs) {
      try {
        console.log("[scope-backfill] Processing document:", doc.id);

        // Call scope-document-ingest for this document
        const ingestResponse = await fetch(
          `${supabaseUrl}/functions/v1/scope-document-ingest`,
          {
            method: 'POST',
            headers: {
              'Authorization': authHeader,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              storage_path: doc.file_path,
              document_type: 'estimate',  // Default to estimate
              file_name: doc.filename,
              source_document_id: doc.id
            })
          }
        );

        if (!ingestResponse.ok) {
          const errorText = await ingestResponse.text();
          throw new Error(`Ingest failed: ${errorText}`);
        }

        const ingestResult = await ingestResponse.json();

        // Link the source document
        if (ingestResult.document_id) {
          await supabase
            .from('insurance_scope_documents')
            .update({ source_document_id: doc.id })
            .eq('id', ingestResult.document_id);
        }

        results.push({
          document_id: doc.id,
          file_name: doc.filename,
          status: 'processed',
          scope_document_id: ingestResult.document_id
        });

        console.log("[scope-backfill] Processed:", doc.id, "->", ingestResult.document_id);

      } catch (error) {
        console.error("[scope-backfill] Failed to process:", doc.id, error);
        results.push({
          document_id: doc.id,
          file_name: doc.filename,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Add skipped documents
    const skippedDocs = documents.filter(d => 
      processedPaths.has(d.file_path) || processedIds.has(d.id)
    );
    for (const doc of skippedDocs) {
      results.push({
        document_id: doc.id,
        file_name: doc.filename,
        status: 'skipped'
      });
    }

    const processed = results.filter(r => r.status === 'processed').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const failed = results.filter(r => r.status === 'failed').length;

    return new Response(JSON.stringify({
      success: true,
      message: `Backfill complete: ${processed} processed, ${skipped} skipped, ${failed} failed`,
      total_found: documents.length,
      processed,
      skipped,
      failed,
      results
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("[scope-backfill] Error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
