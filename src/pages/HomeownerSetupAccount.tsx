import { useState } from "react";
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
  const [contact, setContact] = useState<any>(null);
  const [error, setError] = useState('');
  
  const { toast } = useToast();
  const navigate = useNavigate();

  const verifyIdentity = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      // Verify phone or email matches contact record
      const { data: contactData, error: contactError } = await supabase
        .from('contacts')
        .select('id, first_name, email, phone, tenant_id, portal_access_enabled')
        .or(`email.eq.${verificationValue.toLowerCase()},phone.eq.${verificationValue}`)
        .single();

      if (contactError || !contactData) {
        throw new Error("We couldn't find an account matching that information. Please check and try again.");
      }

      if (!contactData.portal_access_enabled) {
        throw new Error("Portal access hasn't been enabled for your account yet. Please contact your project manager.");
      }

      setContact(contactData);
      setStep('password');

    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
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
      // Hash password (in production, this should be done server-side)
      const encoder = new TextEncoder();
      const data = encoder.encode(password);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      // Update contact with password hash
      const { error: updateError } = await supabase
        .from('contacts')
        .update({ 
          portal_password_hash: hashHex,
          portal_last_login_at: new Date().toISOString()
        })
        .eq('id', contact.id);

      if (updateError) throw updateError;

      // Create session
      const sessionToken = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

      const { error: sessionError } = await supabase
        .from('homeowner_portal_sessions')
        .insert({
          tenant_id: contact.tenant_id,
          contact_id: contact.id,
          token: sessionToken,
          email: contact.email,
          expires_at: expiresAt,
          auth_method: 'password'
        });

      if (sessionError) throw sessionError;

      // Store session
      localStorage.setItem('homeowner_session', JSON.stringify({
        token: sessionToken,
        contactId: contact.id,
        tenantId: contact.tenant_id,
        email: contact.email,
        expiresAt
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
                ? 'Enter your email or phone number to continue'
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
                  <p className="text-xs text-muted-foreground">
                    Use the same contact info from your project
                  </p>
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