import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useCompanyReferralSignups } from "@/hooks/companyReferrals/useCompanyReferralPartners";
import { exportCompanyReferralSignups } from "@/lib/companyReferrals/companyReferralExports";
import { syncCrmReferralSubscriptionStatus } from "@/lib/companyReferrals/companyReferralApi";

export function CompanyReferralSignupsTable({ tenantId }: { tenantId: string }) {
  const { data: signups = [], isLoading } = useCompanyReferralSignups(tenantId);
  const qc = useQueryClient();
  const [active, setActive] = useState<any | null>(null);
  const [form, setForm] = useState({ selected_plan: "", qualifying_revenue: 0, notes: "" });

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading signups…</div>;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" onClick={() => exportCompanyReferralSignups(signups)}>Export CSV</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Company</TableHead><TableHead>Owner</TableHead><TableHead>Trade</TableHead>
            <TableHead>Status</TableHead><TableHead>Plan</TableHead>
            <TableHead>Qualifying $</TableHead><TableHead>Eligible</TableHead><TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {signups.length === 0 && (
            <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No signups yet.</TableCell></TableRow>
          )}
          {signups.map((s: any) => (
            <TableRow key={s.id}>
              <TableCell>{s.referred_company_name}<div className="text-xs text-muted-foreground">{s.referred_company_city}, {s.referred_company_state}</div></TableCell>
              <TableCell>{s.referred_owner_name}<div className="text-xs text-muted-foreground">{s.referred_owner_email}</div></TableCell>
              <TableCell>{s.referred_company_trade}</TableCell>
              <TableCell><Badge>{s.signup_status}</Badge></TableCell>
              <TableCell>{s.selected_plan}</TableCell>
              <TableCell>${Number(s.qualifying_revenue || 0).toFixed(0)}</TableCell>
              <TableCell>{s.payout_eligible ? "✓" : "—"}</TableCell>
              <TableCell>
                <Button size="sm" variant="outline" onClick={() => {
                  setActive(s);
                  setForm({ selected_plan: s.selected_plan ?? "", qualifying_revenue: Number(s.qualifying_revenue || 0), notes: "" });
                }}>
                  Mark Active Paid
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Mark Active Paid — {active?.referred_company_name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Selected plan</Label>
              <Input value={form.selected_plan} onChange={(e) => setForm({ ...form, selected_plan: e.target.value })} /></div>
            <div><Label>Qualifying revenue</Label>
              <Input type="number" value={form.qualifying_revenue}
                onChange={(e) => setForm({ ...form, qualifying_revenue: Number(e.target.value) })} /></div>
            <div><Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <Button
              onClick={async () => {
                if (!active) return;
                try {
                  await syncCrmReferralSubscriptionStatus({
                    referred_company_id: active.referred_company_id ?? undefined,
                    subscription_id: active.subscription_id ?? undefined,
                    status: "active",
                    paid_amount: form.qualifying_revenue,
                  });
                  toast.success("Marked active paid");
                  qc.invalidateQueries({ queryKey: ["companyReferralSignups", tenantId] });
                  qc.invalidateQueries({ queryKey: ["companyReferralPayouts", tenantId] });
                  setActive(null);
                } catch (e: any) {
                  toast.error(e?.message || "Failed");
                }
              }}
            >Confirm</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
export default CompanyReferralSignupsTable;
