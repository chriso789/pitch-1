import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [activeTab, setActiveTab] = useState('login');
  
  // Login form state
  const [loginForm, setLoginForm] = useState({
    email: '',
    password: ''
  });

  // Password setup form state
  const [setupForm, setSetupForm] = useState({
    email: '',
    tempPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  useEffect(() => {
    // Check if user is already logged in
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        navigate('/');
      }
    };
    checkAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        navigate('/');
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validatePassword = (password: string) => {
    // At least 8 characters, 1 uppercase, 1 lowercase, 1 number, 1 special char
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    return passwordRegex.test(password);
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
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginForm.email,
        password: loginForm.password
      });

      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          setErrors({ general: 'Invalid email or password' });
        } else {
          setErrors({ general: error.message });
        }
        return;
      }

      if (data.user) {
        toast({
          title: "Login successful",
          description: "Welcome back!",
        });
      }
    } catch (error: any) {
      console.error('Login error:', error);
      setErrors({ general: 'An unexpected error occurred' });
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    if (!validateEmail(setupForm.email)) {
      setErrors({ email: 'Please enter a valid email address' });
      return;
    }

    if (!setupForm.tempPassword) {
      setErrors({ tempPassword: 'Temporary password is required' });
      return;
    }

    if (!validatePassword(setupForm.newPassword)) {
      setErrors({ 
        newPassword: 'Password must be at least 8 characters with uppercase, lowercase, number, and special character' 
      });
      return;
    }

    if (setupForm.newPassword !== setupForm.confirmPassword) {
      setErrors({ confirmPassword: 'Passwords do not match' });
      return;
    }

    setLoading(true);
    try {
      // First, sign in with temporary password
      const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
        email: setupForm.email,
        password: setupForm.tempPassword
      });

      if (loginError) {
        setErrors({ tempPassword: 'Invalid email or temporary password' });
        return;
      }

      // Update password
      const { error: updateError } = await supabase.auth.updateUser({
        password: setupForm.newPassword
      });

      if (updateError) {
        setErrors({ general: 'Failed to update password' });
        return;
      }

      toast({
        title: "Password updated successfully",
        description: "You can now use your new password to log in.",
      });

      // Clear form and switch to login tab
      setSetupForm({
        email: '',
        tempPassword: '',
        newPassword: '',
        confirmPassword: ''
      });
      setActiveTab('login');
      
    } catch (error: any) {
      console.error('Password setup error:', error);
      setErrors({ general: 'An unexpected error occurred' });
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async () => {
    setLoading(true);
    try {
      const demoEmail = 'demo@roofingcrm.com';
      const demoPassword = 'DemoPassword123!';

      // Try to sign in first
      let { data, error } = await supabase.auth.signInWithPassword({
        email: demoEmail,
        password: demoPassword
      });

      if (error && error.message.includes('Invalid login credentials')) {
        // Create demo account if it doesn't exist
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email: demoEmail,
          password: demoPassword,
          options: {
            emailRedirectTo: `${window.location.origin}/`
          }
        });

        if (signUpError) {
          throw signUpError;
        }

        if (signUpData.user) {
          // Create demo profile
          const { error: profileError } = await supabase
            .from('profiles')
            .insert({
              id: signUpData.user.id,
              email: demoEmail,
              first_name: 'Demo',
              last_name: 'User',
              role: 'admin',
              company_name: 'Demo Company',
              title: 'Administrator',
              tenant_id: signUpData.user.id // Use user ID as tenant ID for demo
            });

          if (profileError) {
            console.warn('Profile creation failed:', profileError);
          }

          toast({
            title: "Demo account created",
            description: "Welcome to the demo!",
          });
        }
      } else if (error) {
        throw error;
      } else {
        toast({
          title: "Demo login successful",
          description: "Welcome to the demo!",
        });
      }
    } catch (error: any) {
      console.error('Demo login error:', error);
      setErrors({ general: 'Demo login failed. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold gradient-primary bg-clip-text text-transparent">
            Roofing CRM
          </h1>
          <p className="text-muted-foreground mt-2">
            Sign in to manage your roofing business
          </p>
        </div>

        <Card>
          <CardHeader className="space-y-1">
            <CardTitle>Welcome</CardTitle>
            <CardDescription>
              Sign in to your account or set up your password
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">Sign In</TabsTrigger>
                <TabsTrigger value="setup">Set Password</TabsTrigger>
              </TabsList>

              {errors.general && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{errors.general}</AlertDescription>
                </Alert>
              )}

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
                      className={errors.email ? 'border-red-500' : ''}
                    />
                    {errors.email && <p className="text-sm text-red-500">{errors.email}</p>}
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
                        className={errors.password ? 'border-red-500 pr-10' : 'pr-10'}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    {errors.password && <p className="text-sm text-red-500">{errors.password}</p>}
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
                </form>
              </TabsContent>

              <TabsContent value="setup" className="space-y-4">
                <form onSubmit={handlePasswordSetup} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="setup-email">Email</Label>
                    <Input
                      id="setup-email"
                      type="email"
                      placeholder="Enter your email"
                      value={setupForm.email}
                      onChange={(e) => setSetupForm({ ...setupForm, email: e.target.value })}
                      className={errors.email ? 'border-red-500' : ''}
                    />
                    {errors.email && <p className="text-sm text-red-500">{errors.email}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="temp-password">Temporary Password</Label>
                    <Input
                      id="temp-password"
                      type="password"
                      placeholder="Enter the temporary password from email"
                      value={setupForm.tempPassword}
                      onChange={(e) => setSetupForm({ ...setupForm, tempPassword: e.target.value })}
                      className={errors.tempPassword ? 'border-red-500' : ''}
                    />
                    {errors.tempPassword && <p className="text-sm text-red-500">{errors.tempPassword}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="new-password">New Password</Label>
                    <div className="relative">
                      <Input
                        id="new-password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Create a strong password"
                        value={setupForm.newPassword}
                        onChange={(e) => setSetupForm({ ...setupForm, newPassword: e.target.value })}
                        className={errors.newPassword ? 'border-red-500 pr-10' : 'pr-10'}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    {errors.newPassword && <p className="text-sm text-red-500">{errors.newPassword}</p>}
                    <p className="text-xs text-muted-foreground">
                      Must be 8+ characters with uppercase, lowercase, number, and special character
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirm-password">Confirm Password</Label>
                    <Input
                      id="confirm-password"
                      type="password"
                      placeholder="Confirm your new password"
                      value={setupForm.confirmPassword}
                      onChange={(e) => setSetupForm({ ...setupForm, confirmPassword: e.target.value })}
                      className={errors.confirmPassword ? 'border-red-500' : ''}
                    />
                    {errors.confirmPassword && <p className="text-sm text-red-500">{errors.confirmPassword}</p>}
                  </div>

                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Setting up password...
                      </>
                    ) : (
                      'Set Password'
                    )}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>

            <div className="mt-6 pt-6 border-t">
              <Button
                onClick={handleDemoLogin}
                variant="outline"
                className="w-full"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading demo...
                  </>
                ) : (
                  'Try Demo Account'
                )}
              </Button>
              <p className="text-xs text-muted-foreground text-center mt-2">
                Explore the system with sample data
              </p>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          Need help? Contact your system administrator
        </p>
      </div>
    </div>
  );
};

export default Login;