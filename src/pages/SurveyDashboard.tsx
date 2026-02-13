import { useState, useMemo } from "react";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { Star, TrendingUp, Users, ThumbsUp, ThumbsDown, Minus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";

const SurveyDashboard = () => {
  const { activeTenantId } = useActiveTenantId();
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const { data: surveys = [], isLoading } = useQuery({
    queryKey: ["satisfaction-surveys", activeTenantId, typeFilter],
    queryFn: async () => {
      if (!activeTenantId) return [];
      let query = supabase
        .from("satisfaction_surveys")
        .select("*, contacts(first_name, last_name, email), projects(name)")
        .eq("tenant_id", activeTenantId)
        .order("created_at", { ascending: false });

      if (typeFilter !== "all") {
        query = query.eq("survey_type", typeFilter);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeTenantId,
  });

  const completedSurveys = useMemo(() => surveys.filter((s: any) => s.nps_score !== null), [surveys]);

  const npsStats = useMemo(() => {
    if (completedSurveys.length === 0) return { nps: 0, promoters: 0, passives: 0, detractors: 0, total: 0, responseRate: 0 };
    const promoters = completedSurveys.filter((s: any) => s.nps_score >= 9).length;
    const passives = completedSurveys.filter((s: any) => s.nps_score >= 7 && s.nps_score <= 8).length;
    const detractors = completedSurveys.filter((s: any) => s.nps_score <= 6).length;
    const total = completedSurveys.length;
    const nps = Math.round(((promoters - detractors) / total) * 100);
    const responseRate = surveys.length > 0 ? Math.round((total / surveys.length) * 100) : 0;
    return { nps, promoters, passives, detractors, total, responseRate };
  }, [completedSurveys, surveys]);

  const distributionData = useMemo(() => {
    const counts = Array(11).fill(0);
    completedSurveys.forEach((s: any) => { if (s.nps_score !== null) counts[s.nps_score]++; });
    return counts.map((count, score) => ({
      score: score.toString(),
      count,
      fill: score >= 9 ? "hsl(var(--success))" : score >= 7 ? "hsl(var(--warning, 45 93% 47%))" : "hsl(var(--destructive))",
    }));
  }, [completedSurveys]);

  const trendData = useMemo(() => {
    const monthly: Record<string, { promoters: number; detractors: number; total: number }> = {};
    completedSurveys.forEach((s: any) => {
      const month = format(new Date(s.completed_at || s.created_at), "yyyy-MM");
      if (!monthly[month]) monthly[month] = { promoters: 0, detractors: 0, total: 0 };
      monthly[month].total++;
      if (s.nps_score >= 9) monthly[month].promoters++;
      if (s.nps_score <= 6) monthly[month].detractors++;
    });
    return Object.entries(monthly)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, d]) => ({
        month: format(new Date(month + "-01"), "MMM yy"),
        nps: d.total > 0 ? Math.round(((d.promoters - d.detractors) / d.total) * 100) : 0,
      }));
  }, [completedSurveys]);

  const getSentimentBadge = (sentiment: string | null) => {
    if (!sentiment) return null;
    const v = sentiment === "positive" ? "default" : sentiment === "negative" ? "destructive" : "secondary";
    return <Badge variant={v}>{sentiment}</Badge>;
  };

  const getNpsColor = (score: number) => score >= 50 ? "text-green-500" : score >= 0 ? "text-yellow-500" : "text-destructive";

  return (
    <GlobalLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Customer Satisfaction</h1>
            <p className="text-muted-foreground">NPS scores, survey responses & feedback analytics</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Survey Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="nps">NPS</SelectItem>
                <SelectItem value="csat">CSAT</SelectItem>
                <SelectItem value="post_project">Post-Project</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* NPS Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Star className="h-5 w-5 text-primary" />
                <span className="text-sm text-muted-foreground">NPS Score</span>
              </div>
              <p className={`text-3xl font-bold mt-1 ${getNpsColor(npsStats.nps)}`}>{npsStats.nps}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <ThumbsUp className="h-5 w-5 text-green-500" />
                <span className="text-sm text-muted-foreground">Promoters</span>
              </div>
              <p className="text-3xl font-bold mt-1">{npsStats.promoters}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Minus className="h-5 w-5 text-yellow-500" />
                <span className="text-sm text-muted-foreground">Passives</span>
              </div>
              <p className="text-3xl font-bold mt-1">{npsStats.passives}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <ThumbsDown className="h-5 w-5 text-destructive" />
                <span className="text-sm text-muted-foreground">Detractors</span>
              </div>
              <p className="text-3xl font-bold mt-1">{npsStats.detractors}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Response Rate</span>
              </div>
              <p className="text-3xl font-bold mt-1">{npsStats.responseRate}%</p>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Score Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={distributionData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="score" className="text-muted-foreground" />
                  <YAxis className="text-muted-foreground" />
                  <Tooltip />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">NPS Trend</CardTitle>
            </CardHeader>
            <CardContent>
              {trendData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="month" className="text-muted-foreground" />
                    <YAxis className="text-muted-foreground" />
                    <Tooltip />
                    <Line type="monotone" dataKey="nps" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ fill: "hsl(var(--primary))" }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[250px] flex items-center justify-center text-muted-foreground">No trend data yet</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Responses Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Survey Responses ({completedSurveys.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : completedSurveys.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No survey responses yet</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contact</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>Sentiment</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {completedSurveys.slice(0, 50).map((survey: any) => (
                      <TableRow key={survey.id}>
                        <TableCell className="font-medium">
                          {survey.contacts ? `${survey.contacts.first_name} ${survey.contacts.last_name}` : "—"}
                        </TableCell>
                        <TableCell>{survey.projects?.name || "—"}</TableCell>
                        <TableCell>
                          <Badge variant={survey.nps_score >= 9 ? "default" : survey.nps_score >= 7 ? "secondary" : "destructive"}>
                            {survey.nps_score}
                          </Badge>
                        </TableCell>
                        <TableCell>{getSentimentBadge(survey.sentiment)}</TableCell>
                        <TableCell className="capitalize">{survey.survey_type?.replace("_", " ")}</TableCell>
                        <TableCell>{survey.completed_at ? format(new Date(survey.completed_at), "MMM d, yyyy") : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </GlobalLayout>
  );
};

export default SurveyDashboard;
