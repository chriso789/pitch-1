import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

const FOREIGN_TENANT_ID = "5a02983a-3d4d-4d5e-af01-7f2c7f02e78c"; // Under One Roof — NOT O'Brien

export default function AbcValidateDebug() {
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<string>("");
  const [srsLoading, setSrsLoading] = useState(false);
  const [srsOutput, setSrsOutput] = useState<string>("");

  const run = async () => {
    setLoading(true);
    setOutput("Running…");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data: { user } } = await supabase.auth.getUser();

      const log: any = {
        step1_session_user: session?.user?.email ?? null,
        step1_session_sub: session?.user?.id ?? null,
        step1_has_access_token: !!session?.access_token,
        step2_getUser_email: user?.email ?? null,
        step2_getUser_id: user?.id ?? null,
      };

      // Resolve tenant via profiles
      if (user?.id) {
        const { data: profile, error: profileErr } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", user.id)
          .maybeSingle();
        log.step3_profile = profile;
        log.step3_profile_error = profileErr?.message ?? null;
      }

      // Invoke the edge function via the supabase client (auto-attaches JWT)
      const body = {
        action: "validate_payload_only",
        environment: "sandbox",
        sandboxDemo: true,
        shipToNumber: "2010466-2",
        branchNumber: "1209",
        itemNumber: "02OCTDUMP",
        itemDescription: "Sandbox Demo Item 02OCTDUMP",
        uom: "EA",
        quantity: 1,
        priceOverride: {
          value: 1.0,
          reason:
            "Sandbox Price Items call WAF-blocked; payload validation only for ABC demo.",
        },
        jobsiteContact: {
          name: "Demo Contact",
          email: "demo@example.com",
          phone: "555-555-5555",
        },
      };

      log.step4_request_body = body;

      const { data, error } = await supabase.functions.invoke(
        "supplier-api/abc/proxy",
        { body }
      );

      log.step5_response_data = data;
      log.step5_response_error = error
        ? { message: error.message, name: error.name, ctx: (error as any).context ?? null }
        : null;

      setOutput(JSON.stringify(log, null, 2));
      console.log("[ABC validate debug]", log);
    } catch (e: any) {
      setOutput("Threw: " + (e?.message ?? String(e)));
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const runSrsSpoof = async () => {
    setSrsLoading(true);
    setSrsOutput("Running…");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const log: any = {
        caller_user_id: user?.id ?? null,
        caller_email: user?.email ?? null,
        spoofed_tenant_id: FOREIGN_TENANT_ID,
        note: "Sending a foreign tenant_id in the body while authenticated as O'Brien. Expected: 403 with tenant-mismatch error. NO srs_credential_audit row should be written for the foreign tenant.",
      };

      const { data, error } = await supabase.functions.invoke("srs-api-proxy", {
        body: { action: "ping", tenant_id: FOREIGN_TENANT_ID },
      });

      log.response_data = data;
      log.response_error = error
        ? { message: error.message, name: error.name, ctx: (error as any).context ?? null }
        : null;

      setSrsOutput(JSON.stringify(log, null, 2));
      console.log("[SRS spoof debug]", log);
    } catch (e: any) {
      setSrsOutput("Threw: " + (e?.message ?? String(e)));
      console.error(e);
    } finally {
      setSrsLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <section className="space-y-4">
        <h1 className="text-2xl font-bold">ABC Validate-Only Debug</h1>
        <p className="text-sm text-muted-foreground">
          Runs the ABC validate_payload_only call using the live Supabase client
          (session JWT auto-attached). No order is submitted.
        </p>
        <Button onClick={run} disabled={loading}>
          {loading ? "Running…" : "Run validate_payload_only"}
        </Button>
        <pre className="bg-muted p-4 rounded text-xs overflow-auto max-h-[50vh] whitespace-pre-wrap">
          {output || "Click the button to run."}
        </pre>
      </section>

      <section className="space-y-4 border-t pt-6">
        <h2 className="text-xl font-bold">SRS Cross-Tenant Spoof Proof</h2>
        <p className="text-sm text-muted-foreground">
          Calls <code>srs-api-proxy</code> with your live JWT but a{" "}
          <strong>foreign tenant_id</strong> ({FOREIGN_TENANT_ID}) in the body.
          The hardened proxy MUST reject with 403 and write NO audit/order rows
          for the spoofed tenant.
        </p>
        <Button onClick={runSrsSpoof} disabled={srsLoading} variant="destructive">
          {srsLoading ? "Running…" : "Run SRS spoof test"}
        </Button>
        <pre className="bg-muted p-4 rounded text-xs overflow-auto max-h-[50vh] whitespace-pre-wrap">
          {srsOutput || "Click the button to run."}
        </pre>
      </section>
    </div>
  );
}
