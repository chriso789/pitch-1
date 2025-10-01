import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";

export default function QuickBooksCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const handleCallback = () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const realmId = params.get('realmId');
      const state = params.get('state');

      if (code && realmId) {
        // Send message to parent window (Settings page)
        if (window.opener) {
          window.opener.postMessage({
            type: 'qbo-oauth-success',
            code,
            realmId,
            state,
          }, window.location.origin);
          
          // Close this popup window
          window.close();
        } else {
          // If not in popup, redirect to settings
          navigate('/settings');
        }
      } else {
        // Error case
        if (window.opener) {
          window.opener.postMessage({
            type: 'qbo-oauth-error',
            error: 'Missing authorization code',
          }, window.location.origin);
          window.close();
        } else {
          navigate('/settings');
        }
      }
    };

    handleCallback();
  }, [navigate]);

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
