// Full ABC Supply admin surface stack.
//
// This bundles every ABC surface that was originally built inside the
// O'Brien Contracting tenant sandbox (connection setup, sandbox demo
// workflow, sandbox test console with product search / pricelist / order
// submit / order tracking, catalog browser with live pricing + inventory,
// webhook history, and the order diagnostics timeline) so platform admins
// can drive every ABC integration surface directly from
// Company Administration → Integrations → ABC Supply, without switching
// into a specific tenant's Settings page.
//
// All rendered panels are self-contained and resolve tenant via
// `useEffectiveTenantId()`, matching the exact behavior they had inside
// the O'Brien testing area.

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ABCConnectionSettings } from "@/components/settings/ABCConnectionSettings";
import { AbcDiagnosticsPanel } from "@/components/settings/AbcDiagnosticsPanel";
import { AbcWebhookPanel } from "@/components/settings/abc/AbcWebhookPanel";
import { AbcCatalogBrowser } from "@/components/orders/AbcCatalogBrowser";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { useAbcConnection } from "@/lib/abc/useAbcConnection";

export function AbcAdminSurfaces() {
  const tenantId = useEffectiveTenantId();
  const { connection } = useAbcConnection();
  const environment = (connection?.environment as "sandbox" | "production") ?? "sandbox";

  return (
    <div className="space-y-6">
      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle className="text-base">ABC Supply — full sandbox surface</CardTitle>
          <CardDescription>
            Every panel below is the same one that was built and validated inside
            the O'Brien Contracting tenant. Payload history, sandbox pricelist,
            product search, live pricing, catalog + inventory, sandbox order
            submit / validate, webhook feed, and order diagnostics all resolve
            against the currently-active tenant.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Connection setup + sandbox demo workflow + sandbox test console.
          This is the 1500-line panel that owns product search, pricelist,
          submit_test_order, validate_payload_only, get_order_status, and the
          Sandy-contract UOM/jobsite/override fields. */}
      <ABCConnectionSettings />

      {/* Live catalog browser — item numbers, descriptions, UOMs and
          per-ship-to pricing for the active tenant's ABC account. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Catalog, pricelist & inventory</CardTitle>
          <CardDescription>
            Browse ABC's live sandbox catalog. Pricing pulls from
            <code className="mx-1">POST /pricing/v1/prices</code> for the tenant's
            ship-to; item metadata (description, valid UOMs, availability) comes
            from <code>GET /catalog/v1/items/&#123;itemNumber&#125;</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AbcCatalogBrowser />
        </CardContent>
      </Card>

      {/* Order diagnostics — every abc_orders row for the active tenant with
          matched webhook events and audit-log entries. */}
      <AbcDiagnosticsPanel />

      {/* Raw webhook feed (order.accepted / order.updated / etc.) */}
      {tenantId && <AbcWebhookPanel tenantId={tenantId} environment={environment} />}
    </div>
  );
}

export default AbcAdminSurfaces;
