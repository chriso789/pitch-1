import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Lock, User, Palette, FileText, Rocket, CheckCircle2, 
  Eye, EyeOff, Loader2, AlertCircle, ArrowRight, ArrowLeft,
  Upload, Building2, LayoutDashboard, Users, Calendar, FileSpreadsheet, Play
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { LogoUploader } from '@/components/settings/LogoUploader';
import { InlineVideo } from '@/components/onboarding/VideoTutorialPlayer';
import { useOnboardingAnalytics } from '@/hooks/useOnboardingAnalytics';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import confetti from 'canvas-confetti';

interface OnboardingToken {
  id: string;
  tenant_id: string;
  user_id: string | null;
  email: string;
  expires_at: string;
  used_at: string | null;
  onboarding_progress: {
    current_step: number;
    completed_steps: number[];
  } | null;
}

interface TenantInfo {
  id: string;
  name: string;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
}

interface OnboardingVideo {
  step_key: string;
  video_type: 'youtube' | 'loom';
  video_id: string;
  title: string;
  description?: string;
  duration_seconds?: number;
}

const STEPS = [
  { key: 'password', label: 'Set Password', icon: Lock },
  { key: 'profile', label: 'Your Profile', icon: User },
  { key: 'branding', label: 'Company Branding', icon: Palette },
  { key: 'smartdocs', label: 'Smart Docs', icon: FileText },
  { key: 'tour', label: 'Feature Tour', icon: Rocket },
  { key: 'complete', label: 'All Done!', icon: CheckCircle2 },
];

