#!/usr/bin/env -S deno run -A
/**
 * Edge Function Consolidation Audit
 *
 * Walks supabase/functions/* and greps the repo for every reference.
 * Outputs:
 *   - docs/edge-function-consolidation-audit.csv
 *   - docs/EDGE_FUNCTION_CONSOLIDATION_AUDIT.md
 *
 * Run: bunx tsx scripts/audit-edge-functions.ts  (or: deno run -A scripts/audit-edge-functions.ts)
 */
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const FN_DIR = join(ROOT, "supabase/functions");

// ---- collect function names ----
const fnNames = readdirSync(FN_DIR)
  .filter((n) => !n.startsWith("_") && !n.startsWith("."))
  .filter((n) => {
    try { return statSync(join(FN_DIR, n)).isDirectory(); } catch { return false; }
  });

// ---- walk repo for text files ----
const IGNORE = new Set(["node_modules", ".git", "dist", "build", ".lovable", ".next", ".turbo", "coverage", "playwright-report"]);
const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|mdx|yaml|yml|toml|sql|html|css|sh)$/i;
const files: string[] = [];
(function walk(dir: string) {
  for (const ent of readdirSync(dir)) {
    if (IGNORE.has(ent)) continue;
    const p = join(dir, ent);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) walk(p);
    else if (TEXT_EXT.test(ent)) files.push(p);
  }
})(ROOT);

// pre-read all files once
const fileCache = new Map<string, string>();
for (const f of files) {
  try { fileCache.set(f, readFileSync(f, "utf8")); } catch { /* ignore */ }
}

// ---- classification ----
type Category =
  | "messaging" | "email" | "telnyx" | "voice"
  | "measurement" | "roof-report-ingest" | "training-data"
  | "supplier" | "qbo" | "qxo" | "srs" | "abc"
  | "document" | "pdf" | "signature" | "report-packet"
  | "canvass" | "property-data" | "permit" | "storm" | "map"
  | "ai"
  | "payment" | "stripe"
  | "admin" | "auth" | "company" | "user" | "contact" | "job" | "pipeline" | "task"
  | "analytics" | "security" | "backup" | "health" | "webhook" | "other";

