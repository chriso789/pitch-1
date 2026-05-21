import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ReferralFunnelChart({ funnel }: { funnel: { stage: string; count: number }[] | null }) {
  if (!funnel) return null;
  const max = Math.max(...funnel.map((f) => f.count), 1);
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Referral funnel</CardTitle></CardHeader>
      <CardContent>
        {funnel.every((f) => f.count === 0) ? (
          <div className="text-sm text-muted-foreground py-6 text-center">No referral analytics yet.</div>
        ) : (
          <div className="space-y-2">
            {funnel.map((f) => {
              const w = `${Math.max((f.count / max) * 100, f.count > 0 ? 4 : 0)}%`;
              return (
                <div key={f.stage} className="flex items-center gap-3 text-sm">
                  <div className="w-48 text-muted-foreground truncate">{f.stage}</div>
                  <div className="flex-1 bg-muted rounded h-6 relative overflow-hidden">
                    <div className="h-full bg-primary/80 rounded transition-all"
                      style={{ width: w }} />
                  </div>
                  <div className="w-16 text-right font-medium tabular-nums">{f.count}</div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
