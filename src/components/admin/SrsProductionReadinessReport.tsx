// SRS Production Readiness Report
//
// Static checklist mirroring the 11-task production hardening plan.
// Each row shows VERIFIED / PENDING / BLOCKED and a short evidence
// note. "Copy for SRS" exports the report + outstanding questions as
// markdown so the platform team can paste it into the next SRS
// technical review.

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";

type RowStatus = "verified" | "pending" | "blocked";

interface ReportRow {
  key: string;
  label: string;
  status: RowStatus;
  note: string;
}

const ROWS: ReportRow[] = [
  { key: "auth", label: "Authentication", status: "verified", note: "OAuth token exchange (form-urlencoded primary, JSON fallback); token cache + expiration + audit log active." },
  { key: "customer", label: "Customer Validation", status: "verified", note: "customerCode accepted and echoed back on order.updated." },
  { key: "branch", label: "Branch Validation", status: "verified", note: "branchCode accepted; catalog resolves for branch (activeBranchProducts)." },
  { key: "jobacct", label: "Job Account Validation", status: "verified", note: "accountNumber + shipToSequenceNumber accepted on submit." },
  { key: "catalog", label: "Catalog Validation", status: "verified", note: "Product IDs verified against branch catalog before submit; unknown SKUs rejected pre-flight." },
  { key: "pricing", label: "Pricing", status: "pending", note: "Price API request contract (productId vs productNumber, option handling) pending SRS confirmation — see §8.3 Q1/Q2." },
  { key: "submit", label: "Submit Order", status: "verified", note: "Frozen payload contract (§8.1); production path never mutates the payload." },
  { key: "queue", label: "Queue Handling", status: "verified", note: "Queued responses left to srs-order-status-poller + webhook; no auto-resubmit in production." },
  { key: "orderid", label: "Order ID", status: "verified", note: "Real orderID returned on production credentials; queueID===orderID treated as queued, not submitted." },
  { key: "webhook", label: "Webhook", status: "verified", note: "order.updated received and matched by transactionID + PO; dedupe + idempotency + status history intact." },
  { key: "status", label: "Status Updates", status: "verified", note: "srs_order_status_events populated end-to-end from webhook + poller." },
  { key: "delivery", label: "Delivery Documents", status: "verified", note: "Delivery documents imported through the existing webhook attachment path." },
  { key: "invoice", label: "Invoice Processing", status: "verified", note: "Invoice creation wired via webhook events; no functional changes this cycle." },
  { key: "audit", label: "Audit Trail", status: "verified", note: "srs_submit_audit + srs_audit_log capture every submit attempt, response, and error." },
  { key: "retry", label: "Retry Strategy", status: "verified", note: "Network retries reuse the same transactionID; business retries require explicit user action; payload mutation disabled in production." },
  { key: "safety", label: "Production Safety", status: "verified", note: "submit_order_variances + autoSweep gated behind SRS_DEBUG_MODE / tenant_settings.srs_debug_mode / srs_environment='debug'." },
  { key: "questions", label: "Outstanding Questions", status: "pending", note: "5 open contract questions documented in docs/srs-sips-integration-audit.md §8.3 — do NOT change code until answered." },
];

const OUTSTANDING_QUESTIONS = [
  "Confirm /products/v2/price request contract (productId vs productNumber, and whether productName + productOptions are required).",
  "Confirm whether non-color products should send option: \"N/A\" or an empty string.",
  "Confirm transactionID idempotency — safe to re-submit with same transactionID, or does it create a second PO?",
  "Confirm production webhook registration is global to the PITCH sourceSystem, or must be re-registered per customerCode.",
  "Confirm the QA-approved Submit Order payload (with shipToSequenceNumber, no top-level jobAccountNumber, no line-item price) is the authoritative contract for PITCH.",
];

function statusBadge(s: RowStatus) {
  if (s === "verified") return <Badge className="bg-emerald-500 text-white hover:bg-emerald-500/90">VERIFIED</Badge>;
  if (s === "blocked") return <Badge variant="destructive">BLOCKED</Badge>;
  return <Badge variant="secondary">PENDING</Badge>;
}

function buildMarkdown(): string {
  const now = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`# SRS Production Readiness — ${now}`);
  lines.push("");
  lines.push("Generated from Pitch CRM. Verified against QA end-to-end submit → webhook → status pipeline.");
  lines.push("");
  lines.push("| # | Capability | Status | Evidence |");
  lines.push("|---|---|---|---|");
  ROWS.forEach((r, i) => {
    lines.push(`| ${i + 1} | ${r.label} | ${r.status.toUpperCase()} | ${r.note} |`);
  });
  lines.push("");
  lines.push("## Outstanding questions for SRS");
  lines.push("");
  OUTSTANDING_QUESTIONS.forEach((q, i) => {
    lines.push(`${i + 1}. ${q}`);
  });
  lines.push("");
  lines.push("## Frozen Submit Order payload contract");
  lines.push("");
  lines.push("- sourceSystem (constant: PITCH)");
  lines.push("- customerCode");
  lines.push("- accountNumber");
  lines.push("- branchCode");
  lines.push("- shipToSequenceNumber");
  lines.push("- transactionID (persisted, reused on network retries, never regenerated)");
  lines.push("- transactionDate");
  lines.push("- shipTo (no `name` field)");
  lines.push("- poDetails (job:{order_number} prefix)");
  lines.push("- orderLineItemDetails (no `price` — SRS prices server-side)");
  lines.push("- customerContactInfo");
  lines.push("");
  lines.push("Do NOT mutate this payload in the production path. Any change requires explicit SRS confirmation and a fresh QA run.");
  return lines.join("\n");
}

export function SrsProductionReadinessReport() {
  const md = useMemo(buildMarkdown, []);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn("copy failed", e);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">SRS production readiness report</CardTitle>
          <CardDescription>
            Verified capabilities from the QA end-to-end run + outstanding
            contract questions for the next SRS technical review.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
          {copied ? "Copied" : "Copy for SRS"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border divide-y">
          {ROWS.map((r, i) => (
            <div key={r.key} className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-6 shrink-0">{i + 1}.</span>
                  <span className="font-medium text-sm">{r.label}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 ml-8">{r.note}</p>
              </div>
              <div className="shrink-0">{statusBadge(r.status)}</div>
            </div>
          ))}
        </div>

        <div>
          <h4 className="text-sm font-semibold mb-2">Outstanding questions for SRS</h4>
          <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
            {OUTSTANDING_QUESTIONS.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}

export default SrsProductionReadinessReport;
