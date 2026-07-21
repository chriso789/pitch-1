import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

// Production Intuit OAuth uses this branded public callback because Intuit's
// dashboard may reject raw Supabase Edge Function URLs. This page immediately
// forwards token-bearing params to qbo-oauth-connect/callback so the code
// exchange still happens server-side and tenants land back inside Pitch CRM.
export default function QuickBooksCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const realmId = params.get("realmId");
    const state = params.get("state");
    const err = params.get("error");

    // If Intuit still hits this URL with token-bearing params, forward to the
    // edge function 302 callback so the exchange happens server-side.
    if (code || err) {
      const fwd = new URL(
        "https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/qbo-oauth-connect/callback",
      );
      if (code) fwd.searchParams.set("code", code);
      if (realmId) fwd.searchParams.set("realmId", realmId);
      if (state) fwd.searchParams.set("state", state);
      if (err) fwd.searchParams.set("error", err);
      window.location.replace(fwd.toString());
      return;
    }

    navigate("/settings/integrations?provider=qbo");
  }, [navigate]);

  return null;
}
