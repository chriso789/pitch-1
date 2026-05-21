import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export function CompanyReferralDetailDrawer({
  open, onOpenChange, signup,
}: { open: boolean; onOpenChange: (v: boolean) => void; signup: any | null }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[480px] sm:w-[540px]">
        <SheetHeader><SheetTitle>{signup?.referred_company_name ?? "Signup"}</SheetTitle></SheetHeader>
        {signup && (
          <div className="mt-4 space-y-2 text-sm">
            <Row k="Status" v={signup.signup_status} />
            <Row k="Owner" v={signup.referred_owner_name} />
            <Row k="Email" v={signup.referred_owner_email} />
            <Row k="Phone" v={signup.referred_owner_phone} />
            <Row k="Trade" v={signup.referred_company_trade} />
            <Row k="Plan" v={signup.selected_plan} />
            <Row k="Subscription ID" v={signup.subscription_id} />
            <Row k="Qualifying revenue" v={`$${Number(signup.qualifying_revenue || 0).toFixed(2)}`} />
            <Row k="Payout eligible" v={signup.payout_eligible ? "Yes" : "No"} />
            <Row k="Eligibility reason" v={signup.payout_eligibility_reason} />
            <Row k="Active paid at" v={signup.active_paid_at} />
            <Row k="Created" v={signup.created_at} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
function Row({ k, v }: { k: string; v: any }) {
  return (
    <div className="flex justify-between gap-3 border-b py-1">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right">{v ?? "—"}</span>
    </div>
  );
}
export default CompanyReferralDetailDrawer;
