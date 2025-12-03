import { useUserProfile } from '@/contexts/UserProfileContext';

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
  const { profile, loading, error, refetch } = useUserProfile();

  // Map profile to CurrentUser interface (maintains backward compatibility)
  const user: CurrentUser | null = profile ? {
    id: profile.id,
    email: profile.email,
    first_name: profile.first_name,
    last_name: profile.last_name,
    company_name: profile.company_name,
    role: profile.role,
    tenant_id: profile.tenant_id,
    active_tenant_id: profile.active_tenant_id,
    phone: profile.phone,
    title: profile.title,
    is_developer: profile.is_developer,
  } : null;

  return { user, loading, error, refetch };
};
