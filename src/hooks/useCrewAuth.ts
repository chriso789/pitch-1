import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type CrewRole = 'admin' | 'manager' | 'subcontractor';

interface CrewUser {
  id: string;
  companyId: string;
  userId: string;
  role: CrewRole;
  isActive: boolean;
}

interface CrewProfile {
  id: string;
  companyId: string;
  userId: string;
  legalBusinessName: string | null;
  dba: string | null;
  primaryContactName: string | null;
  phone: string | null;
  email: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  emergencyContactName: string | null;
  emergencyContactRelationship: string | null;
  emergencyContactPhone: string | null;
  emergencyContactAltPhone: string | null;
  primaryTrade: string;
  tradeTags: string[];
}

export function useCrewAuth() {
  const { user, loading: authLoading } = useAuth();
  const [crewUser, setCrewUser] = useState<CrewUser | null>(null);
  const [crewProfile, setCrewProfile] = useState<CrewProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCrewData = useCallback(async () => {
    if (!user) {
      setCrewUser(null);
      setCrewProfile(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Query crew.company_users using raw SQL via rpc
      const { data: userData, error: userError } = await supabase.rpc(
        'get_crew_company_user' as any,
        { p_user_id: user.id }
      );

      if (userError || !userData) {
        // Fallback: user might not be in crew system
        console.log('[useCrewAuth] No crew user found');
        setCrewUser(null);
        setCrewProfile(null);
        setLoading(false);
        return;
      }

      const data = userData as any;
      setCrewUser({
        id: data.id,
        companyId: data.company_id,
        userId: data.user_id,
        role: data.role as CrewRole,
        isActive: data.is_active,
      });

      // Fetch profile
      const { data: profileData } = await supabase.rpc(
        'get_crew_subcontractor_profile' as any,
        { p_user_id: user.id }
      );

      if (profileData) {
        const profile = profileData as any;
        setCrewProfile({
          id: profile.id,
          companyId: profile.company_id,
          userId: profile.user_id,
          legalBusinessName: profile.legal_business_name,
          dba: profile.dba,
          primaryContactName: profile.primary_contact_name,
          phone: profile.phone,
          email: profile.email,
          addressLine1: profile.address_line1,
          addressLine2: profile.address_line2,
          city: profile.city,
          state: profile.state,
          postalCode: profile.postal_code,
          emergencyContactName: profile.emergency_contact_name,
          emergencyContactRelationship: profile.emergency_contact_relationship,
          emergencyContactPhone: profile.emergency_contact_phone,
          emergencyContactAltPhone: profile.emergency_contact_alt_phone,
          primaryTrade: profile.primary_trade,
          tradeTags: profile.trade_tags || [],
        });
      }
    } catch (err) {
      console.error('[useCrewAuth] Error fetching crew data:', err);
      setError('Failed to load crew data');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading) {
      fetchCrewData();
    }
  }, [authLoading, fetchCrewData]);

  const isAdmin = crewUser?.role === 'admin' || crewUser?.role === 'manager';
  const isSubcontractor = crewUser?.role === 'subcontractor';
  const isCrewMember = !!crewUser && crewUser.isActive;

  return {
    user,
    crewUser,
    crewProfile,
    loading: authLoading || loading,
    error,
    isAdmin,
    isSubcontractor,
    isCrewMember,
    companyId: crewUser?.companyId || null,
    refetch: fetchCrewData,
  };
}