function classify(name: string): { category: Category; recFn: string; recRoute: string } {
  const n = name.toLowerCase();
  const map = (category: Category, recFn: string, recRoute: string) => ({ category, recFn, recRoute });
  const route = "/" + name.replace(/^[a-z]+-/, "");

  // explicit migration map snippets (subset; everything else falls into domain default)
  if (/^send-sms$|messaging-send-sms|sms-send-reply/.test(n)) return map("messaging", "messaging-api", "/sms/send");
  if (/sms-blast/.test(n)) return map("messaging", "messaging-worker", "/sms/blast/process");
  if (/sms-auto-responder/.test(n)) return map("messaging", "messaging-worker", "/sms/auto-responder");
  if (/sms-conversation-ai/.test(n)) return map("messaging", "messaging-api", "/sms/conversation-ai");
  if (/messaging-inbound-webhook/.test(n)) return map("messaging", "messaging-webhook", "/generic/inbound");
  if (/^telnyx-/.test(n) && /webhook/.test(n)) return map("telnyx", "telnyx-webhook", route);
  if (/^telnyx-send-sms$/.test(n)) return map("telnyx", "telnyx-api", "/sms/send");
  if (/^telnyx-dial$/.test(n)) return map("telnyx", "telnyx-api", "/call/dial");
  if (/^telnyx-/.test(n)) return map("telnyx", "telnyx-api", route);

  if (/email-sequence/.test(n)) return map("email", "email-worker", "/sequence/process");
  if (/^send-email$|^email-send$|messaging-send-email/.test(n)) return map("email", "email-api", "/send");
  if (/email|invitation|unsubscribe|suppression|onboarding|demo-request|quote-email|labor-order-send|material-order-send-email/.test(n)) return map("email", "email-api", route);

  if (/measurement|measure|remeasure|calibration|accuracy|benchmark|perimeter|footprint/.test(n) && !/roof-report/.test(n)) {
    if (/worker|batch|learning-loop|auto-generate/.test(n)) return map("measurement", "measurement-worker", route);
    return map("measurement", "measurement-api", route);
  }
  if (/roof-report|roof-segmentation|trace-roof|roof-obstruction|roof-overlay|roofr-style/.test(n)) return map("roof-report-ingest", "roof-report-ingest", route);
  if (/training/.test(n) || /unet/.test(n)) return map("training-data", "training-data-api", route);

  if (/^qxo-|qxo-/.test(n)) {
    if (/sync-orchestrator/.test(n)) return map("supplier", "supplier-worker", "/qxo/sync");
    return map("supplier", "supplier-api", "/qxo" + route);
  }
  if (/^srs-/.test(n)) {
    if (/importer|refresh-scheduler|status-poller/.test(n)) return map("supplier", "supplier-worker", "/srs" + route);
    return map("supplier", "supplier-api", "/srs" + route);
  }
  if (/^abc-/.test(n)) return map("supplier", "supplier-api", "/abc" + route);
  if (/billtrust|sunniland|supplier|material-pricing|price-list|parse-supplier|create-material-order|material-order-processor|material-fulfillment/.test(n)) {
    if (/worker|importer|processor/.test(n)) return map("supplier", "supplier-worker", route);
    return map("supplier", "supplier-api", route);
  }

  if (/^qbo-.*webhook/.test(n)) return map("qbo", "qbo-webhook", "/events");
  if (/^qbo-/.test(n)) return map("qbo", "qbo-api", route);

  if (/docusign.*webhook/.test(n)) return map("signature", "signature-webhook", "/docusign");
  if (/docusign|signature|signer-open|notify-signature/.test(n)) return map("signature", "signature-api", route);

  if (/report-packet/.test(n)) return map("report-packet", "report-packet-api", route);
  if (/^pdf-/.test(n)) return map("pdf", "pdf-api", route);
  if (/document|render-liquid|render-tagged-pdf|smart-docs|merge-document-tags/.test(n)) return map("document", "document-api", route);

  if (/^canvass-|^canvassiq-/.test(n)) {
    if (/canvassiq|skip-trace|property-enrich/.test(n)) return map("property-data", "property-data-api", route);
    return map("canvass", "canvass-api", route);
  }
  if (/skip-trace|property-enrich/.test(n)) return map("property-data", "property-data-api", route);
  if (/permit/.test(n)) return map("permit", "permit-api", route);
  if (/storm|noaa|weather/.test(n)) return map("storm", "storm-api", route);
  if (/mapbox|google-maps|google-address|satellite-tile|map-/.test(n)) return map("map", "map-api", route);

  if (/^ai-|ai-agent|ai-worker|crm-ai-agent|homeowner-ai-chat/.test(n)) {
    if (/worker|dispatch|runner|processor/.test(n)) return map("ai", "ai-worker", route);
    return map("ai", "ai-api", route);
  }

  if (/stripe.*webhook/.test(n)) return map("stripe", "stripe-webhook", "/events");
  if (/stripe-sync/.test(n)) return map("stripe", "stripe-worker", route);
  if (/stripe|zelle/.test(n)) return map("payment", "payment-api", route);

  if (/^admin-/.test(n)) return map("admin", "admin-api", route);
  if (/^auth-|setup-token|view-token|mobile-session/.test(n)) return map("auth", "auth-api", route);
  if (/initialize-company|provision-tenant|create-company-user/.test(n)) return map("company", "company-api", route);
  if (/initialize-user-context|sync-user-email|sync-user-metadata|register-mobile-device/.test(n)) return map("user", "user-api", route);
  if (/contact/.test(n)) return map("contact", "contact-api", route);
  if (/^job-|approve-job|job-/.test(n)) return map("job", "job-api", route);
  if (/pipeline/.test(n)) return map("pipeline", "pipeline-api", route);
  if (/^task-|assign-contact-task/.test(n)) return map("task", "task-api", route);
  if (/analytics/.test(n)) return map("analytics", "analytics-api", route);
  if (/security/.test(n)) return map("security", "security-api", route);
  if (/backup/.test(n)) return map("backup", "backup-api", route);
  if (/health/.test(n)) return map("health", "health-api", route);
  if (/webhook|inbound|oauth-callback/.test(n)) return map("webhook", "webhook-api", route);

  return map("other", "TBD", route);
}

