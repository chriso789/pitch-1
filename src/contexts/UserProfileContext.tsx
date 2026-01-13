import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { getCachedUserProfile, clearCachedUserProfile, cacheWorkspaceIdentity, getCachedWorkspaceIdentity } from '@/components/layout/GlobalLoadingHandler';

interface UserProfile {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  company_name?: string;
  role: string;
  tenant_id: string;
  active_tenant_id?: string;
  phone?: string;
  title?: string;
  is_developer?: boolean;
  password_set_at?: string | null;
  profileLoaded: boolean;
}

interface UserProfileContextType {
  profile: UserProfile | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  prefetch: (userId: string) => void;
}

const UserProfileContext = createContext<UserProfileContextType>({
  profile: null,
  loading: true,
  error: null,
  refetch: async () => {},
  prefetch: () => {},
});

// Session storage keys for role and title backup
const SESSION_ROLE_KEY = 'pitch-user-role';
const SESSION_TITLE_KEY = 'pitch-user-title';

// Helper to get role from session storage
const getSessionRole = (): string => {
  try {
    return sessionStorage.getItem(SESSION_ROLE_KEY) || '';
  } catch {
    return '';
  }
};

// Helper to set role in session storage
const setSessionRole = (role: string) => {
  try {
    if (role) {
      sessionStorage.setItem(SESSION_ROLE_KEY, role);
    }
  } catch {
    // Ignore session storage errors
  }
};

// Helper to get title from session storage
const getSessionTitle = (): string => {
  try {
    return sessionStorage.getItem(SESSION_TITLE_KEY) || '';
  } catch {
    return '';
  }
};

// Helper to set title in session storage
const setSessionTitle = (title: string) => {
  try {
    if (title) {
      sessionStorage.setItem(SESSION_TITLE_KEY, title);
    }
  } catch {
    // Ignore session storage errors
  }
};

