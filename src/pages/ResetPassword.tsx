import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, AlertCircle, CheckCircle, Eye, EyeOff, Shield, ArrowLeft } from 'lucide-react';

const ResetPassword: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isValidToken, setIsValidToken] = useState<boolean | null>(null);
  const [tokenValidated, setTokenValidated] = useState(false);
  
  const [formData, setFormData] = useState({
    password: '',
    confirmPassword: ''
  });
  
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  // Get access token from URL parameters
  const accessToken = searchParams.get('access_token');
  const refreshToken = searchParams.get('refresh_token');
  const tokenType = searchParams.get('type');

  useEffect(() => {
    validateResetToken();
  }, [accessToken, refreshToken]);

  const validateResetToken = async () => {
    console.log('🔐 Validating reset token:', {
      hasAccessToken: !!accessToken,
      hasRefreshToken: !!refreshToken,
      type: tokenType,
      timestamp: new Date().toISOString()
    });

    // Check if we have the required tokens
    if (!accessToken || tokenType !== 'recovery') {
      console.error('❌ Invalid token parameters:', {
        access_token: accessToken ? '[present]' : '[missing]',
        refresh_token: refreshToken ? '[present]' : '[missing]',
        type: tokenType,
      });
      setIsValidToken(false);
      setTokenValidated(true);
      return;
    }

    try {
      // Set the session using the tokens from URL
      const { data: { session }, error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken || ''
      });

      if (error) {
        console.error('❌ Token validation failed:', {
          error: error.message,
          timestamp: new Date().toISOString()
        });
        setIsValidToken(false);
      } else if (session) {
        console.log('✅ Token validated successfully:', {
          userId: session.user?.id,
          timestamp: new Date().toISOString()
        });
        setIsValidToken(true);
      } else {
        console.error('❌ No session returned from token validation');
        setIsValidToken(false);
      }
    } catch (error) {
      console.error('❌ Exception during token validation:', error);
      setIsValidToken(false);
    } finally {
      setTokenValidated(true);
    }
  };

  const validatePassword = (password: string) => {
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    return passwordRegex.test(password);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    
    if (!validatePassword(formData.password)) {
      setErrors({ 
        password: 'Password must be at least 8 characters with uppercase, lowercase, number, and special character' 
      });
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setErrors({ confirmPassword: 'Passwords do not match' });
      return;
    }

    setLoading(true);
    console.log('🔄 Attempting password reset...');

    try {
      const { error } = await supabase.auth.updateUser({
        password: formData.password
      });

      if (error) {
        console.error('❌ Password update failed:', {
          error: error.message,
          timestamp: new Date().toISOString()
        });
        setErrors({ general: error.message });
        return;
      }

      console.log('✅ Password updated successfully');
      toast({
        title: "Password Reset Successful",
        description: "Your password has been updated successfully. You can now sign in with your new password.",
      });

      // Sign out the user after successful password reset
      await supabase.auth.signOut();
      
      // Redirect to login page after a brief delay
      setTimeout(() => {
        navigate('/login?message=password-reset-success');
      }, 2000);

    } catch (error: any) {
      console.error('❌ Password reset exception:', error);
      setErrors({ general: 'An unexpected error occurred. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  if (!tokenValidated) {
    return (
      <div className="min-h-screen flex items-center justify-center gradient-hero p-4">
        <Card className="w-full max-w-md shadow-strong border-0 bg-white/95 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-center space-x-2">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span>Validating reset link...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isValidToken === false) {
    return (
      <div className="min-h-screen flex items-center justify-center gradient-hero p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-white mb-2">PITCH</h1>
            <p className="text-white/90 text-lg">Professional Roofing CRM</p>
          </div>

          <Card className="shadow-strong border-0 bg-white/95 backdrop-blur-sm">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertCircle className="h-6 w-6 text-destructive" />
              </div>
              <CardTitle className="text-2xl font-semibold text-destructive">Invalid or Expired Reset Link</CardTitle>
              <CardDescription>
                This password reset link cannot be used.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  The password reset link is either invalid, expired, or has already been used.
                </AlertDescription>
              </Alert>
              
              <div className="space-y-2 text-sm text-muted-foreground">
                <p className="font-semibold text-foreground">Common reasons:</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>The link is more than 1 hour old (links expire for security)</li>
                  <li>The link has already been used to reset your password</li>
                  <li>The link was not copied completely from your email</li>
                  <li>The redirect URL is not configured in Supabase settings</li>
                </ul>
              </div>

              <Alert className="border-primary/50 bg-primary/10">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  <strong>For administrators:</strong> Make sure <code className="text-xs bg-muted px-1 py-0.5 rounded">{window.location.origin}/reset-password</code> is added to "Redirect URLs" in your Supabase project under Authentication → URL Configuration.
                </AlertDescription>
              </Alert>
              
              <div className="space-y-2 pt-2">
                <Button 
                  onClick={() => navigate('/login?tab=forgot')} 
                  className="w-full"
                >
                  Request New Reset Link
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => navigate('/login')} 
                  className="w-full"
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Login
                </Button>
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
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Shield className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-2xl font-semibold">Reset Your Password</CardTitle>
            <CardDescription>
              Enter your new password below. Make sure it's strong and secure.
            </CardDescription>
          </CardHeader>
          
          <CardContent>
            <Alert className="mb-4 border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-sm text-amber-800 dark:text-amber-200">
                ⏰ <strong>Note:</strong> Password reset links expire after 1 hour for security. If your link has expired, request a new one from the login page.
              </AlertDescription>
            </Alert>

            {errors.general && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{errors.general}</AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">New Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your new password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
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
                <p className="text-xs text-muted-foreground">
                  Password must contain at least 8 characters with uppercase, lowercase, number, and special character
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm New Password</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="Confirm your new password"
                    value={formData.confirmPassword}
                    onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                    className={errors.confirmPassword ? 'border-destructive pr-10' : 'pr-10'}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                {errors.confirmPassword && <p className="text-sm text-destructive">{errors.confirmPassword}</p>}
              </div>

              <Button 
                type="submit" 
                className="w-full" 
                disabled={loading}
                data-testid="auth-reset-button"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Updating Password...
                  </>
                ) : (
                  <>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Update Password
                  </>
                )}
              </Button>
            </form>

            <div className="mt-4">
              <Button 
                variant="outline" 
                onClick={() => navigate('/login')} 
                className="w-full"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Login
              </Button>
            </div>

            <Alert className="mt-4 border-primary/50 bg-primary/10">
              <Shield className="h-4 w-4" />
              <AlertDescription className="text-sm">
                After updating your password, you'll be signed out and can log in with your new credentials.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ResetPassword;