function isPublicWebhook(name: string) {
  return /(webhook|inbound|oauth-callback|asterisk)/i.test(name);
}

function riskLevel(name: string, isWebhook: boolean, refs: { be: number }) {
  if (isWebhook) return "HIGH";
  if (/stripe|payment|auth|admin|password|oauth/i.test(name)) return "HIGH";
  if (/worker|cron|batch|measurement|messaging|telnyx/i.test(name)) return "MEDIUM";
  if (refs.be > 0) return "MEDIUM";
  return "LOW";
}

// ---- reference scanning ----
type Refs = {
  fe: Set<string>;
  be: Set<string>;
  docs: Set<string>;
};

const refsByFn = new Map<string, Refs>();
for (const fn of fnNames) refsByFn.set(fn, { fe: new Set(), be: new Set(), docs: new Set() });

const fnNameSet = new Set(fnNames);

for (const [path, content] of fileCache) {
  const rel = relative(ROOT, path);
  const isBackend = rel.startsWith("supabase/functions/");
  const isDocs = /\.(md|mdx)$/i.test(path) || rel.startsWith("docs/");
  const isFrontend = !isBackend && !isDocs && rel.startsWith("src/");

  // invoke / fetch references — single regex pass, then dedupe by fn name
  const patterns = [
    /functions\.invoke\(\s*[`'"]([a-z0-9_-]+)[`'"]/g,
    /\/functions\/v1\/([a-z0-9_-]+)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const name = m[1];
      if (!fnNameSet.has(name)) continue;
      const refs = refsByFn.get(name)!;
      if (isBackend) refs.be.add(rel);
      else if (isFrontend) refs.fe.add(rel);
      else if (isDocs) refs.docs.add(rel);
    }
  }

  // docs-only literal mention (for functions never invoked but mentioned by name)
  if (isDocs) {
    for (const name of fnNames) {
      if (content.includes(name)) refsByFn.get(name)!.docs.add(rel);
    }
  }
}

// ---- emit CSV ----
const csvCols = [
  "old_function_name",
  "exists_in_supabase_functions_folder",
  "referenced_by_frontend",
  "referenced_by_backend",
  "referenced_by_docs_only",
  "reference_files",
  "category",
  "risk_level",
  "is_public_webhook",
  "recommended_new_function",
  "recommended_new_route",
  "migration_status",
  "notes",
];

const rows: string[][] = [];
const counts: Record<string, number> = {};

for (const fn of fnNames.sort()) {
  const r = refsByFn.get(fn)!;
  const c = classify(fn);
  const webhook = isPublicWebhook(fn);
  const risk = riskLevel(fn, webhook, { be: r.be.size });
  const allRefs = [...r.fe, ...r.be, ...r.docs];
  const refsTrimmed = allRefs.slice(0, 8).join("|");

  let status = "UNKNOWN";
  if (webhook) status = "KEEP";
  else if (r.fe.size === 0 && r.be.size === 0 && r.docs.size === 0) status = "DELETE_CANDIDATE";
  else if (r.fe.size > 0 || r.be.size > 0) status = "MIGRATE";
  else if (r.docs.size > 0) status = "SHIM";

  counts[c.category] = (counts[c.category] || 0) + 1;

  rows.push([
    fn,
    "true",
    String(r.fe.size > 0),
    String(r.be.size > 0),
    String(r.fe.size === 0 && r.be.size === 0 && r.docs.size > 0),
    refsTrimmed,
    c.category,
    risk,
    String(webhook),
    c.recFn,
    c.recRoute,
    status,
    "",
  ]);
}

function csvEscape(v: string) {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

const csv = [csvCols.join(",")]
  .concat(rows.map((r) => r.map(csvEscape).join(",")))
  .join("\n");

writeFileSync(join(ROOT, "docs/edge-function-consolidation-audit.csv"), csv + "\n");

// ---- emit MD summary ----
const total = fnNames.length;
const byStatus = rows.reduce<Record<string, number>>((acc, r) => {
  acc[r[11]] = (acc[r[11]] || 0) + 1; return acc;
}, {});
const byRisk = rows.reduce<Record<string, number>>((acc, r) => {
  acc[r[7]] = (acc[r[7]] || 0) + 1; return acc;
}, {});

const md = `# Edge Function Consolidation Audit

Generated: ${new Date().toISOString()}
Total functions: **${total}**

## By status
${Object.entries(byStatus).sort().map(([k, v]) => `- ${k}: ${v}`).join("\n")}

## By risk
${Object.entries(byRisk).sort().map(([k, v]) => `- ${k}: ${v}`).join("\n")}

## By category (target consolidation domain)
${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

## Public webhooks (DO NOT DELETE without provider URL update)
${rows.filter((r) => r[8] === "true").map((r) => `- \`${r[0]}\` → ${r[9]}${r[10]}`).join("\n")}

