// Master-only Intuit production-review readiness dashboard.
//
// Surfaces every Intuit questionnaire item with the recommended answer, the
// codebase status, and the evidence the reviewer would want to see. Reads from
// qbo_api_logs, qbo_connection_tests, qbo_connections, legal_documents,
// legal_acceptances, integration_consents. Master ('COB') role only.

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ShieldCheck, ShieldAlert, CheckCircle2, XCircle, AlertTriangle, RefreshCw, ClipboardCopy } from "lucide-react";
import { useUserProfile } from "@/contexts/UserProfileContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

type StatusValue = "pass" | "warn" | "fail" | "unknown";

interface ReadinessRow {
  section: string;
  question: string;
  recommendedAnswer: string;
  status: StatusValue;
  evidence: string;
  action?: string;
}

function StatusBadge({ status }: { status: StatusValue }) {
  const map = {
    pass: { variant: "default", icon: CheckCircle2, label: "Pass", className: "bg-emerald-600 hover:bg-emerald-600" },
    warn: { variant: "secondary", icon: AlertTriangle, label: "Warning", className: "bg-amber-500 text-white hover:bg-amber-500" },
    fail: { variant: "destructive", icon: XCircle, label: "Fail", className: "" },
    unknown: { variant: "outline", icon: AlertTriangle, label: "Unknown", className: "" },
  } as const;
  const c = map[status];
  const Icon = c.icon;
  return (
    <Badge variant={c.variant} className={`gap-1 ${c.className}`}>
      <Icon className="h-3 w-3" /> {c.label}
    </Badge>
  );
}

interface QboApiLogRow {
  id: string;
  tenant_id: string | null;
  realm_id: string | null;
  oauth_app_env: string | null;
  action: string;
  endpoint: string | null;
  method: string | null;
  http_status: number | null;
  intuit_tid: string | null;
  success: boolean;
  error_message: string | null;
  duration_ms: number | null;
  created_at: string;
}

interface QboTestRow {
  id: string;
  tenant_id: string;
  test_type: string;
  status: string;
  oauth_app_env: string;
  realm_id: string | null;
  evidence: Record<string, unknown>;
  created_at: string;
}

interface QboConnectionRow {
  id: string;
  tenant_id: string;
  realm_id: string;
  qbo_company_name: string | null;
  oauth_app_env: string;
  is_active: boolean;
  connected_at: string;
  last_refresh_at: string | null;
  refresh_token_expires_at: string | null;
  metadata: Record<string, unknown>;
}

