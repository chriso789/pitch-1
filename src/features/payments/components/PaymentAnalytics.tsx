import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, TrendingUp, TrendingDown, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function PaymentAnalytics() {
  const { data: analytics, isLoading } = useQuery({
    queryKey: ["payment-analytics"],
    queryFn: async () => {
      const { data: payments, error } = await supabase
        .from("payments")
        .select("amount, status, created_at");

      if (error) throw error;

      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Calculate metrics
      const totalRevenue = payments
        ?.filter((p) => p.status === "completed")
        .reduce((sum, p) => sum + Number(p.amount), 0) || 0;

      const recentRevenue = payments
        ?.filter(
          (p) =>
            p.status === "completed" &&
            new Date(p.created_at) >= thirtyDaysAgo
        )
        .reduce((sum, p) => sum + Number(p.amount), 0) || 0;

      const pendingAmount = payments
        ?.filter((p) => p.status === "pending")
        .reduce((sum, p) => sum + Number(p.amount), 0) || 0;

      const failedAmount = payments
        ?.filter((p) => p.status === "failed")
        .reduce((sum, p) => sum + Number(p.amount), 0) || 0;

      const successRate =
        payments && payments.length > 0
          ? (payments.filter((p) => p.status === "completed").length /
              payments.length) *
            100
          : 0;

      return {
        totalRevenue,
        recentRevenue,
        pendingAmount,
        failedAmount,
        successRate,
        totalPayments: payments?.length || 0,
      };
    },
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4 rounded" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-32 mb-1" />
              <Skeleton className="h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const metrics = [
    {
      title: "Total Revenue",
      value: `$${analytics?.totalRevenue.toLocaleString() || "0"}`,
      description: "All time",
      icon: DollarSign,
      trend: analytics?.recentRevenue || 0,
    },
    {
      title: "Recent Revenue",
      value: `$${analytics?.recentRevenue.toLocaleString() || "0"}`,
      description: "Last 30 days",
      icon: TrendingUp,
      trend: analytics?.recentRevenue || 0,
    },
    {
      title: "Pending Payments",
      value: `$${analytics?.pendingAmount.toLocaleString() || "0"}`,
      description: `${analytics?.totalPayments || 0} payments`,
      icon: Clock,
      trend: analytics?.pendingAmount || 0,
    },
    {
      title: "Success Rate",
      value: `${analytics?.successRate.toFixed(1) || "0"}%`,
      description: "Payment completion",
      icon: analytics?.successRate >= 80 ? TrendingUp : TrendingDown,
      trend: analytics?.successRate || 0,
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {metrics.map((metric, index) => {
        const Icon = metric.icon;
        return (
          <Card key={index}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">{metric.title}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metric.value}</div>
              <p className="text-xs text-muted-foreground">{metric.description}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
