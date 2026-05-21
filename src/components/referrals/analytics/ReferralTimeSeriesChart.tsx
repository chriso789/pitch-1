import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";

export function ReferralTimeSeriesChart({ rows }: { rows: any[] | null }) {
  if (!rows) return null;
  if (rows.length === 0 || rows.every((r) => r.clicks === 0 && r.submittedLeads === 0)) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">Performance over time</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground py-8 text-center">
          No daily activity in this date range.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Performance over time</CardTitle></CardHeader>
      <CardContent className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="clicks" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="submittedLeads" stroke="hsl(var(--chart-2, 142 71% 45%))" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="soldReferrals" stroke="hsl(var(--chart-3, 38 92% 50%))" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="collectedRevenue" stroke="hsl(var(--chart-4, 280 65% 60%))" strokeWidth={2} dot={false} yAxisId={0} />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
