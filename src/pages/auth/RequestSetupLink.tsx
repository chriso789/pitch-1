import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Mail, ArrowLeft, CheckCircle, AlertCircle, KeyRound, LogIn, LogOut } from 'lucide-react';

const RequestSetupLink: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  
  // Check if user was redirected because they haven't set their password
  const needsPasswordSetup = (location.state as any)?.needsPasswordSetup === true;
  
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [hasSessionWithoutPassword, setHasSessionWithoutPassword] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Check if user is already authenticated with password set - redirect to dashboard
  useEffect(() => {
    const checkAuthAndRedirect = async () => {
      // Always clear stale setup flag on this page
      localStorage.removeItem('pitch_password_setup_in_progress');
      
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          // Fetch fresh profile to check password_set_at
          const { data: profile } = await supabase
            .from('profiles')
            .select('password_set_at, role')
            .eq('id', user.id)
            .single();
          
          if (profile?.password_set_at) {
            console.log('[RequestSetupLink] User already has password set, redirecting to dashboard');
            // Clear stale profile cache before redirect
            localStorage.removeItem('user-profile-cache');
            navigate('/dashboard', { replace: true });
            return;
          }
          
          // User is authenticated but password not set - show sign out option
          console.log('[RequestSetupLink] User has session but password not set');
          setHasSessionWithoutPassword(true);
        }
      } catch (err) {
        console.error('[RequestSetupLink] Error checking auth:', err);
      } finally {
        setCheckingAuth(false);
      }
    };
    
    checkAuthAndRedirect();
  }, [navigate]);

  // Handle sign out and go to login
  const handleSignOutAndLogin = async () => {
    setSigningOut(true);
    try {
      localStorage.removeItem('pitch_password_setup_in_progress');
      localStorage.removeItem('user-profile-cache');
      await supabase.auth.signOut({ scope: 'local' });
      navigate('/login', { replace: true });
    } catch (err) {
      console.error('[RequestSetupLink] Sign out error:', err);
      toast({
        title: 'Error',
        description: 'Failed to sign out. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setSigningOut(false);
    }
  };

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!validateEmail(email)) {
      setError('Please enter a valid email address');
      return;
    }

    setLoading(true);

    try {
      // Check if email exists as a company owner
      const { data: tenant, error: tenantError } = await supabase
        .from('tenants')
        .select('id, name, owner_email, owner_name')
        .eq('owner_email', email.toLowerCase())
        .single();

      if (tenantError || !tenant) {
        // Don't reveal if email exists for security
        setSent(true);
        return;
      }

      // Extract first name from owner_name
      const firstName = tenant.owner_name?.split(' ')[0] || 'User';

      // Call edge function to send new onboarding email
      const { error: sendError } = await supabase.functions.invoke('send-company-onboarding', {
        body: {
          tenant_id: tenant.id,
          email: tenant.owner_email,
          first_name: firstName,
          company_name: tenant.name,
        }
      });

      if (sendError) {
        console.error('Failed to send setup link:', sendError);
      }

      setSent(true);
      
      toast({
        title: "Setup Link Sent",
        description: "If an account with that email exists, a new setup link has been sent.",
      });

    } catch (err: any) {
      console.error('Request setup link error:', err);
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Show loading while checking auth
  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center gradient-hero p-4">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-white" />
          <p className="text-white/90">Checking authentication...</p>
        </div>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center gradient-hero p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-white mb-2">PITCH</h1>
            <p className="text-white/90 text-lg">Professional Roofing CRM</p>
          </div>

          <Card className="shadow-strong border-0 bg-white/95 backdrop-blur-sm">
            <CardContent className="pt-8 pb-8 text-center space-y-6">
              <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle className="h-8 w-8 text-success" />
              </div>
              
              <div className="space-y-2">
                <h2 className="text-xl font-semibold">Check Your Email</h2>
                <p className="text-muted-foreground">
                  If an account exists for <strong>{email}</strong>, we've sent a new setup link.
                </p>
                <p className="text-sm text-muted-foreground mt-4">
                  The link will expire in <strong>4 hours</strong>.
                </p>
              </div>

              <div className="space-y-3 pt-4">
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => { setSent(false); setEmail(''); }}
                >
                  Try a different email
                </Button>
                
                <Link to="/login" className="block">
                  <Button variant="ghost" className="w-full">
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to Login
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center gradient-hero p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-white mb-2">PITCH</h1>
          <p className="text-white/90 text-lg">Professional Roofing CRM</p>
        </div>

        <Card className="shadow-strong border-0 bg-white/95 backdrop-blur-sm">
          <CardHeader className="space-y-1 text-center">
            <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-2">
              <Mail className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-2xl font-semibold">Request New Setup Link</CardTitle>
            <CardDescription className="text-base">
              Enter your email address and we'll send you a new link to complete your account setup.
            </CardDescription>
          </CardHeader>
          
          <CardContent>
            {needsPasswordSetup && (
              <Alert className="mb-4 border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                <KeyRound className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-amber-800 dark:text-amber-200">
                  You need to complete your password setup before accessing the dashboard. 
                  Enter your email below to receive a new setup link.
                </AlertDescription>
              </Alert>
            )}
            
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your company email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Mail className="mr-2 h-4 w-4" />
                    Send Setup Link
                  </>
                )}
              </Button>

              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-2 text-muted-foreground">or</span>
                </div>
              </div>

              {hasSessionWithoutPassword ? (
                <Button 
                  type="button" 
                  variant="outline" 
                  className="w-full"
                  onClick={handleSignOutAndLogin}
                  disabled={signingOut}
                >
                  {signingOut ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Signing out...
                    </>
                  ) : (
                    <>
                      <LogOut className="mr-2 h-4 w-4" />
                      Sign Out & Go to Login
                    </>
                  )}
                </Button>
              ) : (
                <Link to="/login" className="block">
                  <Button type="button" variant="outline" className="w-full">
                    <LogIn className="mr-2 h-4 w-4" />
                    Login with Password
                  </Button>
                </Link>
              )}
            </form>

            <div className="mt-6 p-4 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground text-center">
                <strong>Note:</strong> Setup links expire after 4 hours for security. If you've already set up your password, use the regular login instead.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default RequestSetupLink;
