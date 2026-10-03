import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const db = supabase as any;
const PLATFORMS = ["google", "facebook", "yelp", "bbb", "angi", "houzz", "nextdoor", "other"];
const BLOCKED = /(5[- ]?star|five[- ]?star|positive review|good review|reward|gift card|discount|prize|unlock|in exchange|free )/i;

export default function ReputationSettingsPage() {
  const tenantId = useEffectiveTenantId();
  const qc = useQueryClient();
  const [form, setForm] = useState({ enabled: true, show_on_invoice: true, feedback_enabled: true,
    headline: "Share your experience", message: "Your feedback helps other homeowners. We'd appreciate an honest review." });
  const [newDest, setNewDest] = useState({ platform: "google", label: "Review us on Google", url: "" });

  const { data } = useQuery({
    queryKey: ["reputation", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const [s, d, c, f] = await Promise.all([
        db.from("company_reputation_settings").select("*").eq("tenant_id", tenantId).maybeSingle(),
        db.from("review_destinations").select("*").eq("tenant_id", tenantId).order("sort_order"),
        db.from("review_link_clicks").select("id, platform, clicked_at, destination_id").eq("tenant_id", tenantId).order("clicked_at", { ascending: false }).limit(50),
        db.from("closeout_feedback").select("id, rating, comment, created_at").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(50),
      ]);
      return { settings: s.data, destinations: d.data ?? [], clicks: c.data ?? [], feedback: f.data ?? [] };
    },
  });

  useEffect(() => { if (data?.settings) setForm((p) => ({ ...p, ...data.settings })); }, [data?.settings]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["reputation", tenantId] });

  if (!tenantId) return <div className="p-6 text-muted-foreground">Select a company.</div>;

  const save = async () => {
    if (BLOCKED.test(form.headline) || BLOCKED.test(form.message))
      return toast.error("Review wording can't ask for a specific rating or offer anything in exchange.");
    const { error } = await db.from("company_reputation_settings").upsert({ tenant_id: tenantId, enabled: form.enabled,
      show_on_invoice: form.show_on_invoice, feedback_enabled: form.feedback_enabled, headline: form.headline, message: form.message });
    if (error) return toast.error(error.message);
    toast.success("Saved"); refresh();
  };

  const addDest = async () => {
    if (!/^https:\/\//i.test(newDest.url)) return toast.error("Link must start with https://");
    if (BLOCKED.test(newDest.label)) return toast.error("Button text can't mention ratings or incentives.");
    const { error } = await db.from("review_destinations").insert({ ...newDest, tenant_id: tenantId, sort_order: data?.destinations.length ?? 0 });
    if (error) return toast.error(error.message);
    setNewDest({ platform: "google", label: "Review us on Google", url: "" }); refresh();
  };

  const destName = (id: string) => data?.destinations.find((d: any) => d.id === id)?.label ?? "Removed link";

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Reputation & Reviews</h1>
        <p className="text-sm text-muted-foreground">Review links shown on the customer invoice page, and who clicked them.</p>
      </header>

      <Card>
        <CardHeader><CardTitle>Invoice page</CardTitle>
          <CardDescription>Use neutral wording — reviews can't be tied to ratings or incentives.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {([["enabled", "Enabled"], ["show_on_invoice", "Show review links on invoice page"], ["feedback_enabled", "Collect private feedback"]] as const).map(([k, l]) => (
            <div key={k} className="flex items-center justify-between"><Label>{l}</Label>
              <Switch checked={form[k]} onCheckedChange={(v) => setForm({ ...form, [k]: v })} /></div>
          ))}
          <div><Label>Headline</Label><Input value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} /></div>
          <div><Label>Message</Label><Textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></div>
          <Button onClick={save}>Save</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Review links</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {data?.destinations.map((d: any) => (
            <div key={d.id} className="flex items-center gap-3 border border-border p-3">
              <span className="w-20 text-xs uppercase text-muted-foreground">{d.platform}</span>
              <span className="flex-1 truncate">{d.label} <span className="text-xs text-muted-foreground">{d.url}</span></span>
              <Switch checked={d.active} onCheckedChange={async (v) => { await db.from("review_destinations").update({ active: v }).eq("id", d.id); refresh(); }} />
              <Button size="icon" variant="ghost" aria-label="Delete" onClick={async () => { await db.from("review_destinations").delete().eq("id", d.id); refresh(); }}>
                <Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <div className="grid gap-2 md:grid-cols-[140px_1fr_2fr_auto]">
            <Select value={newDest.platform} onValueChange={(v) => setNewDest({ ...newDest, platform: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PLATFORMS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
            <Input placeholder="Button text" value={newDest.label} onChange={(e) => setNewDest({ ...newDest, label: e.target.value })} />
            <Input placeholder="https://g.page/r/..." value={newDest.url} onChange={(e) => setNewDest({ ...newDest, url: e.target.value })} />
            <Button onClick={addDest}><Plus className="mr-1 h-4 w-4" /> Add</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Review link clicks ({data?.clicks.length ?? 0})</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data?.clicks.length ? data.clicks.map((c: any) => (
              <div key={c.id} className="flex justify-between"><span>{destName(c.destination_id)}</span>
                <span className="text-muted-foreground">{new Date(c.clicked_at).toLocaleString()}</span></div>
            )) : <p className="text-muted-foreground">No clicks yet.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Private feedback</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {data?.feedback.length ? data.feedback.map((f: any) => (
              <div key={f.id} className="border-b border-border pb-2"><div className="flex justify-between">
                <span className="font-medium">{f.rating}/5</span><span className="text-muted-foreground">{new Date(f.created_at).toLocaleDateString()}</span></div>
                {f.comment && <p className="text-muted-foreground">{f.comment}</p>}</div>
            )) : <p className="text-muted-foreground">No feedback yet.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
