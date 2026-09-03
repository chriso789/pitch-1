/**
 * Per-tab active company (tenant) isolation.
 *
 * The server stores a single `profiles.active_tenant_id` per user, so switching
 * companies in one tab used to change the company in every other tab/device.
 * Each browser tab gets its own sessionStorage-scoped tenant id which is sent to
 * Supabase as the `x-pitch-tenant` header. The database verifies the caller
 * actually has access to that tenant before honoring it, so the header can never
 * be used to reach another company's data.
 */

const TAB_TENANT_KEY = 'pitch_tab_tenant_id';

const isUuid = (v: string | null | undefined): v is string =>
  !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export function getTabTenantId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = sessionStorage.getItem(TAB_TENANT_KEY);
    return isUuid(v) ? v : null;
  } catch {
    return null;
  }
}

export function setTabTenantId(tenantId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (isUuid(tenantId)) sessionStorage.setItem(TAB_TENANT_KEY, tenantId);
    else sessionStorage.removeItem(TAB_TENANT_KEY);
  } catch {
    /* ignore */
  }
}

/** Seed the tab with the server-side active tenant the first time it loads. */
export function seedTabTenantId(tenantId: string | null | undefined): void {
  if (!getTabTenantId() && isUuid(tenantId)) setTabTenantId(tenantId);
}

export function clearTabTenantId(): void {
  setTabTenantId(null);
}

export const TAB_TENANT_HEADER = 'x-pitch-tenant';
