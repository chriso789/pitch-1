import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  DollarSign, 
  Clock, 
  CheckCircle2, 
  Package, 
  AlertCircle,
  ExternalLink,
  Download
} from 'lucide-react';
import { format } from 'date-fns';

interface Reward {
  id: string;
  user_id: string;
  achievement_id?: string;
  competition_id?: string;
  reward_type: string;
  reward_value: number;
  status: string;
  stripe_payout_id?: string;
  tracking_number?: string;
  reward_metadata?: any;
  created_at: string;
  processed_at?: string;
}

interface RewardHistoryProps {
  rewards: {
    all: Reward[];
    pending: Reward[];
    processing: Reward[];
    sent: Reward[];
    claimed: Reward[];
    totalValue: number;
  };
  onClaim?: (rewardId: string) => void;
  onExport?: () => void;
}

export function RewardHistory({ rewards, onClaim, onExport }: RewardHistoryProps) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'processing' | 'sent' | 'claimed'>('all');

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'processing':
        return <AlertCircle className="h-4 w-4 text-blue-500 animate-spin" />;
      case 'sent':
        return <Package className="h-4 w-4 text-purple-500" />;
      case 'claimed':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const getStatusLabel = (status: string) => {
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  const getStatusVariant = (status: string): "default" | "secondary" | "outline" | "destructive" => {
    switch (status) {
      case 'pending':
        return 'secondary';
      case 'processing':
        return 'default';
      case 'sent':
        return 'outline';
      case 'claimed':
        return 'secondary';
      default:
        return 'secondary';
    }
  };

  const displayedRewards = filter === 'all' ? rewards.all : rewards[filter];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            Reward History
          </span>
          <div className="flex items-center gap-2">
            <div className="text-right">
              <p className="text-2xl font-bold text-primary">
                ${rewards.totalValue.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">Lifetime Earnings</p>
            </div>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats Row */}
        <div className="grid grid-cols-4 gap-2">
          <div className="text-center p-2 rounded-lg bg-muted/50">
            <p className="text-xl font-bold text-yellow-600">{rewards.pending.length}</p>
            <p className="text-xs text-muted-foreground">Pending</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted/50">
            <p className="text-xl font-bold text-blue-600">{rewards.processing.length}</p>
            <p className="text-xs text-muted-foreground">Processing</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted/50">
            <p className="text-xl font-bold text-purple-600">{rewards.sent.length}</p>
            <p className="text-xs text-muted-foreground">Sent</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted/50">
            <p className="text-xl font-bold text-green-600">{rewards.claimed.length}</p>
            <p className="text-xs text-muted-foreground">Claimed</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant={filter === 'all' ? 'default' : 'outline'}
            onClick={() => setFilter('all')}
          >
            All
          </Button>
          <Button
            size="sm"
            variant={filter === 'pending' ? 'default' : 'outline'}
            onClick={() => setFilter('pending')}
          >
            Pending
          </Button>
          <Button
            size="sm"
            variant={filter === 'processing' ? 'default' : 'outline'}
            onClick={() => setFilter('processing')}
          >
            Processing
          </Button>
          <Button
            size="sm"
            variant={filter === 'sent' ? 'default' : 'outline'}
            onClick={() => setFilter('sent')}
          >
            Sent
          </Button>
          <Button
            size="sm"
            variant={filter === 'claimed' ? 'default' : 'outline'}
            onClick={() => setFilter('claimed')}
          >
            Claimed
          </Button>
          {onExport && (
            <Button size="sm" variant="outline" onClick={onExport} className="ml-auto">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          )}
        </div>

        {/* Reward List */}
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {displayedRewards.map((reward) => (
            <div 
              key={reward.id}
              className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
            >
              <div className="mt-1">
                {getStatusIcon(reward.status)}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div>
                    <p className="font-bold text-lg">${reward.reward_value}</p>
                    <p className="text-sm text-muted-foreground">
                      {reward.reward_metadata?.source || reward.reward_type}
                    </p>
                  </div>
                  <Badge variant={getStatusVariant(reward.status)}>
                    {getStatusLabel(reward.status)}
                  </Badge>
                </div>
                
                <p className="text-xs text-muted-foreground">
                  {format(new Date(reward.created_at), 'MMM dd, yyyy')}
                  {reward.processed_at && ` • Processed ${format(new Date(reward.processed_at), 'MMM dd')}`}
                </p>

                {reward.tracking_number && (
                  <div className="flex items-center gap-2 mt-2">
                    <Package className="h-3 w-3" />
                    <a 
                      href={`https://www.fedex.com/fedextrack/?trknbr=${reward.tracking_number}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      Track: {reward.tracking_number}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}

                {reward.status === 'pending' && onClaim && (
                  <Button 
                    size="sm" 
                    variant="default"
                    className="mt-2"
                    onClick={() => onClaim(reward.id)}
                  >
                    Claim Reward
                  </Button>
                )}
              </div>
            </div>
          ))}

          {displayedRewards.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No rewards in this category
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
