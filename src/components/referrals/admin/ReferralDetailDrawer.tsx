import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

interface Props { linkId: string | null; onClose: () => void; }

export function ReferralDetailDrawer({ linkId, onClose }: Props) {
  const tenantId = useEffectiveTenantId();
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    if (!linkId || !tenantId) { setData(null); return; }
    (async () => {
      const [linkRes, eventsRes, subsRes, payoutsRes, flagsRes, sendsRes, historyRes] = await Promise.all([
        supabase.from("referral_codes").select("*, contacts:customer_id(first_name,last_name,phone,email)").eq("id", linkId).maybeSingle(),
        supabase.from("referral_events").select("*").eq("tenant_id", tenantId).eq("referral_link_id", linkId).order("created_at", { ascending: false }).limit(50),
        supabase.from("referral_submissions").select("*").eq("tenant_id", tenantId).eq("referral_link_id", linkId).order("created_at", { ascending: false }),
        supabase.from("referral_payouts").select("*").eq("tenant_id", tenantId).eq("referral_link_id", linkId).order("created_at", { ascending: false }),
        supabase.from("referral_flags").select("*").eq("tenant_id", tenantId).eq("referral_link_id", linkId),
        supabase.from("referral_send_logs").select("*").eq("tenant_id", tenantId).eq("referral_link_id", linkId).order("created_at", { ascending: false }),
        supabase.from("referral_status_history").select("*, referral_submissions!inner(referral_link_id)").eq("tenant_id", tenantId).eq("referral_submissions.referral_link_id", linkId).order("created_at", { ascending: false }),
      ]);
      setData({
        link: linkRes.data,
        events: eventsRes.data ?? [],
        submissions: subsRes.data ?? [],
        payouts: payoutsRes.data ?? [],
        flags: flagsRes.data ?? [],
        sends: sendsRes.data ?? [],
        history: historyRes.data ?? [],
      });
    })();
  }, [linkId, tenantId]);

  return (
    <Sheet open={!!linkId} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader><SheetTitle>Referral details</SheetTitle></SheetHeader>
        {!data ? (
          <div className="text-sm text-muted-foreground p-6">Loading…</div>
        ) : (
          <div className="space-y-6 mt-4 text-sm">
            <section>
              <h3 className="font-semibold mb-2">Referrer</h3>
              <div>{data.link?.contacts ? `${data.link.contacts.first_name ?? ""} ${data.link.contacts.last_name ?? ""}` : "—"}</div>
              <div className="text-xs text-muted-foreground">{data.link?.contacts?.phone} {data.link?.contacts?.email}</div>
              <div className="text-xs mt-1">Code: <span className="font-mono">{data.link?.code}</span></div>
            </section>

            <section>
              <h3 className="font-semibold mb-2">Activity ({data.events.length})</h3>
              <div className="space-y-1 max-h-48 overflow-auto">
                {data.events.map((e: any) => (
                  <div key={e.id} className="flex justify-between text-xs">
                    <span>{e.event_type}</span>
                    <span className="text-muted-foreground">{format(new Date(e.created_at), "MMM d HH:mm")}</span>
                  </div>
                ))}
                {data.events.length === 0 && <div className="text-xs text-muted-foreground">No events yet.</div>}
              </div>
            </section>

            <section>
              <h3 className="font-semibold mb-2">Referred leads ({data.submissions.length})</h3>
              {data.submissions.map((s: any) => (
                <div key={s.id} className="border rounded p-2 mb-1 text-xs">
                  <div className="font-medium">{s.referred_first_name} {s.referred_last_name}</div>
                  <div className="text-muted-foreground">{s.service_needed} · <Badge variant="outline">{s.status}</Badge></div>
                </div>
              ))}
              {data.submissions.length === 0 && <div className="text-xs text-muted-foreground">None yet.</div>}
            </section>

            <section>
              <h3 className="font-semibold mb-2">Payouts ({data.payouts.length})</h3>
              {data.payouts.map((p: any) => (
                <div key={p.id} className="flex justify-between text-xs border-b py-1">
                  <span>{p.payout_method} · ${p.payout_amount}</span>
                  <Badge>{p.payout_status}</Badge>
                </div>
              ))}
              {data.payouts.length === 0 && <div className="text-xs text-muted-foreground">No payouts.</div>}
            </section>

            <section>
              <h3 className="font-semibold mb-2">Flags ({data.flags.length})</h3>
              {data.flags.map((f: any) => (
                <div key={f.id} className="text-xs"><Badge variant="destructive">{f.severity}</Badge> {f.flag_type} — {f.description}</div>
              ))}
              {data.flags.length === 0 && <div className="text-xs text-muted-foreground">No flags.</div>}
            </section>

            <section>
              <h3 className="font-semibold mb-2">Send log ({data.sends.length})</h3>
              {data.sends.map((s: any) => (
                <div key={s.id} className="text-xs">{s.channel} → {s.recipient} · {format(new Date(s.created_at), "MMM d HH:mm")}</div>
              ))}
              {data.sends.length === 0 && <div className="text-xs text-muted-foreground">No sends logged.</div>}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
