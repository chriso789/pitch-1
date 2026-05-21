import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useCreateCompanyReferralPartner } from "@/hooks/companyReferrals/useCompanyReferralPartners";

export function CreateCompanyReferralPartnerDialog({ tenantId, onCreated }: { tenantId: string; onCreated?: (p: any) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ partner_name: "", partner_email: "", partner_phone: "", partner_type: "contractor" });
  const create = useCreateCompanyReferralPartner(tenantId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Add partner</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create referral partner</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Partner name *</Label>
            <Input value={form.partner_name} onChange={(e) => setForm({ ...form, partner_name: e.target.value })} />
          </div>
          <div><Label>Partner email</Label>
            <Input type="email" value={form.partner_email} onChange={(e) => setForm({ ...form, partner_email: e.target.value })} />
          </div>
          <div><Label>Partner phone</Label>
            <Input value={form.partner_phone} onChange={(e) => setForm({ ...form, partner_phone: e.target.value })} />
          </div>
          <div><Label>Partner type</Label>
            <Input value={form.partner_type} onChange={(e) => setForm({ ...form, partner_type: e.target.value })} />
          </div>
          <Button
            disabled={create.isPending || !form.partner_name}
            onClick={async () => {
              try {
                const res = await create.mutateAsync(form);
                toast.success("Partner created");
                onCreated?.(res);
                setOpen(false);
              } catch (e: any) { toast.error(e?.message || "Create failed"); }
            }}
          >
            {create.isPending ? "Creating…" : "Create partner"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default CreateCompanyReferralPartnerDialog;
