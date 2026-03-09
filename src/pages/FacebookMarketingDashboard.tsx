import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/UserProfileContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, FunnelChart, Funnel, LabelList } from "recharts";
import { Facebook, TrendingUp, DollarSign, Users, Target, Activity } from "lucide-react";
import { useState } from "react";

const FacebookMarketingDashboard = () => {
  const { profile } = useUserProfile();
  const tenantId = profile?.active_tenant_id || profile?.tenant_id;
  const [days, setDays] = useState(30);
  const [groupBy, setGroupBy] = useState("source");

  // ROI data from edge function
  const { data: roiData, isLoading: roiLoading } = useQuery({
    queryKey: ["marketing-roi", tenantId, days, groupBy],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("marketing-roi-calculator", {
        body: { tenant_id: tenantId, days, group_by: groupBy },
      });
      if (error) throw error;
      return data;
    },
    enabled: !!tenantId,
  });

  // Attribution summary
  const { data: attributionData } = useQuery({
    queryKey: ["lead-attribution-summary", tenantId, days],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("lead-attribution-tracker", {
        body: { action: "summary", tenant_id: tenantId, days },
      });
      if (error) throw error;
      return data;
    },
    enabled: !!tenantId,
  });

  // CAPI event log from audit_log
  const { data: capiEvents } = useQuery({
    queryKey: ["capi-events", tenantId],
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_log")
        .select("*")
        .eq("tenant_id", tenantId!)
        .eq("table_name", "meta_capi")
        .order("created_at", { ascending: false })
        .limit(20);
      return data || [];
    },
    enabled: !!tenantId,
  });

  // Pipeline funnel data
  const { data: funnelData } = useQuery({
    queryKey: ["pipeline-funnel", tenantId],
    queryFn: async () => {
      const { data } = await supabase
        .from("pipeline_entries")
        .select("status")
        .eq("tenant_id", tenantId!);

      const counts: Record<string, number> = {};
      (data || []).forEach((e) => {
        counts[e.status] = (counts[e.status] || 0) + 1;
      });

      return [
        { name: "Leads", value: counts["lead"] || 0, fill: "hsl(var(--primary))" },
        { name: "Appointments", value: (counts["appointment_set"] || 0) + (counts["appointment_scheduled"] || 0), fill: "hsl(var(--chart-2))" },
        { name: "Proposals", value: (counts["proposal_sent"] || 0) + (counts["contingency"] || 0), fill: "hsl(var(--chart-3))" },
        { name: "Projects", value: counts["project"] || 0, fill: "hsl(var(--chart-4))" },
      ];
    },
    enabled: !!tenantId,
  });

  const totals = roiData?.totals;

  return (
    <GlobalLayout>
      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Facebook className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Facebook Marketing</h1>
              <p className="text-sm text-muted-foreground">Attribution, CAPI events & ROI tracking</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
            <Select value={groupBy} onValueChange={setGroupBy}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="source">By Source</SelectItem>
                <SelectItem value="campaign">By Campaign</SelectItem>
                <SelectItem value="medium">By Medium</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Users className="h-3.5 w-3.5" />
                Total Leads
              </div>
              <p className="text-2xl font-bold text-foreground">{totals?.leads ?? "–"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Target className="h-3.5 w-3.5" />
                Conversions
              </div>
              <p className="text-2xl font-bold text-foreground">{totals?.conversions ?? "–"}</p>
              {totals?.conversion_rate != null && (
                <p className="text-xs text-muted-foreground">{totals.conversion_rate}% rate</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <DollarSign className="h-3.5 w-3.5" />
                Revenue
              </div>
              <p className="text-2xl font-bold text-foreground">
                ${(totals?.revenue ?? 0).toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <TrendingUp className="h-3.5 w-3.5" />
                ROI
              </div>
              <p className="text-2xl font-bold text-foreground">
                {totals?.roi_pct != null ? `${totals.roi_pct}%` : "–"}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Charts Row */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* ROI by Source */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Revenue by {groupBy}</CardTitle>
            </CardHeader>
            <CardContent>
              {roiLoading ? (
                <p className="text-muted-foreground text-sm">Loading…</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={roiData?.results || []}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="name" className="text-xs fill-muted-foreground" />
                    <YAxis className="text-xs fill-muted-foreground" />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                    />
                    <Bar dataKey="total_revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Revenue" />
                    <Bar dataKey="total_cost" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} name="Cost" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Funnel */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pipeline Funnel</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {(funnelData || []).map((stage, i) => (
                  <div key={stage.name} className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground w-24">{stage.name}</span>
                    <div className="flex-1 bg-muted rounded-full h-6 overflow-hidden">
                      <div
                        className="h-full rounded-full flex items-center justify-end pr-2 text-xs font-medium text-primary-foreground"
                        style={{
                          width: `${Math.max(((stage.value / Math.max((funnelData?.[0]?.value || 1), 1)) * 100), 8)}%`,
                          backgroundColor: stage.fill,
                        }}
                      >
                        {stage.value}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Attribution Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Campaign ROI Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 font-medium">Source</th>
                    <th className="text-right py-2 font-medium">Leads</th>
                    <th className="text-right py-2 font-medium">Conv.</th>
                    <th className="text-right py-2 font-medium">Rate</th>
                    <th className="text-right py-2 font-medium">Cost</th>
                    <th className="text-right py-2 font-medium">Revenue</th>
                    <th className="text-right py-2 font-medium">ROI</th>
                    <th className="text-right py-2 font-medium">CPL</th>
                  </tr>
                </thead>
                <tbody>
                  {(roiData?.results || []).map((row: any) => (
                    <tr key={row.name} className="border-b border-border/50">
                      <td className="py-2 font-medium text-foreground">{row.name}</td>
                      <td className="text-right text-foreground">{row.leads}</td>
                      <td className="text-right text-foreground">{row.conversions}</td>
                      <td className="text-right text-foreground">{row.conversion_rate}%</td>
                      <td className="text-right text-foreground">${row.total_cost.toLocaleString()}</td>
                      <td className="text-right text-foreground">${row.total_revenue.toLocaleString()}</td>
                      <td className="text-right">
                        {row.roi_pct != null ? (
                          <Badge variant={row.roi_pct >= 0 ? "default" : "destructive"} className="text-xs">
                            {row.roi_pct}%
                          </Badge>
                        ) : "–"}
                      </td>
                      <td className="text-right text-foreground">${row.cost_per_lead}</td>
                    </tr>
                  ))}
                  {(!roiData?.results || roiData.results.length === 0) && (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-muted-foreground">
                        No attribution data yet. Create leads with UTM sources to see results.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* CAPI Events Log */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Recent CAPI Events
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {(capiEvents || []).length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No CAPI events recorded yet. Configure Meta Pixel in Settings → Integrations.
                </p>
              )}
              {(capiEvents || []).map((event: any) => (
                <div key={event.id} className="flex items-center justify-between py-2 border-b border-border/50 text-sm">
                  <div>
                    <span className="font-medium text-foreground">
                      {(event.new_values as any)?.event_name || "Event"}
                    </span>
                    <span className="text-muted-foreground ml-2">
                      {new Date(event.created_at).toLocaleString()}
                    </span>
                  </div>
                  <Badge variant={event.action === "meta_capi_event_sent" ? "default" : "destructive"} className="text-xs">
                    {event.action === "meta_capi_event_sent" ? "Sent" : "Failed"}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </GlobalLayout>
  );
};

export default FacebookMarketingDashboard;
