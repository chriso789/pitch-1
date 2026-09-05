import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

const RETRY_DELAYS_MS = [0, 500, 1500];

export function useGoogleMapsToken() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchKey = async () => {
      let lastError: unknown;

      for (const delay of RETRY_DELAYS_MS) {
        if (delay > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, delay));
        }

        try {
          const { data, error } = await supabase.functions.invoke('get-google-maps-key');

          if (error) throw error;
          if (!data?.apiKey) throw new Error('No API key returned');

          setApiKey(data.apiKey);
          setError(null);
          setLoading(false);
          return;
        } catch (err) {
          lastError = err;
        }
      }

      console.error('Error fetching Google Maps key after retries:', lastError);
      setError('Unable to connect to Google Maps. Check your connection and try again.');
      setLoading(false);
    };

    fetchKey();
  }, []);

  return { apiKey, loading, error };
}
