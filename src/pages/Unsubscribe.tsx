import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle2, AlertCircle, MailX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

type State =
  | { status: "validating" }
  | { status: "valid" }
  | { status: "already" }
  | { status: "invalid"; message: string }
  | { status: "submitting" }
  | { status: "success" }
  | { status: "error"; message: string };

export default function Unsubscribe() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<State>({ status: "validating" });

  useEffect(() => {
    if (!token) {
      setState({ status: "invalid", message: "Missing unsubscribe token." });
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`,
          { headers: { apikey: SUPABASE_ANON_KEY } }
        );
        const data = await res.json();
        if (!res.ok) {
          setState({ status: "invalid", message: data.error || "Invalid or expired link." });
          return;
        }
        if (data.valid === false && data.reason === "already_unsubscribed") {
          setState({ status: "already" });
          return;
        }
        if (data.valid) {
          setState({ status: "valid" });
          return;
        }
        setState({ status: "invalid", message: "Invalid token." });
      } catch (e: any) {
        setState({ status: "invalid", message: e.message || "Failed to validate link." });
      }
    })();
  }, [token]);

  const handleConfirm = async () => {
    if (!token) return;
    setState({ status: "submitting" });
    try {
      const { data, error } = await supabase.functions.invoke("handle-email-unsubscribe", {
        body: { token },
      });
      if (error) throw error;
      if (data?.success) {
        setState({ status: "success" });
      } else if (data?.reason === "already_unsubscribed") {
        setState({ status: "already" });
      } else {
        setState({ status: "error", message: "Could not process request." });
      }
    } catch (e: any) {
      setState({ status: "error", message: e.message || "Failed to unsubscribe." });
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <MailX className="h-6 w-6 text-muted-foreground" />
          </div>
          <CardTitle>Email Preferences</CardTitle>
          <CardDescription>Manage your email subscription</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          {state.status === "validating" && (
            <div className="flex flex-col items-center gap-2 py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Verifying your link…</p>
            </div>
          )}

          {state.status === "valid" && (
            <>
              <p className="text-sm text-muted-foreground">
                Click below to unsubscribe from PITCH CRM emails. You will no longer receive
                notifications at this address.
              </p>
              <Button onClick={handleConfirm} className="w-full">
                Confirm Unsubscribe
              </Button>
            </>
          )}

          {state.status === "submitting" && (
            <div className="flex flex-col items-center gap-2 py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Processing…</p>
            </div>
          )}

          {state.status === "success" && (
            <div className="flex flex-col items-center gap-2 py-4">
              <CheckCircle2 className="h-10 w-10 text-primary" />
              <p className="font-medium">You've been unsubscribed</p>
              <p className="text-sm text-muted-foreground">
                You will no longer receive emails from us.
              </p>
            </div>
          )}

          {state.status === "already" && (
            <div className="flex flex-col items-center gap-2 py-4">
              <CheckCircle2 className="h-10 w-10 text-muted-foreground" />
              <p className="font-medium">Already unsubscribed</p>
              <p className="text-sm text-muted-foreground">
                This email address is no longer subscribed.
              </p>
            </div>
          )}

          {(state.status === "invalid" || state.status === "error") && (
            <div className="flex flex-col items-center gap-2 py-4">
              <AlertCircle className="h-10 w-10 text-destructive" />
              <p className="font-medium">Something went wrong</p>
              <p className="text-sm text-muted-foreground">{state.message}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
