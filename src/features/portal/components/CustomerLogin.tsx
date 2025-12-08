import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Shield, Users, HardHat, Home, 
  Mail, Phone, Loader2, ArrowRight
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

type UserType = 'admin' | 'sales_rep' | 'crew' | 'customer';

const USER_TYPES = [
  { id: 'admin' as const, label: 'Admin', icon: Shield, description: 'Full system access' },
  { id: 'sales_rep' as const, label: 'Sales Rep', icon: Users, description: 'Sales & CRM access' },
  { id: 'crew' as const, label: 'Crew', icon: HardHat, description: 'Field work access' },
  { id: 'customer' as const, label: 'Customer', icon: Home, description: 'View your project' },
];

interface CustomerLoginProps {
  onLoginSuccess?: () => void;
}

export function CustomerLogin({ onLoginSuccess }: CustomerLoginProps) {
  const navigate = useNavigate();
  const [userType, setUserType] = useState<UserType>('customer');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginMethod, setLoginMethod] = useState<'email' | 'phone'>('email');

  const handleStaffLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) throw signInError;

      onLoginSuccess?.();
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCustomerLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const identifier = loginMethod === 'email' ? email : phone;
      
      const { data, error: lookupError } = await supabase.functions.invoke('customer-portal-access', {
        body: { 
          action: 'customer_login',
          email: loginMethod === 'email' ? identifier : undefined,
          phone: loginMethod === 'phone' ? identifier : undefined,
        }
      });

      if (lookupError || !data?.success) {
        throw new Error(data?.error || 'No project found for this email/phone');
      }

      // Redirect to customer portal with token
      navigate(`/customer/${data.token}`);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const isCustomer = userType === 'customer';

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Welcome Back</CardTitle>
          <CardDescription>Select your account type to continue</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* User Type Selection */}
          <div className="grid grid-cols-2 gap-3">
            {USER_TYPES.map((type) => {
              const Icon = type.icon;
              const isSelected = userType === type.id;
              
              return (
                <button
                  key={type.id}
                  onClick={() => setUserType(type.id)}
                  className={cn(
                    "flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all",
                    isSelected 
                      ? "border-primary bg-primary/5" 
                      : "border-border hover:border-primary/50"
                  )}
                >
                  <div className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center",
                    isSelected ? "bg-primary text-primary-foreground" : "bg-muted"
                  )}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className="font-medium text-sm">{type.label}</span>
                </button>
              );
            })}
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Customer Login Form */}
          {isCustomer ? (
            <form onSubmit={handleCustomerLogin} className="space-y-4">
              <Tabs value={loginMethod} onValueChange={(v) => setLoginMethod(v as 'email' | 'phone')}>
                <TabsList className="grid grid-cols-2 w-full">
                  <TabsTrigger value="email" className="flex items-center gap-2">
                    <Mail className="w-4 h-4" />
                    Email
                  </TabsTrigger>
                  <TabsTrigger value="phone" className="flex items-center gap-2">
                    <Phone className="w-4 h-4" />
                    Phone
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="email" className="mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="customer-email">Email Address</Label>
                    <Input
                      id="customer-email"
                      type="email"
                      placeholder="your@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                </TabsContent>

                <TabsContent value="phone" className="mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="customer-phone">Phone Number</Label>
                    <Input
                      id="customer-phone"
                      type="tel"
                      placeholder="(555) 123-4567"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      required
                    />
                  </div>
                </TabsContent>
              </Tabs>

              <p className="text-xs text-muted-foreground text-center">
                Enter the email or phone number associated with your project
              </p>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Looking up project...
                  </>
                ) : (
                  <>
                    Access My Project
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </form>
          ) : (
            /* Staff Login Form */
            <form onSubmit={handleStaffLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="staff-email">Email</Label>
                <Input
                  id="staff-email"
                  type="email"
                  placeholder="your@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="staff-password">Password</Label>
                <Input
                  id="staff-password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    Sign In
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
