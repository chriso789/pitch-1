import { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { checkSessionExpiry, clearAllSessionData } from '@/services/sessionManager';
import { getDeviceFingerprint } from '@/services/deviceFingerprint';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  isTrustedDevice: boolean;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  isTrustedDevice: false,
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isTrustedDevice, setIsTrustedDevice] = useState(false);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      // Check if session has expired based on our custom timeout
      const sessionInfo = checkSessionExpiry();
      if (session && sessionInfo.expiresAt !== null && !sessionInfo.isValid) {
        console.log('[AuthContext] Session expired based on custom timeout, signing out');
        clearAllSessionData();
        supabase.auth.signOut();
        setSession(null);
        setUser(null);
        setLoading(false);
        return;
      }
      
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
      
      // Check if this is a trusted device and update last_seen
      if (session?.user) {
        checkTrustedDevice(session.user.id);
      }
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Refresh session on window focus (helps with Lovable iframe)
    const handleFocus = async () => {
      const rememberMe = localStorage.getItem('pitch_remember_me') === 'true';
      if (rememberMe) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          await supabase.auth.refreshSession();
        }
      }
    };

    window.addEventListener('focus', handleFocus);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  // Check if current device is trusted and update last_seen
  const checkTrustedDevice = async (userId: string) => {
    try {
      const fingerprint = await getDeviceFingerprint();
      
      const { data, error } = await supabase
        .from('trusted_devices')
        .select('id, is_active')
        .eq('user_id', userId)
        .eq('device_fingerprint', fingerprint)
        .eq('is_active', true)
        .maybeSingle();
      
      if (data && !error) {
        setIsTrustedDevice(true);
        // Update last_seen_at
        await supabase
          .from('trusted_devices')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('id', data.id);
      } else {
        setIsTrustedDevice(false);
      }
    } catch (error) {
      console.warn('[AuthContext] Error checking trusted device:', error);
      setIsTrustedDevice(false);
    }
  };

  return (
    <AuthContext.Provider value={{ session, user, loading, isTrustedDevice }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
