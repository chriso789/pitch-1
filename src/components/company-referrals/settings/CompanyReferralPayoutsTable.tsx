import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useCompanyReferralPayouts } from "@/hooks/companyReferrals/useCompanyReferralPartners";
import { exportCompanyReferralPayouts } from "@/lib/companyReferrals/companyReferralExports";
import { approveCrmReferralPayout, markCrmReferralPayoutPaid } from "@/lib/companyReferrals/companyReferralApi";

export function CompanyReferralPayoutsTable({ tenantId }: { tenantId: string }) {
  const { data: payouts = [], isLoading } = useCompanyReferralPayouts(tenantId);
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["companyReferralPayouts", tenantId] });

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading payouts…</div>;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" onClick={() => exportCompanyReferralPayouts(payouts)}>Export CSV</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Signup</TableHead><TableHead>Method</TableHead><TableHead>Amount</TableHead>
            <TableHead>Status</TableHead><TableHead>Approved</TableHead><TableHead>Paid</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payouts.length === 0 && (
            <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No payouts yet.</TableCell></TableRow>
          )}
          {payouts.map((p: any) => (
            <TableRow key={p.id}>
              <TableCell className="text-xs">{p.referral_company_signup_id?.slice(0, 8)}</TableCell>
              <TableCell>{p.payout_method}</TableCell>
              <TableCell>${Number(p.payout_amount || 0).toFixed(2)}</TableCell>
              <TableCell><Badge>{p.payout_status}</Badge></TableCell>
              <TableCell className="text-xs">{p.approved_at ? new Date(p.approved_at).toLocaleDateString() : "—"}</TableCell>
              <TableCell className="text-xs">{p.paid_at ? new Date(p.paid_at).toLocaleDateString() : "—"}</TableCell>
              <TableCell className="flex gap-2">
                {p.payout_status === "pending" && (
                  <Button size="sm" variant="outline" onClick={async () => {
                    try { await approveCrmReferralPayout({ referral_company_signup_id: p.referral_company_signup_id, payout_method: p.payout_method, payout_amount: p.payout_amount }); toast.success("Approved"); refresh(); }
                    catch (e: any) { toast.error(e?.message || "Failed"); }
                  }}>Approve</Button>
                )}
                {p.payout_status === "approved" && (
                  <Button size="sm" onClick={async () => {
                    const ref = prompt("Payment reference?") || undefined;
                    try { await markCrmReferralPayoutPaid({ crm_referral_payout_id: p.id, payment_reference: ref }); toast.success("Marked paid"); refresh(); }
                    catch (e: any) { toast.error(e?.message || "Failed"); }
                  }}>Mark paid</Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
export default CompanyReferralPayoutsTable;
