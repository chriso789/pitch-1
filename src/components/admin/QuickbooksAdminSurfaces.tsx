// Full QuickBooks Online admin surface stack.
//
// Bundles every QBO surface that was originally built inside the O'Brien
// Contracting tenant (connection setup + OAuth, job-type → QBO item mapping,
// webhook event feed, sync-error triage, active location selector) so
// platform admins can drive every QBO integration surface directly from
// Company Administration → Integrations → QuickBooks Online, without
// switching into a specific tenant's Settings page.
//
// All rendered panels are self-contained and resolve tenant via the same
// hooks they used inside the O'Brien testing area
// (useEffectiveTenantId / useCompanySwitcher / profiles.tenant_id).

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import QuickBooksSettings from "@/components/settings/QuickBooksSettings";
import { JobTypeQBOMapping } from "@/components/settings/JobTypeQBOMapping";
import { QuickBooksWebhookEvents } from "@/components/settings/QuickBooksWebhookEvents";
import { QuickBooksSyncErrors } from "@/components/settings/QuickBooksSyncErrors";
import { LocationSelector } from "@/components/settings/LocationSelector";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";

export function QuickbooksAdminSurfaces() {
  const tenantId = useEffectiveTenantId();

  return (
    <div className="space-y-6">
      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle className="text-base">QuickBooks Online — full sandbox surface</CardTitle>
          <CardDescription>
            Every panel below is the same one that was built and validated
            inside the O'Brien Contracting tenant. OAuth connection,
            job-type → QBO item mapping, active location selection, webhook
            event feed, and sync-error triage all resolve against the
            currently-active tenant. Production credentials
            (<code className="mx-1">QBO_CLIENT_ID_PRODUCTION</code>,
            <code className="mx-1">QBO_CLIENT_SECRET_PRODUCTION</code>,
            <code className="mx-1">QBO_REDIRECT_URI_PRODUCTION</code>) are
            read from environment secrets — flip the environment toggle
            inside the connect dialog to use them.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* OAuth connection setup + credentials + environment toggle.
          Embeds its own reauth banner, refresh-token controls, and
          disconnect/switch-account flow. */}
      <QuickBooksSettings />

      {/* Job type → QBO income item mapping. Used by invoice creation to
          route line items to the right QBO product/service. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Job type → QBO item mapping</CardTitle>
          <CardDescription>
            Maps each Pitch job type (roof repair, replacement, gutters,
            paint, handyman, …) to a specific QuickBooks income item so
            invoices land in the correct chart-of-accounts bucket. Same
            mapping surface that was configured inside O'Brien.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <JobTypeQBOMapping />
        </CardContent>
      </Card>

      {/* Active QBO location / class selector (multi-location tenants). */}
      {tenantId ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Active QBO location</CardTitle>
            <CardDescription>
              For multi-location tenants: pick which QBO
              location/department invoices post against. Persists on
              <code className="mx-1">qbo_connections.active_location_id</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LocationSelector tenantId={tenantId} />
          </CardContent>
        </Card>
      ) : null}

      {/* Live QBO webhook event feed (invoices, payments, customers). */}
      {tenantId ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Webhook event feed</CardTitle>
            <CardDescription>
              Live stream of inbound QBO webhook events (Invoice, Payment,
              Customer create/update). Same feed used inside O'Brien to
              verify that HMAC-verified events land and update the AR
              mirror.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <QuickBooksWebhookEvents tenantId={tenantId} />
          </CardContent>
        </Card>
      ) : null}

      {/* QBO sync-error triage panel (retryable failures). */}
      {tenantId ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sync error triage</CardTitle>
            <CardDescription>
              Every failed QBO API call (invoice create, customer sync,
              payment record) with its Intuit request-id, error code, and
              retry action. Same panel used inside O'Brien to clear stuck
              invoices during the sandbox review.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <QuickBooksSyncErrors tenantId={tenantId} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
