/**
 * Session Expiry Handler Component
 * Monitors session expiry and shows warning dialog before auto-logout
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { SESSION_CONFIG } from '@/config/sessionConfig';
import {
  checkSessionExpiry,
  extendSession,
  clearAllSessionData,
  formatRemainingTime,
  isSessionExpiringSoon,
} from '@/services/sessionManager';

export function SessionExpiryHandler() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showWarning, setShowWarning] = useState(false);
  const [remainingTime, setRemainingTime] = useState(0);

  const handleSessionExpired = useCallback(async () => {
    console.log('[SessionExpiryHandler] Session expired, logging out...');
    setShowWarning(false);
    
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('[SessionExpiryHandler] Sign out error:', error);
    }
    
    clearAllSessionData();
    toast.error('Your session has expired. Please log in again.');
    navigate('/login', { replace: true });
  }, [navigate]);

  const handleExtendSession = useCallback(() => {
    extendSession();
    setShowWarning(false);
    toast.success('Session extended successfully');
  }, []);

  useEffect(() => {
    // Only run checks if user is logged in
    if (!user) return;

    const checkSession = () => {
      const sessionInfo = checkSessionExpiry();
      
      // If no session info exists (legacy login), don't force logout
      if (sessionInfo.expiresAt === null) {
        return;
      }

      if (!sessionInfo.isValid) {
        handleSessionExpired();
        return;
      }

      setRemainingTime(sessionInfo.remainingTime);

      // Show warning if expiring soon
      if (isSessionExpiringSoon() && !showWarning) {
        setShowWarning(true);
      }
    };

    // Initial check
    checkSession();

    // Set up interval for periodic checks
    const interval = setInterval(checkSession, SESSION_CONFIG.CHECK_INTERVAL);

    return () => clearInterval(interval);
  }, [user, showWarning, handleSessionExpired]);

  // Update remaining time more frequently when warning is shown
  useEffect(() => {
    if (!showWarning) return;

    const interval = setInterval(() => {
      const sessionInfo = checkSessionExpiry();
      setRemainingTime(sessionInfo.remainingTime);
      
      if (!sessionInfo.isValid) {
        handleSessionExpired();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [showWarning, handleSessionExpired]);

  if (!user) return null;

  return (
    <AlertDialog open={showWarning} onOpenChange={setShowWarning}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Session Expiring Soon</AlertDialogTitle>
          <AlertDialogDescription>
            Your session will expire in {formatRemainingTime(remainingTime)}.
            Would you like to extend your session or log out?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleSessionExpired}>
            Log Out
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleExtendSession}>
            Extend Session
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
