import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useReferralCreditBalances } from "@/hooks/referrals/useReferralDashboard";
import { useReferralActions } from "@/hooks/referrals/useReferralActions";
import { getReferralCreditLedger } from "@/lib/referrals/adminApi";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { toast } from "sonner";

interface Props { canManage: boolean; }

export function ReferralCreditsTable({ canManage }: Props) {
  const tenantId = useEffectiveTenantId();
  const { data: balances = [], isLoading } = useReferralCreditBalances();
  const { applyCredit } = useReferralActions();
  const [ledger, setLedger] = useState<any | null>(null);
  const [apply, setApply] = useState<any | null>(null);
  const [jobId, setJobId] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  const openLedger = async (row: any) => {
    if (!tenantId) return;
    const entries = await getReferralCreditLedger(tenantId, row.referrer_contact_id);
    setLedger({ row, entries });
  };

  const submitApply = async () => {
    if (!apply) return;
    const amt = Number(amount);
    if (!jobId || !amt) { toast.error("Job and amount required"); return; }
    if (amt > apply.current_balance) { toast.error("Exceeds available balance"); return; }
    await applyCredit.mutateAsync({
      referrer_contact_id: apply.referrer_contact_id,
      job_id: jobId,
      amount: amt,
      notes,
    });
    setApply(null); setJobId(""); setAmount(""); setNotes("");
  };

  return (
    <>
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : balances.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground text-sm">No stored referral credits yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Referrer</TableHead>
                  <TableHead>Balance</TableHead>
                  <TableHead>Earned</TableHead>
                  <TableHead>Used</TableHead>
                  <TableHead>Last activity</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {balances.map((b: any) => (
                  <TableRow key={b.referrer_contact_id}>
                    <TableCell>{b.contact ? `${b.contact.first_name ?? ""} ${b.contact.last_name ?? ""}`.trim() : b.referrer_contact_id.slice(0, 8)}</TableCell>
                    <TableCell className="font-medium">{formatCurrency(Number(b.current_balance || 0))}</TableCell>
                    <TableCell>{formatCurrency(b.total_earned)}</TableCell>
                    <TableCell>{formatCurrency(b.total_used)}</TableCell>
                    <TableCell className="text-xs">{format(new Date(b.last_activity), "MMM d, yyyy")}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" variant="outline" onClick={() => openLedger(b)}>Ledger</Button>
                      {canManage && (
                        <Button size="sm" onClick={() => setApply(b)}>Apply</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!ledger} onOpenChange={(v) => !v && setLedger(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Credit ledger</DialogTitle></DialogHeader>
          {ledger && (
            <div className="max-h-96 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Balance</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledger.entries.map((e: any) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs">{format(new Date(e.created_at), "MMM d, yyyy")}</TableCell>
                      <TableCell className="text-xs">{e.transaction_type}</TableCell>
                      <TableCell>{formatCurrency(Number(e.amount || 0))}</TableCell>
                      <TableCell>{formatCurrency(Number(e.balance_after || 0))}</TableCell>
                      <TableCell className="text-xs">{e.notes || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!apply} onOpenChange={(v) => !v && setApply(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Apply credit to job</DialogTitle></DialogHeader>
          {apply && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                Available balance: <span className="font-medium text-foreground">{formatCurrency(Number(apply.current_balance || 0))}</span>
              </div>
              <div><Label>Job ID</Label><Input value={jobId} onChange={(e) => setJobId(e.target.value)} placeholder="UUID" /></div>
              <div><Label>Amount</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
              <div><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setApply(null)}>Cancel</Button>
            <Button onClick={submitApply}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