## Delete candidates (zero references)
${rows.filter((r) => r[11] === "DELETE_CANDIDATE").map((r) => `- \`${r[0]}\``).join("\n") || "_none_"}

Full per-function breakdown: \`docs/edge-function-consolidation-audit.csv\`
`;

writeFileSync(join(ROOT, "docs/EDGE_FUNCTION_CONSOLIDATION_AUDIT.md"), md);

// ---- emit current-status.md (live counts requested by the consolidation plan) ----
const GROUPED_SUFFIX = /-(api|worker|webhook)$/;
const groupedFns = fnNames.filter((n) => GROUPED_SUFFIX.test(n));

// A "shim" is a legacy function whose index.ts imports _shared/shim.ts
let shimmedFns: string[] = [];
let realGroupedFns: string[] = [];
let scaffoldOnlyGrouped: string[] = [];
for (const fn of fnNames) {
  const idx = join(FN_DIR, fn, "index.ts");
  if (!existsSync(idx)) continue;
  const src = fileCache.get(idx) ?? "";
  if (/_shared\/shim\.ts/.test(src) && /forward\s*\(/.test(src)) {
    shimmedFns.push(fn);
  } else if (GROUPED_SUFFIX.test(fn)) {
    if (/not_migrated/.test(src) && src.length < 4000) scaffoldOnlyGrouped.push(fn);
    else realGroupedFns.push(fn);
  }
}

const deleteCandidates = rows.filter((r) => r[11] === "DELETE_CANDIDATE").map((r) => r[0]);
const publicWebhooks = rows.filter((r) => r[8] === "true").map((r) => r[0]);
const migrateRows = rows.filter((r) => r[11] === "MIGRATE");
const tbdMigrateRows = migrateRows.filter((r) => r[9] === "TBD");

// Frontend call sites still pointing to OLD function names (anything not a grouped fn or KEEP webhook).
const keepSet = new Set(publicWebhooks);
const groupedSet = new Set(groupedFns);
const oldRefsFromFE: { fn: string; files: string[] }[] = [];
for (const fn of fnNames) {
  if (groupedSet.has(fn) || keepSet.has(fn)) continue;
  const r = refsByFn.get(fn)!;
  if (r.fe.size > 0) oldRefsFromFE.push({ fn, files: [...r.fe] });
}

const statusMd = `# Edge Function Consolidation — Current Status

Generated: ${new Date().toISOString()}

## Live counts

| Metric | Count |
|---|---:|
| Function folders (excluding \`_shared\`) | **${total}** |
| Grouped routed functions (\`*-api\` / \`*-worker\` / \`*-webhook\`) | **${groupedFns.length}** |
| ↳ with real routes wired | **${realGroupedFns.length}** |
| ↳ scaffold-only (501 not_migrated) | **${scaffoldOnlyGrouped.length}** |
| Legacy shim functions (index.ts forwards via \`_shared/shim.ts\`) | **${shimmedFns.length}** |
| MIGRATE rows in audit CSV | **${migrateRows.length}** |
| ↳ still classified \`TBD\` (need manual target) | **${tbdMigrateRows.length}** |
| DELETE_CANDIDATE rows (zero references) | **${deleteCandidates.length}** |
| Public webhook functions that MUST stay (KEEP) | **${publicWebhooks.length}** |
| Frontend call sites still pointing to OLD function names | **${oldRefsFromFE.length}** |

## Scaffold-only grouped functions (need logic ported in)

${scaffoldOnlyGrouped.map((n) => `- \`${n}\``).join("\n") || "_none — every grouped function has real routes_"}

