import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useReferralOverview } from "@/hooks/referrals/useReferralDashboard";
import { formatCurrency } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { format, subDays } from "date-fns";

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}

export function ReferralOverview() {
  const { data, isLoading } = useReferralOverview();

  const stats = useMemo(() => {
    if (!data) return null;
    const links = data.links;
    const events = data.events;
    const subs = data.submissions;
    const payouts = data.payouts;
    const credits = data.credits;

    const clicks = events.filter((e: any) => e.event_type === "page_view" || e.event_type === "click").length;
    const visitors = new Set(events.map((e: any) => e.visitor_id).filter(Boolean)).size;
    const submitted = subs.length;
    const valid = subs.filter((s: any) => s.payout_eligible).length;
    const sold = subs.filter((s: any) => s.status === "sold").length;
    const completed = subs.filter((s: any) => s.status === "completed").length;
    const duplicate = subs.filter((s: any) => s.status === "duplicate").length;
    const pendingAmt = payouts.filter((p: any) => p.payout_status === "pending").reduce((a: number, p: any) => a + Number(p.payout_amount || 0), 0);
    const approvedAmt = payouts.filter((p: any) => p.payout_status === "approved").reduce((a: number, p: any) => a + Number(p.payout_amount || 0), 0);
    const paidAmt = payouts.filter((p: any) => p.payout_status === "paid").reduce((a: number, p: any) => a + Number(p.payout_amount || 0), 0);

    const balByContact = new Map<string, number>();
    for (const c of credits) {
      balByContact.set(c.referrer_contact_id, c.balance_after ?? 0);
    }
    const storedOutstanding = Array.from(balByContact.values()).reduce((a, b) => a + Number(b || 0), 0);

    const visitorToLead = visitors > 0 ? ((submitted / visitors) * 100).toFixed(1) + "%" : "—";
    const leadToSold = submitted > 0 ? ((sold / submitted) * 100).toFixed(1) + "%" : "—";

    // Daily series (last 30 days)
    const days = Array.from({ length: 30 }, (_, i) => format(subDays(new Date(), 29 - i), "MMM d"));
    const clicksByDay = days.map((d) => ({ date: d, value: 0 }));
    const subsByDay = days.map((d) => ({ date: d, value: 0 }));
    const dayKey = (iso: string) => format(new Date(iso), "MMM d");
    for (const e of events) {
      const k = dayKey(e.created_at);
      const idx = days.indexOf(k);
      if (idx >= 0) clicksByDay[idx].value += 1;
    }
    for (const s of subs) {
      const k = dayKey(s.created_at);
      const idx = days.indexOf(k);
      if (idx >= 0) subsByDay[idx].value += 1;
    }

    // Source breakdown
    const sources = new Map<string, number>();
    for (const e of events) {
      const k = e.utm_source || "(direct)";
      sources.set(k, (sources.get(k) || 0) + 1);
    }
    const sourceRows = Array.from(sources.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);

    return {
      activeLinks: links.filter((l: any) => l.is_active).length,
      clicks, visitors, submitted, valid, sold, completed, duplicate,
      pendingAmt, approvedAmt, paidAmt, storedOutstanding,
      visitorToLead, leadToSold, clicksByDay, subsByDay, sourceRows,
    };
  }, [data]);

  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
    );
  }

  if (data && data.links.length === 0 && data.events.length === 0 && data.submissions.length === 0) {
    return <div className="text-center py-12 text-muted-foreground">No referral activity yet.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Active links" value={stats.activeLinks} />
        <Stat label="Total clicks" value={stats.clicks} />
        <Stat label="Unique visitors" value={stats.visitors} />
        <Stat label="Leads submitted" value={stats.submitted} />
        <Stat label="Valid leads" value={stats.valid} />
        <Stat label="Duplicates" value={stats.duplicate} />
        <Stat label="Sold" value={stats.sold} />
        <Stat label="Completed" value={stats.completed} />
        <Stat label="Pending payouts" value={formatCurrency(stats.pendingAmt)} />
        <Stat label="Approved payouts" value={formatCurrency(stats.approvedAmt)} />
        <Stat label="Paid payouts" value={formatCurrency(stats.paidAmt)} />
        <Stat label="Stored credit" value={formatCurrency(stats.storedOutstanding)} />
        <Stat label="Visitor → Lead" value={stats.visitorToLead} />
        <Stat label="Lead → Sold" value={stats.leadToSold} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Clicks (last 30 days)</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.clicksByDay}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="value" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Submissions (last 30 days)</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.subsByDay}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="value" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Source breakdown</CardTitle></CardHeader>
        <CardContent>
          {stats.sourceRows.length === 0 ? (
            <div className="text-sm text-muted-foreground">No traffic yet.</div>
          ) : (
            <div className="space-y-1.5">
              {stats.sourceRows.map(([src, n]) => (
                <div key={src} className="flex justify-between text-sm">
                  <span>{src}</span><span className="font-medium">{n}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
