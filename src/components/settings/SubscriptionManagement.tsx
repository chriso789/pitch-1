import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { 
  Check, 
  X, 
  CreditCard, 
  Calendar, 
  Users, 
  FileText, 
  Phone, 
  Zap,
  Building2,
  Crown,
  Star,
  Rocket
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useCompanySwitcher } from '@/hooks/useCompanySwitcher';
import { useEffectiveTenantId, useEffectiveTenantIdLoading } from '@/hooks/useEffectiveTenantId';
import { TenantCardAndSeatsPanel } from '@/components/settings/TenantCardAndSeatsPanel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface SubscriptionData {
  subscription_tier: string;
  subscription_status: string;
  subscription_expires_at: string | null;
  features_enabled: string[];
  billing_email: string | null;
}

const CREW_LOGIN_PRICE = 10;

const TIER_CONFIG = {
  crm: {
    name: 'CRM',
    price: 50,
    priceSuffix: '/user/mo',
    audience: 'Employees, sales reps, production & owners',
    crewPrice: CREW_LOGIN_PRICE,
    icon: Star,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
    features: {
      users: 'Unlimited',
      contacts: 'Unlimited',
      measurements: '—',
      smartDocs: 'Basic',
      powerDialer: '500 min/mo',
      apiAccess: false,
      whiteLabel: false,
      prioritySupport: false,
    }
  },
  crm_ai: {
    name: 'CRM + AI Measuring',
    price: 80,
    priceSuffix: '/user/mo',
    audience: 'Employees, sales reps, production & owners',
    crewPrice: CREW_LOGIN_PRICE,
    icon: Rocket,
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
    features: {
      users: 'Unlimited',
      contacts: 'Unlimited',
      measurements: 'Unlimited',
      smartDocs: 'Custom',
      powerDialer: 'Unlimited',
      apiAccess: true,
      whiteLabel: true,
      prioritySupport: true,
    }
  }
};

const FEATURE_LIST = [
  { key: 'users', label: 'Team Members', icon: Users },
  { key: 'contacts', label: 'Contacts', icon: Building2 },
  { key: 'measurements', label: 'Measurements/mo', icon: FileText },
  { key: 'smartDocs', label: 'Smart Documents', icon: FileText },
  { key: 'powerDialer', label: 'Power Dialer', icon: Phone },
  { key: 'apiAccess', label: 'API Access', icon: Zap },
  { key: 'whiteLabel', label: 'White Label', icon: Building2 },
  { key: 'prioritySupport', label: 'Priority Support', icon: Star },
];

