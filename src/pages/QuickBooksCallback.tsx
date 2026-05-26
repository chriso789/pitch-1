import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function QuickBooksCallback() {
  const navigate = useNavigate();
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
      if (window.opener) {
        window.opener.postMessage(
          { type: 'qbo-oauth-success', code, realmId, state },
          window.location.origin
        );
        window.close();
      } else {
        navigate('/settings');
      }
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

    if (window.opener) {
      window.opener.postMessage(
        { type: 'qbo-oauth-error', error: errCode, description: errDesc },
        window.location.origin
      );
    }
  }, [navigate]);

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
