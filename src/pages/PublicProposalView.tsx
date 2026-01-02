import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { 
  Phone, 
  Mail, 
  Download, 
  Check, 
  Shield, 
  Clock, 
  Star,
  FileText,
  Calculator,
  ChevronRight,
  Loader2
} from 'lucide-react';
import { ProposalTierSelector } from '@/components/proposals/ProposalTierSelector';
import { ProposalAcceptFlow } from '@/components/proposals/ProposalAcceptFlow';

interface TierData {
  tier: 'good' | 'better' | 'best';
  totalPrice: number;
  warranty: { years: number; type: string; description?: string };
  financing: Array<{
    provider: string;
    termMonths: number;
    aprPercent: number;
    monthlyPayment: number;
  }>;
  materials: Array<{ name: string; quantity: number; unit: string }>;
  labor: Array<{ task: string; hours: number }>;
}

export default function PublicProposalView() {
  const { token } = useParams<{ token: string }>();
  const [selectedTier, setSelectedTier] = useState<'good' | 'better' | 'best' | null>(null);
  const [showAcceptFlow, setShowAcceptFlow] = useState(false);
  const sessionStartRef = useRef(Date.now());
  const hasTrackedViewRef = useRef(false);

  // Fetch proposal data by share token
  const { data: proposal, isLoading, error } = useQuery({
    queryKey: ['public-proposal', token],
    queryFn: async () => {
      if (!token) throw new Error('No token provided');

      const { data, error } = await supabase
        .from('enhanced_estimates')
        .select(`
          *,
          tenants (
            id,
            name,
            logo_url,
            phone,
            email,
            address,
            primary_color,
            secondary_color
          )
        `)
        .eq('share_token', token)
        .single();

      if (error) throw error;
      if (!data) throw new Error('Proposal not found');

      return data;
    },
    enabled: !!token,
  });

  // Track view mutation and send notifications
  const trackEvent = useMutation({
    mutationFn: async (params: { eventType: string; tier?: string }) => {
      if (!proposal) return;
      
      // Track the event
      const { error } = await supabase.functions.invoke('generate-proposal', {
        body: {
          action: 'track',
          estimateId: proposal.id,
          tenantId: proposal.tenant_id,
          eventType: params.eventType,
          selectedTier: params.tier,
          durationSeconds: Math.floor((Date.now() - sessionStartRef.current) / 1000)
        }
      });
      if (error) console.error('Track event error:', error);

      // Send SMS notification to rep for key events
      if (['viewed', 'tier_selected', 'signed'].includes(params.eventType)) {
        try {
          await supabase.functions.invoke('proposal-event-notifications', {
            body: {
              estimateId: proposal.id,
              eventType: params.eventType,
              customerName: proposal.customer_name,
              propertyAddress: proposal.customer_address,
              selectedTier: params.tier,
              tierAmount: params.tier ? 
                (params.tier === 'good' ? proposal.good_tier_total :
                 params.tier === 'better' ? proposal.better_tier_total :
                 proposal.best_tier_total) : undefined
            }
          });
        } catch (notifyError) {
          console.error('Notification error:', notifyError);
        }
      }
    }
  });

  // Track initial view
  useEffect(() => {
    if (proposal && !hasTrackedViewRef.current) {
      hasTrackedViewRef.current = true;
      trackEvent.mutate({ eventType: 'viewed' });
    }
  }, [proposal]);

  // Heartbeat for session duration tracking
  useEffect(() => {
    if (!proposal) return;
    
    const interval = setInterval(() => {
      trackEvent.mutate({ eventType: 'heartbeat' });
    }, 30000); // Every 30 seconds

    return () => clearInterval(interval);
  }, [proposal]);

  // Handle tier selection
  const handleTierSelect = (tier: 'good' | 'better' | 'best') => {
    setSelectedTier(tier);
    trackEvent.mutate({ eventType: 'tier_selected', tier });
  };

  // Build tier data from estimate
  const buildTierData = (): TierData[] => {
    if (!proposal) return [];

    const tierLineItems = proposal.tier_line_items as Record<string, any> || {};
    const warrantyDetails = proposal.warranty_tier_details as Record<string, any> || {};
    const financingOptions = proposal.financing_options as Array<any> || [];

    return ['good', 'better', 'best'].map((tierName) => {
      const tierKey = tierName as 'good' | 'better' | 'best';
      const total = tierName === 'good' ? proposal.good_tier_total :
                   tierName === 'better' ? proposal.better_tier_total :
                   proposal.best_tier_total;

      return {
        tier: tierKey,
        totalPrice: total || 0,
        warranty: warrantyDetails[tierName] || { years: 10, type: 'Standard' },
        financing: financingOptions.filter((f: any) => f.tier === tierName || !f.tier),
        materials: tierLineItems[tierName]?.materials || [],
        labor: tierLineItems[tierName]?.labor || []
      };
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Loading your proposal...</p>
        </div>
      </div>
    );
  }

  if (error || !proposal) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-6 text-center space-y-4">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground" />
            <h2 className="text-xl font-semibold">Proposal Not Found</h2>
            <p className="text-muted-foreground">
              This proposal link may have expired or is invalid.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const tenant = proposal.tenants as any;
  const tiers = buildTierData();
  const selectedTierData = selectedTier ? tiers.find(t => t.tier === selectedTier) : null;

  // Check if proposal is expired
  const isExpired = proposal.expires_at && new Date(proposal.expires_at) < new Date();

  if (showAcceptFlow && selectedTier) {
    return (
      <ProposalAcceptFlow
        proposal={proposal}
        selectedTier={selectedTier}
        tierData={selectedTierData!}
        tenant={tenant}
        onBack={() => setShowAcceptFlow(false)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      {/* Company Header */}
      <header 
        className="py-6 px-4 border-b"
        style={{ 
          backgroundColor: tenant?.primary_color ? `${tenant.primary_color}10` : undefined 
        }}
      >
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            {tenant?.logo_url && (
              <img 
                src={tenant.logo_url} 
                alt={tenant.name} 
                className="h-12 w-auto"
              />
            )}
            <div>
              <h1 className="font-bold text-xl">{tenant?.name || 'Roofing Company'}</h1>
              {tenant?.phone && (
                <p className="text-sm text-muted-foreground">{tenant.phone}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {tenant?.phone && (
              <Button variant="outline" size="sm" asChild>
                <a href={`tel:${tenant.phone}`}>
                  <Phone className="h-4 w-4 mr-2" />
                  Call
                </a>
              </Button>
            )}
            {tenant?.email && (
              <Button variant="outline" size="sm" asChild>
                <a href={`mailto:${tenant.email}`}>
                  <Mail className="h-4 w-4 mr-2" />
                  Email
                </a>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        {/* Welcome Section */}
        <div className="text-center space-y-2">
          <h2 className="text-3xl font-bold">Your Roofing Proposal</h2>
          <p className="text-muted-foreground">
            Prepared for {proposal.customer_name}
          </p>
          {proposal.customer_address && (
            <p className="text-sm text-muted-foreground">{proposal.customer_address}</p>
          )}
        </div>

        {/* Status Badges */}
        <div className="flex justify-center gap-2 flex-wrap">
          <Badge variant="secondary" className="gap-1">
            <FileText className="h-3 w-3" />
            Estimate #{proposal.estimate_number}
          </Badge>
          {proposal.roof_area_sq_ft && (
            <Badge variant="outline" className="gap-1">
              <Calculator className="h-3 w-3" />
              {proposal.roof_area_sq_ft.toLocaleString()} sq ft
            </Badge>
          )}
          {proposal.expires_at && !isExpired && (
            <Badge variant="outline" className="gap-1">
              <Clock className="h-3 w-3" />
              Valid until {new Date(proposal.expires_at).toLocaleDateString()}
            </Badge>
          )}
          {isExpired && (
            <Badge variant="destructive" className="gap-1">
              <Clock className="h-3 w-3" />
              Expired
            </Badge>
          )}
        </div>

        {/* Tier Selection */}
        <ProposalTierSelector
          tiers={tiers}
          selectedTier={selectedTier}
          onSelect={handleTierSelect}
          disabled={isExpired}
          showComparison={true}
        />

        {/* Accept CTA */}
        {selectedTier && !isExpired && (
          <Card className="border-primary/50 bg-primary/5">
            <CardContent className="py-6">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-center sm:text-left">
                  <h3 className="text-lg font-semibold">
                    Ready to proceed with the {selectedTier.charAt(0).toUpperCase() + selectedTier.slice(1)} option?
                  </h3>
                  <p className="text-muted-foreground">
                    ${selectedTierData?.totalPrice?.toLocaleString()} • {selectedTierData?.warranty.years}-year warranty
                  </p>
                </div>
                <Button 
                  size="lg" 
                  onClick={() => setShowAcceptFlow(true)}
                  className="gap-2"
                >
                  Accept & Sign
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Separator />

        {/* Scope of Work Preview */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Scope of Work
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {[
                'Complete tear-off of existing roofing materials',
                'Inspection and repair of roof decking as needed',
                'Installation of new underlayment and ice/water shield',
                'Installation of new drip edge and flashing',
                'Installation of premium shingles per selected tier',
                'Ridge cap and ventilation installation',
                'Complete cleanup and debris removal',
                'Final inspection and customer walkthrough'
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Trust Signals */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="py-4 text-center">
              <Shield className="h-8 w-8 mx-auto text-primary mb-2" />
              <p className="font-semibold">Licensed & Insured</p>
              <p className="text-sm text-muted-foreground">Fully protected</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-center">
              <Star className="h-8 w-8 mx-auto text-primary mb-2" />
              <p className="font-semibold">5-Star Rated</p>
              <p className="text-sm text-muted-foreground">Trusted by homeowners</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-center">
              <Clock className="h-8 w-8 mx-auto text-primary mb-2" />
              <p className="font-semibold">Fast Turnaround</p>
              <p className="text-sm text-muted-foreground">Weather permitting</p>
            </CardContent>
          </Card>
        </div>

        {/* Download PDF */}
        <div className="text-center">
          <Button variant="outline" className="gap-2">
            <Download className="h-4 w-4" />
            Download PDF
          </Button>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t py-6 mt-12">
        <div className="max-w-4xl mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} {tenant?.name}. All rights reserved.</p>
          {tenant?.address && <p className="mt-1">{tenant.address}</p>}
        </div>
      </footer>
    </div>
  );
}
