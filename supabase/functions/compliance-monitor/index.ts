import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ComplianceRequest {
  action: "check_compliance_status" | "track_license" | "track_certification" | "get_expiring_items" | "generate_compliance_report" | "send_expiry_alerts";
  tenant_id: string;
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

    const { action, tenant_id, params = {} } = await req.json() as ComplianceRequest;

    if (!tenant_id) {
      return new Response(
        JSON.stringify({ error: "tenant_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[compliance-monitor] Action: ${action}, Tenant: ${tenant_id}`);

    switch (action) {
      case "check_compliance_status": {
        const today = new Date();
        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

        // Get all compliance items
        const { data: items } = await supabase
          .from("compliance_items")
          .select(`
            *,
            profiles!compliance_items_assigned_to_fkey (
              id,
              full_name
            )
          `)
          .eq("tenant_id", tenant_id);

        // Categorize by status
        const expired = items?.filter(i => new Date(i.expiry_date) < today) || [];
        const expiringSoon = items?.filter(i => {
          const expiry = new Date(i.expiry_date);
          return expiry >= today && expiry <= thirtyDaysFromNow;
        }) || [];
        const active = items?.filter(i => new Date(i.expiry_date) > thirtyDaysFromNow) || [];

        // Calculate compliance score
        const totalItems = items?.length || 0;
        const compliantItems = active.length;
        const complianceScore = totalItems > 0 
          ? Math.round((compliantItems / totalItems) * 100) 
          : 100;

        // Group by type
        const byType: Record<string, { total: number; expired: number; expiring: number; active: number }> = {};
        items?.forEach(item => {
          if (!byType[item.item_type]) {
            byType[item.item_type] = { total: 0, expired: 0, expiring: 0, active: 0 };
          }
          byType[item.item_type].total++;
          if (expired.some(e => e.id === item.id)) byType[item.item_type].expired++;
          else if (expiringSoon.some(e => e.id === item.id)) byType[item.item_type].expiring++;
          else byType[item.item_type].active++;
        });

        return new Response(
          JSON.stringify({
            success: true,
            compliance_status: {
              score: complianceScore,
              rating: complianceScore >= 90 ? "Excellent" 
                : complianceScore >= 70 ? "Good" 
                : complianceScore >= 50 ? "Fair" : "Critical",
              summary: {
                total_items: totalItems,
                active: active.length,
                expiring_soon: expiringSoon.length,
                expired: expired.length
              },
              by_type: byType,
              critical_items: [
                ...expired.map(i => ({ ...i, urgency: "expired" })),
                ...expiringSoon.map(i => ({ ...i, urgency: "expiring_soon" }))
              ].slice(0, 10)
            }
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "track_license": {
        const { 
          id, // For updates
          name, 
          number, 
          issuing_authority, 
          issue_date, 
          expiry_date, 
          document_url,
          assigned_to,
          notes,
          alert_days = 30
        } = params;

        if (!name || !expiry_date) {
          return new Response(
            JSON.stringify({ error: "name and expiry_date are required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const itemData = {
          tenant_id,
          item_type: "license",
          name,
          number,
          issuing_authority,
          issue_date,
          expiry_date,
          document_url,
          assigned_to,
          notes,
          alert_days,
          status: new Date(expiry_date as string) < new Date() ? "expired" : "active"
        };

        let result;
        if (id) {
          // Update existing
          result = await supabase
            .from("compliance_items")
            .update(itemData)
            .eq("id", id)
            .eq("tenant_id", tenant_id)
            .select()
            .single();
        } else {
          // Create new
          result = await supabase
            .from("compliance_items")
            .insert(itemData)
            .select()
            .single();
        }

        if (result.error) {
          return new Response(
            JSON.stringify({ error: result.error.message }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            license: result.data,
            message: id ? "License updated" : "License created"
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "track_certification": {
        const { 
          id,
          name, 
          number,
          issuing_authority, 
          assigned_to,
          issue_date, 
          expiry_date, 
          document_url,
          notes,
          alert_days = 30
        } = params;

        if (!name || !expiry_date || !assigned_to) {
          return new Response(
            JSON.stringify({ error: "name, expiry_date, and assigned_to are required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const itemData = {
          tenant_id,
          item_type: "certification",
          name,
          number,
          issuing_authority,
          assigned_to,
          issue_date,
          expiry_date,
          document_url,
          notes,
          alert_days,
          status: new Date(expiry_date as string) < new Date() ? "expired" : "active"
        };

        let result;
        if (id) {
          result = await supabase
            .from("compliance_items")
            .update(itemData)
            .eq("id", id)
            .eq("tenant_id", tenant_id)
            .select()
            .single();
        } else {
          result = await supabase
            .from("compliance_items")
            .insert(itemData)
            .select()
            .single();
        }

        if (result.error) {
          return new Response(
            JSON.stringify({ error: result.error.message }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            certification: result.data,
            message: id ? "Certification updated" : "Certification created"
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "get_expiring_items": {
        const { days_ahead = 30, item_type } = params;

        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + Number(days_ahead));

        let query = supabase
          .from("compliance_items")
          .select(`
            *,
            profiles!compliance_items_assigned_to_fkey (
              id,
              full_name,
              email
            )
          `)
          .eq("tenant_id", tenant_id)
          .lte("expiry_date", futureDate.toISOString())
          .order("expiry_date", { ascending: true });

        if (item_type) {
          query = query.eq("item_type", item_type);
        }

        const { data: items, error } = await query;

        if (error) {
          return new Response(
            JSON.stringify({ error: error.message }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const today = new Date();
        const categorized = {
          expired: items?.filter(i => new Date(i.expiry_date) < today) || [],
          expiring_this_week: items?.filter(i => {
            const expiry = new Date(i.expiry_date);
            const weekFromNow = new Date();
            weekFromNow.setDate(weekFromNow.getDate() + 7);
            return expiry >= today && expiry <= weekFromNow;
          }) || [],
          expiring_this_month: items?.filter(i => {
            const expiry = new Date(i.expiry_date);
            const weekFromNow = new Date();
            weekFromNow.setDate(weekFromNow.getDate() + 7);
            const monthFromNow = new Date();
            monthFromNow.setDate(monthFromNow.getDate() + 30);
            return expiry > weekFromNow && expiry <= monthFromNow;
          }) || []
        };

        return new Response(
          JSON.stringify({
            success: true,
            items: categorized,
            total_count: items?.length || 0
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "generate_compliance_report": {
        const { include_details = true } = params;

        const { data: items } = await supabase
          .from("compliance_items")
          .select(`
            *,
            profiles!compliance_items_assigned_to_fkey (
              full_name
            )
          `)
          .eq("tenant_id", tenant_id)
          .order("item_type")
          .order("expiry_date");

        const { data: tenant } = await supabase
          .from("tenants")
          .select("name")
          .eq("id", tenant_id)
          .single();

        const today = new Date();

        // Build report
        const report = {
          generated_at: today.toISOString(),
          company_name: tenant?.name || "Unknown",
          summary: {
            total_items: items?.length || 0,
            active: items?.filter(i => i.status === "active" && new Date(i.expiry_date) > today).length || 0,
            expired: items?.filter(i => new Date(i.expiry_date) < today).length || 0,
            pending_renewal: items?.filter(i => i.status === "pending_renewal").length || 0
          },
          by_type: {} as Record<string, unknown[]>,
          upcoming_expirations: items
            ?.filter(i => {
              const expiry = new Date(i.expiry_date);
              const sixtyDays = new Date();
              sixtyDays.setDate(sixtyDays.getDate() + 60);
              return expiry >= today && expiry <= sixtyDays;
            })
            .map(i => ({
              name: i.name,
              type: i.item_type,
              expires: i.expiry_date,
              days_remaining: Math.ceil((new Date(i.expiry_date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
              assigned_to: i.profiles?.full_name
            })) || []
        };

        // Group by type
        items?.forEach(item => {
          if (!report.by_type[item.item_type]) {
            report.by_type[item.item_type] = [];
          }
          if (include_details) {
            report.by_type[item.item_type].push({
              name: item.name,
              number: item.number,
              issuing_authority: item.issuing_authority,
              issue_date: item.issue_date,
              expiry_date: item.expiry_date,
              status: new Date(item.expiry_date) < today ? "EXPIRED" : item.status,
              assigned_to: item.profiles?.full_name
            });
          }
        });

        return new Response(
          JSON.stringify({
            success: true,
            report
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "send_expiry_alerts": {
        const today = new Date();
        
        // Get items expiring within their alert window
        const { data: items } = await supabase
          .from("compliance_items")
          .select(`
            *,
            profiles!compliance_items_assigned_to_fkey (
              id,
              full_name,
              email
            )
          `)
          .eq("tenant_id", tenant_id)
          .eq("status", "active");

        const alertsToSend: Array<{
          item: unknown;
          days_until_expiry: number;
          recipient: unknown;
        }> = [];

        items?.forEach(item => {
          const daysUntilExpiry = Math.ceil(
            (new Date(item.expiry_date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
          );
          
          if (daysUntilExpiry <= (item.alert_days || 30) && daysUntilExpiry >= 0) {
            alertsToSend.push({
              item,
              days_until_expiry: daysUntilExpiry,
              recipient: item.profiles
            });
          }
        });

        // Create notifications for each alert
        const notificationPromises = alertsToSend.map(async (alert) => {
          if (alert.recipient?.id) {
            await supabase
              .from("user_notifications")
              .insert({
                tenant_id,
                user_id: alert.recipient.id,
                type: "compliance_expiry",
                title: `${(alert.item as any).item_type} Expiring Soon`,
                message: `${(alert.item as any).name} expires in ${alert.days_until_expiry} days`,
                action_url: `/settings/compliance`,
                metadata: {
                  item_id: (alert.item as any).id,
                  expiry_date: (alert.item as any).expiry_date
                }
              });
          }
        });

        await Promise.all(notificationPromises);

        // Update items to pending_renewal if within 7 days
        const urgentItems = alertsToSend.filter(a => a.days_until_expiry <= 7);
        if (urgentItems.length > 0) {
          await supabase
            .from("compliance_items")
            .update({ status: "pending_renewal" })
            .in("id", urgentItems.map(u => (u.item as any).id));
        }

        return new Response(
          JSON.stringify({
            success: true,
            alerts_sent: alertsToSend.length,
            alerts: alertsToSend.map(a => ({
              item_name: (a.item as any).name,
              item_type: (a.item as any).item_type,
              days_until_expiry: a.days_until_expiry,
              recipient: (a.recipient as any)?.full_name
            }))
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
    console.error("[compliance-monitor] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
