import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";

export default function GoogleCalendarCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const handleCallback = () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const state = params.get('state');
      const error = params.get('error');

      if (error) {
        // Handle OAuth error
        if (window.opener) {
          window.opener.postMessage({
            type: 'google-calendar-oauth-error',
            error: error,
          }, window.location.origin);
          window.close();
        } else {
          navigate('/settings');
        }
        return;
      }

      if (code && state) {
        // Send message to parent window (Settings page)
        if (window.opener) {
          window.opener.postMessage({
            type: 'google-calendar-oauth-success',
            code,
            state,
          }, window.location.origin);
          
          // Close this popup window
          window.close();
        } else {
          // If not in popup, redirect to settings
          navigate('/settings');
        }
      } else {
        // Missing parameters
        if (window.opener) {
          window.opener.postMessage({
            type: 'google-calendar-oauth-error',
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
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="text-center space-y-4">
        <RefreshCw className="h-12 w-12 animate-spin mx-auto text-primary" />
        <h2 className="text-xl font-semibold">Connecting to Google Calendar...</h2>
        <p className="text-muted-foreground">Please wait while we complete the connection.</p>
      </div>
    </div>
  );
}
