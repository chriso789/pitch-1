import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Gift, Users, DollarSign, CreditCard, Sparkles,
  ChevronRight, Trophy, Send, Star
} from 'lucide-react';
import { CustomerReward, CustomerReferral } from '../hooks/useCustomerPortal';
import { cn } from '@/lib/utils';

interface ReferralRewardsSectionProps {
  rewards: CustomerReward | null;
  referrals: CustomerReferral[];
  onSubmitReferral: (referral: { name: string; email?: string; phone?: string }) => Promise<void>;
  onRedeemPoints: (points: number, type: 'cash' | 'gift' | 'project_credit') => Promise<void>;
}

const REDEMPTION_OPTIONS = [
  { 
    type: 'cash' as const, 
    name: 'Cash Out', 
    icon: DollarSign, 
    description: '$10 per 1,000 points',
    minPoints: 1000,
    valuePerPoint: 0.01
  },
  { 
    type: 'gift' as const, 
    name: 'Gift Cards', 
    icon: Gift, 
    description: 'Amazon, Home Depot, & more',
    minPoints: 500,
    valuePerPoint: 0.01
  },
  { 
    type: 'project_credit' as const, 
    name: 'Project Credit', 
    icon: CreditCard, 
    description: 'Apply to future projects',
    minPoints: 500,
    valuePerPoint: 0.012 // Bonus value for project credit
  },
];

