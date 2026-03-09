import { useState } from "react";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ProposalTierSelector } from "@/components/proposals/ProposalTierSelector";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Sparkles, FileText, Send } from "lucide-react";
import { toast } from "sonner";

const GoodBetterBestBuilderPage = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<'configure' | 'preview' | 'send'>('configure');
  const [selectedTier, setSelectedTier] = useState<'good' | 'better' | 'best' | null>(null);
  
  // Form state for tier configuration
  const [tiers, setTiers] = useState([
    {
      tier: 'good' as const,
      totalPrice: 12500,
      warranty: { years: 10, type: 'Workmanship' },
      financing: [],
      materials: [
        { name: '3-Tab Shingles', quantity: 25, unit: 'bundles' },
        { name: 'Standard Underlayment', quantity: 4, unit: 'rolls' }
      ],
      labor: [
        { task: 'Tear-off & Installation', hours: 16 }
      ]
    },
    {
      tier: 'better' as const,
      totalPrice: 15900,
      warranty: { years: 25, type: 'Manufacturer' },
      financing: [],
      materials: [
        { name: 'Dimensional Shingles', quantity: 28, unit: 'bundles' },
        { name: 'Synthetic Underlayment', quantity: 5, unit: 'rolls' },
        { name: 'Ice & Water Shield', quantity: 8, unit: 'rolls' }
      ],
      labor: [
        { task: 'Premium Installation', hours: 20 }
      ]
    },
    {
      tier: 'best' as const,
      totalPrice: 21400,
      warranty: { years: 50, type: 'Lifetime' },
      financing: [],
      materials: [
        { name: 'Designer Luxury Shingles', quantity: 30, unit: 'bundles' },
        { name: 'Premium Underlayment', quantity: 6, unit: 'rolls' },
        { name: 'Full Perimeter I&W', quantity: 12, unit: 'rolls' },
        { name: 'Copper Flashing', quantity: 8, unit: 'pieces' }
      ],
      labor: [
        { task: 'Premium Installation + Ventilation', hours: 24 }
      ]
    }
  ]);

  const handlePriceChange = (tierLevel: 'good' | 'better' | 'best', price: number) => {
    setTiers(prev => prev.map(t => 
      t.tier === tierLevel ? { ...t, totalPrice: price } : t
    ));
  };

  const handleSendProposal = () => {
    if (!selectedTier) {
      toast.error("Please select a tier to send");
      return;
    }
    toast.success(`${selectedTier.toUpperCase()} tier proposal sent for e-signature!`);
    navigate('/proposals/analytics');
  };

  return (
    <GlobalLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Sparkles className="h-8 w-8 text-primary" />
              Good/Better/Best Proposal Builder
            </h1>
            <p className="text-muted-foreground mt-1">
              Create three-tier pricing options with interactive selection and instant e-sign
            </p>
          </div>
          <Badge variant="outline" className="px-3 py-1">Phase 20</Badge>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center justify-center gap-4">
          <Button 
            variant={step === 'configure' ? 'default' : 'outline'} 
            size="sm"
            onClick={() => setStep('configure')}
          >
            1. Configure Tiers
          </Button>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
          <Button 
            variant={step === 'preview' ? 'default' : 'outline'} 
            size="sm"
            onClick={() => setStep('preview')}
          >
            2. Preview & Select
          </Button>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
          <Button 
            variant={step === 'send' ? 'default' : 'outline'} 
            size="sm"
            onClick={() => setStep('send')}
          >
            3. Send for E-Sign
          </Button>
        </div>

        {/* Content */}
        {step === 'configure' && (
          <Tabs defaultValue="good" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="good">Good Tier</TabsTrigger>
              <TabsTrigger value="better">Better Tier</TabsTrigger>
              <TabsTrigger value="best">Best Tier</TabsTrigger>
            </TabsList>
            
            {tiers.map(tier => (
              <TabsContent key={tier.tier} value={tier.tier} className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Configure {tier.tier.toUpperCase()} Tier</CardTitle>
                    <CardDescription>Set pricing, warranty, and features</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor={`price-${tier.tier}`}>Total Price</Label>
                        <Input
                          id={`price-${tier.tier}`}
                          type="number"
                          value={tier.totalPrice}
                          onChange={(e) => handlePriceChange(tier.tier, Number(e.target.value))}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label htmlFor={`warranty-${tier.tier}`}>Warranty (Years)</Label>
                        <Input
                          id={`warranty-${tier.tier}`}
                          type="number"
                          value={tier.warranty.years}
                          className="mt-1"
                        />
                      </div>
                    </div>
                    
                    <div>
                      <Label>Materials Included</Label>
                      <Textarea 
                        value={tier.materials.map(m => `• ${m.name} (${m.quantity} ${m.unit})`).join('\n')}
                        rows={4}
                        className="mt-1 font-mono text-sm"
                        readOnly
                      />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            ))}
          </Tabs>
        )}

        {step === 'preview' && (
          <div className="space-y-4">
            <Card className="bg-primary/5">
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground text-center mb-4">
                  Select the tier you want to send to the customer for e-signature
                </p>
              </CardContent>
            </Card>
            
            <ProposalTierSelector
              tiers={tiers}
              selectedTier={selectedTier}
              onSelect={setSelectedTier}
              showComparison={true}
            />
          </div>
        )}

        {step === 'send' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="h-5 w-5" />
                Send for E-Signature
              </CardTitle>
              <CardDescription>
                {selectedTier 
                  ? `Ready to send ${selectedTier.toUpperCase()} tier proposal`
                  : "Select a tier in the preview step first"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="customer-email">Customer Email</Label>
                <Input id="customer-email" type="email" placeholder="customer@example.com" className="mt-1" />
              </div>
              <div>
                <Label htmlFor="message">Personal Message (Optional)</Label>
                <Textarea 
                  id="message" 
                  placeholder="Thank you for choosing us for your roofing project..."
                  rows={4}
                  className="mt-1"
                />
              </div>
              {selectedTier && (
                <div className="p-4 bg-muted rounded-lg">
                  <p className="font-medium">Selected Tier: {selectedTier.toUpperCase()}</p>
                  <p className="text-2xl font-bold text-primary mt-1">
                    ${tiers.find(t => t.tier === selectedTier)?.totalPrice.toLocaleString()}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            onClick={() => {
              if (step === 'preview') setStep('configure');
              else if (step === 'send') setStep('preview');
            }}
            disabled={step === 'configure'}
          >
            Back
          </Button>
          <Button
            onClick={() => {
              if (step === 'configure') setStep('preview');
              else if (step === 'preview') setStep('send');
              else handleSendProposal();
            }}
          >
            {step === 'send' ? (
              <>
                <Send className="h-4 w-4 mr-2" />
                Send Proposal
              </>
            ) : (
              <>
                Next
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>
        </div>
      </div>
    </GlobalLayout>
  );
};

export default GoodBetterBestBuilderPage;
