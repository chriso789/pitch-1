import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Home, Wind } from "lucide-react";

const SUPABASE_URL = "https://alxelfrbjzkmtnsulcei.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFseGVsZnJianprbXRuc3VsY2VpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgxNTYyNzcsImV4cCI6MjA3MzczMjI3N30.ouuzXBD8iercLbbxtueioRppHsywgpgxEdDqt6AaMtM";

const SERVICES = [
  { value: "four_point", label: "4-Point Inspection", icon: Home, blurb: "Roof, electrical, plumbing, HVAC — required by most FL insurers on older homes." },
  { value: "wind_mitigation", label: "Wind Mitigation Inspection", icon: Wind, blurb: "Documents wind-resistant features to unlock major insurance discounts." },
  { value: "combo", label: "4-Point + Wind Mitigation (Combo)", icon: ShieldCheck, blurb: "Both inspections in one visit — most popular." },
];

const PRICE_CENTS = 20000;

export default function RequestInspectionPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const tenantId = params.get("c") || params.get("tenant_id") || "";
  const initialType = params.get("type") || "combo";

  const [form, setForm] = useState({
    service_type: SERVICES.some((s) => s.value === initialType) ? initialType : "combo",
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "FL",
    zip: "",
    year_built: "",
    insurance_company: "",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const canceled = params.get("canceled") === "1";

  useEffect(() => {
    if (canceled) toast.info("Payment canceled. You can complete your request below.");
  }, [canceled]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const service = useMemo(() => SERVICES.find((s) => s.value === form.service_type)!, [form.service_type]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) {
      toast.error("Missing company identifier in URL. Contact the office.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/inspection-intake`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: ANON,
          Authorization: `Bearer ${ANON}`,
        },
        body: JSON.stringify({
          tenant_id: tenantId,
          price_cents: PRICE_CENTS,
          source: "hosted_form",
          source_url: window.location.href,
          ...form,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.payment_url) {
        throw new Error(data?.error || "Could not create payment link");
      }
      window.location.href = data.payment_url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Submission failed");
      setSubmitting(false);
    }
  };

  if (!tenantId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-2xl font-bold">Missing company link</h1>
          <p className="text-muted-foreground">
            This page must be opened with a company identifier. Please use the
            link provided by the office.
          </p>
        </div>
      </div>
    );
  }

  const Icon = service.icon;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 py-10 px-4">
      <SEO
        title="Request an Inspection — Pitch CRM"
        description="Book a 4-Point or Wind Mitigation inspection. Fast scheduling, secure payment, and instant confirmation."
        path="/request-inspection"
      />
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Request an Inspection</h1>
          <p className="text-muted-foreground mt-2">
            4-Point &amp; Wind Mitigation inspections — payment required to reserve your slot.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-card rounded-xl border shadow-sm p-6 space-y-6">
          <div className="space-y-2">
            <Label>Inspection Type</Label>
            <Select value={form.service_type} onValueChange={(v) => set("service_type", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SERVICES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-start gap-2 text-sm text-muted-foreground pt-1">
              <Icon className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{service.blurb}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><Label>First Name *</Label><Input required value={form.first_name} onChange={(e) => set("first_name", e.target.value)} /></div>
            <div><Label>Last Name *</Label><Input required value={form.last_name} onChange={(e) => set("last_name", e.target.value)} /></div>
            <div><Label>Email *</Label><Input required type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
            <div><Label>Phone *</Label><Input required type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
          </div>

          <div className="space-y-4">
            <div><Label>Property Address *</Label><Input required value={form.address} onChange={(e) => set("address", e.target.value)} /></div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="col-span-2"><Label>City *</Label><Input required value={form.city} onChange={(e) => set("city", e.target.value)} /></div>
              <div><Label>State *</Label><Input required maxLength={2} value={form.state} onChange={(e) => set("state", e.target.value.toUpperCase())} /></div>
              <div><Label>ZIP *</Label><Input required value={form.zip} onChange={(e) => set("zip", e.target.value)} /></div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><Label>Year Built</Label><Input value={form.year_built} onChange={(e) => set("year_built", e.target.value)} /></div>
            <div><Label>Insurance Company</Label><Input value={form.insurance_company} onChange={(e) => set("insurance_company", e.target.value)} /></div>
          </div>

          <div><Label>Notes (optional)</Label><Textarea rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>

          <div className="rounded-lg border bg-muted/40 p-4 flex items-center justify-between">
            <div>
              <div className="text-sm text-muted-foreground">Total due today</div>
              <div className="text-2xl font-bold">${(PRICE_CENTS / 100).toFixed(2)}</div>
            </div>
            <ShieldCheck className="h-8 w-8 text-primary" />
          </div>

          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? (<><Loader2 className="h-4 w-4 animate-spin" />Redirecting to secure checkout…</>) : ("Continue to Payment")}
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            Secure payment via Stripe. Our office will contact you to schedule after payment is received.
          </p>
        </form>
      </div>
    </div>
  );
}
