import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Eye, EyeOff, UserPlus, LogIn, Shield } from 'lucide-react';

interface AuthTabsProps {
  loading: boolean;
  setLoading: (loading: boolean) => void;
  errors: { [key: string]: string };
  setErrors: (errors: { [key: string]: string }) => void;
  showPassword: boolean;
  setShowPassword: (show: boolean) => void;
}

export const AuthTabs: React.FC<AuthTabsProps> = ({
  loading,
  setLoading,
  errors,
  setErrors,
  showPassword,
  setShowPassword,
}) => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('login');
  
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

  // Password setup form state
  const [setupForm, setSetupForm] = useState({
    email: '',
    tempPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validatePassword = (password: string) => {
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
    
    const timeoutId = setTimeout(() => {
      setLoading(false);
      setErrors({ general: 'Login timeout - please check your connection and try again' });
    }, 15000);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginForm.email,
        password: loginForm.password
      });

      clearTimeout(timeoutId);

      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          setErrors({ general: 'Invalid email or password' });
        } else if (error.message.includes('Email not confirmed')) {
          setErrors({ general: 'Please check your email and click the confirmation link before signing in' });
        } else if (error.message.includes('Too many requests')) {
          setErrors({ general: 'Too many login attempts. Please wait a moment and try again' });
        } else {
          setErrors({ general: error.message });
        }
        return;
      }

      if (data.user) {
        toast({
          title: "Login successful",
          description: "Welcome back to PITCH CRM!",
        });
      }
    } catch (error: any) {
      clearTimeout(timeoutId);
      console.error('Login error:', error);
      setErrors({ general: 'Connection error - please check your internet and try again' });
    } finally {
      setLoading(false);
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
        password: 'Password must be at least 8 characters with uppercase, lowercase, number, and special character' 
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
    
    const timeoutId = setTimeout(() => {
      setLoading(false);
      setErrors({ general: 'Signup timeout - please check your connection and try again' });
    }, 15000);

    try {
      const { data, error } = await supabase.auth.signUp({
        email: signupForm.email,
        password: signupForm.password,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
          data: {
            first_name: signupForm.firstName.trim(),
            last_name: signupForm.lastName.trim(),
            company_name: signupForm.companyName.trim()
          }
        }
      });

      clearTimeout(timeoutId);

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
          description: "Please check your email to confirm your account before signing in.",
        });
        
        // Clear form and switch to login
        setSignupForm({
          email: '',
          password: '',
          confirmPassword: '',
          firstName: '',
          lastName: '',
          companyName: ''
        });
        setActiveTab('login');
        setLoginForm({ email: signupForm.email, password: '' });
      }
    } catch (error: any) {
      clearTimeout(timeoutId);
      console.error('Signup error:', error);
      setErrors({ general: 'Connection error - please check your internet and try again' });
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

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
      <TabsList className="grid w-full grid-cols-3 bg-muted/50">
        <TabsTrigger value="login" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
          <LogIn className="h-4 w-4 mr-2" />
          Sign In
        </TabsTrigger>
        <TabsTrigger 
          value="signup" 
          data-testid="auth-toggle-mode"
          className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
        >
          <UserPlus className="h-4 w-4 mr-2" />
          Sign Up
        </TabsTrigger>
        <TabsTrigger value="setup" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
          <Shield className="h-4 w-4 mr-2" />
          Setup
        </TabsTrigger>
      </TabsList>

      {/* Login Tab */}
      <TabsContent value="login" className="space-y-4">
        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="login-email">Email</Label>
            <Input
              id="login-email"
              data-testid="auth-email-input"
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
                data-testid="auth-password-input"
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

          <Button type="submit" className="w-full" disabled={loading} data-testid="auth-submit-button">
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

      {/* Signup Tab */}
      <TabsContent value="signup" className="space-y-4">
        <form onSubmit={handleSignup} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="signup-firstName">First Name</Label>
              <Input
                id="signup-firstName"
                data-testid="auth-firstname-input"
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
                data-testid="auth-lastname-input"
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
              Must be 8+ characters with uppercase, lowercase, number, and special character
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

      {/* Password Setup Tab */}
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
              className={errors.email ? 'border-destructive' : ''}
            />
            {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="temp-password">Temporary Password</Label>
            <Input
              id="temp-password"
              type="password"
              placeholder="Enter the temporary password from email"
              value={setupForm.tempPassword}
              onChange={(e) => setSetupForm({ ...setupForm, tempPassword: e.target.value })}
              className={errors.tempPassword ? 'border-destructive' : ''}
            />
            {errors.tempPassword && <p className="text-sm text-destructive">{errors.tempPassword}</p>}
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
                className={errors.newPassword ? 'border-destructive pr-10' : 'pr-10'}
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
            {errors.newPassword && <p className="text-sm text-destructive">{errors.newPassword}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm Password</Label>
            <Input
              id="confirm-password"
              type="password"
              placeholder="Confirm your new password"
              value={setupForm.confirmPassword}
              onChange={(e) => setSetupForm({ ...setupForm, confirmPassword: e.target.value })}
              className={errors.confirmPassword ? 'border-destructive' : ''}
            />
            {errors.confirmPassword && <p className="text-sm text-destructive">{errors.confirmPassword}</p>}
            <p className="text-xs text-muted-foreground">
              Must be 8+ characters with uppercase, lowercase, number, and special character
            </p>
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
  );
};