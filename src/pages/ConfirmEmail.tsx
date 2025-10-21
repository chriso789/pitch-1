import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Eye, EyeOff, CheckCircle2, XCircle, Shield } from 'lucide-react';

const ConfirmEmail = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [tokenValidated, setTokenValidated] = useState(false);
  const [userEmail, setUserEmail] = useState<string>('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string>('');
  const [settingPassword, setSettingPassword] = useState(false);

  useEffect(() => {
    const verifyToken = async () => {
      const token_hash = searchParams.get('token_hash');
      const type = searchParams.get('type');

      console.log('🔐 Verifying email confirmation token:', {
        hasTokenHash: !!token_hash,
        type,
        timestamp: new Date().toISOString()
      });

      if (!token_hash || type !== 'email') {
        console.error('❌ Missing or invalid token parameters');
        setError('Invalid confirmation link. Please request a new one.');
        setLoading(false);
        return;
      }

      try {
        const { data, error: verifyError } = await supabase.auth.verifyOtp({
          token_hash,
          type: 'email'
        });

        if (verifyError) {
          console.error('❌ Token verification failed:', verifyError);
          
          if (verifyError.message.includes('expired')) {
            setError('This confirmation link has expired. Please sign up again to receive a new link.');
          } else if (verifyError.message.includes('already been used')) {
            setError('This link has already been used. Try logging in instead.');
          } else {
            setError('Unable to verify your email. Please try again or contact support.');
          }
          setLoading(false);
          return;
        }

        if (data.session) {
          console.log('✅ Email confirmed successfully:', {
            email: data.session.user.email,
            userId: data.session.user.id,
            timestamp: new Date().toISOString()
          });

          setUserEmail(data.session.user.email || '');
          setTokenValidated(true);
        }
      } catch (err: any) {
        console.error('❌ Unexpected error during verification:', err);
        setError('An unexpected error occurred. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    verifyToken();
  }, [searchParams]);

  const validatePassword = (pwd: string) => {
    return pwd.length >= 6;
  };

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!validatePassword(password)) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSettingPassword(true);

    try {
      console.log('🔐 Setting user password...');

      const { error: updateError } = await supabase.auth.updateUser({
        password: password
      });

      if (updateError) {
        console.error('❌ Password update failed:', updateError);
        setError('Failed to set password. Please try again.');
        setSettingPassword(false);
        return;
      }

      console.log('✅ Password set successfully, redirecting to login');

      toast.success('Password Set!', {
        description: 'Your password has been set successfully. You can now sign in.',
      });

      // Redirect to login with success message
      setTimeout(() => {
        navigate('/login?message=email-confirmed');
      }, 1500);
    } catch (err: any) {
      console.error('❌ Unexpected error setting password:', err);
      setError('An unexpected error occurred. Please try again.');
      setSettingPassword(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-background via-muted/20 to-primary/5">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground">Verifying your email...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error state
  if (error && !tokenValidated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-background via-muted/20 to-primary/5">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <XCircle className="h-12 w-12 text-destructive" />
            </div>
            <CardTitle>Verification Failed</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button 
              onClick={() => navigate('/login?tab=signup')} 
              className="w-full"
              variant="outline"
            >
              Back to Sign Up
            </Button>
            <Button 
              onClick={() => navigate('/login')} 
              className="w-full"
            >
              Go to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Success state - Password setup form
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-background via-muted/20 to-primary/5">
      <Card className="w-full max-w-md shadow-soft">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
              <Shield className="h-6 w-6 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">Set Your Password</CardTitle>
          <CardDescription>
            Email confirmed for: <strong>{userEmail}</strong>
          </CardDescription>
        </CardHeader>

        <CardContent>
          <Alert className="mb-6 border-primary/20 bg-primary/5">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            <AlertDescription className="text-sm">
              Your email has been verified! Create a password to complete your account setup.
            </AlertDescription>
          </Alert>

          <form onSubmit={handleSetPassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10"
                  disabled={settingPassword}
                  required
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={settingPassword}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Confirm your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={settingPassword}
                required
              />
            </div>

            {/* Password requirements */}
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground font-medium">Password requirements:</p>
              <div className="flex items-center gap-2">
                {password.length >= 6 ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <div className="h-4 w-4 rounded-full border-2 border-muted" />
                )}
                <span className={password.length >= 6 ? 'text-green-600' : 'text-muted-foreground'}>
                  At least 6 characters
                </span>
              </div>
              <div className="flex items-center gap-2">
                {password && confirmPassword && password === confirmPassword ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <div className="h-4 w-4 rounded-full border-2 border-muted" />
                )}
                <span className={password && confirmPassword && password === confirmPassword ? 'text-green-600' : 'text-muted-foreground'}>
                  Passwords match
                </span>
              </div>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button 
              type="submit" 
              className="w-full" 
              disabled={settingPassword}
            >
              {settingPassword ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Setting Password...
                </>
              ) : (
                'Set Password & Continue'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default ConfirmEmail;
