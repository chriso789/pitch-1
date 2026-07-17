import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, XCircle, ClipboardCheck } from "lucide-react";
import type { ReactNode } from "react";

type Status = "shipped" | "in_progress" | "not_built";

interface ChecklistItem {
  label: ReactNode;
  status: Status;
  verify?: string; // What to look for in the UI after a test run to confirm this is accurate
}

const STATUS_META: Record<Status, { icon: ReactNode; label: string; className: string }> = {
  shipped: {
    icon: <CheckCircle2 className="h-4 w-4 text-green-600" />,
    label: "Shipped",
    className: "bg-green-500/10 text-green-700 border-green-500/30",
  },
  in_progress: {
    icon: <Clock className="h-4 w-4 text-amber-600" />,
    label: "In progress",
    className: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  },
  not_built: {
    icon: <XCircle className="h-4 w-4 text-muted-foreground" />,
    label: "Not built",
    className: "bg-muted text-muted-foreground border-border",
  },
};

function Section({ title, items }: { title: string; items: ChecklistItem[] }) {
  return (
    <div>
      <h4 className="font-semibold text-foreground mb-2">{title}</h4>
      <ul className="space-y-2">
        {items.map((item, i) => {
          const meta = STATUS_META[item.status];
          return (
            <li
              key={i}
              className="flex items-start gap-3 p-3 rounded-md border bg-card/50"
            >
              <div className="mt-0.5">{meta.icon}</div>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="text-sm text-foreground">{item.label}</div>
                  <Badge variant="outline" className={`text-[10px] ${meta.className}`}>
                    {meta.label}
                  </Badge>
                </div>
                {item.verify && (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">UI check:</span> {item.verify}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function AIMeasurementProgramCards() {
  const canonicalWorkflow: ChecklistItem[] = [
    { label: <>Confirmed roof target (user PIN placement, Rule 1)</>, status: "shipped", verify: "Test panel requires Google-verified address before Run enables." },
    { label: <>Source acquisition — Google Solar DSM/mask/RGB, Microsoft Footprints, OSM, parcel fallback</>, status: "shipped", verify: "Debug Details lists evidence_sources_used + footprint_source_tier." },
    { label: <>Target roof mask isolation (component-scoped, not global mask)</>, status: "shipped", verify: "Full report overlay shows target mask fill, not global building bbox." },
    { label: <>Layer 1 — true outer roof perimeter with eave/rake classification</>, status: "shipped", verify: "Eave and Rake linear feet populated (not 0) in results card." },
    { label: <>Conservative refinement + region-based tree/patio/shadow exclusion</>, status: "shipped", verify: "Overlay shows raw (gray) vs refined (green) perimeters distinctly." },
    { label: <>DSM/Solar structural evidence preservation (deferred candidates)</>, status: "shipped", verify: "deferred_structural_candidates present in geometry_report_json." },
    { label: <>Backbone-first topology — ridges → valleys → local hips</>, status: "in_progress", verify: "Fonsica: ridge_lf > 0 AND valley_lf > 0 on complex hip. Currently valley=0." },
    { label: <>Typed roof_lines emission (only source of totals)</>, status: "shipped", verify: "Totals in report match sum of typed roof_lines by attribute." },
    { label: <>Pitch validation with Solar fallback when topology is weak</>, status: "shipped", verify: "pitch_source displayed in debug when Solar fallback engages." },
    { label: <>Vendor benchmark + 6-contract gate → customer_report_ready</>, status: "shipped", verify: "customer_report_ready=false while facets/ridge deltas exceed thresholds." },
  ];

  const contracts: ChecklistItem[] = [
    { label: <>Authoritative footprint (source tier logged)</>, status: "shipped", verify: "footprint_source_tier appears in Debug Details." },
    { label: <>Coordinate-space truth — solver in DSM px, persists geometry_dsm_px + geometry_geo</>, status: "shipped" },
    { label: <>Shared edges, no dangling vertices</>, status: "shipped" },
    { label: <>Area conservation 0.95–1.05 vs footprint</>, status: "shipped", verify: "Fonsica delta banner shows Solar footprint delta ≤ 5%." },
    { label: <>Overlay registration rms≤4px, max_error≤8px, IoU≥0.85, coverage≥0.85</>, status: "shipped" },
    { label: <>Debug metrics + phase provenance persisted every run</>, status: "shipped", verify: "phase3_5 / phase3C / phase3D / phase3E blocks populated in report." },
  ];

  const shipped: ChecklistItem[] = [
    { label: <>Canonical entrypoint: <code>start-ai-measurement</code> with Rule 1 (HTTP 412 unconfirmed)</>, status: "shipped" },
    { label: <>Vendor-free evidence cascade OSM → MS Footprints → Parcel → Solar/UNet</>, status: "shipped" },
    { label: <>Footprint-DSM coordinate gate + sanity gates (&gt;8000 sqft / &gt;35% tile / &gt;2.5× solar rejected)</>, status: "shipped" },
    { label: <>Pre-masked DSM edge detection (v8) constrained to footprint mask</>, status: "shipped" },
    { label: <>Structural hierarchy clustering (v11) — primary/secondary/tertiary tiers</>, status: "shipped" },
    { label: <>Evidence-driven topology refinement (v15)</>, status: "shipped" },
    { label: <>Perimeter-first contract (Phase 0) — eave/rake independent of ridge</>, status: "shipped" },
    { label: <>Backbone-first topology v18 + cross-roof diagonal suppression</>, status: "shipped" },
    { label: <>Constraint roof solver v19 (reverse-solve from Solar priors)</>, status: "shipped" },
    { label: <>Ridge vs hip classifier via along-edge elevation gradient</>, status: "shipped" },
    { label: <>Vendor benchmark comparison gate (offline-audit only)</>, status: "shipped" },
    { label: <>Result-state normalizer + <code>assertCustomerReportReady()</code> guard</>, status: "shipped" },
    { label: <>Perimeter debug overlay renders in place of blank reports on failure</>, status: "shipped" },
    { label: <>Manual perimeter editor with snap-to-aerial-edge + canonical rerun</>, status: "shipped" },
    { label: <>Regression harness — Fonsica, Montelluna, Palm Harbor baselines</>, status: "shipped" },
    { label: <>Google Places autocomplete address verification in test panel</>, status: "shipped", verify: '"Verified via Google" banner appears before Run enables.' },
    { label: <>Open Full Measurement Report from test results (aerial + overlays)</>, status: "shipped", verify: "Blue button opens dialog showing aerial + perimeter overlay layers." },
  ];

  const inProgress: ChecklistItem[] = [
    { label: <>Closing Fonsica topology fidelity gap (target 14 facets, ridge/valley LF within 25%)</>, status: "in_progress", verify: "Currently ~10 facets, valley=0. Target ≥12 facets and valley_lf &gt; 0." },
    { label: <>Patent Rules 2–5 override write-back via <code>recalculate-measurement-from-overrides</code></>, status: "in_progress" },
    { label: <>Report PDF diagram parity — aerial-first overlay export</>, status: "in_progress" },
    { label: <>Per-tenant enablement wiring off <em>measurements</em> feature flag</>, status: "in_progress" },
  ];

  const notBuilt: ChecklistItem[] = [
    { label: <>RoofNetV3 UNet — no trained model or inference server</>, status: "not_built" },
    { label: <>Vendor-report ingestion at runtime (EagleView/Roofr/Hover are offline-audit only)</>, status: "not_built" },
    { label: <>Internal Python compute-plane worker (real point-cloud → roof geometry)</>, status: "not_built" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5" />
          AI Measurement Program — Verification Checklist
        </CardTitle>
        <CardDescription>
          Run the test above, then use this checklist to confirm the report and overlays reflect every shipped contract.
          Any row that fails its <span className="font-medium">UI check</span> is a regression to log with the developers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 text-sm">
        <div>
          <h4 className="font-semibold text-foreground mb-1">Mission</h4>
          <p className="text-muted-foreground">
            Produce a customer-ready roof measurement report (area, perimeter, ridges, hips, valleys, eaves,
            rakes, pitch, facet count, waste factor, 3D preview) directly from an aerial + DSM pipeline — at
            98%+ agreement with EagleView / Roofr baselines — with zero vendor cost per report at runtime.
          </p>
        </div>

        <Section title="Canonical workflow (10 steps)" items={canonicalWorkflow} />
        <Section title="Hard architectural contracts (6 gates)" items={contracts} />
        <Section title="Shipped production paths" items={shipped} />
        <Section title="In progress" items={inProgress} />
        <Section title="Not built / do not enable" items={notBuilt} />

        <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Failure model:</span> Every failed run persists a diagnostic
          overlay and a stage-specific <code>hard_fail_reason</code>. <code>result_state</code> is one of 10 canonical
          buckets normalized through <code>normalizeResultStateForWrite()</code>. No customer report is ever rendered
          for a failed pipeline — the perimeter debug overlay is shown in its place.
        </div>
      </CardContent>
    </Card>
  );
}
