import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { checkSessionExpiry, clearAllSessionData } from '@/services/sessionManager';
import { getDeviceFingerprint } from '@/services/deviceFingerprint';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  isTrustedDevice: boolean;
  validateSession: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  isTrustedDevice: false,
  validateSession: async () => false,
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isTrustedDevice, setIsTrustedDevice] = useState(false);

  // CRITICAL SECURITY: Validate session is real and belongs to this user
  const validateSession = useCallback(async (): Promise<boolean> => {
    try {
      const { data: { session: currentSession }, error } = await supabase.auth.getSession();
      
      if (error || !currentSession?.user) {
        console.log('[AuthContext] Session validation failed - no valid session');
        clearAllSessionData();
        setSession(null);
        setUser(null);
        return false;
      }

      // Verify the session token is actually valid by making a test API call
      // ALSO check if user is suspended
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, email, is_suspended, suspension_reason')
        .eq('id', currentSession.user.id)
        .maybeSingle();

      if (profileError && profileError.code !== 'PGRST116') {
        console.error('[AuthContext] Session validation failed - API error:', profileError);
        clearAllSessionData();
        await supabase.auth.signOut();
        setSession(null);
        setUser(null);
        return false;
      }

      // SECURITY: Check if user is suspended - immediately log them out
      if (profile?.is_suspended) {
        console.warn('[AuthContext] User is suspended, forcing logout:', profile.suspension_reason);
        clearAllSessionData();
        await supabase.auth.signOut();
        setSession(null);
        setUser(null);
        return false;
      }

      // Session is valid
      return true;
    } catch (error) {
      console.error('[AuthContext] Session validation error:', error);
      clearAllSessionData();
      setSession(null);
      setUser(null);
      return false;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    // CRITICAL: Always start with clean state, then verify session
    const initializeAuth = async () => {
      try {
        const { data: { session: initialSession }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('[AuthContext] Error getting session:', error);
          if (mounted) {
            clearAllSessionData();
            setSession(null);
            setUser(null);
            setLoading(false);
          }
          return;
        }

        // Check if session has expired based on our custom timeout
        const sessionInfo = checkSessionExpiry();
        if (initialSession && sessionInfo.expiresAt !== null && !sessionInfo.isValid) {
          console.log('[AuthContext] Session expired based on custom timeout, signing out');
          clearAllSessionData();
          await supabase.auth.signOut();
          if (mounted) {
            setSession(null);
            setUser(null);
            setLoading(false);
          }
          return;
        }

        if (initialSession?.user) {
          // SECURITY: Verify this session actually works AND user is not suspended
          const { data: verifyProfile, error: verifyError } = await supabase
            .from('profiles')
            .select('id, is_suspended, suspension_reason')
            .eq('id', initialSession.user.id)
            .maybeSingle();

          if (verifyError && verifyError.code !== 'PGRST116') {
            console.error('[AuthContext] Session verification failed:', verifyError);
            clearAllSessionData();
            await supabase.auth.signOut();
            if (mounted) {
              setSession(null);
              setUser(null);
              setLoading(false);
            }
            return;
          }

          // SECURITY: Check suspension status on init
          if (verifyProfile?.is_suspended) {
            console.warn('[AuthContext] User is suspended, forcing logout:', verifyProfile.suspension_reason);
            clearAllSessionData();
            await supabase.auth.signOut();
            if (mounted) {
              setSession(null);
              setUser(null);
              setLoading(false);
            }
            return;
          }

          if (mounted) {
            setSession(initialSession);
            setUser(initialSession.user);
            // Check trusted device AFTER confirming session is valid
            checkTrustedDevice(initialSession.user.id);
          }
        } else {
          // No session - ensure clean state
          if (mounted) {
            setSession(null);
            setUser(null);
          }
        }

        if (mounted) {
          setLoading(false);
        }
      } catch (error) {
        console.error('[AuthContext] Init error:', error);
        if (mounted) {
          clearAllSessionData();
          setSession(null);
          setUser(null);
          setLoading(false);
        }
      }
    };

    initializeAuth();

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[AuthContext] Auth state change:', event, session?.user?.email);
      
      if (event === 'SIGNED_OUT') {
        clearAllSessionData();
        setSession(null);
        setUser(null);
        setIsTrustedDevice(false);
      } else if (session) {
        setSession(session);
        setUser(session.user);
      } else {
        setSession(null);
        setUser(null);
      }
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
      mounted = false;
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
        .select('id, is_active, user_id')
        .eq('user_id', userId)
        .eq('device_fingerprint', fingerprint)
        .eq('is_active', true)
        .maybeSingle();
      
      // SECURITY: Verify the trusted device actually belongs to this user
      if (data && !error && data.user_id === userId) {
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
    <AuthContext.Provider value={{ session, user, loading, isTrustedDevice, validateSession }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
