import { useCompanySwitcher } from './useCompanySwitcher';
import { useUserProfile } from '@/contexts/UserProfileContext';

/**
 * Returns the "effective" tenant ID for the current user session.
 * Priority:
 *  1. Active company from company switcher (DB-backed, most reliable)
 *  2. Profile's active_tenant_id (after profile loads from DB)
 *  3. Profile's tenant_id (fallback to home tenant)
 * 
 * This hook ensures tenant-scoped operations use the currently selected
 * company, not stale auth metadata.
 */
export function useEffectiveTenantId(): string | null {
  const { activeCompanyId, loading: switcherLoading } = useCompanySwitcher();
  const { profile } = useUserProfile();

  // Priority 1: Company switcher's active company (from DB)
  if (activeCompanyId) {
    return activeCompanyId;
  }

  // Priority 2: Profile's active_tenant_id (if profile loaded from DB)
  if (profile?.profileLoaded && profile.active_tenant_id) {
    return profile.active_tenant_id;
  }

  // Priority 3: Profile's tenant_id (home tenant fallback)
  if (profile?.tenant_id) {
    return profile.tenant_id;
  }

  return null;
}

/**
 * Returns loading state for tenant ID resolution.
 * Use this to disable save buttons until tenant is resolved.
 */
export function useEffectiveTenantIdLoading(): boolean {
  const { loading: switcherLoading } = useCompanySwitcher();
  const { profile } = useUserProfile();
  
  // Still loading if switcher is loading and profile hasn't loaded yet
  return switcherLoading && !profile?.profileLoaded;
}
