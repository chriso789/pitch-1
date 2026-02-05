import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Calculator,
  FileText,
  Send,
  Loader2,
  Download,
} from 'lucide-react';
import { supabase } from "@/integrations/supabase/client";
import { downloadProposalPdf } from "@/lib/proposalPdfGenerator";
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { TierComparisonCard } from './TierComparisonCard';
import { ProposalPreview } from './ProposalPreview';
import {
  useCalculatePricing,
  useGenerateProposal,
  useSendProposal,
  type PricingInput,
  type TierPricing,
} from '@/hooks/useProposalGenerator';
import { cn } from '@/lib/utils';

interface ProposalBuilderProps {
  projectId: string;
  initialMeasurement?: {
    roofArea: number;
    pitch: string;
    complexity: 'simple' | 'moderate' | 'complex';
    stories: number;
  };
  onComplete?: (estimateId: string) => void;
}

const STEPS = [
  { id: 'measurements', label: 'Measurements', icon: Calculator },
  { id: 'pricing', label: 'Pricing Tiers', icon: FileText },
  { id: 'review', label: 'Review & Send', icon: Send },
];

export const ProposalBuilder = ({
  projectId,
  initialMeasurement,
  onComplete,
}: ProposalBuilderProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedTier, setSelectedTier] = useState<'good' | 'better' | 'best'>('better');
  const [estimateId, setEstimateId] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState<PricingInput>({
    roofArea: initialMeasurement?.roofArea || 2500,
    pitch: initialMeasurement?.pitch || '6/12',
    complexity: initialMeasurement?.complexity || 'moderate',
    stories: initialMeasurement?.stories || 1,
    wastePercentage: 10,
    overheadPercentage: 15,
    profitMargins: { good: 25, better: 30, best: 35 },
  });

  const [scopeOfWork, setScopeOfWork] = useState(
    'Complete tear-off of existing roofing materials. Install new underlayment, drip edge, and selected shingle system. Replace all pipe boots and flashing. Clean up and haul away all debris.'
  );

  // Mutations
  const calculatePricing = useCalculatePricing();
  const generateProposal = useGenerateProposal();
  const sendProposal = useSendProposal();
  const [downloading, setDownloading] = useState(false);

  const [tiers, setTiers] = useState<{
    good: TierPricing;
    better: TierPricing;
    best: TierPricing;
  } | null>(null);

  const handleCalculatePricing = async () => {
    try {
      const result = await calculatePricing.mutateAsync(formData);
      setTiers(result);
      setCurrentStep(1);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to calculate pricing',
        variant: 'destructive',
      });
    }
  };

  const handleGenerateProposal = async () => {
    try {
      const result = await generateProposal.mutateAsync({
        projectId,
        pricingInput: formData,
        scopeOfWork,
      });
      setEstimateId(result.estimateId);
      setCurrentStep(2);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to generate proposal',
        variant: 'destructive',
      });
    }
  };

  const handleSendProposal = async () => {
    if (!estimateId) return;

    try {
      await sendProposal.mutateAsync({
        estimateId,
        recipientEmail: 'customer@example.com', // TODO: Get from contact
      });
      toast({ title: 'Proposal Sent', description: 'The proposal has been sent to the customer.' });
      onComplete?.(estimateId);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to send proposal',
        variant: 'destructive',
      });
    }
  };

  const updateFormData = (key: keyof PricingInput, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-6">
      {/* Step Indicator */}
      <div className="flex items-center justify-center gap-2">
        {STEPS.map((step, idx) => {
          const Icon = step.icon;
          const isActive = idx === currentStep;
          const isComplete = idx < currentStep;

          return (
            <div key={step.id} className="flex items-center">
              <div
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-full transition-colors',
                  isActive && 'bg-primary text-primary-foreground',
                  isComplete && 'bg-primary/20 text-primary',
                  !isActive && !isComplete && 'bg-muted text-muted-foreground'
                )}
              >
                {isComplete ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
                <span className="text-sm font-medium">{step.label}</span>
              </div>
              {idx < STEPS.length - 1 && (
                <div className="w-8 h-0.5 bg-border mx-2" />
              )}
            </div>
          );
        })}
      </div>

      {/* Step Content */}
      {currentStep === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Roof Measurements & Settings</CardTitle>
            <CardDescription>
              Enter the roof measurements and configure pricing parameters
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Roof Area */}
              <div className="space-y-2">
                <Label>Roof Area (sq ft)</Label>
                <Input
                  type="number"
                  value={formData.roofArea}
                  onChange={(e) => updateFormData('roofArea', Number(e.target.value))}
                />
              </div>

              {/* Pitch */}
              <div className="space-y-2">
                <Label>Roof Pitch</Label>
                <Select
                  value={formData.pitch}
                  onValueChange={(v) => updateFormData('pitch', v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['4/12', '5/12', '6/12', '7/12', '8/12', '9/12', '10/12', '12/12'].map(
                      (pitch) => (
                        <SelectItem key={pitch} value={pitch}>
                          {pitch}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Complexity */}
              <div className="space-y-2">
                <Label>Complexity</Label>
                <Select
                  value={formData.complexity}
                  onValueChange={(v) =>
                    updateFormData('complexity', v as 'simple' | 'moderate' | 'complex')
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="simple">Simple (Few valleys/hips)</SelectItem>
                    <SelectItem value="moderate">Moderate (Multiple sections)</SelectItem>
                    <SelectItem value="complex">Complex (Many angles)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Stories */}
              <div className="space-y-2">
                <Label>Stories</Label>
                <Select
                  value={String(formData.stories)}
                  onValueChange={(v) => updateFormData('stories', Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 Story</SelectItem>
                    <SelectItem value="2">2 Stories</SelectItem>
                    <SelectItem value="3">3+ Stories</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Waste & Overhead */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <Label>Waste Factor: {formData.wastePercentage}%</Label>
                <Slider
                  value={[formData.wastePercentage || 10]}
                  onValueChange={([v]) => updateFormData('wastePercentage', v)}
                  min={5}
                  max={20}
                  step={1}
                />
              </div>
              <div className="space-y-4">
                <Label>Overhead: {formData.overheadPercentage}%</Label>
                <Slider
                  value={[formData.overheadPercentage || 15]}
                  onValueChange={([v]) => updateFormData('overheadPercentage', v)}
                  min={10}
                  max={30}
                  step={1}
                />
              </div>
            </div>

            {/* Scope of Work */}
            <div className="space-y-2">
              <Label>Scope of Work</Label>
              <Textarea
                value={scopeOfWork}
                onChange={(e) => setScopeOfWork(e.target.value)}
                rows={4}
              />
            </div>

            <div className="flex justify-end">
              <Button onClick={handleCalculatePricing} disabled={calculatePricing.isPending}>
                {calculatePricing.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Calculate Pricing
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {currentStep === 1 && tiers && (
        <div className="space-y-6">
          <div className="text-center">
            <h2 className="text-2xl font-bold">Choose Your Tier</h2>
            <p className="text-muted-foreground">
              Select the option that best fits your needs and budget
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <TierComparisonCard
              tier={tiers.good}
              isSelected={selectedTier === 'good'}
              onSelect={() => setSelectedTier('good')}
            />
            <TierComparisonCard
              tier={tiers.better}
              isSelected={selectedTier === 'better'}
              isPopular
              onSelect={() => setSelectedTier('better')}
            />
            <TierComparisonCard
              tier={tiers.best}
              isSelected={selectedTier === 'best'}
              onSelect={() => setSelectedTier('best')}
            />
          </div>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setCurrentStep(0)}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <Button onClick={handleGenerateProposal} disabled={generateProposal.isPending}>
              {generateProposal.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Generate Proposal
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {currentStep === 2 && estimateId && (
        <div className="space-y-6">
          <ProposalPreview
            estimateId={estimateId}
            onSend={handleSendProposal}
            onDownload={async () => {
              if (!estimateId || downloading) return;
              
              setDownloading(true);
              try {
                // Fetch the HTML preview
                const { data: previewData, error } = await supabase.functions.invoke('generate-proposal', {
                  body: { action: 'preview', estimateId },
                });
                
                if (error || !previewData?.html) {
                  throw new Error('Failed to fetch proposal preview');
                }
                
                // Generate and download PDF
                await downloadProposalPdf(
                  previewData.html,
                  `Proposal-${estimateId}.pdf`
                );
                
                toast({ title: 'Success', description: 'PDF downloaded successfully' });
              } catch (error) {
                console.error('PDF generation error:', error);
                toast({ 
                  title: 'Download Failed', 
                  description: 'Could not generate PDF. Please try again.',
                  variant: 'destructive'
                });
              } finally {
                setDownloading(false);
              }
            }}
            downloading={downloading}
          />

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setCurrentStep(1)}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Tiers
            </Button>
            <Button onClick={handleSendProposal} disabled={sendProposal.isPending}>
              {sendProposal.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <Send className="h-4 w-4 mr-2" />
              Send to Customer
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
