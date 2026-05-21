import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { useCompanyReferralCredits } from "@/hooks/companyReferrals/useCompanyReferralPartners";
import { exportCompanyReferralCredits } from "@/lib/companyReferrals/companyReferralExports";

export function CompanyReferralCreditsTable({ tenantId }: { tenantId: string }) {
  const { data: credits = [], isLoading } = useCompanyReferralCredits(tenantId);
  if (isLoading) return <div className="p-6 text-muted-foreground">Loading credits…</div>;
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" onClick={() => exportCompanyReferralCredits(credits)}>Export CSV</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Partner</TableHead><TableHead>Type</TableHead><TableHead>Amount</TableHead>
            <TableHead>Balance after</TableHead><TableHead>Notes</TableHead><TableHead>Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {credits.length === 0 && (
            <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No account credit activity yet.</TableCell></TableRow>
          )}
          {credits.map((c: any) => (
            <TableRow key={c.id}>
              <TableCell className="text-xs">{c.partner_id?.slice(0, 8)}</TableCell>
              <TableCell>{c.transaction_type}</TableCell>
              <TableCell>${Number(c.amount || 0).toFixed(2)}</TableCell>
              <TableCell>${Number(c.balance_after || 0).toFixed(2)}</TableCell>
              <TableCell className="text-xs">{c.notes}</TableCell>
              <TableCell className="text-xs">{new Date(c.created_at).toLocaleDateString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
export default CompanyReferralCreditsTable;