export const SubscriptionManagement = () => {
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [billingTab, setBillingTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('billing') === 'payment' || params.has('card') ? 'payment' : 'plan';
  });
  const { toast } = useToast();
  const { activeCompany } = useCompanySwitcher();
  const effectiveTenantId = useEffectiveTenantId();
  const tenantLoading = useEffectiveTenantIdLoading();

  useEffect(() => {
    if (effectiveTenantId) {
      void fetchSubscription(effectiveTenantId);
      return;
    }
    if (!tenantLoading) {
      setSubscription(null);
    }
  }, [effectiveTenantId, tenantLoading]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('billing') === 'payment' || params.has('card')) {
      setBillingTab('payment');
    }
  }, []);

  const fetchSubscription = async (tenantId: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('tenants')
        .select('subscription_tier, subscription_status, subscription_expires_at, features_enabled, billing_email')
        .eq('id', tenantId)
        .single();

      if (error) throw error;
      setSubscription(data);
    } catch (error: any) {
      console.error('Error fetching subscription:', error);
      setSubscription({
        subscription_tier: 'crm',
        subscription_status: 'active',
        subscription_expires_at: null,
        features_enabled: [],
        billing_email: null,
      });
    } finally {
      setLoading(false);
    }
  };

  const rawTier = subscription?.subscription_tier || 'crm';
  const currentTier = rawTier in TIER_CONFIG ? rawTier : 'crm';
  const currentConfig = TIER_CONFIG[currentTier as keyof typeof TIER_CONFIG];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-500/20 text-green-700 border-green-500/30">Active</Badge>;
      case 'past_due':
        return <Badge variant="destructive">Past Due</Badge>;
      case 'canceled':
        return <Badge variant="secondary">Canceled</Badge>;
      case 'trialing':
        return <Badge className="bg-blue-500/20 text-blue-700 border-blue-500/30">Trial</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatFeatureValue = (value: any) => {
    if (typeof value === 'boolean') {
      return value ? (
        <Check className="h-5 w-5 text-green-500" />
      ) : (
        <X className="h-5 w-5 text-muted-foreground/50" />
      );
    }
    return <span className="font-medium">{value.toLocaleString()}</span>;
  };

  return (
    <Tabs value={billingTab} onValueChange={setBillingTab} className="space-y-6">
      <TabsList>
        <TabsTrigger value="plan" className="gap-2">
          <Crown className="h-4 w-4" />
          Plan
        </TabsTrigger>
        <TabsTrigger value="payment" className="gap-2">
          <CreditCard className="h-4 w-4" />
          Payment &amp; Seats
        </TabsTrigger>
      </TabsList>

      <TabsContent value="payment" className="space-y-6">
        <TenantCardAndSeatsPanel tenantId={effectiveTenantId} />
      </TabsContent>

      <TabsContent value="plan" className="space-y-6">
      {/* Current Subscription Overview */}
      <Card className={`${currentConfig.bgColor} ${currentConfig.borderColor} border-2`}>

        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-3 rounded-lg ${currentConfig.bgColor}`}>
                <currentConfig.icon className={`h-6 w-6 ${currentConfig.color}`} />
              </div>
              <div>
                <CardTitle className="text-xl">{currentConfig.name} Plan</CardTitle>
                <CardDescription>
                  {activeCompany?.tenant_name || 'Your Company'}
                </CardDescription>
              </div>
            </div>
            <div className="text-right">
              {loading && <Badge variant="secondary" className="mb-2">Refreshing…</Badge>}
              {getStatusBadge(subscription?.subscription_status || 'active')}
              {subscription?.subscription_expires_at && (
                <p className="text-sm text-muted-foreground mt-1">
                  <Calendar className="h-3 w-3 inline mr-1" />
                  Renews {new Date(subscription.subscription_expires_at).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-3xl font-bold">
                ${currentConfig.price}
                <span className="text-sm font-normal text-muted-foreground">{currentConfig.priceSuffix}</span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {currentConfig.audience} · Crew logins ${currentConfig.crewPrice}/login/mo
              </p>
            </div>
            <Button variant="outline" className="gap-2" onClick={() => setBillingTab('payment')}>
              <CreditCard className="h-4 w-4" />
              Manage Billing
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tier Comparison */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Compare Plans</h3>
        <div className="grid md:grid-cols-2 gap-4">
          {Object.entries(TIER_CONFIG).map(([tierKey, config]) => {
            const isCurrentTier = tierKey === currentTier;
            const TierIcon = config.icon;
            
            return (
              <Card 
                key={tierKey}
                className={`relative ${isCurrentTier ? `${config.borderColor} border-2` : ''}`}
              >
                {isCurrentTier && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className={`${config.bgColor} ${config.color.replace('text-', 'border-')}`}>
                      Current Plan
                    </Badge>
                  </div>
                )}
                <CardHeader className="text-center pb-2">
                  <div className={`mx-auto p-3 rounded-full ${config.bgColor} w-fit`}>
                    <TierIcon className={`h-6 w-6 ${config.color}`} />
                  </div>
                  <CardTitle className="mt-2">{config.name}</CardTitle>
                  <div className="text-2xl font-bold mt-2">
                    ${config.price}
                    <span className="text-sm font-normal text-muted-foreground">{config.priceSuffix}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{config.audience}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Separator />
                  {FEATURE_LIST.map(feature => {
                    const value = config.features[feature.key as keyof typeof config.features];
                    const FeatureIcon = feature.icon;
                    
                    return (
                      <div key={feature.key} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <FeatureIcon className="h-4 w-4" />
                          {feature.label}
                        </div>
                        {formatFeatureValue(value)}
                      </div>
                    );
                  })}
                  <Separator />
                  {isCurrentTier ? (
                    <Button variant="outline" className="w-full" disabled>
                      Current Plan
                    </Button>
                  ) : (
                    <Button className="w-full" variant="outline">
                      Switch Plan
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Crown className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Crew Logins — ${CREW_LOGIN_PRICE}/login/mo</CardTitle>
              <CardDescription>
                Available on every plan. Field crew members are billed per login, not per user seat.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Usage Stats (placeholder) */}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usage This Month</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Contacts</span>
              <span className="text-muted-foreground">
                245 / {typeof currentConfig.features.contacts === 'number' ? (currentConfig.features.contacts as number).toLocaleString() : currentConfig.features.contacts}
              </span>
            </div>
            <Progress value={typeof currentConfig.features.contacts === 'number' ? (245 / (currentConfig.features.contacts as number)) * 100 : 10} />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Measurements</span>
              <span className="text-muted-foreground">
                12 / {currentConfig.features.measurements}
              </span>
            </div>
            <Progress value={typeof currentConfig.features.measurements === 'number' ? (12 / (currentConfig.features.measurements as number)) * 100 : 5} />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Team Members</span>
              <span className="text-muted-foreground">
                3 / {currentConfig.features.users}
              </span>
            </div>
            <Progress value={typeof currentConfig.features.users === 'number' ? (3 / (currentConfig.features.users as number)) * 100 : 10} />
          </div>
        </CardContent>
      </Card>
      </TabsContent>
    </Tabs>

  );
};
