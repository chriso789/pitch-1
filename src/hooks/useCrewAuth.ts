import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type CrewRole = 'admin' | 'manager' | 'subcontractor';

interface CrewCompany {
  companyId: string;
  companyName: string;
  role: CrewRole;
  isActive: boolean;
}

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
  const [companies, setCompanies] = useState<CrewCompany[]>([]);
  const [activeCompanyId, setActiveCompanyIdState] = useState<string | null>(null);
  const [crewUser, setCrewUser] = useState<CrewUser | null>(null);
  const [crewProfile, setCrewProfile] = useState<CrewProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Set active company and persist
  const setActiveCompany = useCallback((companyId: string) => {
    setActiveCompanyIdState(companyId);
    localStorage.setItem('crew_active_company_id', companyId);
  }, []);

  const fetchCrewData = useCallback(async () => {
    if (!user) {
      setCompanies([]);
      setActiveCompanyIdState(null);
      setCrewUser(null);
      setCrewProfile(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Fetch all companies user belongs to
      const { data: companiesData, error: companiesError } = await supabase.rpc(
        'get_crew_user_companies' as any
      );

      if (companiesError) {
        console.log('[useCrewAuth] Error fetching companies:', companiesError);
        setCompanies([]);
        setCrewUser(null);
        setCrewProfile(null);
        setLoading(false);
        return;
      }

      if (!companiesData || (companiesData as any[]).length === 0) {
        console.log('[useCrewAuth] No crew companies found');
        setCompanies([]);
        setCrewUser(null);
        setCrewProfile(null);
        setLoading(false);
        return;
      }

      const mappedCompanies: CrewCompany[] = (companiesData as any[]).map((c: any) => ({
        companyId: c.company_id,
        companyName: c.company_name,
        role: c.role as CrewRole,
        isActive: c.is_active,
      }));
      setCompanies(mappedCompanies);

      // Determine active company (from localStorage or first)
      const storedCompanyId = localStorage.getItem('crew_active_company_id');
      const validStoredCompany = storedCompanyId && mappedCompanies.some(c => c.companyId === storedCompanyId);
      const selectedCompanyId = validStoredCompany ? storedCompanyId : mappedCompanies[0].companyId;
      setActiveCompanyIdState(selectedCompanyId);

      // Fetch crew user for active company
      const { data: userData } = await supabase.rpc(
        'get_crew_company_user_for_company' as any,
        { p_user_id: user.id, p_company_id: selectedCompanyId }
      );

      if (userData && (userData as any[]).length > 0) {
        const data = (userData as any[])[0];
        setCrewUser({
          id: data.id,
          companyId: data.company_id,
          userId: data.user_id,
          role: data.role as CrewRole,
          isActive: data.is_active,
        });
      }

      // Fetch profile for active company
      const { data: profileData } = await supabase.rpc(
        'get_crew_subcontractor_profile_for_company' as any,
        { p_user_id: user.id, p_company_id: selectedCompanyId }
      );

      if (profileData && (profileData as any[]).length > 0) {
        const profile = (profileData as any[])[0];
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

  // Refetch when active company changes
  useEffect(() => {
    if (activeCompanyId && user && !loading) {
      // Refetch crew user and profile for new company
      const refetchForCompany = async () => {
        const { data: userData } = await supabase.rpc(
          'get_crew_company_user_for_company' as any,
          { p_user_id: user.id, p_company_id: activeCompanyId }
        );

        if (userData && (userData as any[]).length > 0) {
          const data = (userData as any[])[0];
          setCrewUser({
            id: data.id,
            companyId: data.company_id,
            userId: data.user_id,
            role: data.role as CrewRole,
            isActive: data.is_active,
          });
        }

        const { data: profileData } = await supabase.rpc(
          'get_crew_subcontractor_profile_for_company' as any,
          { p_user_id: user.id, p_company_id: activeCompanyId }
        );

        if (profileData && (profileData as any[]).length > 0) {
          const profile = (profileData as any[])[0];
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
      };
      refetchForCompany();
    }
  }, [activeCompanyId]);

  const activeCompany = companies.find(c => c.companyId === activeCompanyId);
  const isAdmin = crewUser?.role === 'admin' || crewUser?.role === 'manager';
  const isSubcontractor = crewUser?.role === 'subcontractor';
  const isCrewMember = !!crewUser && crewUser.isActive;

  return {
    user,
    companies,
    activeCompanyId,
    activeCompany,
    setActiveCompany,
    crewUser,
    crewProfile,
    loading: authLoading || loading,
    error,
    isAdmin,
    isSubcontractor,
    isCrewMember,
    companyId: activeCompanyId,
    refetch: fetchCrewData,
  };
}