export function ReferralRewardsSection({ 
  rewards, 
  referrals, 
  onSubmitReferral, 
  onRedeemPoints 
}: ReferralRewardsSectionProps) {
  const [referralForm, setReferralForm] = useState({ name: '', email: '', phone: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showReferralDialog, setShowReferralDialog] = useState(false);
  const [showRedeemDialog, setShowRedeemDialog] = useState(false);
  const [selectedRedemption, setSelectedRedemption] = useState<typeof REDEMPTION_OPTIONS[0] | null>(null);
  const [redeemAmount, setRedeemAmount] = useState('');

  const handleSubmitReferral = async () => {
    if (!referralForm.name.trim()) return;
    
    setIsSubmitting(true);
    try {
      await onSubmitReferral(referralForm);
      setReferralForm({ name: '', email: '', phone: '' });
      setShowReferralDialog(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRedeemPoints = async () => {
    if (!selectedRedemption || !redeemAmount) return;
    
    const points = parseInt(redeemAmount);
    if (isNaN(points) || points < selectedRedemption.minPoints) return;
    
    setIsSubmitting(true);
    try {
      await onRedeemPoints(points, selectedRedemption.type);
      setShowRedeemDialog(false);
      setRedeemAmount('');
      setSelectedRedemption(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const pointsBalance = rewards?.points_balance || 0;

  return (
    <Card className="border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Trophy className="w-6 h-6 text-primary" />
          </div>
          <div>
            <CardTitle className="flex items-center gap-2">
              Rewards Program
              <Sparkles className="w-4 h-4 text-yellow-500" />
            </CardTitle>
            <CardDescription>Earn points by referring friends</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Points Balance */}
        <div className="flex items-center justify-between p-4 rounded-lg bg-gradient-to-r from-primary/20 to-primary/10">
          <div>
            <p className="text-sm text-muted-foreground">Your Points Balance</p>
            <p className="text-3xl font-bold text-primary">{pointsBalance.toLocaleString()}</p>
          </div>
          <Dialog open={showRedeemDialog} onOpenChange={setShowRedeemDialog}>
            <DialogTrigger asChild>
              <Button disabled={pointsBalance < 500}>
                <Gift className="w-4 h-4 mr-2" />
                Redeem
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Redeem Your Points</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Available: <strong>{pointsBalance.toLocaleString()} points</strong>
                </p>
                
                <div className="grid gap-3">
                  {REDEMPTION_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    const isSelected = selectedRedemption?.type === option.type;
                    const canAfford = pointsBalance >= option.minPoints;

                    return (
                      <button
                        key={option.type}
                        onClick={() => canAfford && setSelectedRedemption(option)}
                        disabled={!canAfford}
                        className={cn(
                          "flex items-center gap-4 p-4 rounded-lg border transition-all text-left",
                          isSelected && "border-primary bg-primary/10",
                          !isSelected && canAfford && "border-border hover:border-primary/50",
                          !canAfford && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        <div className={cn(
                          "w-10 h-10 rounded-full flex items-center justify-center",
                          isSelected ? "bg-primary text-primary-foreground" : "bg-muted"
                        )}>
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="flex-1">
                          <p className="font-medium">{option.name}</p>
                          <p className="text-sm text-muted-foreground">{option.description}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Min: {option.minPoints} points
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {selectedRedemption && (
                  <div className="space-y-2">
                    <Label>Points to redeem</Label>
                    <Input
                      type="number"
                      placeholder={`Min ${selectedRedemption.minPoints}`}
                      value={redeemAmount}
                      onChange={(e) => setRedeemAmount(e.target.value)}
                      min={selectedRedemption.minPoints}
                      max={pointsBalance}
                    />
                    {redeemAmount && parseInt(redeemAmount) >= selectedRedemption.minPoints && (
                      <p className="text-sm text-green-600">
                        Value: ${(parseInt(redeemAmount) * selectedRedemption.valuePerPoint).toFixed(2)}
                      </p>
                    )}
                  </div>
                )}

                <Button 
                  onClick={handleRedeemPoints} 
                  disabled={!selectedRedemption || !redeemAmount || parseInt(redeemAmount) < (selectedRedemption?.minPoints || 0) || isSubmitting}
                  className="w-full"
                >
                  Redeem Points
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Refer a Friend */}
        <Dialog open={showReferralDialog} onOpenChange={setShowReferralDialog}>
          <DialogTrigger asChild>
            <Button className="w-full" variant="outline" size="lg">
              <Users className="w-4 h-4 mr-2" />
              Refer a Friend - Earn 100+ Points
              <ChevronRight className="w-4 h-4 ml-auto" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Refer a Friend</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-primary/10 space-y-2">
                <p className="font-medium text-primary">Earn Points!</p>
                <ul className="text-sm space-y-1 text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Star className="w-3 h-3 text-yellow-500" /> 100 points - Referral submitted
                  </li>
                  <li className="flex items-center gap-2">
                    <Star className="w-3 h-3 text-yellow-500" /> 250 bonus - When we contact them
                  </li>
                  <li className="flex items-center gap-2">
                    <Star className="w-3 h-3 text-yellow-500" /> 1,000 bonus - When they become a customer
                  </li>
                </ul>
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">Friend's Name *</Label>
                <Input
                  id="name"
                  placeholder="John Smith"
                  value={referralForm.name}
                  onChange={(e) => setReferralForm(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="john@example.com"
                  value={referralForm.email}
                  onChange={(e) => setReferralForm(prev => ({ ...prev, email: e.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="(555) 123-4567"
                  value={referralForm.phone}
                  onChange={(e) => setReferralForm(prev => ({ ...prev, phone: e.target.value }))}
                />
              </div>

              <Button 
                onClick={handleSubmitReferral} 
                disabled={!referralForm.name.trim() || isSubmitting}
                className="w-full"
              >
                <Send className="w-4 h-4 mr-2" />
                Submit Referral
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Referral History */}
        {referrals.length > 0 && (
          <div className="space-y-3">
            <h4 className="font-medium text-sm text-muted-foreground">Your Referrals</h4>
            <div className="space-y-2">
              {referrals.map((referral) => (
                <div 
                  key={referral.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                >
                  <div>
                    <p className="font-medium">{referral.referred_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(referral.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={
                      referral.status === 'converted' ? 'default' :
                      referral.status === 'contacted' ? 'secondary' : 'outline'
                    }>
                      {referral.status}
                    </Badge>
                    {referral.reward_points_earned > 0 && (
                      <Badge variant="secondary" className="bg-green-500/10 text-green-600">
                        +{referral.reward_points_earned} pts
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
