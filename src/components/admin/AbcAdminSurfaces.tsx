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

import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ABCConnectionSettings } from "@/components/settings/ABCConnectionSettings";

// ABCConnectionSettings already renders (in developer mode):
//   - Connect card + readiness strip
//   - AbcCatalogBrowser (branch-scoped item/UOM/pricing list)
//   - Sandbox Demo Workflow + Sandbox Test Console
//   - AbcDiagnosticsPanel (order/webhook diagnostics)
//   - AbcWebhookPanel (inside Advanced accordion)
//
// Previously this wrapper ALSO mounted AbcCatalogBrowser and
// AbcDiagnosticsPanel a second time, which is why the developer area was
// showing two Catalog cards and two Diagnostics cards. Render the single
// authoritative surface only.

export function AbcAdminSurfaces() {
  return (
    <div className="space-y-6">
      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle className="text-base">ABC Supply — developer surface</CardTitle>
          <CardDescription>
            One catalog view (branch-scoped item numbers, UOMs and live pricing),
            one diagnostics view, connect + readiness, sandbox demo workflow and
            sandbox test console. All panels resolve against the currently-active tenant.
          </CardDescription>
        </CardHeader>
      </Card>

      <ABCConnectionSettings />
    </div>
  );
}

export default AbcAdminSurfaces;
