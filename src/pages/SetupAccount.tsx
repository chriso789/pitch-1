import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Eye, EyeOff, Lock, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

type SetupState = 'loading' | 'ready' | 'success' | 'error';

export default function SetupAccount() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const [setupState, setSetupState] = useState<SetupState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Get token from URL
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') || 'invite';

  useEffect(() => {
    async function verifyToken() {
      if (!tokenHash) {
        setSetupState('error');
        setErrorMessage('Invalid link. No token found in URL.');
        return;
      }

      try {
        console.log('[SetupAccount] Verifying token:', { type, hasToken: !!tokenHash });
        
        // Verify the OTP token
        const { data, error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: type as 'invite' | 'recovery' | 'signup' | 'magiclink' | 'email_change',
        });

        if (error) {
          console.error('[SetupAccount] Token verification failed:', error);
          setSetupState('error');
          setErrorMessage(error.message || 'This link is invalid or has expired. Please request a new one.');
          return;
        }

        if (data?.user) {
          console.log('[SetupAccount] Token verified, user:', data.user.email);
          setUserEmail(data.user.email || null);
          setSetupState('ready');
        } else {
          setSetupState('error');
          setErrorMessage('Unable to verify your account. Please request a new link.');
        }
      } catch (err) {
        console.error('[SetupAccount] Unexpected error:', err);
        setSetupState('error');
        setErrorMessage('An unexpected error occurred. Please try again.');
      }
    }

    verifyToken();
  }, [tokenHash, type]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    
    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: password,
      });

      if (error) {
        console.error('[SetupAccount] Password update failed:', error);
        toast.error(error.message || 'Failed to set password');
        setIsSubmitting(false);
        return;
      }

      console.log('[SetupAccount] Password set successfully');
      setSetupState('success');
      toast.success('Password created successfully!');

      // Fetch user's role for redirect
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        const { data: roleData } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .maybeSingle();

        // Role-based redirect
        setTimeout(() => {
          if (roleData?.role === 'owner') {
            navigate('/settings?tab=company');
          } else {
            navigate('/dashboard');
          }
        }, 1500);
      } else {
        setTimeout(() => navigate('/dashboard'), 1500);
      }
    } catch (err) {
      console.error('[SetupAccount] Unexpected error:', err);
      toast.error('An unexpected error occurred');
      setIsSubmitting(false);
    }
  };

  const handleRequestNewLink = () => {
    navigate('/request-setup-link');
  };

  // Loading state
  if (setupState === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Verifying your link...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error state
  if (setupState === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle className="text-xl">Link Invalid or Expired</CardTitle>
            <CardDescription className="mt-2">
              {errorMessage}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button onClick={handleRequestNewLink} className="w-full">
              Request New Setup Link
            </Button>
            <Button variant="outline" onClick={() => navigate('/login')} className="w-full">
              Go to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Success state
  if (setupState === 'success') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4">
            <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
            <h2 className="text-xl font-semibold text-center">Password Created!</h2>
            <p className="text-muted-foreground text-center">
              Redirecting you to your dashboard...
            </p>
            <Loader2 className="h-5 w-5 animate-spin text-primary mt-2" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Ready state - show password form
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Create Your Password</CardTitle>
          <CardDescription className="mt-2">
            {userEmail ? (
              <>Setting up account for <strong className="text-foreground">{userEmail}</strong></>
            ) : (
              'Create a secure password to access your account'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  minLength={8}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">Must be at least 8 characters</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                required
              />
            </div>

            <Button 
              type="submit" 
              className="w-full mt-6" 
              disabled={isSubmitting || password.length < 8}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating Password...
                </>
              ) : (
                'Create Password'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
