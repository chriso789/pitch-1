import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── helpers ──────────────────────────────────────────────────────────────────

function supabaseService() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );
}

function supabaseAuth(authHeader: string) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    }
  );
}

const ADMIN_ROLES = ["master", "owner", "corporate", "office_admin"];
const READ_ROLES = [...ADMIN_ROLES, "regional_manager", "sales_manager"];

// ── tool definitions ─────────────────────────────────────────────────────────

const tools = [
  {
    type: "function",
    function: {
      name: "list_pipeline_stages",
      description: "List all pipeline stages with their order, color, and settings for this tenant.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "update_pipeline_stage",
      description: "Add, rename, reorder, or delete a pipeline stage.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["add", "rename", "reorder", "delete"] },
          name: { type: "string", description: "Stage name (current name for rename/delete)" },
          new_name: { type: "string", description: "New name (for rename)" },
          position: { type: "number", description: "New position index (for add/reorder)" },
          color: { type: "string", description: "Hex color for the stage" },
        },
        required: ["action", "name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_lead_sources",
      description: "List all configured lead sources for this tenant.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "update_lead_source",
      description: "Add or remove a lead source.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["add", "remove"] },
          name: { type: "string" },
        },
        required: ["action", "name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_users",
      description: "List all team members (profiles) for this tenant with their roles.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "query_pipeline_stats",
      description: "Get pipeline entry counts and total values grouped by stage.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "query_stagnant_leads",
      description: "Find pipeline entries with no activity in the specified number of days.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "Number of days of inactivity (default 14)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_contacts",
      description: "Search contacts by name, phone, or email.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search term" },
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_contact_stats",
      description: "Get contact counts grouped by qualification status.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_contact_statuses",
      description: "List all contact/qualification statuses for this tenant.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "update_contact_status",
      description: "Add, rename, or delete a contact qualification status.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["add", "rename", "delete"] },
          name: { type: "string" },
          new_name: { type: "string" },
          color: { type: "string" },
        },
        required: ["action", "name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_app_setting",
      description: "Update a tenant-level app setting (company_name, primary_color, etc).",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "Setting key" },
          value: { type: "string", description: "New value" },
        },
        required: ["key", "value"],
      },
    },
  },
];

