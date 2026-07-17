import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AIMeasurementProgramCards() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>PITCH AI Measurement — Full Program</CardTitle>
          <CardDescription>
            End-to-end vision of the measurement product replacing EagleView / Hover / Roofr for PITCH tenants.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <h4 className="font-semibold text-foreground mb-1">Mission</h4>
            <p className="text-muted-foreground">
              Produce a customer-ready roof measurement report (area, perimeter, ridges, hips, valleys, eaves,
              rakes, pitch, facet count, waste factor, 3D preview) directly from an aerial + DSM pipeline — at
              98%+ agreement with EagleView / Roofr baselines — with zero vendor cost per report at runtime.
            </p>
          </div>

          <div>
            <h4 className="font-semibold text-foreground mb-1">Canonical workflow</h4>
            <ol className="list-decimal ml-5 space-y-1 text-muted-foreground">
              <li>Confirmed roof target (user PIN placement, Rule 1).</li>
              <li>Source acquisition — Google Solar DSM/mask/RGB, Microsoft Footprints, OSM, parcel fallback.</li>
              <li>Target roof mask isolation (component-scoped, not global mask).</li>
              <li>Layer 1 — true outer roof perimeter with eave/rake classification.</li>
              <li>Conservative refinement + region-based tree/patio/shadow exclusion.</li>
              <li>DSM/Solar structural evidence preservation (deferred candidates).</li>
              <li>Backbone-first topology — ridges → valleys → local hips.</li>
              <li>Typed <code>roof_lines</code> emission (only source of totals).</li>
              <li>Pitch validation with Solar fallback when topology is weak.</li>
              <li>Vendor benchmark + 6-contract gate → <code>customer_report_ready</code>.</li>
            </ol>
          </div>

          <div>
            <h4 className="font-semibold text-foreground mb-1">Hard architectural contracts</h4>
            <ul className="list-disc ml-5 space-y-1 text-muted-foreground">
              <li>Authoritative footprint (source tier logged).</li>
              <li>Coordinate-space truth — solver runs in DSM px, persists both <code>geometry_dsm_px</code> and <code>geometry_geo</code>.</li>
              <li>Shared edges, no dangling vertices.</li>
              <li>Area conservation 0.95–1.05 vs footprint.</li>
              <li>Overlay registration: rms≤4px, max_error≤8px, IoU≥0.85, coverage≥0.85.</li>
              <li>Debug metrics + phase provenance persisted on every run (never null without <code>skipped_reason</code>).</li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-foreground mb-1">Failure model</h4>
            <p className="text-muted-foreground">
              Every failed run persists a diagnostic overlay and a stage-specific <code>hard_fail_reason</code>.{" "}
              <code>result_state</code> is one of 10 canonical buckets normalized through{" "}
              <code>normalizeResultStateForWrite()</code>. No customer report is ever rendered for a failed
              pipeline — the perimeter debug overlay is shown in its place.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current AI Measurement Buildout</CardTitle>
          <CardDescription>What is shipped today vs. what is next on the roadmap.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <h4 className="font-semibold text-foreground mb-1">Shipped (production paths)</h4>
            <ul className="list-disc ml-5 space-y-1 text-muted-foreground">
              <li>Canonical entrypoint: <code>start-ai-measurement</code> edge function with Rule 1 target confirmation (HTTP 412 on unconfirmed).</li>
              <li>Vendor-free evidence cascade: OSM → MS Footprints → Parcel → Solar/UNet, with <code>evidence_sources_used</code> + <code>footprint_source_tier</code> logged.</li>
              <li>Footprint-DSM coordinate gate + footprint sanity gates (&gt;8000 sqft / &gt;35% tile / &gt;2.5× solar rejected).</li>
              <li>Pre-masked DSM edge detection (v8) constrained to footprint mask before topology.</li>
              <li>Structural hierarchy clustering (v11) — primary/secondary/tertiary edge tiers.</li>
              <li>Evidence-driven topology refinement (v15) — second pass reintroducing lost DSM edges.</li>
              <li>Perimeter-first contract (Phase 0) — eave/rake classification independent of ridge success.</li>
              <li>Backbone-first topology v18 — ridge/valley chains → local assemblies → derived hips; cross-roof diagonal suppression.</li>
              <li>Constraint roof solver v19 — reverse-solve from Solar priors when autonomous score &lt; 0.60.</li>
              <li>Ridge vs hip classifier using along-edge elevation gradient.</li>
              <li>Vendor benchmark comparison gate blocking <code>customer_report_ready</code> on &gt;25% facet / &gt;1-pitch / &gt;25% ridge-hip-valley deltas.</li>
              <li>Six architectural contracts enforced by <code>dsm-geometry-contract.ts</code>.</li>
              <li>Result-state normalizer + <code>assertCustomerReportReady()</code> guard.</li>
              <li>Perimeter debug overlay renders in place of blank reports on failure.</li>
              <li>Manual perimeter editor with snap-to-aerial-edge and canonical rerun.</li>
              <li>Regression harness — Fonsica, Montelluna, Palm Harbor baselines.</li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-foreground mb-1">In progress</h4>
            <ul className="list-disc ml-5 space-y-1 text-muted-foreground">
              <li>Closing the Fonsica topology fidelity gap (target 14 facets, ridge/valley LF within 25%).</li>
              <li>Patent Rules 2–5 override write-back via <code>recalculate-measurement-from-overrides</code>.</li>
              <li>Report PDF diagram parity — aerial-first overlay export.</li>
              <li>Per-tenant enablement wiring off the <em>measurements</em> feature flag.</li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-foreground mb-1">Not built / do not enable</h4>
            <ul className="list-disc ml-5 space-y-1 text-muted-foreground">
              <li>RoofNetV3 UNet has no trained model or inference server — geometry engine is the only active system.</li>
              <li>No vendor-report ingestion at runtime (EagleView/Roofr/Hover are offline-audit only).</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
