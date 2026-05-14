import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useReferralPayouts } from "@/hooks/referrals/useReferralDashboard";
import { useReferralActions } from "@/hooks/referrals/useReferralActions";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";

interface Props { canManage: boolean; }

export function ReferralPayoutsTable({ canManage }: Props) {
  const { data: payouts = [], isLoading } = useReferralPayouts();
  const { markPaid, approvePayout } = useReferralActions();

  return (
    <Card>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : payouts.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground text-sm">No payouts pending.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Referrer</TableHead>
                <TableHead>Referred</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Approved</TableHead>
                <TableHead>Paid</TableHead>
                <TableHead>Reference</TableHead>
                {canManage && <TableHead></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {payouts.map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell>{p.referrer ? `${p.referrer.first_name ?? ""} ${p.referrer.last_name ?? ""}`.trim() : "—"}</TableCell>
                  <TableCell>{p.submission ? `${p.submission.referred_first_name ?? ""} ${p.submission.referred_last_name ?? ""}`.trim() : "—"}</TableCell>
                  <TableCell><Badge variant="outline">{p.payout_method ?? "—"}</Badge></TableCell>
                  <TableCell>{formatCurrency(Number(p.payout_amount || 0))}</TableCell>
                  <TableCell><Badge>{p.payout_status}</Badge></TableCell>
                  <TableCell className="text-xs">{p.approved_at ? format(new Date(p.approved_at), "MMM d") : "—"}</TableCell>
                  <TableCell className="text-xs">{p.paid_at ? format(new Date(p.paid_at), "MMM d") : "—"}</TableCell>
                  <TableCell className="text-xs">{p.payment_reference || "—"}</TableCell>
                  {canManage && (
                    <TableCell className="text-right space-x-1">
                      {p.payout_status === "pending" && p.referral_submission_id && (
                        <Button size="sm" variant="outline" onClick={() => approvePayout.mutate({ referral_submission_id: p.referral_submission_id })}>
                          Approve
                        </Button>
                      )}
                      {p.payout_status === "approved" && (
                        <Button
                          size="sm"
                          onClick={() => {
                            const ref = window.prompt("Payment reference (Venmo handle, Zelle confirmation, gift card #, etc.)") || "";
                            markPaid.mutate({ referral_payout_id: p.id, payment_reference: ref });
                          }}
                        >
                          Mark paid
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
