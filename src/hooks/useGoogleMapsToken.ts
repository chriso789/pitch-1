import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export function useGoogleMapsToken() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchKey = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('get-google-maps-key');
        
        if (error) throw error;
        if (data?.apiKey) {
          setApiKey(data.apiKey);
        } else {
          throw new Error('No API key returned');
        }
      } catch (err) {
        console.error('Error fetching Google Maps key:', err);
        setError('Failed to load Google Maps');
      } finally {
        setLoading(false);
      }
    };

    fetchKey();
  }, []);

  return { apiKey, loading, error };
}
