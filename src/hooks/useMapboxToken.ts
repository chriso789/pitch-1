import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

const FALLBACK_TOKEN = 'pk.eyJ1IjoibG92YWJsZS1kZW1vIiwiYSI6ImNtMXoxZHdwejBhMnAyanM0dzA3ZW1yMG4ifQ.7tYMl9RfRHOaC4K5eKrXRQ';

export function useMapboxToken() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchToken = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('get-mapbox-token');
        
        if (error) {
          console.warn('Failed to fetch Mapbox token from edge function:', error);
          setToken(FALLBACK_TOKEN);
        } else if (data?.token) {
          setToken(data.token);
        } else {
          console.warn('No token in response, using fallback');
          setToken(FALLBACK_TOKEN);
        }
      } catch (err) {
        console.warn('Error fetching Mapbox token:', err);
        setToken(FALLBACK_TOKEN);
      } finally {
        setLoading(false);
      }
    };

    fetchToken();
  }, []);

  return { token, loading, error };
}
