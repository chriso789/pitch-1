import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface CurrentUser {
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
}

export const useCurrentUser = () => {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    fetchUser();
  }, []);

  const fetchUser = async () => {
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      
      if (!authUser) {
        setUser(null);
        return;
      }

      // Fetch profile data
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .single();

      if (profileError) throw profileError;

      // Fetch user role from user_roles table (secure)
      const { data: userRole, error: roleError } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', authUser.id)
        .order('role', { ascending: true }) // Order by role priority (master > manager > admin > user)
        .limit(1)
        .single();

      if (roleError) {
        console.warn('Error fetching user role from user_roles table:', roleError);
        // Fallback to profile.role for backward compatibility
        console.warn('Falling back to profiles.role (deprecated)');
      }

      const role = userRole?.role || profile?.role || 'user';

      console.log('useCurrentUser: Fetched user data:', {
        id: authUser.id,
        email: authUser.email,
        first_name: profile?.first_name,
        last_name: profile?.last_name,
        title: profile?.title,
        role: role,
        is_developer: profile?.is_developer,
        company_name: profile?.company_name,
        tenant_id: profile?.tenant_id
      });

      setUser({
        id: authUser.id,
        email: authUser.email || '',
        first_name: profile?.first_name || '',
        last_name: profile?.last_name || '',
        company_name: profile?.company_name,
        role: role,
        tenant_id: profile?.tenant_id,
        active_tenant_id: profile?.active_tenant_id || profile?.tenant_id,
        phone: profile?.phone,
        title: profile?.title,
        is_developer: profile?.is_developer
      });
    } catch (err) {
      setError(err as Error);
      console.error('Error fetching current user:', err);
    } finally {
      setLoading(false);
    }
  };

  return { user, loading, error, refetch: fetchUser };
};
