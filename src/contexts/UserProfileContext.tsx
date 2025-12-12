import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { getCachedUserProfile, clearCachedUserProfile } from '@/components/layout/GlobalLoadingHandler';

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

export const UserProfileProvider = ({ children }: { children: React.ReactNode }) => {
  const { user: authUser, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const fetchedUserIdRef = useRef<string | null>(null);
  const isFetchingRef = useRef(false);

  // Create instant profile from auth user_metadata or cached profile (available immediately)
  const createInstantProfile = useCallback((user: any): UserProfile => {
    // Check for cached profile first (preserved during company switch)
    const cached = getCachedUserProfile();
    
    return {
      id: user.id,
      email: cached?.email || user.email || '',
      first_name: cached?.first_name || user.user_metadata?.first_name || user.email?.split('@')[0] || 'User',
      last_name: cached?.last_name || user.user_metadata?.last_name || '',
      company_name: user.user_metadata?.company_name,
      role: cached?.role || '', // Use cached role, never fallback to 'user' - wait for DB
      tenant_id: user.user_metadata?.tenant_id || user.id,
      active_tenant_id: user.user_metadata?.tenant_id || user.id,
      profileLoaded: false,
    };
  }, []);

  // Fetch full profile from database (parallel queries)
  const fetchFullProfile = useCallback(async (userId: string) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    try {
      // Parallel fetch: profiles + user_roles
      const [profileResult, roleResult] = await Promise.all([
        supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single(),
        supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', userId)
          .order('role', { ascending: true })
          .limit(1)
          .maybeSingle()
      ]);

      if (profileResult.error) {
        console.warn('Profile fetch error:', profileResult.error);
      }

      const dbProfile = profileResult.data;
      const dbRole = roleResult.data?.role || dbProfile?.role || 'user';

      if (dbProfile) {
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
          profileLoaded: true,
        });
        
        // Clear cached profile now that we have fresh data
        clearCachedUserProfile();
      }

      fetchedUserIdRef.current = userId;
    } catch (err) {
      console.error('Error fetching profile:', err);
      setError(err as Error);
    } finally {
      isFetchingRef.current = false;
      setLoading(false);
    }
  }, []);

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
    setLoading(false); // Mark as not loading - we have instant data!

    // Then fetch full profile in background (parallel)
    if (fetchedUserIdRef.current !== authUser.id) {
      fetchFullProfile(authUser.id);
    }
  }, [authUser, authLoading, createInstantProfile, fetchFullProfile]);

  const refetch = useCallback(async () => {
    if (authUser) {
      fetchedUserIdRef.current = null;
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
