// Full SRS Distribution admin surface stack.
//
// Bundles every SRS surface that was originally built inside the O'Brien
// Contracting tenant sandbox (connection setup + client credentials, sandbox
// pricelist importer, 2026 pricelist backfill, catalog browser, order
// diagnostics with status events + webhooks, reconciliation panel) so
// platform admins can drive every SRS integration surface directly from
// Company Administration → Integrations → SRS Distribution, without switching
// into a specific tenant's Settings page.
//
// All rendered panels are self-contained and resolve tenant via the same
// hooks they used inside the O'Brien testing area (useEffectiveTenantId /
// useCompanySwitcher).

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SRSConnectionSettings } from "@/components/settings/SRSConnectionSettings";
import { SRSPricelistImporter } from "@/components/settings/SRSPricelistImporter";
import { SRSPricelistBackfill } from "@/components/pricing/SRSPricelistBackfill";
import { SRSCatalogBrowser } from "@/components/orders/SRSCatalogBrowser";
import { SrsDiagnosticsPanel } from "@/components/orders/SrsDiagnosticsPanel";
import { SRSReconciliationPanel } from "@/components/orders/SRSReconciliationPanel";
import { SrsIntegrationHealth } from "@/components/admin/SrsIntegrationHealth";
import { SrsProductionReadinessReport } from "@/components/admin/SrsProductionReadinessReport";

export function SrsAdminSurfaces() {
  return (
    <div className="space-y-6">
      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle className="text-base">SRS Distribution — full sandbox surface</CardTitle>
          <CardDescription>
            Every panel below is the same one that was built and validated
            inside the O'Brien Contracting tenant. Connection credentials,
            sandbox pricelist import, 2026 pricelist backfill, catalog
            browser, order diagnostics (status events + webhook feed), and
            order reconciliation all resolve against the currently-active
            tenant.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Connection setup + credentials + environment toggle. This panel
          also embeds its own diagnostics/reconciliation/catalog when a
          connection exists. */}
      <SRSConnectionSettings />

      {/* Sandbox pricelist importer (staged 2026 pricebook + rep info). */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sandbox pricelist import</CardTitle>
          <CardDescription>
            One-click loader for the SRS 2026 sandbox pricebook that O'Brien
            was originally tested against. Populates
            <code className="mx-1">supplier_pricebooks</code> and
            <code className="mx-1">supplier_products</code> for the active
            tenant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SRSPricelistImporter />
        </CardContent>
      </Card>

      {/* Backfill / repair tool for the SRS pricelist tables. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pricelist backfill</CardTitle>
          <CardDescription>
            Backfill and repair tool for the SRS pricelist tables. Same
            workflow used in the O'Brien tenant to reconcile missing or
            stale supplier product rows.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SRSPricelistBackfill />
        </CardContent>
      </Card>

      {/* Live catalog browser — item numbers, descriptions, UOMs. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Catalog & sandbox pricelist</CardTitle>
          <CardDescription>
            Browse the SRS sandbox catalog with the same search/category
            filters that shipped in the O'Brien testing area.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SRSCatalogBrowser />
        </CardContent>
      </Card>

      {/* Order diagnostics — status events + raw webhook payloads. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Order diagnostics & webhook events</CardTitle>
          <CardDescription>
            Every SRS order status event and webhook payload for the active
            tenant. Same panel used to debug order.submit / order.updated
            flows during the O'Brien sandbox rollout.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SrsDiagnosticsPanel />
        </CardContent>
      </Card>

      {/* Order reconciliation — matches SRS orders to internal jobs. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Order reconciliation</CardTitle>
          <CardDescription>
            Reconcile SRS orders against internal material orders and
            projects for the active tenant.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SRSReconciliationPanel />
        </CardContent>
      </Card>
    </div>
  );
}

export default SrsAdminSurfaces;