export const UserProfileProvider = ({ children }: { children: React.ReactNode }) => {
  const { user: authUser, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const fetchedUserIdRef = useRef<string | null>(null);
  const isFetchingRef = useRef(false);
  const mountedRef = useRef(false);

  // Reset fetchedUserIdRef on mount to ensure fresh fetch after page reload
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      fetchedUserIdRef.current = null;
    }
  }, []);

  // Create instant profile from auth user_metadata or cached profile (available immediately)
  const createInstantProfile = useCallback((user: any): UserProfile => {
    // Check for cached profile first (preserved during company switch)
    const cached = getCachedUserProfile(user.id);
    
    // Check for cached workspace identity (fast dashboard entry)
    const cachedIdentity = getCachedWorkspaceIdentity(user.id);
    
    // Also check session storage as backup
    const sessionRole = getSessionRole();
    const sessionTitle = getSessionTitle();
    
    // Use cached role, then cached identity, then session storage, then user_metadata, then empty string
    const effectiveRole = cached?.role || cachedIdentity?.role || sessionRole || user.user_metadata?.role || '';
    // Use cached title, then session storage, then user_metadata, then empty string
    const effectiveTitle = cached?.title || sessionTitle || user.user_metadata?.title || '';
    
    // CRITICAL: Never use user.id as tenant fallback - it's not a valid tenant ID
    const metadataTenantId = user.user_metadata?.tenant_id;
    const metadataActiveTenantId = user.user_metadata?.active_tenant_id || metadataTenantId;
    const effectiveTenantId = cached?.tenant_id || cachedIdentity?.tenant_id || metadataTenantId || '';
    const effectiveActiveTenantId = cached?.active_tenant_id || cachedIdentity?.active_tenant_id || metadataActiveTenantId || '';
    
    // Must have both role AND valid tenant to be considered loaded
    // NOTE: Don't require first_name/last_name here (metadata may not include them on some accounts)
    const hasValidCache = !!effectiveRole;
    const hasValidTenant = !!effectiveTenantId;
    
    return {
      id: user.id,
      email: cached?.email || user.email || '',
      first_name: cached?.first_name || user.user_metadata?.first_name || user.email?.split('@')[0] || 'User',
      last_name: cached?.last_name || user.user_metadata?.last_name || '',
      company_name: user.user_metadata?.company_name,
      role: effectiveRole,
      tenant_id: effectiveTenantId,
      active_tenant_id: effectiveActiveTenantId,
      title: effectiveTitle,
      profileLoaded: hasValidCache && hasValidTenant,
    };
  }, []);

  // FAST PATH: Single RPC call to get everything
  const fetchWithBootstrap = useCallback(async (userId: string): Promise<boolean> => {
    try {
      console.log('[UserProfile] Trying fast bootstrap for:', userId);
      
      // @ts-ignore - RPC function not yet in generated types
      const { data, error: rpcError } = await supabase.rpc('get_workspace_bootstrap');
      
      if (rpcError) {
        console.warn('[UserProfile] Bootstrap RPC error:', rpcError.message);
        return false;
      }
      
      const result = data as any;
      
      if (!result?.success || !result?.tenant_id || !result?.role) {
        console.warn('[UserProfile] Bootstrap returned incomplete data:', result?.error || 'missing fields');
        return false;
      }
      
      // Store role and title in session storage as backup
      setSessionRole(result.role);
      if (result.title) {
        setSessionTitle(result.title);
      }
      
      console.log('[UserProfile] Bootstrap success - role:', result.role, 'tenant:', result.tenant_id);
      
      setProfile({
        id: result.id,
        email: result.email || '',
        first_name: result.first_name || '',
        last_name: result.last_name || '',
        company_name: result.company_name,
        role: result.role,
        tenant_id: result.tenant_id,
        active_tenant_id: result.active_tenant_id || result.tenant_id,
        phone: result.phone,
        title: result.title,
        is_developer: result.is_developer,
        password_set_at: result.password_set_at,
        profileLoaded: true,
      });
      
      // Cache workspace identity for instant future dashboard entry
      cacheWorkspaceIdentity({
        user_id: userId,
        tenant_id: result.tenant_id,
        active_tenant_id: result.active_tenant_id || result.tenant_id,
        role: result.role,
      });
      
      clearCachedUserProfile();
      fetchedUserIdRef.current = userId;
      setLoading(false);
      setError(null);
      return true;
    } catch (err) {
      console.warn('[UserProfile] Bootstrap exception:', err);
      return false;
    }
  }, []);

  // FALLBACK: Parallel REST queries (only if bootstrap fails)
  const fetchWithRest = useCallback(async (userId: string) => {
    console.log('[UserProfile] Fallback to REST queries for:', userId);
    
    const [profileResult, roleResult] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      supabase.from('user_roles').select('role').eq('user_id', userId).order('role', { ascending: true }).limit(1).maybeSingle()
    ]);

    const dbProfile = profileResult.data;
    const dbRole = roleResult.data?.role || '';

    if (!dbProfile || !dbRole || !dbProfile.tenant_id) {
      console.error('[UserProfile] REST fallback failed - profile:', !!dbProfile, 'role:', dbRole, 'tenant:', dbProfile?.tenant_id);
      setError(new Error('Could not load workspace data'));
      setLoading(false);
      return;
    }

    // Store role and title in session storage as backup
    setSessionRole(dbRole);
    if (dbProfile.title) {
      setSessionTitle(dbProfile.title);
    }
    
    console.log('[UserProfile] REST success - role:', dbRole, 'tenant:', dbProfile.tenant_id);
    
    setProfile({
      id: userId,
      email: dbProfile.email || '',
      first_name: dbProfile.first_name || '',
      last_name: dbProfile.last_name || '',
      company_name: dbProfile.company_name,
      role: dbRole,
      tenant_id: dbProfile.tenant_id,
      active_tenant_id: dbProfile.active_tenant_id || dbProfile.tenant_id,
      phone: dbProfile.phone,
      title: dbProfile.title,
      is_developer: dbProfile.is_developer,
      password_set_at: dbProfile.password_set_at,
      profileLoaded: true,
    });
    
    // Cache workspace identity for instant future dashboard entry
    cacheWorkspaceIdentity({
      user_id: userId,
      tenant_id: dbProfile.tenant_id,
      active_tenant_id: dbProfile.active_tenant_id || dbProfile.tenant_id,
      role: dbRole,
    });
    
    clearCachedUserProfile();
    fetchedUserIdRef.current = userId;
    setLoading(false);
    setError(null);
  }, []);

  // Main fetch function - tries bootstrap first, then REST fallback
  const fetchFullProfile = useCallback(async (userId: string) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    try {
      // Try fast path first
      const bootstrapSuccess = await fetchWithBootstrap(userId);
      
      if (!bootstrapSuccess) {
        // Fall back to REST queries
        await fetchWithRest(userId);
      }
    } catch (err) {
      console.error('[UserProfile] Error fetching profile:', err);
      setError(err as Error);
      setLoading(false);
    } finally {
      isFetchingRef.current = false;
    }
  }, [fetchWithBootstrap, fetchWithRest]);

  // Effect: Set instant profile immediately when auth user is available
  useEffect(() => {
    if (authLoading) return;

    if (!authUser) {
      setProfile(null);
      setLoading(false);
      fetchedUserIdRef.current = null;
      return;
    }

    // Immediately set instant profile from user_metadata
    const instantProfile = createInstantProfile(authUser);
    setProfile(instantProfile);
    
    // Only mark as not loading if we have a valid cached role
    if (instantProfile.profileLoaded && instantProfile.role) {
      setLoading(false);
    }

    // Fetch full profile (fast bootstrap first)
    if (fetchedUserIdRef.current !== authUser.id) {
      fetchFullProfile(authUser.id);
    }
  }, [authUser, authLoading, createInstantProfile, fetchFullProfile]);

  const refetch = useCallback(async () => {
    if (authUser) {
      fetchedUserIdRef.current = null;
      isFetchingRef.current = false;
      setError(null);
      await fetchFullProfile(authUser.id);
    }
  }, [authUser, fetchFullProfile]);

  const prefetch = useCallback((userId: string) => {
    if (fetchedUserIdRef.current !== userId) {
      fetchFullProfile(userId);
    }
  }, [fetchFullProfile]);

  return (
    <UserProfileContext.Provider value={{ profile, loading, error, refetch, prefetch }}>
      {children}
    </UserProfileContext.Provider>
  );
};

export const useUserProfile = () => useContext(UserProfileContext);
