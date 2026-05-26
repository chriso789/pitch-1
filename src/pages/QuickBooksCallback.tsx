import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export default function QuickBooksCallback() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [error, setError] = useState<{ code: string; description: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const realmId = params.get('realmId');
    const state = params.get('state');
    const oauthError = params.get('error');
    const oauthErrorDesc = params.get('error_description');

    // Success path
    if (code && realmId) {
      // Popup flow — post message back to opener if present.
      if (window.opener && !window.opener.closed) {
        try {
          window.opener.postMessage(
            { type: 'qbo-oauth-success', code, realmId, state },
            '*'
          );
        } catch {}
        window.close();
        return;
      }

      // Full-redirect flow — complete exchange here, then return to settings.
      (async () => {
        try {
          const storedState = (() => {
            try { return sessionStorage.getItem('qbo_oauth_state'); } catch { return null; }
          })();

          const { error: cbError } = await supabase.functions.invoke('qbo-oauth-connect', {
            body: {
              action: 'callback',
              code,
              realmId,
              state: state ?? storedState,
            },
          });

          try { sessionStorage.removeItem('qbo_oauth_state'); } catch {}

          if (cbError) throw cbError;

          toast({
            title: 'Connected to QuickBooks',
            description: 'Your QuickBooks account has been connected successfully.',
          });
          navigate('/settings');
        } catch (e: any) {
          setError({
            code: 'callback_failed',
            description: e?.message ?? 'Failed to complete QuickBooks connection.',
          });
        }
      })();
      return;
    }

    // Error path — DO NOT auto-close. Show it so the user can read it.
    const errCode = oauthError ?? 'missing_code';
    const errDesc =
      oauthErrorDesc ??
      (oauthError
        ? 'Intuit rejected the connection. This is almost always a redirect URI mismatch — the Redirect URI registered in your Intuit app must exactly match https://pitch-crm.ai/quickbooks/callback'
        : 'No authorization code was returned by Intuit.');

    setError({ code: errCode, description: errDesc });

    if (window.opener && !window.opener.closed) {
      try {
        window.opener.postMessage(
          { type: 'qbo-oauth-error', error: errCode, description: errDesc },
          '*'
        );
      } catch {}
    }
  }, [navigate, toast]);

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen p-6">
        <div className="max-w-lg w-full text-center space-y-4 border rounded-lg p-8 bg-card">
          <AlertTriangle className="h-12 w-12 mx-auto text-destructive" />
          <h2 className="text-xl font-semibold">QuickBooks connection failed</h2>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono text-destructive">{error.code}</span>
          </p>
          <p className="text-sm text-muted-foreground">{error.description}</p>
          <div className="flex gap-2 justify-center pt-2">
            <Button variant="outline" onClick={() => window.close()}>Close</Button>
            <Button onClick={() => navigate('/settings')}>Back to Settings</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center space-y-4">
        <RefreshCw className="h-12 w-12 animate-spin mx-auto text-primary" />
        <h2 className="text-xl font-semibold">Connecting to QuickBooks...</h2>
        <p className="text-muted-foreground">Please wait while we complete the connection.</p>
      </div>
    </div>
  );
}
