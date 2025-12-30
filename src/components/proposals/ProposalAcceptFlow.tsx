import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAcceptProposal } from '@/hooks/useProposalGenerator';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { 
  ArrowLeft, 
  Check, 
  Shield, 
  FileText, 
  Loader2,
  Calendar,
  DollarSign
} from 'lucide-react';

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
}

interface ProposalAcceptFlowProps {
  proposal: any;
  selectedTier: 'good' | 'better' | 'best';
  tierData: TierData;
  tenant: any;
  onBack: () => void;
}

export function ProposalAcceptFlow({
  proposal,
  selectedTier,
  tierData,
  tenant,
  onBack
}: ProposalAcceptFlowProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState<'confirm' | 'signing'>('confirm');
  const [formData, setFormData] = useState({
    fullName: proposal.customer_name || '',
    email: proposal.property_details?.email || '',
    phone: proposal.property_details?.phone || '',
    agreedToTerms: false
  });

  // Use the accept proposal hook
  const acceptProposal = useAcceptProposal();

  const handleAccept = () => {
    acceptProposal.mutate(
      {
        estimateId: proposal.id,
        tenantId: proposal.tenant_id,
        selectedTier,
        customerEmail: formData.email,
        customerName: formData.fullName,
        customerPhone: formData.phone
      },
      {
        onSuccess: (data) => {
          if (data?.signatureUrl) {
            toast.success('Proposal accepted! Redirecting to sign...');
            // Redirect to signature page
            navigate(data.signatureUrl);
          } else {
            toast.success('Proposal accepted! You will receive signing instructions via email.');
            setStep('signing');
          }
        },
        onError: (error: any) => {
          console.error('Accept error:', error);
          toast.error(error.message || 'Failed to accept proposal. Please try again.');
        }
      }
    );
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const tierLabels = {
    good: 'Good',
    better: 'Better',
    best: 'Best'
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.agreedToTerms) {
      toast.error('Please agree to the terms and conditions');
      return;
    }

    if (!formData.email) {
      toast.error('Please enter your email address');
      return;
    }

    if (!formData.fullName) {
      toast.error('Please enter your full name');
      return;
    }

    handleAccept();
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Accept Proposal</h1>
            <p className="text-muted-foreground">
              {tierLabels[selectedTier]} Option - {formatCurrency(tierData.totalPrice)}
            </p>
          </div>
        </div>

        {/* Selected Option Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Check className="h-5 w-5 text-primary" />
              Your Selected Option
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Package</p>
                <p className="font-semibold">{tierLabels[selectedTier]}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Price</p>
                <p className="font-semibold text-lg">{formatCurrency(tierData.totalPrice)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Warranty</p>
                <p className="font-semibold flex items-center gap-1">
                  <Shield className="h-4 w-4 text-primary" />
                  {tierData.warranty.years}-Year {tierData.warranty.type}
                </p>
              </div>
              {tierData.financing.length > 0 && (
                <div>
                  <p className="text-sm text-muted-foreground">Financing Available</p>
                  <p className="font-semibold flex items-center gap-1">
                    <DollarSign className="h-4 w-4 text-primary" />
                    From {formatCurrency(Math.min(...tierData.financing.map(f => f.monthlyPayment)))}/mo
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Confirmation Form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Confirm Your Information
            </CardTitle>
            <CardDescription>
              Please verify your information before proceeding to sign
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">Full Name</Label>
                <Input
                  id="fullName"
                  value={formData.fullName}
                  onChange={(e) => setFormData(prev => ({ ...prev, fullName: e.target.value }))}
                  placeholder="John Smith"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="john@example.com"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="(555) 123-4567"
                />
              </div>

              <Separator />

              <div className="flex items-start gap-3">
                <Checkbox
                  id="terms"
                  checked={formData.agreedToTerms}
                  onCheckedChange={(checked) => 
                    setFormData(prev => ({ ...prev, agreedToTerms: checked === true }))
                  }
                />
                <Label htmlFor="terms" className="text-sm leading-relaxed">
                  I agree to the terms and conditions outlined in this proposal. I understand that 
                  this is a binding agreement upon signature, and I authorize {tenant?.name || 'the contractor'} to 
                  perform the work as described.
                </Label>
              </div>
            </CardContent>

            <CardFooter className="flex flex-col gap-4">
              <Button 
                type="submit" 
                className="w-full gap-2" 
                size="lg"
                disabled={acceptProposal.isPending || !formData.agreedToTerms}
              >
                {acceptProposal.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    Proceed to Sign
                    <Check className="h-4 w-4" />
                  </>
                )}
              </Button>
              
              <p className="text-xs text-center text-muted-foreground">
                You will be redirected to securely sign this agreement. 
                A copy will be sent to your email upon completion.
              </p>
            </CardFooter>
          </form>
        </Card>

        {/* Payment Terms */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Payment Terms
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>• 10% deposit required to schedule the project</p>
            <p>• Balance due upon completion of work</p>
            <p>• Financing options available upon approval</p>
            <p>• All major credit cards accepted</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
