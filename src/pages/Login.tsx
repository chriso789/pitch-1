import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, AlertCircle, Eye, EyeOff, Wifi, WifiOff, Shield, UserPlus, KeyRound, ArrowLeft, CheckCircle } from 'lucide-react';

interface LoginProps {
  initialTab?: 'login' | 'signup' | 'forgot';
}

const Login: React.FC<LoginProps> = ({ initialTab = 'login' }) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user: authUser, session, loading: authLoading } = useAuth();
  
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [sessionCheckComplete, setSessionCheckComplete] = useState(false);
  const [loginAttempted, setLoginAttempted] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => {
    const saved = localStorage.getItem('pitch_remember_me');
    return saved === 'true';
  });
  
  // Login form state
  const [loginForm, setLoginForm] = useState({
    email: '',
    password: ''
  });

  // Signup form state  
  const [signupForm, setSignupForm] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: '',
    companyName: ''
  });

  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  
  // Enhanced profile creation for all users
  const ensureUserProfile = async (user: any) => {
    try {
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .maybeSingle();

      if (!existingProfile) {
        const profileData = {
          id: user.id,
          email: user.email,
          first_name: user.user_metadata?.first_name || user.email?.split('@')[0] || 'User',
          last_name: user.user_metadata?.last_name || '',
          role: 'project_manager' as const,
          company_name: user.user_metadata?.company_name || '',
          title: user.user_metadata?.title || '',
          tenant_id: user.user_metadata?.tenant_id || user.id,
        };

        const { error: profileError } = await supabase
          .from('profiles')
          .insert(profileData);

        if (profileError) {
          console.warn('Profile creation failed:', profileError);
        } else {
          console.log('Profile created successfully for user:', user.id);
        }
      }
    } catch (error) {
      console.warn('Profile check/creation error:', error);
    }
  };

  // Watch AuthContext - navigate when session is ready after login attempt
  useEffect(() => {
    if (loginAttempted && session && authUser && !authLoading) {
      console.log('[Login] AuthContext ready with session, navigating to dashboard');
      localStorage.setItem('pitch_remember_me', rememberMe.toString());
      
      // Background tasks (non-blocking)
      setTimeout(() => {
        ensureUserProfile(authUser).catch(console.warn);
        supabase.functions.invoke('log-auth-activity', {
          body: {
            user_id: authUser.id,
            email: authUser.email,
            event_type: 'login_success',
            success: true
          }
        }).catch(console.warn);
      }, 0);
      
      toast({
        title: "Login successful",
        description: "Welcome back!"
      });
      
      setLoading(false);
      setLoginAttempted(false);
      navigate('/dashboard');
    }
  }, [session, authUser, authLoading, loginAttempted, navigate, toast, rememberMe]);

  // Redirect if already authenticated (landing on /login while logged in)
  useEffect(() => {
    if (!authLoading && session && authUser && !loginAttempted) {
      console.log('[Login] Already authenticated, redirecting to dashboard');
      navigate('/dashboard');
    }
  }, [session, authUser, authLoading, loginAttempted, navigate]);

  useEffect(() => {
    // Check URL params for password reset success message
    const urlParams = new URLSearchParams(window.location.search);
    const message = urlParams.get('message');
    const tab = urlParams.get('tab');
    
    if (message === 'password-reset-success') {
      toast({
        title: "Password Reset Successful",
        description: "You can now sign in with your new password.",
      });
    }
    
    if (message === 'email-confirmed') {
      toast({
        title: "Email Confirmed!",
        description: "Your email has been confirmed. You can now sign in with your password.",
      });
    }
    
    if (tab === 'forgot') {
      setActiveTab('forgot');
    }

    // Non-blocking connection check - assume online, verify in background
    setConnectionStatus('online');
    setSessionCheckComplete(true);
    
    // Silent background connection verification
    supabase.auth.getSession()
      .then(() => setConnectionStatus('online'))
      .catch(() => setConnectionStatus('offline'));
  }, [toast]);

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validatePassword = (password: string) => {
    return password.length >= 6;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    
    if (!validateEmail(loginForm.email)) {
      setErrors({ email: 'Please enter a valid email address' });
      return;
    }

    if (!loginForm.password) {
      setErrors({ password: 'Password is required' });
      return;
    }

    setLoading(true);
    setLoginAttempted(true);
    console.log('[Login] Starting login attempt for:', loginForm.email);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: loginForm.email,
        password: loginForm.password
      });
      
      if (error) {
        setLoading(false);
        setLoginAttempted(false);
        
        // Handle specific errors
        if (error.message.includes('Invalid login credentials')) {
          setErrors({ general: 'Invalid email or password' });
        } else if (error.message.includes('Email not confirmed')) {
          setErrors({ general: 'Please check your email and click the confirmation link' });
        } else {
          setErrors({ general: error.message });
        }
        
        // Non-blocking: Log failed login attempt
        supabase.functions.invoke('log-auth-activity', {
          body: {
            email: loginForm.email,
            event_type: 'login_failed',
            success: false,
            error_message: error.message
          }
        }).catch(console.warn);
        
        return;
      }
      
      // Success! AuthContext will detect the session change
      // The useEffect watching session/authUser will handle navigation
      console.log('[Login] signInWithPassword succeeded, waiting for AuthContext...');
      
    } catch (error: any) {
      setLoading(false);
      setLoginAttempted(false);
      setErrors({ general: error.message || 'Connection error - please try again' });
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    
    if (!validateEmail(signupForm.email)) {
      setErrors({ email: 'Please enter a valid email address' });
      return;
    }

    if (!validatePassword(signupForm.password)) {
      setErrors({ 
        password: 'Password must be at least 6 characters' 
      });
      return;
    }

    if (signupForm.password !== signupForm.confirmPassword) {
      setErrors({ confirmPassword: 'Passwords do not match' });
      return;
    }

    if (!signupForm.firstName.trim()) {
      setErrors({ firstName: 'First name is required' });
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email: signupForm.email,
        password: signupForm.password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/confirm-email`,
          data: {
            first_name: signupForm.firstName.trim(),
            last_name: signupForm.lastName.trim(),
            company_name: signupForm.companyName.trim()
          }
        }
      });

      if (error) {
        if (error.message.includes('User already registered')) {
          setErrors({ general: 'An account with this email already exists. Please sign in instead.' });
        } else {
          setErrors({ general: error.message });
        }
        return;
      }

      if (data.user) {
        toast({
          title: "Account created successfully",
          description: "Please check your email to confirm your account.",
        });
        
        setSignupForm({
          email: '',
          password: '',
          confirmPassword: '',
          firstName: '',
          lastName: '',
          companyName: ''
        });
        setActiveTab('login');
      }
    } catch (error: any) {
      console.error('Signup error:', error);
      setErrors({ general: 'Connection error - please try again' });
    } finally {
      setLoading(false);
    }
  };

  const handleDemoRequest = () => {
    navigate('/demo-request');
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    
    if (!validateEmail(resetEmail)) {
      setErrors({ email: 'Please enter a valid email address' });
      return;
    }

    setResetLoading(true);

    try {
      // Send password reset email using Supabase Auth
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) {
        console.error('❌ Password reset error:', {
          email: resetEmail,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      } else {
        console.log('✅ Password reset email requested:', {
          email: resetEmail,
          redirectTo: `${window.location.origin}/reset-password`,
          timestamp: new Date().toISOString()
        });
        
        // Log password reset request
        supabase.functions.invoke('log-auth-activity', {
          body: {
            email: resetEmail,
            event_type: 'password_reset_request',
            success: true
          }
        }).catch(err => console.error('Failed to log activity:', err));
      }

      // Always show success message for security (don't reveal if email exists)
      toast({
        title: "Reset Link Sent",
        description: "If an account with that email exists, we've sent a password reset link. Please check your email and spam folder.",
      });

      setResetEmail('');
      setActiveTab('login');

    } catch (error: any) {
      console.error('Forgot password error:', error);
      setErrors({ general: 'An error occurred. Please try again.' });
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center gradient-hero p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-white mb-2">
            PITCH
          </h1>
          <p className="text-white/90 text-lg">
            Professional Roofing CRM
          </p>
          
          <div className="flex items-center justify-center gap-2 mt-4 text-sm">
            {connectionStatus === 'online' ? (
              <>
                <Wifi className="h-4 w-4 text-success-light" />
                <span className="text-white/80">Connected</span>
              </>
            ) : connectionStatus === 'offline' ? (
              <>
                <WifiOff className="h-4 w-4 text-warning" />
                <span className="text-white/80">Connection issues detected</span>
              </>
            ) : (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-white/60" />
                <span className="text-white/80">Checking connection...</span>
              </>
            )}
          </div>
        </div>

        <Card className="shadow-strong border-0 bg-white/95 backdrop-blur-sm">
          <CardHeader className="space-y-1 text-center">
            <CardTitle className="text-2xl font-semibold">Welcome Back</CardTitle>
            <CardDescription className="text-base">
              Sign in to access your roofing CRM dashboard
            </CardDescription>
          </CardHeader>
          <CardContent>
            {errors.general && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{errors.general}</AlertDescription>
              </Alert>
            )}


            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'login' | 'signup' | 'forgot')} className="space-y-4">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="login">
                  <Shield className="h-4 w-4 mr-2" />
                  Sign In
                </TabsTrigger>
                <TabsTrigger value="signup">
                  <UserPlus className="h-4 w-4 mr-2" />
                  Sign Up
                </TabsTrigger>
                <TabsTrigger value="forgot">
                  <KeyRound className="h-4 w-4 mr-2" />
                  Reset
                </TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="space-y-4">
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Email</Label>
                    <Input
                      id="login-email"
                      type="email"
                      placeholder="Enter your email"
                      value={loginForm.email}
                      onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                      className={errors.email ? 'border-destructive' : ''}
                    />
                    {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="login-password">Password</Label>
                    <div className="relative">
                      <Input
                        id="login-password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Enter your password"
                        value={loginForm.password}
                        onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                        className={errors.password ? 'border-destructive pr-10' : 'pr-10'}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                    {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
                  </div>

                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="remember-me"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="rounded border-input cursor-pointer"
                      data-testid="auth-remember-me"
                    />
                    <Label htmlFor="remember-me" className="text-sm font-normal cursor-pointer">
                      Keep me signed in
                    </Label>
                  </div>

                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      'Sign In'
                    )}
                  </Button>

                  <div className="text-center">
                    <Button
                      type="button"
                      variant="link"
                      className="text-sm text-muted-foreground hover:text-primary"
                      onClick={() => setActiveTab('forgot')}
                    >
                      Forgot your password?
                    </Button>
                  </div>
                </form>
              </TabsContent>

              <TabsContent value="signup" className="space-y-4">
                <form onSubmit={handleSignup} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="signup-firstName">First Name</Label>
                      <Input
                        id="signup-firstName"
                        type="text"
                        placeholder="First name"
                        value={signupForm.firstName}
                        onChange={(e) => setSignupForm({ ...signupForm, firstName: e.target.value })}
                        className={errors.firstName ? 'border-destructive' : ''}
                      />
                      {errors.firstName && <p className="text-sm text-destructive">{errors.firstName}</p>}
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="signup-lastName">Last Name</Label>
                      <Input
                        id="signup-lastName"
                        type="text"
                        placeholder="Last name"
                        value={signupForm.lastName}
                        onChange={(e) => setSignupForm({ ...signupForm, lastName: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <Input
                      id="signup-email"
                      type="email"
                      placeholder="Enter your email"
                      value={signupForm.email}
                      onChange={(e) => setSignupForm({ ...signupForm, email: e.target.value })}
                      className={errors.email ? 'border-destructive' : ''}
                    />
                    {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="signup-company">Company Name (Optional)</Label>
                    <Input
                      id="signup-company"
                      type="text"
                      placeholder="Your company name"
                      value={signupForm.companyName}
                      onChange={(e) => setSignupForm({ ...signupForm, companyName: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password</Label>
                    <div className="relative">
                      <Input
                        id="signup-password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Create a strong password"
                        value={signupForm.password}
                        onChange={(e) => setSignupForm({ ...signupForm, password: e.target.value })}
                        className={errors.password ? 'border-destructive pr-10' : 'pr-10'}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                    {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="signup-confirmPassword">Confirm Password</Label>
                    <Input
                      id="signup-confirmPassword"
                      type="password"
                      placeholder="Confirm your password"
                      value={signupForm.confirmPassword}
                      onChange={(e) => setSignupForm({ ...signupForm, confirmPassword: e.target.value })}
                      className={errors.confirmPassword ? 'border-destructive' : ''}
                    />
                    {errors.confirmPassword && <p className="text-sm text-destructive">{errors.confirmPassword}</p>}
                    <p className="text-xs text-muted-foreground">
                      Password must be at least 6 characters
                    </p>
                  </div>

                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creating account...
                      </>
                    ) : (
                      'Create Account'
                    )}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="forgot" className="space-y-4">
                <div className="text-center mb-4">
                  <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <KeyRound className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold">Reset Your Password</h3>
                  <p className="text-sm text-muted-foreground">
                    Enter your email address and we'll send you a link to reset your password.
                  </p>
                </div>

                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="reset-email">Email Address</Label>
                    <Input
                      id="reset-email"
                      type="email"
                      placeholder="Enter your email address"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      className={errors.email ? 'border-destructive' : ''}
                    />
                    {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
                  </div>

                  <Button type="submit" className="w-full" disabled={resetLoading}>
                    {resetLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sending Reset Link...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="mr-2 h-4 w-4" />
                        Send Reset Link
                      </>
                    )}
                  </Button>

                  <div className="text-center">
                    <Button
                      type="button"
                      variant="link"
                      className="text-sm text-muted-foreground hover:text-primary"
                      onClick={() => setActiveTab('login')}
                    >
                      <ArrowLeft className="h-4 w-4 mr-1" />
                      Back to Sign In
                    </Button>
                  </div>
                </form>

                <Alert className="border-primary/50 bg-primary/10">
                  <Shield className="h-4 w-4" />
                  <AlertDescription className="text-sm">
                    For security reasons, we'll send a reset link to your email if an account exists. 
                    The link will expire in 1 hour.
                  </AlertDescription>
                </Alert>
              </TabsContent>
            </Tabs>

            <div className="mt-6 pt-6 border-t">
              <Button
                onClick={handleDemoRequest}
                variant="outline"
                className="w-full"
                disabled={loading}
              >
                Request Demo Access
              </Button>
              <p className="text-xs text-muted-foreground text-center mt-2">
                Get personalized access to PITCH CRM
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="text-center space-y-2">
          <p className="text-white/80 text-sm">
            Need help accessing your account?
          </p>
          <p className="text-white/60 text-xs">
            Contact your system administrator or PITCH support
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;