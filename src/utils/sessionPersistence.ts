import { supabase } from '@/integrations/supabase/client';

export const initSessionPersistence = () => {
  // Periodically check and refresh session if remember me is enabled
  const refreshInterval = setInterval(async () => {
    const rememberMe = localStorage.getItem('pitch_remember_me') === 'true';
    
    if (rememberMe) {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session) {
        // Check if token expires in less than 5 minutes
        const expiresAt = session.expires_at ? session.expires_at * 1000 : 0;
        const fiveMinutes = 5 * 60 * 1000;
        
        if (expiresAt - Date.now() < fiveMinutes) {
          console.log('Refreshing session token...');
          await supabase.auth.refreshSession();
        }
      }
    }
  }, 60000); // Check every minute

  return () => clearInterval(refreshInterval);
};
