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

interface SubscriptionData {
  subscription_tier: string;
  subscription_status: string;
  subscription_expires_at: string | null;
  features_enabled: string[];
  billing_email: string | null;
}

const TIER_CONFIG = {
  starter: {
    name: 'Starter',
    price: 199,
    icon: Star,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
    features: {
      users: 5,
      contacts: 1000,
      measurements: 50,
      smartDocs: 'Basic',
      powerDialer: false,
      apiAccess: false,
      whiteLabel: false,
      prioritySupport: false,
    }
  },
  professional: {
    name: 'Professional',
    price: 499,
    icon: Crown,
    color: 'text-primary',
    bgColor: 'bg-primary/10',
    borderColor: 'border-primary/30',
    features: {
      users: 25,
      contacts: 10000,
      measurements: 200,
      smartDocs: 'Advanced',
      powerDialer: true,
      apiAccess: false,
      whiteLabel: false,
      prioritySupport: true,
    }
  },
  enterprise: {
    name: 'Enterprise',
    price: null,
    icon: Rocket,
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
    features: {
      users: 'Unlimited',
      contacts: 'Unlimited',
      measurements: 'Unlimited',
      smartDocs: 'Custom',
      powerDialer: true,
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
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { activeCompanyId, activeCompany } = useCompanySwitcher();

  useEffect(() => {
    if (activeCompanyId) {
      fetchSubscription();
    }
  }, [activeCompanyId]);

  const fetchSubscription = async () => {
    try {
      const { data, error } = await supabase
        .from('tenants')
        .select('subscription_tier, subscription_status, subscription_expires_at, features_enabled, billing_email')
        .eq('id', activeCompanyId)
        .single();

      if (error) throw error;
      setSubscription(data);
    } catch (error: any) {
      console.error('Error fetching subscription:', error);
    } finally {
      setLoading(false);
    }
  };

  const currentTier = subscription?.subscription_tier || 'starter';
  const currentConfig = TIER_CONFIG[currentTier as keyof typeof TIER_CONFIG] || TIER_CONFIG.starter;

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

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-32 bg-muted animate-pulse rounded-lg" />
        <div className="grid md:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-96 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
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
                {currentConfig.price ? `$${currentConfig.price}` : 'Custom'}
                {currentConfig.price && <span className="text-sm font-normal text-muted-foreground">/month</span>}
              </p>
            </div>
            <Button variant="outline" className="gap-2">
              <CreditCard className="h-4 w-4" />
              Manage Billing
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tier Comparison */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Compare Plans</h3>
        <div className="grid md:grid-cols-3 gap-4">
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
                    {config.price ? (
                      <>
                        ${config.price}
                        <span className="text-sm font-normal text-muted-foreground">/mo</span>
                      </>
                    ) : (
                      <span className="text-lg">Custom Pricing</span>
                    )}
                  </div>
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
                  ) : tierKey === 'enterprise' ? (
                    <Button variant="outline" className="w-full">
                      Contact Sales
                    </Button>
                  ) : (
                    <Button 
                      className="w-full"
                      variant={tierKey === 'professional' ? 'default' : 'outline'}
                    >
                      {currentTier === 'starter' && tierKey === 'professional' ? 'Upgrade' : 'Switch Plan'}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

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
                245 / {typeof currentConfig.features.contacts === 'number' ? currentConfig.features.contacts.toLocaleString() : currentConfig.features.contacts}
              </span>
            </div>
            <Progress value={typeof currentConfig.features.contacts === 'number' ? (245 / currentConfig.features.contacts) * 100 : 10} />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Measurements</span>
              <span className="text-muted-foreground">
                12 / {typeof currentConfig.features.measurements === 'number' ? currentConfig.features.measurements : currentConfig.features.measurements}
              </span>
            </div>
            <Progress value={typeof currentConfig.features.measurements === 'number' ? (12 / currentConfig.features.measurements) * 100 : 5} />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Team Members</span>
              <span className="text-muted-foreground">
                3 / {typeof currentConfig.features.users === 'number' ? currentConfig.features.users : currentConfig.features.users}
              </span>
            </div>
            <Progress value={typeof currentConfig.features.users === 'number' ? (3 / currentConfig.features.users) * 100 : 10} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
