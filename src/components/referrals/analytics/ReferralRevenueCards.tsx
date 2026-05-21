import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

function pct(v: number | null) {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}
function money(v: number | null | undefined) {
  return v == null ? "—" : formatCurrency(Number(v));
}

function Card1({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
        {hint && <div className="text-[10px] text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export function ReferralRevenueCards({ overview }: { overview: any | null }) {
  if (!overview) return null;
  const roi = overview.referralRoi;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Card1 label="Collected revenue" value={money(overview.collectedRevenue)} />
      <Card1 label="Sold revenue" value={money(overview.soldRevenue)} />
      <Card1 label="Paid + approved rewards" value={money(overview.paidPayouts + overview.approvedPayouts)} />
      <Card1 label="Pending rewards" value={money(overview.pendingPayouts)} />
      <Card1 label="Referral ROI" value={roi == null ? "—" : `${(roi * 100).toFixed(0)}%`}
        hint={roi == null ? "No payout cost yet" : undefined} />
      <Card1 label="Cost / sold referral" value={money(overview.costPerSoldReferral)} />
      <Card1 label="Revenue / lead" value={money(overview.revenuePerLead)} />
      <Card1 label="Stored credit liability" value={money(overview.storedCreditOutstanding)}
        hint="Future discount liability — review at close." />
    </div>
  );
}

export { pct, money };
