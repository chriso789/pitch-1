import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useReferralPayoutPreference } from "@/hooks/referrals/useReferralPayoutPreference";

const METHOD_LABELS: Record<string, string> = {
  zelle: "Zelle",
  venmo: "Venmo",
  cashapp: "Cash App",
  paypal: "PayPal",
  check: "Mailed check",
  ach: "Direct deposit (ACH)",
  account_credit: "Apply as account credit",
  donation: "Donate to charity",
};

export default function PublicReferralReward() {
  const { referralCode } = useParams<{ referralCode: string }>();
  const { toast } = useToast();
  const { profile, loading, saving, save } = useReferralPayoutPreference(referralCode);
  const [method, setMethod] = useState<string>("");
  const [handle, setHandle] = useState("");
  const [mailing, setMailing] = useState("");
  const [notes, setNotes] = useState("");
  const [done, setDone] = useState(false);

  const enabled: string[] = profile?.enabled_payout_methods || profile?.enabled_methods || [
    "zelle",
    "venmo",
    "cashapp",
    "paypal",
    "check",
    "account_credit",
  ];

  useEffect(() => {
    if (!method && enabled.length) setMethod(enabled[0]);
  }, [enabled, method]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      await save({
        preferred_payout_method: method,
        payout_handle: handle || null,
        mailing_address: mailing || null,
        notes: notes || null,
      });
      setDone(true);
      toast({ title: "Saved", description: "Your reward preference is on file." });
    } catch (e: any) {
      toast({ title: "Could not save", description: e?.message ?? "Try again later", variant: "destructive" });
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Referral not found</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground">
            This reward link isn't active. Please check the URL.
          </CardContent>
        </Card>
      </div>
    );
  }

  const needsHandle = ["zelle", "venmo", "cashapp", "paypal", "ach"].includes(method);
  const needsMailing = method === "check";

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Choose your reward, {profile.first_name || "friend"}</h1>
          <p className="text-muted-foreground mt-2">
            Tell us how you'd like to receive your referral reward when your friend's project closes.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Reward preference</CardTitle>
          </CardHeader>
          <CardContent>
            {done ? (
              <div className="text-center py-8 space-y-4">
                <CheckCircle2 className="h-12 w-12 mx-auto text-primary" />
                <h2 className="text-xl font-semibold">All set!</h2>
                <p className="text-muted-foreground">
                  We'll send your reward via <strong>{METHOD_LABELS[method] || method}</strong> once the referred project closes.
                </p>
              </div>
            ) : (
              <form onSubmit={onSave} className="space-y-4">
                <div>
                  <Label>Payout method</Label>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {enabled.map((m) => (
                      <button
                        type="button"
                        key={m}
                        onClick={() => setMethod(m)}
                        className={`border rounded-md px-3 py-2 text-sm text-left transition ${
                          method === m ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                        }`}
                      >
                        {METHOD_LABELS[m] || m}
                      </button>
                    ))}
                  </div>
                </div>

                {needsHandle && (
                  <div>
                    <Label htmlFor="handle">
                      {method === "ach" ? "Account details" : `${METHOD_LABELS[method]} handle / email / phone`}
                    </Label>
                    <Input id="handle" required value={handle} onChange={(e) => setHandle(e.target.value)} />
                  </div>
                )}

                {needsMailing && (
                  <div>
                    <Label htmlFor="mailing">Mailing address</Label>
                    <Textarea id="mailing" required rows={3} value={mailing} onChange={(e) => setMailing(e.target.value)} />
                  </div>
                )}

                <div>
                  <Label htmlFor="notes">Notes (optional)</Label>
                  <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>

                <Button type="submit" className="w-full" disabled={saving || !method}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Save my preference
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground text-center mt-4">
          <Link to={`/ref/${referralCode}`} className="underline">
            Back to referral page
          </Link>
        </p>
      </div>
    </div>
  );
}
