import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SearchRequest {
  action: "search" | "search_contacts" | "search_jobs" | "search_documents" | "search_communications" | "get_recent" | "save_search";
  tenant_id: string;
  user_id?: string;
  params?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { action, tenant_id, user_id, params = {} } = await req.json() as SearchRequest;

    if (!tenant_id) {
      return new Response(
        JSON.stringify({ error: "tenant_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[unified-search] Action: ${action}, Tenant: ${tenant_id}, Query: ${params.query}`);

    switch (action) {
      case "search": {
        const { 
          query, 
          entity_types = ["contacts", "jobs", "projects", "documents"],
          limit = 20,
          filters = {}
        } = params;

        if (!query || typeof query !== "string") {
          return new Response(
            JSON.stringify({ error: "query is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const searchTerm = query.toLowerCase().trim();
        const results: Record<string, unknown[]> = {};
        const entityTypesArray = Array.isArray(entity_types) ? entity_types : [entity_types];

        // Search contacts
        if (entityTypesArray.includes("contacts")) {
          const { data: contacts } = await supabase
            .from("contacts")
            .select("id, first_name, last_name, email, phone, address, city, state")
            .eq("tenant_id", tenant_id)
            .or(`first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%,phone.ilike.%${searchTerm}%,address.ilike.%${searchTerm}%`)
            .limit(Number(limit));

          results.contacts = (contacts || []).map(c => ({
            ...c,
            _type: "contact",
            _title: `${c.first_name} ${c.last_name}`,
            _subtitle: c.email || c.phone,
            _url: `/contacts/${c.id}`
          }));
        }

        // Search jobs/pipeline entries
        if (entityTypesArray.includes("jobs")) {
          const { data: jobs } = await supabase
            .from("pipeline_entries")
            .select(`
              id, 
              title, 
              status, 
              estimated_value,
              contacts!pipeline_entries_contact_id_fkey (
                first_name,
                last_name
              )
            `)
            .eq("tenant_id", tenant_id)
            .ilike("title", `%${searchTerm}%`)
            .limit(Number(limit));

          results.jobs = (jobs || []).map(j => ({
            ...j,
            _type: "job",
            _title: j.title,
            _subtitle: `${j.status} - $${j.estimated_value?.toLocaleString() || 0}`,
            _url: `/pipeline/${j.id}`
          }));
        }

        // Search projects
        if (entityTypesArray.includes("projects")) {
          const { data: projects } = await supabase
            .from("projects")
            .select(`
              id, 
              project_name, 
              status, 
              contract_amount,
              contacts!projects_contact_id_fkey (
                first_name,
                last_name
              )
            `)
            .eq("tenant_id", tenant_id)
            .ilike("project_name", `%${searchTerm}%`)
            .limit(Number(limit));

          results.projects = (projects || []).map(p => ({
            ...p,
            _type: "project",
            _title: p.project_name,
            _subtitle: `${p.status} - $${p.contract_amount?.toLocaleString() || 0}`,
            _url: `/projects/${p.id}`
          }));
        }

        // Search documents
        if (entityTypesArray.includes("documents")) {
          const { data: documents } = await supabase
            .from("documents")
            .select("id, title, document_type, created_at")
            .eq("tenant_id", tenant_id)
            .ilike("title", `%${searchTerm}%`)
            .limit(Number(limit));

          results.documents = (documents || []).map(d => ({
            ...d,
            _type: "document",
            _title: d.title,
            _subtitle: d.document_type,
            _url: `/documents/${d.id}`
          }));
        }

        // Flatten and rank results
        const allResults = Object.values(results).flat();
        
        // Simple relevance scoring based on exact match
        const scoredResults = allResults.map(r => {
          const title = ((r as any)._title || "").toLowerCase();
          let score = 0;
          if (title === searchTerm) score = 100;
          else if (title.startsWith(searchTerm)) score = 80;
          else if (title.includes(searchTerm)) score = 60;
          else score = 40;
          return { ...r, _relevance: score };
        });

        scoredResults.sort((a, b) => (b as any)._relevance - (a as any)._relevance);

        // Log search for analytics
        if (user_id) {
          await supabase
            .from("activity_log")
            .insert({
              tenant_id,
              entity_type: "search",
              entity_id: user_id,
              action: "unified_search",
              metadata: { query: searchTerm, result_count: scoredResults.length }
            });
        }

        return new Response(
          JSON.stringify({
            success: true,
            query: searchTerm,
            total_results: scoredResults.length,
            results: scoredResults.slice(0, Number(limit)),
            by_type: {
              contacts: results.contacts?.length || 0,
              jobs: results.jobs?.length || 0,
              projects: results.projects?.length || 0,
              documents: results.documents?.length || 0
            }
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "search_contacts": {
        const { query, limit = 20, filters = {} } = params;

        if (!query) {
          return new Response(
            JSON.stringify({ error: "query is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const searchTerm = (query as string).toLowerCase().trim();

        let queryBuilder = supabase
          .from("contacts")
          .select("*")
          .eq("tenant_id", tenant_id)
          .or(`first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%,phone.ilike.%${searchTerm}%,address.ilike.%${searchTerm}%,city.ilike.%${searchTerm}%`);

        // Apply filters
        if ((filters as any).status) {
          queryBuilder = queryBuilder.eq("status", (filters as any).status);
        }
        if ((filters as any).lead_source) {
          queryBuilder = queryBuilder.eq("lead_source", (filters as any).lead_source);
        }

        const { data: contacts } = await queryBuilder.limit(Number(limit));

        return new Response(
          JSON.stringify({
            success: true,
            query: searchTerm,
            results: contacts || [],
            count: contacts?.length || 0
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "search_jobs": {
        const { query, limit = 20, filters = {} } = params;

        if (!query) {
          return new Response(
            JSON.stringify({ error: "query is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const searchTerm = (query as string).toLowerCase().trim();

        let queryBuilder = supabase
          .from("pipeline_entries")
          .select(`
            *,
            contacts!pipeline_entries_contact_id_fkey (
              first_name,
              last_name,
              email
            )
          `)
          .eq("tenant_id", tenant_id)
          .ilike("title", `%${searchTerm}%`);

        if ((filters as any).status) {
          queryBuilder = queryBuilder.eq("status", (filters as any).status);
        }
        if ((filters as any).stage_id) {
          queryBuilder = queryBuilder.eq("stage_id", (filters as any).stage_id);
        }

        const { data: jobs } = await queryBuilder.limit(Number(limit));

        return new Response(
          JSON.stringify({
            success: true,
            query: searchTerm,
            results: jobs || [],
            count: jobs?.length || 0
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "search_documents": {
        const { query, limit = 20, filters = {} } = params;

        if (!query) {
          return new Response(
            JSON.stringify({ error: "query is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const searchTerm = (query as string).toLowerCase().trim();

        let queryBuilder = supabase
          .from("documents")
          .select("*")
          .eq("tenant_id", tenant_id)
          .or(`title.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`);

        if ((filters as any).document_type) {
          queryBuilder = queryBuilder.eq("document_type", (filters as any).document_type);
        }

        const { data: documents } = await queryBuilder.limit(Number(limit));

        return new Response(
          JSON.stringify({
            success: true,
            query: searchTerm,
            results: documents || [],
            count: documents?.length || 0
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "search_communications": {
        const { query, limit = 20, type } = params;

        if (!query) {
          return new Response(
            JSON.stringify({ error: "query is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const searchTerm = (query as string).toLowerCase().trim();
        const results: Record<string, unknown[]> = {};

        // Search calls
        if (!type || type === "calls") {
          const { data: calls } = await supabase
            .from("call_logs")
            .select(`
              *,
              contacts!call_logs_contact_id_fkey (
                first_name,
                last_name
              )
            `)
            .eq("tenant_id", tenant_id)
            .or(`transcription.ilike.%${searchTerm}%,disposition_notes.ilike.%${searchTerm}%`)
            .limit(Number(limit) / 2);

          results.calls = calls || [];
        }

        // Search SMS
        if (!type || type === "sms") {
          const { data: sms } = await supabase
            .from("sms_messages")
            .select(`
              *,
              contacts!sms_messages_contact_id_fkey (
                first_name,
                last_name
              )
            `)
            .eq("tenant_id", tenant_id)
            .ilike("body", `%${searchTerm}%`)
            .limit(Number(limit) / 2);

          results.sms = sms || [];
        }

        // Search emails
        if (!type || type === "emails") {
          const { data: emails } = await supabase
            .from("emails")
            .select("*")
            .eq("tenant_id", tenant_id)
            .or(`subject.ilike.%${searchTerm}%,body.ilike.%${searchTerm}%`)
            .limit(Number(limit) / 2);

          results.emails = emails || [];
        }

        return new Response(
          JSON.stringify({
            success: true,
            query: searchTerm,
            results,
            total: Object.values(results).flat().length
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "get_recent": {
        if (!user_id) {
          return new Response(
            JSON.stringify({ error: "user_id is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { limit = 10 } = params;

        // Get recent activity for this user
        const { data: recentActivity } = await supabase
          .from("activity_log")
          .select("entity_type, entity_id, action, metadata, created_at")
          .eq("tenant_id", tenant_id)
          .eq("user_id", user_id)
          .in("entity_type", ["contact", "pipeline_entry", "project", "document"])
          .in("action", ["view", "edit", "create"])
          .order("created_at", { ascending: false })
          .limit(Number(limit));

        // Dedupe by entity
        const seen = new Set();
        const recentItems = (recentActivity || []).filter(item => {
          const key = `${item.entity_type}-${item.entity_id}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        return new Response(
          JSON.stringify({
            success: true,
            recent: recentItems
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "save_search": {
        if (!user_id) {
          return new Response(
            JSON.stringify({ error: "user_id is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { name, query, filters, entity_types } = params;

        if (!name || !query) {
          return new Response(
            JSON.stringify({ error: "name and query are required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Save to user settings
        const { data: existingSettings } = await supabase
          .from("app_settings")
          .select("setting_value")
          .eq("tenant_id", tenant_id)
          .eq("user_id", user_id)
          .eq("setting_key", "saved_searches")
          .single();

        const savedSearches = (existingSettings?.setting_value as unknown[]) || [];
        savedSearches.push({
          id: crypto.randomUUID(),
          name,
          query,
          filters,
          entity_types,
          created_at: new Date().toISOString()
        });

        await supabase
          .from("app_settings")
          .upsert({
            tenant_id,
            user_id,
            setting_key: "saved_searches",
            setting_value: savedSearches
          });

        return new Response(
          JSON.stringify({
            success: true,
            message: "Search saved successfully",
            saved_searches_count: savedSearches.length
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (error) {
    console.error("[unified-search] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