## Grouped functions with real routes

${realGroupedFns.map((n) => `- \`${n}\``).join("\n") || "_none yet_"}

## Legacy shim functions (forwarding to grouped APIs)

${shimmedFns.map((n) => `- \`${n}\``).join("\n") || "_none yet — no legacy function has been shimmed_"}

## Public webhooks (do NOT delete — provider dashboard URLs depend on these)

${publicWebhooks.map((n) => `- \`${n}\``).join("\n")}

## Frontend call sites still pointing to old function names

${oldRefsFromFE.length === 0 ? "_none — frontend is fully migrated_" :
  oldRefsFromFE.slice(0, 50).map((o) => `- \`${o.fn}\` — ${o.files.slice(0, 3).join(", ")}${o.files.length > 3 ? ` (+${o.files.length - 3} more)` : ""}`).join("\n")}
${oldRefsFromFE.length > 50 ? `\n_…and ${oldRefsFromFE.length - 50} more — see CSV._` : ""}

## Remaining action plan to get below 150 deployed Supabase functions

Current: **${total}**. Target: **<150**. Gap: **${total - 150}**.

1. **Phase A — Wire routes** (${scaffoldOnlyGrouped.length} grouped functions still stubs). Port logic from the ${migrateRows.length - tbdMigrateRows.length} MIGRATE rows with concrete targets into the matching grouped function. _No change to function count yet._
2. **Phase B — Resolve TBD** (${tbdMigrateRows.length} rows). Classify each into an existing domain or escalate to DELETE_CANDIDATE.
3. **Phase C — Shim legacy** (replace ${migrateRows.length} legacy \`index.ts\` files with \`forward(...)\` calls to their grouped target). _No change to function count yet — shims still occupy folders._
4. **Phase D — Frontend migration**: convert the ${oldRefsFromFE.length} old call sites to call the grouped function + route directly. Once 100% migrated, the shims have zero production traffic.
5. **Phase E — First delete sweep**: delete the ${deleteCandidates.length} DELETE_CANDIDATE folders (zero refs anywhere). Drops count to **~${total - deleteCandidates.length}**.
6. **Phase F — Drop shims**: after edge-function logs show zero shim traffic for 7 days, delete the legacy folders. Drops count by ~${shimmedFns.length || migrateRows.length}.
7. **Phase G — Audit KEEP webhooks**: confirm with provider dashboards which can be consolidated under \`*-webhook\` grouped functions. Worst case all ${publicWebhooks.length} stay.

**Projected end state:** \`${groupedFns.length}\` grouped functions + \`${publicWebhooks.length}\` standalone webhooks ≈ **${groupedFns.length + publicWebhooks.length}** deployed functions — well below 150.

---

Full per-function breakdown: \`docs/edge-function-consolidation-audit.csv\`.
Policy: \`docs/EDGE_FUNCTION_RULES.md\` — **one domain = one edge function with internal routes**.
`;

writeFileSync(join(ROOT, "docs/edge-function-current-status.md"), statusMd);

console.log(`Audit complete: ${total} functions analyzed.`);
console.log(`  CSV:    docs/edge-function-consolidation-audit.csv`);
console.log(`  MD:     docs/EDGE_FUNCTION_CONSOLIDATION_AUDIT.md`);
console.log(`  STATUS: docs/edge-function-current-status.md`);
console.log(`  Grouped: ${groupedFns.length} (real: ${realGroupedFns.length}, scaffold: ${scaffoldOnlyGrouped.length})`);
console.log(`  Shimmed: ${shimmedFns.length}`);
console.log(`  Delete candidates: ${deleteCandidates.length}`);
console.log(`  Public webhooks (KEEP): ${publicWebhooks.length}`);
console.log(`  Frontend still on old names: ${oldRefsFromFE.length}`);

