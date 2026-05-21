import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCompanyReferralAnalytics } from "@/hooks/companyReferrals/useCompanyReferralAnalytics";
import { exportCompanyReferralAnalytics } from "@/lib/companyReferrals/companyReferralExports";

export function CompanyReferralAnalytics({ tenantId }: { tenantId: string }) {
  const { data, isLoading } = useCompanyReferralAnalytics(tenantId);
  if (isLoading || !data) return <div className="p-6 text-muted-foreground">Loading analytics…</div>;

  const tiles = [
    { label: "Partners", value: data.partner_count },
    { label: "Signups", value: data.signup_count },
    { label: "Active paid", value: data.active_paid_count },
    { label: "Pending payouts $", value: `$${data.pending_payouts_total.toFixed(2)}` },
    { label: "Paid payouts $", value: `$${data.paid_payouts_total.toFixed(2)}` },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">{t.label}</CardTitle></CardHeader>
            <CardContent className="text-2xl font-semibold">{t.value}</CardContent>
          </Card>
        ))}
      </div>
      <div className="flex justify-end">
        <Button variant="outline" onClick={() => exportCompanyReferralAnalytics(data as any)}>Export CSV</Button>
      </div>
    </div>
  );
}
export default CompanyReferralAnalytics;
