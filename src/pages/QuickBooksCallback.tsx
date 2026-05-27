import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

// Phase 1: server-side 302 callback in qbo-oauth-connect handles the token exchange.
// This page exists only as a transitional shell for the legacy Intuit Redirect URI
// (https://pitch-crm.ai/quickbooks/callback). It forwards any params to the edge
// function so the new server-side flow can take over. After the Intuit dashboard
// Redirect URI is repointed at the edge function URL, this page is no longer hit.
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
