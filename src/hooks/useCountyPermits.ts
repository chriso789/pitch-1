import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface FloridaCounty {
  id: string;
  name: string;
  coast: 'east' | 'west' | 'panhandle' | 'keys' | 'nature_coast';
  region: string | null;
  is_hvhz: boolean;
  wind_zone: string | null;
}

export interface PermitRequirement {
  id: string;
  county_id: string;
  permit_type: string;
  online_submission: boolean;
  in_person_required: boolean;
  permit_portal_url: string | null;
  required_documents: string[];
  base_fee: number | null;
  per_sqft_fee: number | null;
  plan_review_fee: number | null;
  typical_processing_days: number | null;
  expedited_available: boolean;
  expedited_fee: number | null;
  special_requirements: string[] | null;
  department_name: string | null;
  department_phone: string | null;
  department_email: string | null;
  department_address: string | null;
  notes: string | null;
  last_scraped_at: string | null;
  last_verified_at: string | null;
}

export interface PermitForm {
  id: string;
  county_id: string;
  form_name: string;
  form_url: string | null;
  form_type: string | null;
  is_required: boolean;
  notes: string | null;
}

export interface CountyPermitData {
  county: FloridaCounty;
  requirements: PermitRequirement | null;
  forms: PermitForm[];
}

export function useCountyPermits() {
  const [counties, setCounties] = useState<FloridaCounty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch all Florida counties
  const fetchCounties = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from('florida_counties')
        .select('*')
        .order('name');

      if (fetchError) throw fetchError;
      setCounties((data as FloridaCounty[]) || []);
    } catch (err) {
      console.error('Error fetching counties:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch counties');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCounties();
  }, [fetchCounties]);

  // Get counties by coast
  const getCountiesByCoast = useCallback((coast: string) => {
    return counties.filter(c => c.coast === coast);
  }, [counties]);

  // Get permit requirements for a specific county
  const getPermitRequirements = useCallback(async (countyId: string): Promise<PermitRequirement | null> => {
    try {
      const { data, error: fetchError } = await supabase
        .from('county_permit_requirements')
        .select('*')
        .eq('county_id', countyId)
        .eq('permit_type', 'residential_reroof')
        .maybeSingle();

      if (fetchError) throw fetchError;
      
      if (data) {
        let docs: string[] = [];
        if (Array.isArray(data.required_documents)) {
          docs = data.required_documents.map(d => String(d));
        } else if (typeof data.required_documents === 'string') {
          try { docs = JSON.parse(data.required_documents); } catch { docs = []; }
        }
        return {
          ...data,
          required_documents: docs,
        } as PermitRequirement;
      }
      return null;
    } catch (err) {
      console.error('Error fetching permit requirements:', err);
      return null;
    }
  }, []);

  // Get permit forms for a specific county
  const getPermitForms = useCallback(async (countyId: string): Promise<PermitForm[]> => {
    try {
      const { data, error: fetchError } = await supabase
        .from('county_permit_forms')
        .select('*')
        .eq('county_id', countyId)
        .order('is_required', { ascending: false });

      if (fetchError) throw fetchError;
      return (data as PermitForm[]) || [];
    } catch (err) {
      console.error('Error fetching permit forms:', err);
      return [];
    }
  }, []);

  // Get full permit data for a county
  const getCountyPermitData = useCallback(async (countyName: string): Promise<CountyPermitData | null> => {
    try {
      const county = counties.find(c => c.name.toLowerCase() === countyName.toLowerCase());
      if (!county) return null;

      const [requirements, forms] = await Promise.all([
        getPermitRequirements(county.id),
        getPermitForms(county.id),
      ]);

      return { county, requirements, forms };
    } catch (err) {
      console.error('Error fetching county permit data:', err);
      return null;
    }
  }, [counties, getPermitRequirements, getPermitForms]);

  // Find county from address components (Google Places format)
  const findCountyFromAddress = useCallback((addressComponents: any[]): FloridaCounty | null => {
    if (!addressComponents || !Array.isArray(addressComponents)) return null;

    // Look for administrative_area_level_2 (county) in address components
    const countyComponent = addressComponents.find(
      (c: any) => c.types?.includes('administrative_area_level_2')
    );

    if (!countyComponent) return null;

    // Extract county name, removing "County" suffix if present
    let countyName = String(countyComponent.long_name || countyComponent.short_name || '');
    countyName = countyName.replace(/\s*County$/i, '').trim();

    return counties.find(c => c.name.toLowerCase() === countyName.toLowerCase()) || null;
  }, [counties]);

  // Trigger a scrape for a specific county
  const scrapeCountyPermits = useCallback(async (countyName: string) => {
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('scrape-county-permits', {
        body: { county_name: countyName },
      });

      if (invokeError) throw invokeError;
      return data;
    } catch (err) {
      console.error('Error scraping county permits:', err);
      throw err;
    }
  }, []);

  // Scrape all counties
  const scrapeAllCounties = useCallback(async () => {
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('scrape-county-permits', {
        body: { scrape_all: true },
      });

      if (invokeError) throw invokeError;
      return data;
    } catch (err) {
      console.error('Error scraping all counties:', err);
      throw err;
    }
  }, []);

  return {
    counties,
    loading,
    error,
    refetch: fetchCounties,
    getCountiesByCoast,
    getPermitRequirements,
    getPermitForms,
    getCountyPermitData,
    findCountyFromAddress,
    scrapeCountyPermits,
    scrapeAllCounties,
  };
}

export default useCountyPermits;
