import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useCompanySwitcher } from '@/hooks/useCompanySwitcher';

/**
 * Roles that always see Advanced/Developer supplier tooling
 * (OAuth URLs, raw audit logs, WAF notes, sandbox test login, etc.)
 */
const DEVELOPER_ROLES = new Set(['master', 'platform_admin']);

/** Match O'Brien Contracting by tenant name (sandbox/demo tenant). */
export function isObrienSandboxTenant(tenantName?: string | null): boolean {
  if (!tenantName) return false;
  const n = tenantName.toLowerCase();
  return n.includes("o'brien") || n.includes('obrien');
}

/**
 * Single source of truth for "should this user see supplier developer
 * surface area" (OAuth URLs, sandbox defaults, raw audit, WAF debug,
 * sandbox test login, etc.).
 *
 * Normal contractors must only see: Connect / Disconnect / Order History /
 * Order Status. Everything else hides behind this flag.
 */
export function useSupplierDeveloperMode() {
  const { user } = useCurrentUser();
  const { activeCompany } = useCompanySwitcher();

  const role = user?.role ?? '';
  const isMasterOrAdmin = DEVELOPER_ROLES.has(role);
  const isDeveloperFlag = !!user?.is_developer;
  const isObrien = isObrienSandboxTenant(activeCompany?.tenant_name);

  const isDeveloper = isMasterOrAdmin || isDeveloperFlag;
  const showAdvanced = isDeveloper || isObrien;

  return {
    /** true for master / platform_admin / users with is_developer flag */
    isDeveloper,
    /** true when active tenant is the O'Brien sandbox/demo company */
    isObrien,
    /** any advanced surface — developer OR O'Brien (sandbox demo continuity) */
    showAdvanced,
    /** sandbox UI defaults (Sandy ship-to, branch, etc.) allowed for this user */
    allowSandboxDefaults: showAdvanced,
  };
}
