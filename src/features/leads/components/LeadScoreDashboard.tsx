import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { TrendingUp, Flame, Snowflake, Wind, AlertCircle, RefreshCw, Download } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { useState } from "react";

const SCORE_COLORS = {
  hot: "#ef4444",
  warm: "#f97316", 
  cold: "#3b82f6",
  unqualified: "#6b7280",
};

export default function LeadScoreDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isRescoring, setIsRescoring] = useState(false);

  const { data: scoreDistribution = [], isLoading } = useQuery({
    queryKey: ['lead-score-distribution'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select('lead_score, lead_status');
      
      if (error) throw error;

      const distribution = {
        hot: 0,
        warm: 0,
        cold: 0,
        unqualified: 0,
      };

      data.forEach(contact => {
        const score = contact.lead_score || 0;
        if (score >= 80) distribution.hot++;
        else if (score >= 60) distribution.warm++;
        else if (score >= 30) distribution.cold++;
        else distribution.unqualified++;
      });

      return [
        { name: 'Hot', value: distribution.hot, color: SCORE_COLORS.hot },
        { name: 'Warm', value: distribution.warm, color: SCORE_COLORS.warm },
        { name: 'Cold', value: distribution.cold, color: SCORE_COLORS.cold },
        { name: 'Unqualified', value: distribution.unqualified, color: SCORE_COLORS.unqualified },
      ];
    },
  });

  const { data: topLeads = [] } = useQuery({
    queryKey: ['top-leads'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, lead_score, lead_status, phone, email, clj_number')
        .gte('lead_score', 70)
        .order('lead_score', { ascending: false })
        .limit(10);
      
      if (error) throw error;
      return data;
    },
  });

  const { data: scoringHistory = [] } = useQuery({
    queryKey: ['scoring-history'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lead_scoring_history')
        .select('score, created_at')
        .order('created_at', { ascending: true })
        .limit(30);
      
      if (error) throw error;

      // Group by date and calculate average score
      const grouped = data.reduce((acc: any, item: any) => {
        const date = new Date(item.created_at).toLocaleDateString();
        if (!acc[date]) {
          acc[date] = { date, total: 0, count: 0 };
        }
        acc[date].total += item.score;
        acc[date].count++;
        return acc;
      }, {});

      return Object.values(grouped).map((item: any) => ({
        date: item.date,
        avgScore: Math.round(item.total / item.count),
      }));
    },
  });

  const bulkRescoreMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('ai-lead-scorer', {
        body: { action: 'bulk_rescore' }
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-score-distribution'] });
      queryClient.invalidateQueries({ queryKey: ['top-leads'] });
      queryClient.invalidateQueries({ queryKey: ['scoring-history'] });
      toast({ title: "Bulk re-scoring completed", description: "All leads have been re-scored." });
      setIsRescoring(false);
    },
    onError: (error: Error) => {
      toast({ title: "Re-scoring failed", description: error.message, variant: "destructive" });
      setIsRescoring(false);
    },
  });

  const handleBulkRescore = () => {
    setIsRescoring(true);
    bulkRescoreMutation.mutate();
  };

  const handleExport = async () => {
    const { data, error } = await supabase
      .from('contacts')
      .select('first_name, last_name, email, phone, lead_score, lead_status, clj_number')
      .order('lead_score', { ascending: false })
      .csv();
    
    if (error) {
      toast({ title: "Export failed", description: error.message, variant: "destructive" });
      return;
    }

    const blob = new Blob([data], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lead-scores-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    toast({ title: "Export successful", description: "Lead scores downloaded as CSV." });
  };

  const getScoreIcon = (score: number) => {
    if (score >= 80) return <Flame className="h-4 w-4 text-red-500" />;
    if (score >= 60) return <Wind className="h-4 w-4 text-orange-500" />;
    if (score >= 30) return <Snowflake className="h-4 w-4 text-blue-500" />;
    return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
  };

  if (isLoading) {
    return <div className="text-center py-8">Loading lead scores...</div>;
  }

  const totalLeads = scoreDistribution.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold">Lead Scoring Dashboard</h2>
          <p className="text-muted-foreground">AI-powered lead qualification and insights</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
          <Button onClick={handleBulkRescore} disabled={isRescoring}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isRescoring ? 'animate-spin' : ''}`} />
            {isRescoring ? 'Re-scoring...' : 'Bulk Re-score'}
          </Button>
        </div>
      </div>

      {/* Score Distribution */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Score Distribution</CardTitle>
            <CardDescription>Lead breakdown by qualification level</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={scoreDistribution}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={(entry) => `${entry.name}: ${entry.value}`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {scoreDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Score Trends</CardTitle>
            <CardDescription>Average lead score over time</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={scoringHistory}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Bar dataKey="avgScore" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Top Leads */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Flame className="h-5 w-5 text-red-500" />
            Top 10 Hottest Leads
          </CardTitle>
          <CardDescription>High-priority leads requiring immediate attention</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {topLeads.map((lead) => (
              <div key={lead.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-3">
                  {getScoreIcon(lead.lead_score || 0)}
                  <div>
                    <p className="font-medium">
                      {lead.first_name} {lead.last_name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {lead.email} • {lead.phone}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {lead.clj_number && (
                    <Badge variant="outline">{lead.clj_number}</Badge>
                  )}
                  <Badge className="bg-gradient-to-r from-red-500 to-orange-500">
                    {lead.lead_score} pts
                  </Badge>
                  <Button size="sm" variant="outline">
                    Contact
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Stats Overview */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Leads</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalLeads}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Hot Leads</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-500">
              {scoreDistribution.find(d => d.name === 'Hot')?.value || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Conversion Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totalLeads > 0 ? Math.round(((scoreDistribution.find(d => d.name === 'Hot')?.value || 0) / totalLeads) * 100) : 0}%
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Avg Score</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {scoringHistory.length > 0 
                ? scoringHistory[scoringHistory.length - 1]?.avgScore 
                : 0}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
