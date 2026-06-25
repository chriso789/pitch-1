import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Home, 
  Lock, 
  ArrowRight, 
  Loader2, 
  CheckCircle, 
  Eye, 
  EyeOff,
  AlertCircle
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate, useSearchParams } from "react-router-dom";

export default function HomeownerSetupAccount() {
  const [searchParams] = useSearchParams();
  const contactId = searchParams.get('contact');
  const token = searchParams.get('token');
  
  const [step, setStep] = useState<'verify' | 'password'>('verify');
  const [verificationValue, setVerificationValue] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingInvite, setIsCheckingInvite] = useState(Boolean(token));
  const [contact, setContact] = useState<any>(null);
  const [error, setError] = useState('');
  
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    const verifyInvite = async () => {
      if (!token) {
        setIsCheckingInvite(false);
        return;
      }

      setError('');
      setIsCheckingInvite(true);

      try {
        const { data, error: inviteError } = await supabase.functions.invoke('homeowner-password', {
          body: { action: 'verify-invite', token, contact_id: contactId }
        });

        if (inviteError) throw new Error(inviteError.message || 'Invalid invite link');
        if (!data?.success || !data?.contact) throw new Error(data?.error || 'Invalid invite link');

        setContact(data.contact);
        setVerificationValue(data.contact.email || data.contact.phone || '');
        setStep('password');
      } catch (err: any) {
        setError(err.message || 'This invite link is invalid or expired. Please ask your project manager to resend it.');
      } finally {
        setIsCheckingInvite(false);
      }
    };

    verifyInvite();
  }, [contactId, token]);

  const verifyIdentity = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!token) {
      setError('Please open the setup link from your email invite. If you already created a password, sign in instead.');
      return;
    }

    setError('This invite link could not be verified. Please ask your project manager to resend it.');
  };

  const createPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (!/\d/.test(password)) {
      setError('Password must contain at least one number');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsLoading(true);

    try {
      const { data: pwResult, error: pwError } = await supabase.functions.invoke('homeowner-password', {
        body: { action: 'set-password', contact_id: contact.id, token, password }
      });

      if (pwError) throw new Error(pwError.message || 'Failed to set password');
      if (!pwResult?.success) throw new Error(pwResult?.error || 'Failed to set password');

      localStorage.setItem('homeowner_session', JSON.stringify({
        token: pwResult.token,
        contactId: pwResult.contact_id,
        tenantId: pwResult.tenant_id,
        email: pwResult.email,
        expiresAt: pwResult.expires_at
      }));

      toast({
        title: "Account Created!",
        description: "Welcome to your project portal",
      });

      navigate('/homeowner');

    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  if (isCheckingInvite) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Opening your homeowner setup link…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="h-16 w-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Home className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Set Up Your Account</h1>
          <p className="text-muted-foreground mt-2">
            Create a password to access your project portal
          </p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle>
              {step === 'verify' ? 'Verify Your Identity' : 'Create Password'}
            </CardTitle>
            <CardDescription>
              {step === 'verify' 
                ? token ? 'Checking your invite link' : 'Open the setup link from your email invite'
                : `Welcome, ${contact?.first_name}! Create a secure password`
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            {step === 'verify' ? (
              <form onSubmit={verifyIdentity} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="verification">Email or Phone</Label>
                  <Input
                    id="verification"
                    type="text"
                    placeholder="Enter your email or phone"
                    value={verificationValue}
                    onChange={(e) => setVerificationValue(e.target.value)}
                    required
                  />
                  {!token && (
                    <p className="text-xs text-muted-foreground">
                      The invite email opens this page with a secure setup token.
                    </p>
                  )}
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    {error}
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    <>
                      Continue
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </>
                  )}
                </Button>
              </form>
            ) : (
              <form onSubmit={createPassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Create a password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10 pr-10"
                      required
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    At least 8 characters with 1 number
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="confirmPassword"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Confirm your password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="pl-10"
                      required
                    />
                  </div>
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    {error}
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Creating Account...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      Create Account
                    </>
                  )}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <div className="mt-6 text-center">
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <a href="/portal/login" className="text-primary hover:underline">
              Sign In
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}