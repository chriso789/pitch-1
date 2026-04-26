import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

// NOTE: No fallback token. The previous public demo token is dead (401)
// and was silently masking real auth failures. We now surface a clear error.
export function useMapboxToken() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchToken = async () => {
      try {
        const { data, error: fnError } = await supabase.functions.invoke('get-mapbox-token');

        if (fnError) {
          console.error('[useMapboxToken] edge function error:', fnError);
          setError('Failed to load Mapbox token. Make sure you are logged in and MAPBOX_PUBLIC_TOKEN is set.');
          setToken(null);
        } else if (data?.token) {
          setToken(data.token);
          setError(null);
        } else {
          console.error('[useMapboxToken] no token in response:', data);
          setError('No Mapbox token returned from server.');
          setToken(null);
        }
      } catch (err) {
        console.error('[useMapboxToken] unexpected error:', err);
        setError(err instanceof Error ? err.message : 'Unknown error fetching Mapbox token');
        setToken(null);
      } finally {
        setLoading(false);
      }
    };

    fetchToken();
  }, []);

  return { token, loading, error };
}
