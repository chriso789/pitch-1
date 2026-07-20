import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

type LegalDoc = {
  id: string;
  document_key: "privacy_policy" | "terms_of_service" | "qbo_integration_consent";
  version: string;
  body_markdown: string;
  body_sha256: string;
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string;
  userId: string;
  defaultMode: "development" | "production";
  hasDevelopmentCredentials: boolean;
  hasProductionCredentials: boolean;
}

const DOC_LABELS: Record<LegalDoc["document_key"], string> = {
  privacy_policy: "Privacy Policy",
  terms_of_service: "Terms of Service",
  qbo_integration_consent: "QuickBooks Integration Consent",
};

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function QuickBooksConnectDialog({
  open,
  onOpenChange,
  tenantId,
  userId,
  defaultMode,
  hasDevelopmentCredentials,
  hasProductionCredentials,
}: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [docs, setDocs] = useState<LegalDoc[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [mode, setMode] = useState<"development" | "production">(defaultMode);

  useEffect(() => {
    if (!open) return;
    setMode(defaultMode);
    setChecked({});
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("legal_documents" as never)
        .select("id, document_key, version, body_markdown, body_sha256")
        .in("document_key", ["privacy_policy", "terms_of_service", "qbo_integration_consent"])
        .eq("is_current", true);
      setDocs((data ?? []) as unknown as LegalDoc[]);
      setLoading(false);
    })();
  }, [open, defaultMode]);

  const allChecked = useMemo(
    () => docs.length > 0 && docs.every((d) => checked[d.document_key]),
    [docs, checked],
  );

  const handleSubmit = async () => {
    if (!allChecked) return;
    setSubmitting(true);
    try {
      const ua = navigator.userAgent ?? null;

      // 1. Persist legal_acceptances (idempotent per (user, key, version)).
      const acceptanceRows = docs.map((d) => ({
        tenant_id: tenantId,
        user_id: userId,
        document_key: d.document_key,
        document_version: d.version,
        document_id: d.id,
        body_sha256: d.body_sha256,
        user_agent: ua,
      }));
      const { error: accErr } = await supabase
        .from("legal_acceptances" as never)
        .upsert(acceptanceRows as never, { onConflict: "user_id,document_key,document_version" });
      if (accErr) throw accErr;

      // 2. Snapshot integration_consents (one per attempt).
      const qboDoc = docs.find((d) => d.document_key === "qbo_integration_consent");
      if (!qboDoc) throw new Error("QBO consent document missing");
      const snapshotSha = await sha256Hex(qboDoc.body_markdown);

      const { data: consentInsert, error: consentErr } = await supabase
        .from("integration_consents" as never)
        .insert({
          tenant_id: tenantId,
          user_id: userId,
          integration: "quickbooks",
          consent_version: qboDoc.version,
          consent_text_snapshot: qboDoc.body_markdown,
          consent_text_sha256: snapshotSha,
          expected_oauth_app_env: mode,
          user_agent: ua,
        } as never)
        .select("id")
        .single();
      if (consentErr) throw consentErr;
      const consentId = (consentInsert as { id: string }).id;

      // 3. Initiate OAuth (server validates legal + consent for production).
      const { data: initiate, error: initErr } = await supabase.functions.invoke("qbo-oauth-connect", {
        body: { action: "initiate", mode, consent_id: consentId },
      });
      if (initErr) throw initErr;
      const authUrl = (initiate as { authUrl?: string })?.authUrl;
      if (!authUrl) throw new Error("Authorize URL missing from response");

      // 4. Same-tab redirect — server-side 302 callback brings the user back.
      window.location.href = authUrl;
    } catch (e: unknown) {
      // Supabase PostgREST + FunctionsHttpError both carry structured fields
      // that stringify to "[object Object]". Extract the real reason so the
      // toast (and the console) surface the actual failure.
      const err = e as { message?: string; error?: string; details?: string; hint?: string; code?: string; context?: { text?: () => Promise<string> } };
      let description = err?.message || err?.error || err?.details || err?.hint || err?.code || "";
      if (!description && err?.context?.text) {
        try { description = await err.context.text(); } catch { /* noop */ }
      }
      if (!description) {
        try { description = JSON.stringify(e); } catch { description = String(e); }
      }
      console.error("[qbo-connect-dialog] initiate failed", { error: e, description });
      toast({ title: "Could not start QuickBooks connection", description, variant: "destructive" });
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Connect QuickBooks Online</DialogTitle>
          <DialogDescription>
            Review and accept the documents below to authorize Pitch CRM to sync accounting data with QuickBooks.
            You can disconnect at any time.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">


            <div className="space-y-3">
              {docs.map((d) => (
                <div key={d.document_key} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">
                      {DOC_LABELS[d.document_key]}{" "}
                      <span className="text-xs text-muted-foreground">v{d.version}</span>
                    </div>
                  </div>
                  <ScrollArea className="h-24 rounded border bg-muted/30 p-2 text-xs leading-relaxed">
                    {d.body_markdown}
                  </ScrollArea>
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id={`accept-${d.document_key}`}
                      checked={!!checked[d.document_key]}
                      onCheckedChange={(v) =>
                        setChecked((prev) => ({ ...prev, [d.document_key]: !!v }))
                      }
                    />
                    <Label htmlFor={`accept-${d.document_key}`} className="text-xs leading-snug">
                      I have read and accept the {DOC_LABELS[d.document_key]} (v{d.version}).
                    </Label>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!allChecked || submitting || loading}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Continue to QuickBooks
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
