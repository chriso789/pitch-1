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

const tools: Array<{type: string; function: {name: string; description: string; parameters: Record<string, unknown>}}> = [
  // --- Config Management ---
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
  // --- CRM Intelligence ---
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
  // --- Change Tracking & Projects ---
  {
    type: "function",
    function: {
      name: "list_recent_changes",
      description: "List recent changes made by the AI admin agent, optionally filtered by tool name.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max results (default 20)" },
          tool_filter: { type: "string", description: "Filter by tool name" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_project",
      description: "Create a tracked project/initiative (e.g. 'Reorganize pipeline stages').",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Project name" },
          description: { type: "string", description: "Project description" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_projects",
      description: "List all tracked AI admin projects for this tenant.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["active", "completed", "all"], description: "Filter by status" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_project",
      description: "Update a project's status or add notes.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project UUID" },
          status: { type: "string", enum: ["active", "in_progress", "completed", "cancelled"] },
          note: { type: "string", description: "Note to append to the project changes log" },
        },
        required: ["project_id"],
      },
    },
  },
  // --- Backend Inspection ---
  {
    type: "function",
    function: {
      name: "query_table_schema",
      description: "Inspect a database table's columns, types, and constraints. Read-only.",
      parameters: {
        type: "object",
        properties: {
          table_name: { type: "string", description: "Table name (in public schema)" },
        },
        required: ["table_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_read_query",
      description: "Execute a read-only SELECT query against the database for data analysis. Only SELECT statements allowed.",
      parameters: {
        type: "object",
        properties: {
          sql: { type: "string", description: "SELECT SQL query" },
        },
        required: ["sql"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_system_updates",
      description: "Analyze current system configuration, pipeline health, and usage patterns to suggest improvements.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

// ── tool executors ───────────────────────────────────────────────────────────

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  tenantId: string,
  userRole: string,
  userId: string,
  sessionId: string | null
): Promise<string> {
  const db = supabaseService();
  const isAdmin = ADMIN_ROLES.includes(userRole);

  // Helper to log changes for write operations
  async function logChange(toolName: string, toolArgs: unknown, result: unknown, description?: string) {
    try {
      await db.from("ai_admin_changes").insert({
        tenant_id: tenantId,
        user_id: userId,
        tool_name: toolName,
        tool_args: toolArgs,
        result,
        description,
        session_id: sessionId,
      });
    } catch (e) {
      console.error("[ai-admin-agent] Failed to log change:", e);
    }
  }

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
        let result: Record<string, unknown>;

        if (action === "add") {
          const position = Number(args.position) || 999;
          const color = String(args.color || "#3b82f6");
          const { error } = await db.from("pipeline_stages").insert({
            tenant_id: tenantId, name: stageName, order_index: position, color, is_active: true,
          });
          if (error) throw error;
          result = { success: true, message: `Pipeline stage '${stageName}' added at position ${position}.` };
        } else if (action === "rename") {
          const newName = String(args.new_name || "");
          if (!newName) return JSON.stringify({ error: "new_name is required for rename." });
          const { error } = await db.from("pipeline_stages").update({ name: newName }).eq("tenant_id", tenantId).eq("name", stageName);
          if (error) throw error;
          result = { success: true, message: `Pipeline stage '${stageName}' renamed to '${newName}'.` };
        } else if (action === "delete") {
          const { error } = await db.from("pipeline_stages").delete().eq("tenant_id", tenantId).eq("name", stageName);
          if (error) throw error;
          result = { success: true, message: `Pipeline stage '${stageName}' deleted.` };
        } else if (action === "reorder") {
          const position = Number(args.position);
          const { error } = await db.from("pipeline_stages").update({ order_index: position }).eq("tenant_id", tenantId).eq("name", stageName);
          if (error) throw error;
          result = { success: true, message: `Pipeline stage '${stageName}' moved to position ${position}.` };
        } else {
          return JSON.stringify({ error: `Unknown action '${action}'.` });
        }
        await logChange(name, args, result, `${action} pipeline stage: ${stageName}`);
        return JSON.stringify(result);
      }

      case "update_lead_source": {
        if (!isAdmin) return JSON.stringify({ error: "Insufficient permissions." });
        const action = String(args.action);
        const sourceName = String(args.name);
        let result: Record<string, unknown>;

        if (action === "add") {
          const { error } = await db.from("lead_sources").insert({ tenant_id: tenantId, name: sourceName, is_active: true });
          if (error) throw error;
          result = { success: true, message: `Lead source '${sourceName}' added.` };
        } else if (action === "remove") {
          const { error } = await db.from("lead_sources").delete().eq("tenant_id", tenantId).eq("name", sourceName);
          if (error) throw error;
          result = { success: true, message: `Lead source '${sourceName}' removed.` };
        } else {
          return JSON.stringify({ error: `Unknown action '${action}'.` });
        }
        await logChange(name, args, result, `${action} lead source: ${sourceName}`);
        return JSON.stringify(result);
      }

      case "update_contact_status": {
        if (!isAdmin) return JSON.stringify({ error: "Insufficient permissions." });
        const action = String(args.action);
        const statusName = String(args.name);
        let result: Record<string, unknown>;

        if (action === "add") {
          const color = String(args.color || "#6b7280");
          const { error } = await db.from("contact_statuses").insert({ tenant_id: tenantId, name: statusName, color, is_active: true, order_index: 999 });
          if (error) throw error;
          result = { success: true, message: `Contact status '${statusName}' added.` };
        } else if (action === "rename") {
          const newName = String(args.new_name || "");
          if (!newName) return JSON.stringify({ error: "new_name is required for rename." });
          const { error } = await db.from("contact_statuses").update({ name: newName }).eq("tenant_id", tenantId).eq("name", statusName);
          if (error) throw error;
          result = { success: true, message: `Contact status '${statusName}' renamed to '${newName}'.` };
        } else if (action === "delete") {
          const { error } = await db.from("contact_statuses").delete().eq("tenant_id", tenantId).eq("name", statusName);
          if (error) throw error;
          result = { success: true, message: `Contact status '${statusName}' deleted.` };
        } else {
          return JSON.stringify({ error: `Unknown action '${action}'.` });
        }
        await logChange(name, args, result, `${action} contact status: ${statusName}`);
        return JSON.stringify(result);
      }

      case "update_app_setting": {
        if (!isAdmin) return JSON.stringify({ error: "Insufficient permissions." });
        const key = String(args.key);
        const value = String(args.value);
        const { error } = await db.from("app_settings").upsert(
          { tenant_id: tenantId, setting_key: key, setting_value: value },
          { onConflict: "tenant_id,setting_key" }
        );
        if (error) throw error;
        const result = { success: true, message: `Setting '${key}' updated to '${value}'.` };
        await logChange(name, args, result, `Updated setting ${key}`);
        return JSON.stringify(result);
      }

      // ─── Change Tracking & Projects ────────────────────────
      case "list_recent_changes": {
        const limit = Number(args.limit) || 20;
        let query = db
          .from("ai_admin_changes")
          .select("id, tool_name, tool_args, description, created_at")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (args.tool_filter) {
          query = query.eq("tool_name", String(args.tool_filter));
        }
        const { data, error } = await query;
        if (error) throw error;
        return JSON.stringify(data);
      }

      case "create_project": {
        if (!isAdmin) return JSON.stringify({ error: "Insufficient permissions." });
        const projectName = String(args.name);
        const desc = args.description ? String(args.description) : null;
        const { data, error } = await db.from("ai_admin_projects").insert({
          tenant_id: tenantId,
          name: projectName,
          description: desc,
          status: "active",
          created_by: userId,
        }).select("id, name").single();
        if (error) throw error;
        const result = { success: true, project: data };
        await logChange(name, args, result, `Created project: ${projectName}`);
        return JSON.stringify(result);
      }

      case "list_projects": {
        const statusFilter = String(args.status || "active");
        let query = db
          .from("ai_admin_projects")
          .select("id, name, description, status, created_at, updated_at")
          .eq("tenant_id", tenantId)
          .order("updated_at", { ascending: false });
        if (statusFilter !== "all") {
          query = query.eq("status", statusFilter);
        }
        const { data, error } = await query;
        if (error) throw error;
        return JSON.stringify(data);
      }

      case "update_project": {
        if (!isAdmin) return JSON.stringify({ error: "Insufficient permissions." });
        const projectId = String(args.project_id);
        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (args.status) updates.status = String(args.status);

        // If a note is provided, append it to the changes array
        if (args.note) {
          const { data: existing } = await db.from("ai_admin_projects").select("changes").eq("id", projectId).single();
          const changes = Array.isArray(existing?.changes) ? existing.changes : [];
          changes.push({ note: String(args.note), at: new Date().toISOString(), by: userId });
          updates.changes = changes;
        }

        const { error } = await db.from("ai_admin_projects").update(updates).eq("id", projectId).eq("tenant_id", tenantId);
        if (error) throw error;
        const result = { success: true, message: `Project updated.` };
        await logChange(name, args, result, `Updated project ${projectId}`);
        return JSON.stringify(result);
      }

      // ─── Backend Inspection ────────────────────────────────
      case "query_table_schema": {
        const tableName = String(args.table_name).replace(/[^a-zA-Z0-9_]/g, "");
        const { data, error } = await db.rpc("", {}).catch(() => null) as any;
        // Use information_schema directly via a raw query workaround
        const { data: cols, error: colErr } = await db
          .from("information_schema.columns" as any)
          .select("column_name, data_type, is_nullable, column_default")
          .eq("table_schema", "public")
          .eq("table_name", tableName)
          .order("ordinal_position" as any);
        // Fallback: use rpc if direct query fails
        if (colErr) {
          // Try a direct SQL approach via postgrest
          return JSON.stringify({ error: `Could not inspect table '${tableName}': ${colErr.message}. This tool works best with public schema tables.` });
        }
        return JSON.stringify({ table: tableName, columns: cols });
      }

      case "run_read_query": {
        const sql = String(args.sql || "").trim();
        // Strict validation: only SELECT allowed
        if (!/^SELECT\b/i.test(sql)) {
          return JSON.stringify({ error: "Only SELECT queries are allowed." });
        }
        // Block dangerous keywords
        const blocked = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXECUTE|EXEC)\b/i;
        if (blocked.test(sql)) {
          return JSON.stringify({ error: "Query contains prohibited keywords. Only read-only SELECT queries are allowed." });
        }
        try {
          // Execute via postgrest rpc or direct fetch
          const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
          const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
          const resp = await fetch(`${supabaseUrl}/rest/v1/rpc/`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${serviceKey}`,
              "apikey": serviceKey,
              "Prefer": "return=representation",
            },
            body: JSON.stringify({}),
          });
          // Since we can't run arbitrary SQL via postgrest, use the pg_net or a workaround
          // For now, indicate limitation
          return JSON.stringify({ info: "Direct SQL execution requires a database function. The query was validated as read-only.", sql, suggestion: "Create a postgres function 'run_readonly_query(sql text)' to enable this." });
        } catch (e) {
          return JSON.stringify({ error: `Query failed: ${(e as Error).message}` });
        }
      }

      case "suggest_system_updates": {
        // Gather system state for analysis
        const [stages, sources, statuses, pipelineData, contactData] = await Promise.all([
          db.from("pipeline_stages").select("name, order_index, is_active").eq("tenant_id", tenantId).order("order_index"),
          db.from("lead_sources").select("name, is_active").eq("tenant_id", tenantId),
          db.from("contact_statuses").select("name, is_active, order_index").eq("tenant_id", tenantId),
          db.from("pipeline_entries").select("stage_name, estimated_value, updated_at, created_at").eq("tenant_id", tenantId).limit(500),
          db.from("contacts").select("qualification_status, created_at").eq("tenant_id", tenantId).limit(500),
        ]);

        // Compute metrics
        const staleCount = (pipelineData.data || []).filter((e: any) => {
          const updated = new Date(e.updated_at);
          return (Date.now() - updated.getTime()) > 14 * 24 * 60 * 60 * 1000;
        }).length;

        const totalPipeline = (pipelineData.data || []).length;
        const inactiveStages = (stages.data || []).filter((s: any) => !s.is_active).length;
        const inactiveSources = (sources.data || []).filter((s: any) => !s.is_active).length;

        return JSON.stringify({
          analysis: {
            pipeline_stages: { total: stages.data?.length || 0, inactive: inactiveStages },
            lead_sources: { total: sources.data?.length || 0, inactive: inactiveSources },
            contact_statuses: { total: statuses.data?.length || 0 },
            pipeline_entries: { total: totalPipeline, stale_14d: staleCount },
            contacts: { total: contactData.data?.length || 0 },
          },
          suggestions: [
            staleCount > 5 ? `⚠️ ${staleCount} pipeline entries have been stale for 14+ days. Consider reviewing or archiving them.` : null,
            inactiveStages > 0 ? `🔧 ${inactiveStages} pipeline stage(s) are inactive. Consider removing them to simplify the pipeline.` : null,
            inactiveSources > 0 ? `🔧 ${inactiveSources} lead source(s) are inactive. Clean up unused sources.` : null,
            totalPipeline === 0 ? "📊 No pipeline entries found. Make sure leads are being added to the pipeline." : null,
          ].filter(Boolean),
        });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    console.error(`[ai-admin-agent] Tool ${name} error:`, err);
    return JSON.stringify({ error: `Tool execution failed: ${(err as Error).message}` });
  }
}

// ── AI provider calls ────────────────────────────────────────────────────────

interface AIMessage {
  role: string;
  content?: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

async function callOpenAI(
  messages: AIMessage[],
  includeTools: boolean,
  stream: boolean
): Promise<Response> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const body: Record<string, unknown> = {
    model: "gpt-4o",
    messages,
    temperature: 0.3,
    stream,
  };
  if (includeTools) {
    body.tools = tools;
  }

  return await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function callAnthropic(
  messages: AIMessage[],
  systemPrompt: string
): Promise<{ content: string }> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  // Convert messages for Anthropic format (no system in messages array)
  const anthropicMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "tool" ? "user" : m.role,
      content: m.role === "tool" ? `[Tool result]: ${m.content}` : (m.content || ""),
    }));

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      messages: anthropicMessages,
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Anthropic error ${resp.status}: ${txt}`);
  }

  const json = await resp.json();
  const content = json.content?.[0]?.text || "";
  return { content };
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
    const { data: { user }, error: userError } = await sb.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

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

    const { messages, model: requestedModel, session_id } = await req.json();
    const useAnthropic = requestedModel === "claude";
    const isAdmin = ADMIN_ROLES.includes(userRole);

    const systemPrompt = `You are PITCH CRM Admin Assistant — an AI that helps manage system configuration and analyze CRM data.

Current user: ${profile.first_name || "Admin"} (role: ${userRole})
Tenant ID: ${tenantId}

CAPABILITIES:
- View and modify pipeline stages, lead sources, contact statuses, and app settings
- Query pipeline statistics, stagnant leads, and contact data
- Search contacts by name/phone/email
- Track changes: view recent modifications, create/manage projects
- Inspect database schema and suggest system improvements
- Reference past changes and provide context on what was modified

${isAdmin ? "This user has ADMIN privileges and can modify system configuration." : "This user has READ-ONLY access. They can query data but cannot modify configuration."}

RULES:
- Always confirm before making destructive changes (deleting stages, statuses, etc.)
- When showing data, format it clearly with tables or bullet points
- Be concise but thorough
- Log all write operations automatically
- If a tool returns an error, explain it clearly to the user
- When asked about past changes, use list_recent_changes
- When working on multi-step initiatives, create a project to track progress
- Never reveal internal IDs unless specifically asked`;

    // Try OpenAI with tool-calling first
    if (!useAnthropic) {
      try {
        const aiMessages: AIMessage[] = [
          { role: "system", content: systemPrompt },
          ...messages,
        ];

        const aiResponse = await callOpenAI(aiMessages, true, true);

        if (!aiResponse.ok) {
          if (aiResponse.status === 429) {
            return new Response(JSON.stringify({ error: "Rate limited — please try again in a moment." }), {
              status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          const txt = await aiResponse.text();
          console.error("[ai-admin-agent] OpenAI error:", aiResponse.status, txt);
          throw new Error(`OpenAI error ${aiResponse.status}`);
        }

        // Buffer stream to detect tool_calls
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
                  const tcIdx = tc.index ?? 0;
                  if (!toolCalls[tcIdx]) {
                    toolCalls[tcIdx] = { id: tc.id || `call_${tcIdx}`, function: { name: "", arguments: "" } };
                  }
                  if (tc.id) toolCalls[tcIdx].id = tc.id;
                  if (tc.function?.name) toolCalls[tcIdx].function.name += tc.function.name;
                  if (tc.function?.arguments) toolCalls[tcIdx].function.arguments += tc.function.arguments;
                }
              }
            } catch {
              // partial JSON, skip
            }
          }
        }

        // Execute tool calls if present
        if (toolCalls.length > 0) {
          console.log(`[ai-admin-agent] Executing ${toolCalls.length} tool call(s)`);
          const toolResults: AIMessage[] = [];
          const actionsTaken: Array<{ tool: string; args: unknown; result: string }> = [];

          for (const tc of toolCalls) {
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* empty */ }

            const result = await executeTool(tc.function.name, args, tenantId, userRole, userId, session_id || null);
            toolResults.push({ role: "tool", tool_call_id: tc.id, content: result });
            actionsTaken.push({ tool: tc.function.name, args, result });
          }

          // Follow-up call with tool results
          const followUpMessages: AIMessage[] = [
            { role: "system", content: systemPrompt },
            ...messages,
            {
              role: "assistant",
              content: fullContent || null,
              tool_calls: toolCalls.map((tc) => ({
                id: tc.id, type: "function",
                function: { name: tc.function.name, arguments: tc.function.arguments },
              })),
            },
            ...toolResults,
          ];

          const followUpResponse = await callOpenAI(followUpMessages, false, true);
          if (!followUpResponse.ok) {
            const txt = await followUpResponse.text();
            console.error("[ai-admin-agent] Follow-up error:", followUpResponse.status, txt);
            throw new Error(`Follow-up AI call failed: ${followUpResponse.status}`);
          }

          return new Response(followUpResponse.body, {
            headers: {
              ...corsHeaders,
              "Content-Type": "text/event-stream",
              "X-Actions-Taken": JSON.stringify(actionsTaken),
            },
          });
        }

        // No tool calls — re-emit buffered content as SSE
        const body = new ReadableStream({
          start(controller) {
            const enc = new TextEncoder();
            const chunk = { choices: [{ delta: { content: fullContent }, finish_reason: "stop" }] };
            controller.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            controller.enqueue(enc.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });

        return new Response(body, {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
        });
      } catch (openaiErr) {
        console.error("[ai-admin-agent] OpenAI failed, falling back to Anthropic:", openaiErr);
        // Fall through to Anthropic
      }
    }

    // Anthropic Claude fallback (non-streaming, no tool-calling)
    try {
      const anthropicResult = await callAnthropic(
        [{ role: "system", content: systemPrompt }, ...messages],
        systemPrompt
      );

      // Return as SSE for consistent frontend parsing
      const body = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          const chunk = { choices: [{ delta: { content: anthropicResult.content }, finish_reason: "stop" }] };
          controller.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          controller.enqueue(enc.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });

      return new Response(body, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    } catch (claudeErr) {
      console.error("[ai-admin-agent] Anthropic also failed:", claudeErr);
      throw claudeErr;
    }
  } catch (err) {
    console.error("[ai-admin-agent] Error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
