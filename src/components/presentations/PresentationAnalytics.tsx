import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import { Eye, CheckCircle, FileSignature, Clock } from "lucide-react";

interface PresentationAnalyticsProps {
  presentationId: string;
}

export const PresentationAnalytics = ({ presentationId }: PresentationAnalyticsProps) => {
  const { data: metrics } = useQuery({
    queryKey: ["presentation-metrics", presentationId],
    queryFn: async () => {
      // For now, calculate metrics from sessions directly
      const { data: sessions, error } = await supabase
        .from("presentation_sessions")
        .select("*")
        .eq("presentation_id", presentationId);
      
      if (error) throw error;

      const totalViews = sessions?.length || 0;
      const completed = sessions?.filter(s => s.status === "completed").length || 0;
      const completionRate = totalViews > 0 ? (completed / totalViews) * 100 : 0;
      const avgTime = sessions?.reduce((acc, s) => {
        if (s.completed_at && s.started_at) {
          return acc + (new Date(s.completed_at).getTime() - new Date(s.started_at).getTime());
        }
        return acc;
      }, 0) / (sessions?.length || 1);
      const signatures = sessions?.filter(s => s.signature_captured).length || 0;

      return {
        total_views: totalViews,
        unique_viewers: new Set(sessions?.map(s => s.contact_id).filter(Boolean)).size,
        completion_rate: completionRate,
        avg_time_spent: avgTime / 1000,
        signatures_captured: signatures,
        slide_engagement: {},
      };
    },
  });

  const { data: sessions } = useQuery({
    queryKey: ["presentation-sessions", presentationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("presentation_sessions")
        .select("*")
        .eq("presentation_id", presentationId)
        .order("started_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const metricCards = [
    {
      title: "Total Views",
      value: metrics?.total_views || 0,
      icon: Eye,
      color: "text-blue-500",
    },
    {
      title: "Completion Rate",
      value: `${metrics?.completion_rate || 0}%`,
      icon: CheckCircle,
      color: "text-green-500",
    },
    {
      title: "Signatures",
      value: metrics?.signatures_captured || 0,
      icon: FileSignature,
      color: "text-purple-500",
    },
    {
      title: "Avg Time",
      value: `${Math.round((metrics?.avg_time_spent || 0) / 60)}m`,
      icon: Clock,
      color: "text-orange-500",
    },
  ];

  const viewsOverTime = sessions?.map((session) => ({
    date: new Date(session.started_at).toLocaleDateString(),
    views: 1,
  })) || [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {metricCards.map((metric) => (
          <Card key={metric.title} className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{metric.title}</p>
                <p className="text-2xl font-bold mt-2">{metric.value}</p>
              </div>
              <metric.icon className={`h-8 w-8 ${metric.color}`} />
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Views Over Time</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={viewsOverTime}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="views" stroke="hsl(var(--primary))" />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Slide Engagement</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={Object.entries(metrics?.slide_engagement || {}).map(([slide, count]) => ({
            slide: `Slide ${slide}`,
            views: count,
          }))}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="slide" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="views" fill="hsl(var(--primary))" />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
};
