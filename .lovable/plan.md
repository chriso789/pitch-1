

# Fix: Landing Page Stuck on "Loading..."

## Root Cause
In `src/pages/LandingPage.tsx`, when a signed-in user visits `/`, the auth check finds a session and calls `navigate('/dashboard')` but never sets `checkingAuth(false)`. If the navigation doesn't unmount the LandingPage (e.g., ProtectedRoute takes time validating, or the user gets redirected back), the spinner stays visible indefinitely.

## Fix
In `LandingPage.tsx`, add `setCheckingAuth(false)` after the navigate call so the landing page content renders as a fallback. Also add a timeout safety net — if auth check takes more than 3 seconds, show the landing page anyway.

### `src/pages/LandingPage.tsx` (lines 39-56)
```typescript
useEffect(() => {
  let mounted = true;
  const checkAuth = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        console.log('[LandingPage] User authenticated, redirecting to dashboard');
        navigate('/dashboard', { replace: true });
        return; // Don't set checkingAuth false - let unmount handle it
      }
    } catch (error) {
      console.error('[LandingPage] Auth check error:', error);
    }
    if (mounted) setCheckingAuth(false);
  };

  // Safety timeout: if auth check hangs, show landing page
  const timeout = setTimeout(() => {
    if (mounted) setCheckingAuth(false);
  }, 3000);

  checkAuth();
  return () => { mounted = false; clearTimeout(timeout); };
}, [navigate]);
```

This is a single-file, ~10 line change. The key addition is the 3-second safety timeout that prevents the "Loading..." spinner from persisting indefinitely.