export default function OnboardingWalkthrough() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [tokenData, setTokenData] = useState<OnboardingToken | null>(null);
  const [tenantInfo, setTenantInfo] = useState<TenantInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [videos, setVideos] = useState<OnboardingVideo[]>([]);
  
  // Analytics tracking
  const analytics = useOnboardingAnalytics(
    tokenData?.tenant_id,
    tokenData?.user_id || undefined
  );
  
  // Form states
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  
  const [profile, setProfile] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    timezone: 'America/Chicago',
  });
  
  const [branding, setBranding] = useState({
    logo_url: null as string | null,
    primary_color: '#16a34a',
    secondary_color: '#ca8a04',
  });

  useEffect(() => {
    validateToken();
    loadVideos();
  }, [token]);

  // Track step changes
  useEffect(() => {
    if (tokenData) {
      const stepKey = STEPS[currentStep]?.key;
      if (stepKey) {
        analytics.trackStepEntry(stepKey, currentStep);
      }
    }
  }, [currentStep, tokenData]);

  // Track dropoff on unmount
  useEffect(() => {
    return () => {
      if (tokenData && currentStep < STEPS.length - 1) {
        analytics.trackDropoff();
      }
    };
  }, [tokenData, currentStep]);

  const loadVideos = async () => {
    try {
      const { data } = await (supabase.from('onboarding_videos') as any)
        .select('*')
        .eq('is_active', true)
        .order('display_order');
      setVideos(data || []);
    } catch (err) {
      console.error('Failed to load videos:', err);
    }
  };

  const getVideoForStep = (stepKey: string): OnboardingVideo | undefined => {
    return videos.find(v => v.step_key === stepKey);
  };

  const validateToken = async () => {
    if (!token) {
      setError('Invalid onboarding link');
      setLoading(false);
      return;
    }

    try {
      // Fetch token data
      const { data: tokenRecord, error: tokenError } = await supabase
        .from('company_onboarding_tokens')
        .select('*')
        .eq('token', token)
        .single();

      if (tokenError || !tokenRecord) {
        setError('Invalid or expired onboarding link');
        setLoading(false);
        return;
      }

      // Check expiration
      if (new Date(tokenRecord.expires_at) < new Date()) {
        setError('This onboarding link has expired. Please contact support for a new link.');
        setLoading(false);
        return;
      }

      // Check if already used
      if (tokenRecord.used_at) {
        setError('This onboarding link has already been used. Please login to continue.');
        setLoading(false);
        return;
      }

      const progress = tokenRecord.onboarding_progress as OnboardingToken['onboarding_progress'];
      setTokenData({
        ...tokenRecord,
        onboarding_progress: progress,
      } as OnboardingToken);
      setCurrentStep(progress?.current_step || 0);

      // Fetch tenant info
      const { data: tenant } = await supabase
        .from('tenants')
        .select('id, name, logo_url, primary_color, secondary_color')
        .eq('id', tokenRecord.tenant_id)
        .single();

      if (tenant) {
        setTenantInfo(tenant);
        setBranding({
          logo_url: tenant.logo_url,
          primary_color: tenant.primary_color || '#16a34a',
          secondary_color: tenant.secondary_color || '#ca8a04',
        });
      }

      // Fetch user profile if exists
      if (tokenRecord.user_id) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('first_name, last_name, phone')
          .eq('id', tokenRecord.user_id)
          .single();
        
        if (profileData) {
          setProfile(prev => ({
            ...prev,
            first_name: profileData.first_name || '',
            last_name: profileData.last_name || '',
            phone: profileData.phone || '',
          }));
        }
      }

    } catch (err) {
      console.error('Token validation error:', err);
      setError('Failed to validate onboarding link');
    } finally {
      setLoading(false);
    }
  };

  const saveProgress = async (step: number) => {
    if (!tokenData) return;
    
    const completedSteps = [...(tokenData.onboarding_progress?.completed_steps || [])];
    if (!completedSteps.includes(currentStep)) {
      completedSteps.push(currentStep);
    }

    await supabase
      .from('company_onboarding_tokens')
      .update({
        onboarding_progress: {
          current_step: step,
          completed_steps: completedSteps,
        }
      })
      .eq('id', tokenData.id);
  };

  const validatePassword = (pwd: string) => {
    const errors: string[] = [];
    if (pwd.length < 8) errors.push('At least 8 characters');
    if (!/[A-Z]/.test(pwd)) errors.push('One uppercase letter');
    if (!/[a-z]/.test(pwd)) errors.push('One lowercase letter');
    if (!/[0-9]/.test(pwd)) errors.push('One number');
    return errors;
  };

  const handleSetPassword = async () => {
    if (!tokenData) return;
    
    const errors = validatePassword(password);
    if (errors.length > 0) {
      toast({ title: 'Password Requirements', description: errors.join(', '), variant: 'destructive' });
      return;
    }
    
    if (password !== confirmPassword) {
      toast({ title: 'Passwords do not match', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      // Update user password via admin API through edge function
      const { error } = await supabase.functions.invoke('admin-create-user', {
        body: {
          action: 'update_password',
          user_id: tokenData.user_id,
          password,
        }
      });

      if (error) throw error;

      toast({ title: 'Password set successfully!' });
      nextStep();
    } catch (err: any) {
      toast({ title: 'Failed to set password', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!tokenData?.user_id) return;
    
    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          first_name: profile.first_name,
          last_name: profile.last_name,
          phone: profile.phone,
        })
        .eq('id', tokenData.user_id);

      if (error) throw error;

      toast({ title: 'Profile updated!' });
      nextStep();
    } catch (err: any) {
      toast({ title: 'Failed to save profile', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBranding = async () => {
    if (!tenantInfo) return;
    
    setSaving(true);
    try {
      const { error } = await supabase
        .from('tenants')
        .update({
          logo_url: branding.logo_url,
          primary_color: branding.primary_color,
          secondary_color: branding.secondary_color,
        })
        .eq('id', tenantInfo.id);

      if (error) throw error;

      toast({ title: 'Branding saved!' });
      nextStep();
    } catch (err: any) {
      toast({ title: 'Failed to save branding', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = async () => {
    if (!tokenData) return;
    
    // Mark token as used
    await supabase
      .from('company_onboarding_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', tokenData.id);

    // Trigger confetti
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 }
    });

    toast({ title: '🎉 Onboarding Complete!', description: 'Welcome to PITCH CRM!' });
    
    setTimeout(() => {
      navigate('/login');
    }, 2000);
  };

  const nextStep = () => {
    // Track step completion before moving
    const stepKey = STEPS[currentStep]?.key;
    if (stepKey) {
      analytics.trackStepComplete(stepKey, currentStep);
    }
    
    const next = Math.min(currentStep + 1, STEPS.length - 1);
    setCurrentStep(next);
    saveProgress(next);
  };

  const prevStep = () => {
    const prev = Math.max(currentStep - 1, 0);
    setCurrentStep(prev);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Validating your onboarding link...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-2" />
            <CardTitle>Onboarding Error</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => navigate('/login')}>Go to Login</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const progress = ((currentStep + 1) / STEPS.length) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted p-4 md:p-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">
            Welcome to {tenantInfo?.name || 'PITCH CRM'}
          </h1>
          <p className="text-muted-foreground">Let's get your account set up in just a few steps</p>
        </div>

        {/* Progress */}
        <div className="mb-8">
          <div className="flex justify-between mb-2">
            {STEPS.map((step, idx) => (
              <div 
                key={step.key}
                className={`flex flex-col items-center ${idx <= currentStep ? 'text-primary' : 'text-muted-foreground'}`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center mb-1 ${
                  idx < currentStep ? 'bg-primary text-primary-foreground' :
                  idx === currentStep ? 'bg-primary/20 border-2 border-primary' :
                  'bg-muted'
                }`}>
                  <step.icon className="h-4 w-4" />
                </div>
                <span className="text-xs hidden md:block">{step.label}</span>
              </div>
            ))}
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Step Content */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {React.createElement(STEPS[currentStep].icon, { className: "h-5 w-5" })}
              {STEPS[currentStep].label}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Step 1: Password */}
            {currentStep === 0 && (
              <div className="space-y-4">
                <p className="text-muted-foreground">Create a secure password for your account.</p>
                
                <div className="space-y-2">
                  <Label>New Password</Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter password"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-2 top-1/2 -translate-y-1/2"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Confirm Password</Label>
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  {['8+ chars', 'Uppercase', 'Lowercase', 'Number'].map((req, i) => {
                    const checks = [
                      password.length >= 8,
                      /[A-Z]/.test(password),
                      /[a-z]/.test(password),
                      /[0-9]/.test(password),
                    ];
                    return (
                      <Badge key={req} variant={checks[i] ? 'default' : 'secondary'}>
                        {checks[i] ? '✓' : '○'} {req}
                      </Badge>
                    );
                  })}
                </div>

                <Button 
                  onClick={handleSetPassword} 
                  disabled={saving || validatePassword(password).length > 0 || password !== confirmPassword}
                  className="w-full"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Set Password & Continue
                </Button>
              </div>
            )}

            {/* Step 2: Profile */}
            {currentStep === 1 && (
              <div className="space-y-4">
                <p className="text-muted-foreground">Tell us a bit about yourself.</p>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>First Name</Label>
                    <Input
                      value={profile.first_name}
                      onChange={(e) => setProfile({ ...profile, first_name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Last Name</Label>
                    <Input
                      value={profile.last_name}
                      onChange={(e) => setProfile({ ...profile, last_name: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Phone Number</Label>
                  <Input
                    type="tel"
                    value={profile.phone}
                    onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                    placeholder="(555) 123-4567"
                  />
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" onClick={prevStep}>
                    <ArrowLeft className="h-4 w-4 mr-2" /> Back
                  </Button>
                  <Button onClick={handleSaveProfile} disabled={saving} className="flex-1">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Save & Continue
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3: Branding */}
            {currentStep === 2 && (
              <div className="space-y-6">
                <p className="text-muted-foreground">Customize your company branding.</p>
                
                <div className="space-y-2">
                  <Label>Company Logo</Label>
                  <LogoUploader
                    logoUrl={branding.logo_url}
                    onLogoUploaded={(url) => setBranding({ ...branding, logo_url: url })}
                    onLogoRemoved={() => setBranding({ ...branding, logo_url: null })}
                  />
                </div>

                <Separator />

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Primary Color</Label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={branding.primary_color}
                        onChange={(e) => setBranding({ ...branding, primary_color: e.target.value })}
                        className="h-10 w-14 rounded border cursor-pointer"
                      />
                      <Input
                        value={branding.primary_color}
                        onChange={(e) => setBranding({ ...branding, primary_color: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Secondary Color</Label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={branding.secondary_color}
                        onChange={(e) => setBranding({ ...branding, secondary_color: e.target.value })}
                        className="h-10 w-14 rounded border cursor-pointer"
                      />
                      <Input
                        value={branding.secondary_color}
                        onChange={(e) => setBranding({ ...branding, secondary_color: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" onClick={prevStep}>
                    <ArrowLeft className="h-4 w-4 mr-2" /> Back
                  </Button>
                  <Button onClick={handleSaveBranding} disabled={saving} className="flex-1">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Save & Continue
                  </Button>
                </div>
              </div>
            )}

            {/* Step 4: Smart Docs */}
            {currentStep === 3 && (
              <div className="space-y-4">
                <p className="text-muted-foreground">
                  Smart Docs is where you manage contracts, proposals, and company documents with smart auto-fill capabilities.
                </p>
                
                {/* Video Tutorial */}
                {getVideoForStep('smartdocs') && (
                  <div className="mb-4">
                    <InlineVideo
                      videoType={getVideoForStep('smartdocs')!.video_type}
                      videoId={getVideoForStep('smartdocs')!.video_id}
                      title={getVideoForStep('smartdocs')!.title}
                    />
                  </div>
                )}
                
                <div className="grid gap-4">
                  <Card className="p-4 border-primary/20 bg-primary/5">
                    <div className="flex items-start gap-3">
                      <FileText className="h-8 w-8 text-primary" />
                      <div>
                        <h4 className="font-semibold">Upload Templates</h4>
                        <p className="text-sm text-muted-foreground">
                          Add your contracts, proposals, and warranty documents
                        </p>
                      </div>
                    </div>
                  </Card>
                  
                  <Card className="p-4 border-primary/20 bg-primary/5">
                    <div className="flex items-start gap-3">
                      <Upload className="h-8 w-8 text-primary" />
                      <div>
                        <h4 className="font-semibold">Auto-Fill Tags</h4>
                        <p className="text-sm text-muted-foreground">
                          Use smart tags like {'{customer_name}'} to auto-populate documents
                        </p>
                      </div>
                    </div>
                  </Card>
                </div>

                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => window.open('/smartdocs', '_blank')}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Open Smart Docs (New Tab)
                </Button>

                <div className="flex gap-2">
                  <Button variant="outline" onClick={prevStep}>
                    <ArrowLeft className="h-4 w-4 mr-2" /> Back
                  </Button>
                  <Button onClick={nextStep} className="flex-1">
                    Continue to Feature Tour <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 5: Feature Tour */}
            {currentStep === 4 && (
              <div className="space-y-4">
                <p className="text-muted-foreground">
                  Explore the key features of PITCH CRM. Click any card to open that feature.
                </p>
                
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { icon: LayoutDashboard, label: 'Dashboard', path: '/dashboard', desc: 'Your command center' },
                    { icon: Users, label: 'Pipeline', path: '/pipeline', desc: 'Manage leads & deals' },
                    { icon: Building2, label: 'Contacts', path: '/client-list', desc: 'Customer database' },
                    { icon: FileSpreadsheet, label: 'Estimates', path: '/estimates', desc: 'Create proposals' },
                    { icon: Calendar, label: 'Calendar', path: '/calendar', desc: 'Schedule & appointments' },
                    { icon: FileText, label: 'Smart Docs', path: '/smartdocs', desc: 'Documents & contracts' },
                  ].map(({ icon: Icon, label, path, desc }) => (
                    <Card 
                      key={path}
                      className="p-4 cursor-pointer hover:border-primary hover:shadow-md transition-all"
                      onClick={() => window.open(path, '_blank')}
                    >
                      <Icon className="h-6 w-6 text-primary mb-2" />
                      <h4 className="font-semibold">{label}</h4>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </Card>
                  ))}
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" onClick={prevStep}>
                    <ArrowLeft className="h-4 w-4 mr-2" /> Back
                  </Button>
                  <Button onClick={nextStep} className="flex-1">
                    Finish Setup <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 6: Complete */}
            {currentStep === 5 && (
              <div className="text-center space-y-6 py-8">
                <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="h-10 w-10 text-primary" />
                </div>
                
                <div>
                  <h2 className="text-2xl font-bold mb-2">You're All Set! 🎉</h2>
                  <p className="text-muted-foreground">
                    Your account is ready. Click below to login and start using PITCH CRM.
                  </p>
                </div>

                <Button size="lg" onClick={handleComplete} className="px-8">
                  Go to Login <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Help text */}
        <p className="text-center text-sm text-muted-foreground mt-6">
          Need help? Contact support at support@pitch-crm.ai
        </p>
      </div>
    </div>
  );
}