export default function IntuitReviewReadinessPage() {
  const { profile } = useUserProfile();
  const { toast } = useToast();
  const isMaster = profile?.role === "master";

  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<QboApiLogRow[]>([]);
  const [tests, setTests] = useState<QboTestRow[]>([]);
  const [connections, setConnections] = useState<QboConnectionRow[]>([]);
  const [legalDocs, setLegalDocs] = useState<any[]>([]);
  const [consents, setConsents] = useState<any[]>([]);
  const [securityReviews, setSecurityReviews] = useState<any[]>([]);
  const [supportContacts, setSupportContacts] = useState<any[]>([]);
  const [savingReview, setSavingReview] = useState(false);
  const [savingAnswers, setSavingAnswers] = useState(false);
  const [savingSupport, setSavingSupport] = useState(false);
  const [supportForm, setSupportForm] = useState({ subject: "", message: "" });
  const [reviewNotes, setReviewNotes] = useState("");

  // Filters for API logs
  const [logFilters, setLogFilters] = useState<{ env: string; tid: string; successOnly: string }>({
    env: "all",
    tid: "",
    successOnly: "all",
  });

  // Test recorder form
  const [testForm, setTestForm] = useState({
    test_type: "sandbox_connect",
    status: "passed",
    realm_id: "",
    oauth_app_env: "development",
    notes: "",
  });
  const [savingTest, setSavingTest] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [l, t, c, d, ic, sr, sc] = await Promise.all([
        supabase
          .from("qbo_api_logs" as any)
          .select("id,tenant_id,realm_id,oauth_app_env,action,endpoint,method,http_status,intuit_tid,success,error_message,duration_ms,created_at")
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("qbo_connection_tests" as any)
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("qbo_connections" as any)
          .select("id,tenant_id,realm_id,qbo_company_name,oauth_app_env,is_active,connected_at,last_refresh_at,refresh_token_expires_at,metadata")
          .order("connected_at", { ascending: false })
          .limit(50),
        supabase
          .from("legal_documents" as any)
          .select("document_key,version,effective_at,is_current")
          .order("effective_at", { ascending: false })
          .limit(20),
        supabase
          .from("integration_consents" as any)
          .select("id,tenant_id,user_id,integration,consent_version,expected_oauth_app_env,accepted_at")
          .eq("integration", "qbo" as any)
          .order("accepted_at", { ascending: false })
          .limit(50),
        supabase
          .from("intuit_security_reviews" as any)
          .select("id,reviewed_by,status,review_scope,notes,created_at")
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("app_support_contacts" as any)
          .select("id,tenant_id,user_id,subject,message,category,status,created_at,qbo_context")
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (l.data) setLogs(l.data as any);
      if (t.data) setTests(t.data as any);
      if (c.data) setConnections(c.data as any);
      if (d.data) setLegalDocs(d.data as any);
      if (ic.data) setConsents(ic.data as any);
      if (sr.data) setSecurityReviews(sr.data as any);
      if (sc.data) setSupportContacts(sc.data as any);
    } catch (e: any) {
      toast({ title: "Failed to load readiness data", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isMaster) void loadAll();
  }, [isMaster]);

  // ---- Computed checks ----

  const hasIntuitTidEvidence = logs.some((l) => !!l.intuit_tid);
  const totalLogs = logs.length;
  const errorLogs = logs.filter((l) => !l.success).length;
  const sandboxConnect = tests.find((t) => t.test_type === "sandbox_connect" && t.status === "passed");
  const sandboxDisconnect = tests.find((t) => t.test_type === "sandbox_disconnect" && t.status === "passed");
  const sandboxReconnect = tests.find((t) => t.test_type === "sandbox_reconnect" && t.status === "passed");
  const tokenRefreshTest = tests.find((t) => t.test_type === "token_refresh" && t.status === "passed");
  const validationErrorTest = tests.find((t) => t.test_type === "validation_error" && t.status === "passed");
  const webhookSigTest = tests.find((t) => t.test_type === "webhook_signature" && t.status === "passed");
  const currentLegalDocs = legalDocs.filter((d: any) => d.is_current);

  const rows: ReadinessRow[] = useMemo(() => {
    return [
      // -------- OAuth / Token Handling
      {
        section: "OAuth / Token Handling",
        question: "Tested connecting, disconnecting, reconnecting with sandbox/non-production company?",
        recommendedAnswer: "Yes — only after sandbox tests are recorded.",
        status: sandboxConnect && sandboxDisconnect && sandboxReconnect ? "pass" : "warn",
        evidence: `qbo_connection_tests: connect=${sandboxConnect ? "passed" : "missing"}, disconnect=${sandboxDisconnect ? "passed" : "missing"}, reconnect=${sandboxReconnect ? "passed" : "missing"}`,
        action: !sandboxConnect || !sandboxDisconnect || !sandboxReconnect ? "Record each sandbox test on the OAuth Tests tab before answering Yes." : undefined,
      },
      {
        section: "OAuth / Token Handling",
        question: "How often does the app refresh access tokens?",
        recommendedAnswer: "As needed / before API calls when expired or near expiry.",
        status: "pass",
        evidence: "_shared/qbo-auth.ts → getValidAccessToken() + _shared/qbo-api.ts → refreshQboTokenIfNeeded() refresh when <5min remaining; token_expires_at, refresh_token, refresh_token_expires_at, last_refresh_at persisted on every refresh.",
      },
      {
        section: "OAuth / Token Handling",
        question: "Does the app retry auth/authentication requests that failed?",
        recommendedAnswer: "No aggressive retries — surface error, prompt reconnect on invalid_grant.",
        status: "pass",
        evidence: "invalid_grant → QboReauthRequiredError → connection.is_active=false + metadata.reauth_required=true. UI shows reconnect banner.",
      },
      {
        section: "OAuth / Token Handling",
        question: "On auth error, ask customer to reconnect?",
        recommendedAnswer: "Yes.",
        status: "pass",
        evidence: "QuickBooksSettings.tsx renders 'Reauthorization required' banner + 'Reauthorize QuickBooks' button when reauth_required is detected.",
      },
      {
        section: "OAuth / Token Handling",
        question: "Did app use Intuit's current OAuth endpoints?",
        recommendedAnswer: "Yes.",
        status: "pass",
        evidence: "QBO_AUTH_URL=https://appcenter.intuit.com/connect/oauth2, QBO_TOKEN_URL=https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer, QBO_REVOKE_URL=https://developer.api.intuit.com/v2/oauth2/tokens/revoke.",
      },
      {
        section: "OAuth / Token Handling",
        question: "Handles expired access-token errors?",
        recommendedAnswer: "Yes.",
        status: "pass",
        evidence: "refreshQboTokenIfNeeded() runs before each qboFetch; getValidAccessToken refreshes 5min before expiry.",
      },
      {
        section: "OAuth / Token Handling",
        question: "Handles expired refresh-token / invalid_grant?",
        recommendedAnswer: "Yes — connection marked inactive, reauth UI shown.",
        status: "pass",
        evidence: "markQboReauthRequired() sets is_active=false, metadata.reauth_required=true, metadata.reauth_reason. UI renders ShieldAlert + Reauthorize button.",
      },
      {
        section: "OAuth / Token Handling",
        question: "Handles CSRF (state) errors?",
        recommendedAnswer: "Yes.",
        status: "pass",
        evidence: "qbo_oauth_state table stores per-flow state; qbo-oauth-connect validates server-side, enforces expiry, deletes after use.",
      },
      {
        section: "OAuth / Token Handling",
        question: "Use OAuth playground / offline tools?",
        recommendedAnswer: "No.",
        status: "pass",
        evidence: "Own OAuth flow only — server-side authorize/callback/refresh/revoke.",
      },

      // -------- API Usage
      {
        section: "API Usage",
        question: "Broad API categories used.",
        recommendedAnswer: "Accounting API only. Do not select Payments or Payroll.",
        status: "pass",
        evidence: "scope = com.intuit.quickbooks.accounting; no Payroll or separate Payments API endpoints in repo.",
      },
      {
        section: "API Usage",
        question: "Frequency of API calls.",
        recommendedAnswer: "Event-driven / user-initiated, with periodic webhook-driven updates.",
        status: "pass",
        evidence: "Calls occur during OAuth connect, company verification, customer/item sync, invoice create/send, payment status updates, token refresh, and webhook-driven invoice/payment fetches.",
      },

      // -------- QBO Versions
      {
        section: "QBO Versions",
        question: "Customer-facing QBO versions supported.",
        recommendedAnswer: "Simple Start, Essentials, Plus, Advanced.",
        status: "pass",
        evidence: "Accounting API endpoints used are available on all four versions.",
      },
      {
        section: "QBO Versions",
        question: "Can app handle users gaining/losing version-specific features?",
        recommendedAnswer: "Yes — graceful error handling, no crash.",
        status: "pass",
        evidence: "QBO API errors return structured 502 JSON with intuit_tid + status; UI surfaces error rather than crashing.",
      },
      {
        section: "QBO Versions",
        question: "Sales-tax / TaxCodeRef usage.",
        recommendedAnswer: "None of the above — invoices do not currently send TxnTaxDetail.",
        status: "pass",
        evidence: "qbo-invoice-create payload does not include TxnTaxDetail / TaxCodeRef. If sales tax is later added, change this answer to 'Sales tax — United States'.",
      },

      // -------- Webhooks / CDC
      {
        section: "Webhooks / CDC",
        question: "Do you use webhooks?",
        recommendedAnswer: "Yes.",
        status: webhookSigTest ? "pass" : "warn",
        evidence: `qbo-webhook-handler verifies HMAC signature against dev + prod verifier tokens; routes per oauth_app_env. webhook_signature test recorded: ${webhookSigTest ? "yes" : "no"}.`,
        action: !webhookSigTest ? "Record a webhook_signature test on the OAuth Tests tab." : undefined,
      },
      {
        section: "Webhooks / CDC",
        question: "Use CDC (Change Data Capture) endpoint?",
        recommendedAnswer: "No.",
        status: "pass",
        evidence: "No /cdc endpoint usage in repo. Updates arrive via webhook notifications + on-demand fetches.",
      },

      // -------- Error Handling / Logging
      {
        section: "Error Handling / Logging",
        question: "Tested that app handles API syntax / validation errors?",
        recommendedAnswer: "Yes — only after sandbox validation-error test recorded.",
        status: validationErrorTest ? "pass" : "warn",
        evidence: `qbo_connection_tests.validation_error: ${validationErrorTest ? "passed" : "not recorded"}. Errored API calls already write to qbo_api_logs.`,
        action: !validationErrorTest ? "Trigger a deliberate invalid QBO request from sandbox and record the test." : undefined,
      },
      {
        section: "Error Handling / Logging",
        question: "Capture intuit_tid from response headers?",
        recommendedAnswer: "Yes.",
        status: hasIntuitTidEvidence ? "pass" : "warn",
        evidence: `_shared/qbo-intuit-tid.ts → getIntuitTid() reads response.headers.get('intuit_tid') on every QBO call; _shared/qbo-api.ts writeQboApiLog persists it to public.qbo_api_logs.intuit_tid. Rows with intuit_tid in DB: ${logs.filter((l) => !!l.intuit_tid).length}/${totalLogs}.`,
        action: !hasIntuitTidEvidence ? "Make at least one QBO API call (e.g. fetch items) so a log row with intuit_tid is captured." : undefined,
      },
      {
        section: "Error Handling / Logging",
        question: "Store error info in shareable logs?",
        recommendedAnswer: "Yes.",
        status: totalLogs > 0 ? "pass" : "warn",
        evidence: `public.qbo_api_logs stores: action, endpoint, http_status, intuit_tid, realm_id, oauth_app_env, error_message, duration_ms, timestamp. ${totalLogs} rows. Tokens NEVER stored.`,
      },
      {
        section: "Error Handling / Logging",
        question: "Support contact accessible in-app?",
        recommendedAnswer: "Yes.",
        status: "pass",
        evidence: "Settings → QuickBooks → Support card exposes mailto with tenant_id, realm_id, qbo_company_name and last intuit_tid pre-filled.",
      },

      // -------- Security
      {
        section: "Security",
        question: "Security team regularly assesses vulnerabilities?",
        recommendedAnswer: "Yes only if a recent internal security review is recorded; otherwise No.",
        status: securityReviews.some((r) => r.status === "completed" && new Date(r.created_at).getTime() > Date.now() - 1000 * 60 * 60 * 24 * 180) ? "pass" : "warn",
        evidence: `intuit_security_reviews rows (last 180d): ${securityReviews.filter((r) => r.status === "completed" && new Date(r.created_at).getTime() > Date.now() - 1000 * 60 * 60 * 24 * 180).length}. Lovable + Supabase security linters also run on every migration.`,
        action: securityReviews.length === 0 ? "Record an internal security review on the Security Checklist tab before answering Yes." : undefined,
      },
      {
        section: "Security",
        question: "Client ID / Client Secret stored securely?",
        recommendedAnswer: "Yes.",
        status: "pass",
        evidence: "QBO client ID/secret read from Deno.env in edge functions only (qbo-context.ts). Never present in frontend bundle. Never logged. Never returned to browser.",
      },
      {
        section: "Security",
        question: "MFA enabled?",
        recommendedAnswer: "No — unless Supabase MFA is enabled before submission.",
        status: "warn",
        evidence: "Auth uses Supabase email/password. No MFA factor enrolment in code. Enable in Supabase dashboard → Auth → MFA before answering Yes.",
        action: "Enable Supabase Auth MFA (TOTP) in dashboard, then answer Yes.",
      },
      {
        section: "Security",
        question: "CAPTCHA on authentication?",
        recommendedAnswer: "No — unless Supabase captcha (hCaptcha/Turnstile) is enabled.",
        status: "warn",
        evidence: "No captcha provider configured in supabase/config.toml. Enable in Supabase dashboard → Auth → Bot & Abuse Protection before answering Yes.",
        action: "Enable hCaptcha or Turnstile in Supabase Auth settings, then answer Yes.",
      },
      {
        section: "Security",
        question: "Use WebSocket / Realtime?",
        recommendedAnswer: "Yes — used for app CRM realtime updates only (not for QBO token exchange).",
        status: "pass",
        evidence: "Supabase Realtime channels used for pipeline, notifications, inbox, documents. QBO OAuth/refresh use HTTPS to Intuit endpoints, not WebSocket.",
      },
      {
        section: "Security",
        question: "Is customer Intuit data shown to anyone other than that customer?",
        recommendedAnswer: "No.",
        status: "pass",
        evidence: "All QBO tables (qbo_connections, qbo_entity_mapping, qbo_payment_history, qbo_webhook_events, qbo_api_logs, qbo_connection_tests) have tenant_id columns and RLS policies scoped to user_roles for that tenant. No cross-tenant queries. Data is never sold or shared.",
      },

      // -------- Customer Data Use
      {
        section: "Customer Data Use",
        question: "Legal/consent gating before production connect?",
        recommendedAnswer: "Yes — Privacy + Terms + QBO Integration Consent required.",
        status: currentLegalDocs.length >= 3 ? (consents.length > 0 ? "pass" : "warn") : "warn",
        evidence: `legal_documents current versions: ${currentLegalDocs.map((d: any) => `${d.document_key}@v${d.version}`).join(", ") || "none"}. integration_consents (qbo) accepted: ${consents.length}.`,
        action: currentLegalDocs.length < 3 ? "Ensure privacy_policy, terms_of_service, and qbo_integration_consent are seeded with is_current=true." : undefined,
      },

      // -------- Support
      {
        section: "Support / Contact",
        question: "In-app support contact?",
        recommendedAnswer: "Yes.",
        status: "pass",
        evidence: "Settings → QuickBooks → 'Get support with this QuickBooks connection' card.",
      },
    ];
  }, [logs, tests, consents, currentLegalDocs, hasIntuitTidEvidence, sandboxConnect, sandboxDisconnect, sandboxReconnect, validationErrorTest, webhookSigTest, totalLogs, securityReviews]);

  const generatedAnswers = useMemo(() => {
    const lines: string[] = [];
    lines.push("INTUIT REVIEW ANSWERS — generated " + new Date().toISOString());
    lines.push("=".repeat(72));
    const grouped: Record<string, ReadinessRow[]> = {};
    for (const r of rows) {
      (grouped[r.section] ||= []).push(r);
    }
    for (const [section, items] of Object.entries(grouped)) {
      lines.push("");
      lines.push(`## ${section}`);
      for (const it of items) {
        const safe = it.status === "pass"
          ? it.recommendedAnswer
          : `${it.recommendedAnswer}  [DO NOT ANSWER YES YET — ${it.status.toUpperCase()}: ${it.action ?? "see Readiness tab"}]`;
        lines.push(`- Q: ${it.question}`);
        lines.push(`  A: ${safe}`);
      }
    }
    return lines.join("\n");
  }, [rows]);

  const filteredLogs = useMemo(() => {
    return logs.filter((l) => {
      if (logFilters.env !== "all" && l.oauth_app_env !== logFilters.env) return false;
      if (logFilters.tid && !(l.intuit_tid ?? "").toLowerCase().includes(logFilters.tid.toLowerCase())) return false;
      if (logFilters.successOnly === "success" && !l.success) return false;
      if (logFilters.successOnly === "error" && l.success) return false;
      return true;
    });
  }, [logs, logFilters]);

  const recordTest = async () => {
    if (!profile) return;
    setSavingTest(true);
    try {
      // Resolve tenant from current user profile
      const tenant_id = (profile as any).tenant_id ?? (profile as any).active_tenant_id;
      if (!tenant_id) throw new Error("No tenant resolved on profile");
      const { error } = await supabase.from("qbo_connection_tests" as any).insert({
        tenant_id,
        user_id: profile.id,
        realm_id: testForm.realm_id || null,
        oauth_app_env: testForm.oauth_app_env,
        test_type: testForm.test_type,
        status: testForm.status,
        evidence: testForm.notes ? { notes: testForm.notes, recorded_by: `${profile.first_name} ${profile.last_name}`.trim() || profile.id } : { recorded_by: `${profile.first_name} ${profile.last_name}`.trim() || profile.id },
      });
      if (error) throw error;
      toast({ title: "Test recorded", description: `${testForm.test_type} → ${testForm.status}` });
      setTestForm((f) => ({ ...f, notes: "" }));
      await loadAll();
    } catch (e: any) {
      toast({ title: "Failed to record test", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setSavingTest(false);
    }
  };

  const recordSecurityReview = async () => {
    setSavingReview(true);
    try {
      const { error } = await supabase.functions.invoke("intuit-review-api", {
        method: "POST" as any,
        body: { notes: reviewNotes },
      } as any);
      // Fallback: invoke with raw path if needed
      if (error) {
        const { error: e2 } = await supabase
          .from("intuit_security_reviews" as any)
          .insert({
            reviewed_by: profile?.id,
            status: "completed",
            review_scope: "intuit_security_review",
            notes: reviewNotes || null,
            checklist: { recorded_via: "readiness_page" },
          });
        if (e2) throw e2;
      }
      toast({ title: "Security review recorded" });
      setReviewNotes("");
      await loadAll();
    } catch (e: any) {
      toast({ title: "Failed to record review", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setSavingReview(false);
    }
  };

  const persistAnswers = async () => {
    setSavingAnswers(true);
    try {
      const payload = rows.map((r, i) => ({
        question_key: `${r.section}::${r.question}`.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 180) + "_" + i,
        question_text: r.question,
        recommended_answer: r.recommendedAnswer,
        actual_answer: r.status === "pass" ? r.recommendedAnswer : null,
        implementation_status: r.status,
        evidence: { text: r.evidence, section: r.section },
        action_needed: r.action ?? null,
      }));
      const { error } = await supabase
        .from("intuit_review_answers" as any)
        .upsert(payload, { onConflict: "question_key" });
      if (error) throw error;
      toast({ title: "Generated answers persisted", description: `${payload.length} rows saved.` });
    } catch (e: any) {
      toast({ title: "Failed to persist answers", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setSavingAnswers(false);
    }
  };

  const submitSupportTest = async () => {
    if (!profile) return;
    setSavingSupport(true);
    try {
      const tenant_id = (profile as any).tenant_id ?? (profile as any).active_tenant_id ?? null;
      const activeConn = connections.find((c) => c.is_active);
      const lastTid = logs.find((l) => !!l.intuit_tid)?.intuit_tid ?? null;
      const { error } = await supabase
        .from("app_support_contacts" as any)
        .insert({
          tenant_id,
          user_id: profile.id,
          category: "support",
          subject: supportForm.subject || "Support test",
          message: supportForm.message || null,
          qbo_context: {
            realm_id: activeConn?.realm_id ?? null,
            qbo_company_name: activeConn?.qbo_company_name ?? null,
            oauth_app_env: activeConn?.oauth_app_env ?? null,
            last_intuit_tid: lastTid,
          },
        });
      if (error) throw error;
      toast({ title: "Support contact recorded" });
      setSupportForm({ subject: "", message: "" });
      await loadAll();
    } catch (e: any) {
      toast({ title: "Failed to record support contact", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setSavingSupport(false);
    }
  };

  if (!profile) {
    return <div className="p-6 text-muted-foreground">Loading profile…</div>;
  }
  if (!isMaster) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Restricted</AlertTitle>
          <AlertDescription>The Intuit review readiness page is master-only.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-7xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Intuit Production Review Readiness</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Per-question status and evidence for the QuickBooks Online production review submission. Master ('COB') only.
          </p>
        </div>
        <Button variant="outline" onClick={loadAll} disabled={loading} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <Tabs defaultValue="answers" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto gap-1 justify-start">
          <TabsTrigger value="answers">Review Answers</TabsTrigger>
          <TabsTrigger value="oauth-tests">OAuth Tests</TabsTrigger>
          <TabsTrigger value="api-logs">API Logs</TabsTrigger>
          <TabsTrigger value="error-tests">Error Tests</TabsTrigger>
          <TabsTrigger value="security">Security Checklist</TabsTrigger>
          <TabsTrigger value="legal">Legal/Consent</TabsTrigger>
          <TabsTrigger value="support">Support/Data Use</TabsTrigger>
          <TabsTrigger value="generate">Generate Answers</TabsTrigger>
        </TabsList>

        {/* ---- Answers tab ---- */}
        <TabsContent value="answers">
          <Card>
            <CardHeader>
              <CardTitle>Review Answer Map</CardTitle>
              <CardDescription>Every Intuit question, the recommended answer, and current support in the codebase.</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-[70vh]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Section</TableHead>
                      <TableHead>Question</TableHead>
                      <TableHead>Recommended answer</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Evidence / action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{r.section}</TableCell>
                        <TableCell className="text-sm">{r.question}</TableCell>
                        <TableCell className="text-sm">{r.recommendedAnswer}</TableCell>
                        <TableCell><StatusBadge status={r.status} /></TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.evidence}
                          {r.action && <div className="mt-1 text-amber-700 dark:text-amber-400"><strong>Action:</strong> {r.action}</div>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- OAuth Tests tab ---- */}
        <TabsContent value="oauth-tests" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Record sandbox / non-production test</CardTitle>
              <CardDescription>Use Sandbox to satisfy Intuit's "tested in sandbox" requirement.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div className="space-y-1">
                <Label>Test type</Label>
                <Select value={testForm.test_type} onValueChange={(v) => setTestForm((f) => ({ ...f, test_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sandbox_connect">sandbox_connect</SelectItem>
                    <SelectItem value="sandbox_disconnect">sandbox_disconnect</SelectItem>
                    <SelectItem value="sandbox_reconnect">sandbox_reconnect</SelectItem>
                    <SelectItem value="token_refresh">token_refresh</SelectItem>
                    <SelectItem value="validation_error">validation_error</SelectItem>
                    <SelectItem value="invalid_grant">invalid_grant</SelectItem>
                    <SelectItem value="webhook_signature">webhook_signature</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={testForm.status} onValueChange={(v) => setTestForm((f) => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="passed">passed</SelectItem>
                    <SelectItem value="failed">failed</SelectItem>
                    <SelectItem value="skipped">skipped</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Environment</Label>
                <Select value={testForm.oauth_app_env} onValueChange={(v) => setTestForm((f) => ({ ...f, oauth_app_env: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="development">development (sandbox)</SelectItem>
                    <SelectItem value="production">production</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Realm ID (optional)</Label>
                <Input value={testForm.realm_id} onChange={(e) => setTestForm((f) => ({ ...f, realm_id: e.target.value }))} placeholder="4620816365…" />
              </div>
              <div className="space-y-1 md:col-span-5">
                <Label>Notes / evidence</Label>
                <Textarea value={testForm.notes} onChange={(e) => setTestForm((f) => ({ ...f, notes: e.target.value }))} placeholder="What did you test, expected vs actual?" />
              </div>
              <div className="md:col-span-5">
                <Button onClick={recordTest} disabled={savingTest}>{savingTest ? "Saving…" : "Record test"}</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Test history</CardTitle>
              <CardDescription>{tests.length} test record(s).</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Env</TableHead>
                    <TableHead>Realm</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tests.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="text-xs">{formatDistanceToNow(new Date(t.created_at), { addSuffix: true })}</TableCell>
                      <TableCell className="text-xs font-mono">{t.test_type}</TableCell>
                      <TableCell><Badge variant={t.status === "passed" ? "default" : "destructive"}>{t.status}</Badge></TableCell>
                      <TableCell className="text-xs">{t.oauth_app_env}</TableCell>
                      <TableCell className="text-xs font-mono">{t.realm_id ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-md truncate">{(t.evidence as any)?.notes ?? ""}</TableCell>
                    </TableRow>
                  ))}
                  {tests.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">No tests recorded yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- API Logs tab ---- */}
        <TabsContent value="api-logs">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <CardTitle>QBO API Logs</CardTitle>
                  <CardDescription>{filteredLogs.length} of {logs.length} loaded (last 500).</CardDescription>
                </div>
                <div className="flex gap-2 flex-wrap items-end">
                  <div>
                    <Label className="text-xs">Env</Label>
                    <Select value={logFilters.env} onValueChange={(v) => setLogFilters((f) => ({ ...f, env: v }))}>
                      <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="development">development</SelectItem>
                        <SelectItem value="production">production</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">intuit_tid</Label>
                    <Input value={logFilters.tid} onChange={(e) => setLogFilters((f) => ({ ...f, tid: e.target.value }))} className="w-[200px]" placeholder="search…" />
                  </div>
                  <div>
                    <Label className="text-xs">Outcome</Label>
                    <Select value={logFilters.successOnly} onValueChange={(v) => setLogFilters((f) => ({ ...f, successOnly: v }))}>
                      <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="success">Success</SelectItem>
                        <SelectItem value="error">Error</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-[70vh]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Endpoint</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>intuit_tid</TableHead>
                      <TableHead>Env</TableHead>
                      <TableHead>Realm</TableHead>
                      <TableHead>Dur</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLogs.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="text-xs whitespace-nowrap">{formatDistanceToNow(new Date(l.created_at), { addSuffix: true })}</TableCell>
                        <TableCell className="text-xs font-mono">{l.action}</TableCell>
                        <TableCell className="text-xs">{l.method ?? "—"}</TableCell>
                        <TableCell className="text-xs font-mono max-w-[260px] truncate">{l.endpoint ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant={l.success ? "default" : "destructive"} className={l.success ? "bg-emerald-600 hover:bg-emerald-600" : ""}>
                            {l.http_status ?? "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-mono">{l.intuit_tid ?? "—"}</TableCell>
                        <TableCell className="text-xs">{l.oauth_app_env ?? "—"}</TableCell>
                        <TableCell className="text-xs font-mono">{l.realm_id ?? "—"}</TableCell>
                        <TableCell className="text-xs">{l.duration_ms != null ? `${l.duration_ms}ms` : "—"}</TableCell>
                        <TableCell className="text-xs text-destructive max-w-[260px] truncate">{l.error_message ?? ""}</TableCell>
                      </TableRow>
                    ))}
                    {filteredLogs.length === 0 && (
                      <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground">No log rows match filters.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Error Tests tab ---- */}
        <TabsContent value="error-tests">
          <Card>
            <CardHeader>
              <CardTitle>Error handling test guidance</CardTitle>
              <CardDescription>Use a sandbox connection to deliberately trigger each error, then record the result on the OAuth Tests tab.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ol className="list-decimal pl-6 space-y-2">
                <li><strong>Validation error</strong>: send an invoice with missing required fields (e.g., empty CustomerRef) via Settings → QuickBooks → invoice tools against the sandbox realm. Confirm an error row appears in <em>API Logs</em> with intuit_tid + http_status 400/4xx. Record as <code>validation_error / passed</code>.</li>
                <li><strong>Missing-field error</strong>: same as above but omit Line items. Same evidence and record.</li>
                <li><strong>Expired-token simulation</strong>: in sandbox, manually shorten the token TTL or wait for natural expiry. Trigger a fetch — the wrapper should refresh and retry transparently. Record as <code>token_refresh / passed</code>.</li>
                <li><strong>Invalid_grant</strong>: revoke the sandbox connection from Intuit's My Apps page, then call refresh. Connection should flip to <code>is_active=false</code>, <code>metadata.reauth_required=true</code>. Record as <code>invalid_grant / passed</code>.</li>
                <li><strong>Webhook signature</strong>: post a fabricated payload with an intentionally wrong HMAC to the webhook endpoint. Expect a non-2xx and no DB writes. Record as <code>webhook_signature / passed</code>.</li>
              </ol>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Security tab ---- */}
        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle>Security checklist</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Control</TableHead><TableHead>Status</TableHead><TableHead>Notes</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow><TableCell>QBO client secret not in repo</TableCell><TableCell><StatusBadge status="pass" /></TableCell><TableCell className="text-xs">Secrets read from Deno.env only via qbo-context.ts.</TableCell></TableRow>
                  <TableRow><TableCell>QBO client ID not bundled in frontend</TableCell><TableCell><StatusBadge status="pass" /></TableCell><TableCell className="text-xs">No VITE_QBO_* keys; OAuth authorize URL is built server-side.</TableCell></TableRow>
                  <TableRow><TableCell>Tokens never logged</TableCell><TableCell><StatusBadge status="pass" /></TableCell><TableCell className="text-xs">qbo-api.ts stripTokenKeys() filters; qbo_api_logs has no token columns.</TableCell></TableRow>
                  <TableRow><TableCell>OAuth callback is server-side 302 only</TableCell><TableCell><StatusBadge status="pass" /></TableCell><TableCell className="text-xs">qbo-oauth-connect GET /callback returns 302 to /settings/integrations.</TableCell></TableRow>
                  <TableRow><TableCell>OAuth state table + single-use</TableCell><TableCell><StatusBadge status="pass" /></TableCell><TableCell className="text-xs">qbo_oauth_state row deleted after callback validates state.</TableCell></TableRow>
                  <TableRow><TableCell>Webhook verifier env split (dev/prod)</TableCell><TableCell><StatusBadge status="pass" /></TableCell><TableCell className="text-xs">qbo-context.ts → qboWebhookVerifiers; both validated and the winning one tags webhook_mode.</TableCell></TableRow>
                  <TableRow><TableCell>intuit_tid captured + logged</TableCell><TableCell><StatusBadge status={hasIntuitTidEvidence ? "pass" : "warn"} /></TableCell><TableCell className="text-xs">{logs.filter((l) => !!l.intuit_tid).length}/{totalLogs} log rows carry intuit_tid.</TableCell></TableRow>
                  <TableRow><TableCell>qbo_api_logs table exists</TableCell><TableCell><StatusBadge status="pass" /></TableCell><TableCell className="text-xs">public.qbo_api_logs with RLS scoped to master + tenant owner/admin.</TableCell></TableRow>
                  <TableRow><TableCell>Tenant RLS for QBO data</TableCell><TableCell><StatusBadge status="pass" /></TableCell><TableCell className="text-xs">qbo_connections, qbo_entity_mapping, qbo_payment_history, qbo_webhook_events all scoped by tenant_id.</TableCell></TableRow>
                  <TableRow><TableCell>MFA enabled</TableCell><TableCell><StatusBadge status="warn" /></TableCell><TableCell className="text-xs">Enable in Supabase dashboard → Auth → MFA before answering Yes.</TableCell></TableRow>
                  <TableRow><TableCell>CAPTCHA enabled</TableCell><TableCell><StatusBadge status="warn" /></TableCell><TableCell className="text-xs">Enable hCaptcha/Turnstile in Supabase Auth before answering Yes.</TableCell></TableRow>
                  <TableRow><TableCell>WebSocket / Realtime used</TableCell><TableCell><StatusBadge status="pass" /></TableCell><TableCell className="text-xs">Supabase Realtime for CRM updates only; not used for QBO token exchange.</TableCell></TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Legal tab ---- */}
        <TabsContent value="legal">
          <Card>
            <CardHeader>
              <CardTitle>Legal documents</CardTitle>
              <CardDescription>Current versions and QBO integration consent records.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="font-medium mb-2">Current legal documents</h3>
                <Table>
                  <TableHeader><TableRow><TableHead>Key</TableHead><TableHead>Version</TableHead><TableHead>Effective</TableHead><TableHead>Current</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {legalDocs.map((d: any) => (
                      <TableRow key={d.document_key + d.version}>
                        <TableCell className="text-xs font-mono">{d.document_key}</TableCell>
                        <TableCell className="text-xs">{d.version}</TableCell>
                        <TableCell className="text-xs">{d.effective_at ? new Date(d.effective_at).toLocaleDateString() : "—"}</TableCell>
                        <TableCell>{d.is_current ? <Badge>current</Badge> : <Badge variant="outline">historical</Badge>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div>
                <h3 className="font-medium mb-2">QBO integration consents ({consents.length})</h3>
                <Table>
                  <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Tenant</TableHead><TableHead>Version</TableHead><TableHead>Env</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {consents.slice(0, 25).map((c: any) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-xs">{c.accepted_at ? formatDistanceToNow(new Date(c.accepted_at), { addSuffix: true }) : "—"}</TableCell>
                        <TableCell className="text-xs font-mono">{c.tenant_id?.slice(0, 8)}…</TableCell>
                        <TableCell className="text-xs">{c.consent_version}</TableCell>
                        <TableCell className="text-xs">{c.expected_oauth_app_env ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Support tab ---- */}
        <TabsContent value="support">
          <Card>
            <CardHeader>
              <CardTitle>Support contact &amp; data-use statement</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <strong>In-app support:</strong> Settings → QuickBooks → Support card (mailto with tenant_id, realm_id, qbo_company_name and last intuit_tid).
              </div>
              <div>
                <strong>Data use:</strong> PITCH CRM accesses QuickBooks Online Accounting data only after the user authorizes the integration. Data is used to sync customers, items, invoices and payment status. Data is scoped to the customer's tenant via RLS; never sold; never shown to other tenants. Users may disconnect at any time from Settings → QuickBooks.
              </div>
              <div>
                <strong>Active QBO connections in DB:</strong> {connections.length} ({connections.filter((c) => c.is_active).length} active).
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Generate tab ---- */}
        <TabsContent value="generate">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Generated Intuit review answers</CardTitle>
                  <CardDescription>Copy directly into the Intuit reviewer form. Items not Pass are marked DO NOT ANSWER YES YET.</CardDescription>
                </div>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => {
                    navigator.clipboard.writeText(generatedAnswers);
                    toast({ title: "Copied to clipboard" });
                  }}
                >
                  <ClipboardCopy className="h-4 w-4" /> Copy
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Textarea readOnly value={generatedAnswers} className="font-mono text-xs h-[60vh]" />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
