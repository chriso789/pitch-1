import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { searchContacts } from "@/lib/referrals/adminApi";
import { useReferralActions } from "@/hooks/referrals/useReferralActions";
import { Copy } from "lucide-react";
import { toast } from "sonner";

interface Props { open: boolean; onOpenChange: (v: boolean) => void; }

export function CreateReferralLinkDialog({ open, onOpenChange }: Props) {
  const tenantId = useEffectiveTenantId();
  const { createLink } = useReferralActions();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [contact, setContact] = useState<any | null>(null);
  const [note, setNote] = useState("");
  const [created, setCreated] = useState<any | null>(null);

  const doSearch = async (q: string) => {
    setSearch(q);
    if (!tenantId) return;
    const r = await searchContacts(tenantId, q);
    setResults(r);
  };

  const onCreate = async () => {
    if (!contact) { toast.error("Select a customer"); return; }
    const res = await createLink.mutateAsync({ referrer_contact_id: contact.id, custom_note: note || undefined });
    setCreated(res);
  };

  const reset = () => {
    setSearch(""); setResults([]); setContact(null); setNote(""); setCreated(null);
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Create referral link</DialogTitle></DialogHeader>

        {!created ? (
          <div className="space-y-4">
            <div>
              <Label>Customer</Label>
              {contact ? (
                <div className="flex items-center justify-between border rounded p-2 mt-1">
                  <div>
                    <div className="font-medium">{contact.first_name} {contact.last_name}</div>
                    <div className="text-xs text-muted-foreground">{contact.phone || contact.email}</div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setContact(null)}>Change</Button>
                </div>
              ) : (
                <>
                  <Input
                    className="mt-1"
                    placeholder="Search by name, phone, email…"
                    value={search}
                    onChange={(e) => doSearch(e.target.value)}
                  />
                  {results.length > 0 && (
                    <div className="border rounded mt-1 max-h-56 overflow-auto">
                      {results.map((r) => (
                        <button
                          key={r.id}
                          className="w-full text-left px-3 py-2 hover:bg-accent text-sm"
                          onClick={() => { setContact(r); setResults([]); setSearch(""); }}
                        >
                          <div className="font-medium">{r.first_name} {r.last_name}</div>
                          <div className="text-xs text-muted-foreground">{r.phone || r.email}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            <div>
              <Label>Internal note (optional)</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">Link created. Copy and share with the customer.</div>
            <div>
              <Label className="text-xs">Referral code</Label>
              <div className="font-mono text-sm">{created.referral_code}</div>
            </div>
            <div>
              <Label className="text-xs">Referral link</Label>
              <div className="flex gap-2">
                <Input readOnly value={created.referral_url} />
                <Button size="icon" variant="outline" onClick={() => copy(created.referral_url, "Referral link")}><Copy className="h-4 w-4" /></Button>
              </div>
            </div>
            <div>
              <Label className="text-xs">Reward choice link</Label>
              <div className="flex gap-2">
                <Input readOnly value={created.reward_url} />
                <Button size="icon" variant="outline" onClick={() => copy(created.reward_url, "Reward link")}><Copy className="h-4 w-4" /></Button>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {!created ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={onCreate} disabled={createLink.isPending}>
                {createLink.isPending ? "Creating…" : "Create link"}
              </Button>
            </>
          ) : (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
