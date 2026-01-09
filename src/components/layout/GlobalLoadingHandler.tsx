import { useState, useEffect } from 'react';
import { CompanySwitchingOverlay } from './CompanySwitchingOverlay';

const SWITCHING_KEY = 'company-switching';
const USER_PROFILE_KEY = 'user-profile-cache';
const WORKSPACE_IDENTITY_KEY = 'pitch_workspace_identity_v1';

// Max age for cached data (2 minutes)
const CACHE_TTL_MS = 2 * 60 * 1000;

interface SwitchingData {
  companyName?: string;
  userName?: string;
  timestamp: number;
}

interface UserProfileCache {
  user_id: string; // Required for validation
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  title?: string;
  tenant_id?: string;
  active_tenant_id?: string;
  timestamp: number; // Required for TTL
}

interface WorkspaceIdentity {
  user_id: string;
  tenant_id: string;
  active_tenant_id: string;
  role: string;
  timestamp: number;
}

export const GlobalLoadingHandler = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [companyName, setCompanyName] = useState<string | undefined>();

  useEffect(() => {
    // Check for switching flag on mount
    const stored = localStorage.getItem(SWITCHING_KEY);
    if (stored) {
      try {
        const data: SwitchingData = JSON.parse(stored);
        // Only show if switch started within last 10 seconds (prevent stale overlays)
        if (Date.now() - data.timestamp < 10000) {
          setCompanyName(data.companyName);
          setIsLoading(true);
          
          // Fade out after a brief delay to let dashboard render
          const timer = setTimeout(() => {
            setIsLoading(false);
            localStorage.removeItem(SWITCHING_KEY);
          }, 600);
          
          return () => clearTimeout(timer);
        } else {
          // Stale flag, remove it
          localStorage.removeItem(SWITCHING_KEY);
        }
      } catch {
        localStorage.removeItem(SWITCHING_KEY);
      }
    }
  }, []);

  return <CompanySwitchingOverlay isVisible={isLoading} companyName={companyName} />;
};

// Helper to set the switching flag (used by useCompanySwitcher)
export const setSwitchingFlag = (companyName?: string, userName?: string) => {
  const data: SwitchingData = {
    companyName,
    userName,
    timestamp: Date.now(),
  };
  localStorage.setItem(SWITCHING_KEY, JSON.stringify(data));
};

// Helper to cache user profile before reload (now with user_id and timestamp)
export const cacheUserProfile = (profile: Omit<UserProfileCache, 'timestamp'> & { user_id: string }) => {
  const data: UserProfileCache = {
    ...profile,
    timestamp: Date.now(),
  };
  localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(data));
};

// Helper to get cached user profile (validates user_id and TTL)
export const getCachedUserProfile = (currentUserId?: string): Omit<UserProfileCache, 'timestamp' | 'user_id'> | null => {
  const cached = localStorage.getItem(USER_PROFILE_KEY);
  if (!cached) return null;
  
  try {
    const data: UserProfileCache = JSON.parse(cached);
    
    // Validate user_id matches (prevent cross-user pollution)
    if (currentUserId && data.user_id !== currentUserId) {
      console.log('[GlobalLoadingHandler] Cached profile user_id mismatch, clearing');
      localStorage.removeItem(USER_PROFILE_KEY);
      return null;
    }
    
    // Validate TTL
    if (Date.now() - data.timestamp > CACHE_TTL_MS) {
      console.log('[GlobalLoadingHandler] Cached profile expired, clearing');
      localStorage.removeItem(USER_PROFILE_KEY);
      return null;
    }
    
    const { timestamp, user_id, ...rest } = data;
    return rest;
  } catch {
    localStorage.removeItem(USER_PROFILE_KEY);
    return null;
  }
};

// Helper to clear cached profile (after successful load)
export const clearCachedUserProfile = () => {
  localStorage.removeItem(USER_PROFILE_KEY);
};

// Store minimal workspace identity for instant dashboard entry
export const cacheWorkspaceIdentity = (identity: Omit<WorkspaceIdentity, 'timestamp'>) => {
  const data: WorkspaceIdentity = {
    ...identity,
    timestamp: Date.now(),
  };
  localStorage.setItem(WORKSPACE_IDENTITY_KEY, JSON.stringify(data));
};

// Get cached workspace identity (validates user_id and TTL)
export const getCachedWorkspaceIdentity = (currentUserId?: string): Omit<WorkspaceIdentity, 'timestamp'> | null => {
  const cached = localStorage.getItem(WORKSPACE_IDENTITY_KEY);
  if (!cached) return null;
  
  try {
    const data: WorkspaceIdentity = JSON.parse(cached);
    
    // Validate user_id matches
    if (currentUserId && data.user_id !== currentUserId) {
      console.log('[GlobalLoadingHandler] Cached workspace identity user_id mismatch, clearing');
      localStorage.removeItem(WORKSPACE_IDENTITY_KEY);
      return null;
    }
    
    // Validate TTL (5 minutes for workspace identity)
    if (Date.now() - data.timestamp > 5 * 60 * 1000) {
      console.log('[GlobalLoadingHandler] Cached workspace identity expired, clearing');
      localStorage.removeItem(WORKSPACE_IDENTITY_KEY);
      return null;
    }
    
    const { timestamp, ...rest } = data;
    return rest;
  } catch {
    localStorage.removeItem(WORKSPACE_IDENTITY_KEY);
    return null;
  }
};

// Clear all app-specific localStorage keys (for full reset)
export const clearAllAppLocalStorage = () => {
  localStorage.removeItem(SWITCHING_KEY);
  localStorage.removeItem(USER_PROFILE_KEY);
  localStorage.removeItem(WORKSPACE_IDENTITY_KEY);
  
  // Also clear session storage keys
  sessionStorage.removeItem('pitch-user-role');
  sessionStorage.removeItem('pitch-user-title');
  
  console.log('[GlobalLoadingHandler] Cleared all app localStorage/sessionStorage');
};