// ── tool executors ───────────────────────────────────────────────────────────

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  tenantId: string,
  userRole: string
): Promise<string> {
  const db = supabaseService();
  const isAdmin = ADMIN_ROLES.includes(userRole);

  try {
    switch (name) {
      // ─── READ tools ────────────────────────────────────────
      case "list_pipeline_stages": {
        const { data, error } = await db
          .from("pipeline_stages")
          .select("id, name, order_index, color, is_active")
          .eq("tenant_id", tenantId)
          .order("order_index");
        if (error) throw error;
        return JSON.stringify(data);
      }

      case "list_lead_sources": {
        const { data, error } = await db
          .from("lead_sources")
          .select("id, name, is_active")
          .eq("tenant_id", tenantId)
          .order("name");
        if (error) throw error;
        return JSON.stringify(data);
      }

      case "list_users": {
        const { data, error } = await db
          .from("profiles")
          .select("id, first_name, last_name, email, role, is_active")
          .eq("tenant_id", tenantId)
          .order("first_name");
        if (error) throw error;
        return JSON.stringify(data);
      }

      case "list_contact_statuses": {
        const { data, error } = await db
          .from("contact_statuses")
          .select("id, name, color, is_active, order_index")
          .eq("tenant_id", tenantId)
          .order("order_index");
        if (error) throw error;
        return JSON.stringify(data);
      }

      case "query_pipeline_stats": {
        const { data, error } = await db
          .from("pipeline_entries")
          .select("stage_name, estimated_value")
          .eq("tenant_id", tenantId);
        if (error) throw error;
        const stats: Record<string, { count: number; total_value: number }> = {};
        for (const entry of data || []) {
          const stage = entry.stage_name || "Unknown";
          if (!stats[stage]) stats[stage] = { count: 0, total_value: 0 };
          stats[stage].count++;
          stats[stage].total_value += Number(entry.estimated_value || 0);
        }
        return JSON.stringify(stats);
      }

      case "query_stagnant_leads": {
        const days = Number(args.days) || 14;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const { data, error } = await db
          .from("pipeline_entries")
          .select("id, contact_name, stage_name, estimated_value, updated_at")
          .eq("tenant_id", tenantId)
          .lt("updated_at", cutoff.toISOString())
          .order("updated_at", { ascending: true })
          .limit(20);
        if (error) throw error;
        return JSON.stringify({ days, count: data?.length || 0, leads: data });
      }

      case "search_contacts": {
        const q = String(args.query || "");
        const limit = Number(args.limit) || 10;
        const { data, error } = await db
          .from("contacts")
          .select("id, first_name, last_name, email, phone, qualification_status")
          .eq("tenant_id", tenantId)
          .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`)
          .limit(limit);
        if (error) throw error;
        return JSON.stringify(data);
      }

      case "query_contact_stats": {
        const { data, error } = await db
          .from("contacts")
          .select("qualification_status")
          .eq("tenant_id", tenantId);
        if (error) throw error;
        const stats: Record<string, number> = {};
        for (const c of data || []) {
          const status = c.qualification_status || "Unset";
          stats[status] = (stats[status] || 0) + 1;
        }
        return JSON.stringify(stats);
      }

      // ─── WRITE tools (admin only) ─────────────────────────
      case "update_pipeline_stage": {
        if (!isAdmin) return JSON.stringify({ error: "Insufficient permissions. Only admin roles can modify pipeline stages." });
        const action = String(args.action);
        const stageName = String(args.name);

        if (action === "add") {
          const position = Number(args.position) || 999;
          const color = String(args.color || "#3b82f6");
          const { error } = await db.from("pipeline_stages").insert({
            tenant_id: tenantId,
            name: stageName,
            order_index: position,
            color,
            is_active: true,
          });
          if (error) throw error;
          return JSON.stringify({ success: true, message: `Pipeline stage '${stageName}' added at position ${position}.` });
        }

        if (action === "rename") {
          const newName = String(args.new_name || "");
          if (!newName) return JSON.stringify({ error: "new_name is required for rename." });
          const { error } = await db
            .from("pipeline_stages")
            .update({ name: newName })
            .eq("tenant_id", tenantId)
            .eq("name", stageName);
          if (error) throw error;
          return JSON.stringify({ success: true, message: `Pipeline stage '${stageName}' renamed to '${newName}'.` });
        }

        if (action === "delete") {
          const { error } = await db
            .from("pipeline_stages")
            .delete()
            .eq("tenant_id", tenantId)
            .eq("name", stageName);
          if (error) throw error;
          return JSON.stringify({ success: true, message: `Pipeline stage '${stageName}' deleted.` });
        }

        if (action === "reorder") {
          const position = Number(args.position);
          const { error } = await db
            .from("pipeline_stages")
            .update({ order_index: position })
            .eq("tenant_id", tenantId)
            .eq("name", stageName);
          if (error) throw error;
          return JSON.stringify({ success: true, message: `Pipeline stage '${stageName}' moved to position ${position}.` });
        }

        return JSON.stringify({ error: `Unknown action '${action}'.` });
      }

      case "update_lead_source": {
        if (!isAdmin) return JSON.stringify({ error: "Insufficient permissions." });
        const action = String(args.action);
        const sourceName = String(args.name);

        if (action === "add") {
          const { error } = await db.from("lead_sources").insert({
            tenant_id: tenantId,
            name: sourceName,
            is_active: true,
          });
          if (error) throw error;
          return JSON.stringify({ success: true, message: `Lead source '${sourceName}' added.` });
        }

        if (action === "remove") {
          const { error } = await db
            .from("lead_sources")
            .delete()
            .eq("tenant_id", tenantId)
            .eq("name", sourceName);
          if (error) throw error;
          return JSON.stringify({ success: true, message: `Lead source '${sourceName}' removed.` });
        }

        return JSON.stringify({ error: `Unknown action '${action}'.` });
      }

      case "update_contact_status": {
        if (!isAdmin) return JSON.stringify({ error: "Insufficient permissions." });
        const action = String(args.action);
        const statusName = String(args.name);

        if (action === "add") {
          const color = String(args.color || "#6b7280");
          const { error } = await db.from("contact_statuses").insert({
            tenant_id: tenantId,
            name: statusName,
            color,
            is_active: true,
            order_index: 999,
          });
          if (error) throw error;
          return JSON.stringify({ success: true, message: `Contact status '${statusName}' added.` });
        }

        if (action === "rename") {
          const newName = String(args.new_name || "");
          if (!newName) return JSON.stringify({ error: "new_name is required for rename." });
          const { error } = await db
            .from("contact_statuses")
            .update({ name: newName })
            .eq("tenant_id", tenantId)
            .eq("name", statusName);
          if (error) throw error;
          return JSON.stringify({ success: true, message: `Contact status '${statusName}' renamed to '${newName}'.` });
        }

        if (action === "delete") {
          const { error } = await db
            .from("contact_statuses")
            .delete()
            .eq("tenant_id", tenantId)
            .eq("name", statusName);
          if (error) throw error;
          return JSON.stringify({ success: true, message: `Contact status '${statusName}' deleted.` });
        }

        return JSON.stringify({ error: `Unknown action '${action}'.` });
      }

      case "update_app_setting": {
        if (!isAdmin) return JSON.stringify({ error: "Insufficient permissions." });
        const key = String(args.key);
        const value = String(args.value);
        const { error } = await db
          .from("app_settings")
          .upsert(
            { tenant_id: tenantId, setting_key: key, setting_value: value },
            { onConflict: "tenant_id,setting_key" }
          );
        if (error) throw error;
        return JSON.stringify({ success: true, message: `Setting '${key}' updated to '${value}'.` });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    console.error(`[ai-admin-agent] Tool ${name} error:`, err);
    return JSON.stringify({ error: `Tool execution failed: ${(err as Error).message}` });
  }
}

// ── main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authenticate user
    const sb = supabaseAuth(authHeader);
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await sb.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    // Get profile for role and tenant
    const admin = supabaseService();
    const { data: profile } = await admin
      .from("profiles")
      .select("role, tenant_id, active_tenant_id, first_name")
      .eq("id", userId)
      .single();

    if (!profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userRole = profile.role;
    const tenantId = profile.active_tenant_id || profile.tenant_id;

    if (!READ_ROLES.includes(userRole)) {
      return new Response(JSON.stringify({ error: "Access denied. Insufficient role." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const isAdmin = ADMIN_ROLES.includes(userRole);

    const systemPrompt = `You are PITCH CRM Admin Assistant — an AI that helps manage system configuration and analyze CRM data.

Current user: ${profile.first_name || "Admin"} (role: ${userRole})
Tenant ID: ${tenantId}

CAPABILITIES:
- View and modify pipeline stages, lead sources, contact statuses, and app settings
- Query pipeline statistics, stagnant leads, and contact data
- Search contacts by name/phone/email

${isAdmin ? "This user has ADMIN privileges and can modify system configuration." : "This user has READ-ONLY access. They can query data but cannot modify configuration."}

RULES:
- Always confirm before making destructive changes (deleting stages, statuses, etc.)
- When showing data, format it clearly with tables or bullet points
- Be concise but thorough
- If a tool returns an error, explain it clearly to the user
- Never reveal internal IDs unless specifically asked`;

    // First AI call with tools
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        tools,
        temperature: 0.3,
        stream: true,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited — please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted — please add funds to your workspace." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const txt = await aiResponse.text();
      console.error("[ai-admin-agent] Gateway error:", aiResponse.status, txt);
      throw new Error(`AI gateway error ${aiResponse.status}`);
    }

    // We need to buffer the stream to detect tool_calls
    // Read the entire streamed response, accumulate it, then check for tool calls
    const reader = aiResponse.body!.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let toolCalls: Array<{ id: string; function: { name: string; arguments: string } }> = [];
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) fullContent += delta.content;
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCalls[idx]) {
                toolCalls[idx] = { id: tc.id || `call_${idx}`, function: { name: "", arguments: "" } };
              }
              if (tc.id) toolCalls[idx].id = tc.id;
              if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
              if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
            }
          }
        } catch {
          // partial JSON, skip
        }
      }
    }

    // If there are tool calls, execute them and make a follow-up request
    if (toolCalls.length > 0) {
      console.log(`[ai-admin-agent] Executing ${toolCalls.length} tool call(s)`);
      const toolResults: Array<{ role: string; tool_call_id: string; content: string }> = [];
      const actionsTaken: Array<{ tool: string; args: unknown; result: string }> = [];

      for (const tc of toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch { /* empty args */ }

        const result = await executeTool(tc.function.name, args, tenantId, userRole);
        toolResults.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });
        actionsTaken.push({ tool: tc.function.name, args, result });
      }

      // Build follow-up messages with tool results
      const followUpMessages = [
        { role: "system", content: systemPrompt },
        ...messages,
        {
          role: "assistant",
          content: fullContent || null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        },
        ...toolResults,
      ];

      // Stream the follow-up response
      const followUpResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: followUpMessages,
          temperature: 0.3,
          stream: true,
        }),
      });

      if (!followUpResponse.ok) {
        const txt = await followUpResponse.text();
        console.error("[ai-admin-agent] Follow-up error:", followUpResponse.status, txt);
        throw new Error(`Follow-up AI call failed: ${followUpResponse.status}`);
      }

      // Return the follow-up stream with actions_taken header
      const headers = {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "X-Actions-Taken": JSON.stringify(actionsTaken),
      };
      return new Response(followUpResponse.body, { headers });
    }

    // No tool calls — just stream the original response
    // Since we already consumed it, re-emit as SSE
    const body = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        const chunk = {
          choices: [{ delta: { content: fullContent }, finish_reason: "stop" }],
        };
        controller.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (err) {
    console.error("[ai-admin-agent] Error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
