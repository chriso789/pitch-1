import { useUserProfile } from '@/contexts/UserProfileContext';

/**
 * Hook to get the effective tenant ID for the current user.
 * This returns the active_tenant_id (if the user has switched companies)
 * or falls back to the user's home tenant_id.
 * 
 * CRITICAL: Always use this hook for tenant-scoped queries to ensure
 * proper multi-tenant data isolation when users switch between companies.
 */
export const useActiveTenantId = () => {
  const { profile } = useUserProfile();
  
  // active_tenant_id is set when user switches companies via company switcher
  // tenant_id is the user's "home" tenant (where they were originally created)
  const activeTenantId = profile?.active_tenant_id || profile?.tenant_id || null;
  const homeTenantId = profile?.tenant_id || null;
  
  // Check if user is viewing their home tenant or a different company
  const isViewingHomeTenant = activeTenantId === homeTenantId;
  
  return {
    activeTenantId,
    homeTenantId,
    isViewingHomeTenant,
    profile
  };
};

/**
 * Utility function to get effective tenant ID from a profile object.
 * Use this when you don't have access to the hook (e.g., in async functions).
 */
export const getEffectiveTenantId = (profile: { active_tenant_id?: string | null; tenant_id?: string | null } | null): string | null => {
  if (!profile) return null;
  return profile.active_tenant_id || profile.tenant_id || null;
};
