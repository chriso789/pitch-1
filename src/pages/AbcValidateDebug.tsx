import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export default function AbcValidateDebug() {
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<string>("");

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
        lines: [
          {
            itemNumber: "02OCTDUMP",
            itemDescription: "Sandbox Demo Item 02OCTDUMP",
            uom: "EA",
            quantity: 1,
            priceOverride: {
              value: 1.0,
              reason:
                "Sandbox Price Items call WAF-blocked; payload validation only for ABC demo.",
            },
          },
        ],
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

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">ABC Validate-Only Debug</h1>
      <p className="text-sm text-muted-foreground">
        Runs the ABC validate_payload_only call using the live Supabase client
        (session JWT auto-attached). No order is submitted.
      </p>
      <Button onClick={run} disabled={loading}>
        {loading ? "Running…" : "Run validate_payload_only"}
      </Button>
      <pre className="bg-muted p-4 rounded text-xs overflow-auto max-h-[70vh] whitespace-pre-wrap">
        {output || "Click the button to run."}
      </pre>
    </div>
  );
}
