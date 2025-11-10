import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DollarSign, Trophy, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface PrizePoolDisplayProps {
  prizePool: Record<string, number>;
  endDate: string;
  userRank?: number;
}

export function PrizePoolDisplay({ prizePool, endDate, userRank }: PrizePoolDisplayProps) {
  const totalPrize = Object.values(prizePool).reduce((sum, val) => sum + val, 0);
  const prizeDistribution = Object.entries(prizePool)
    .sort(([a], [b]) => parseInt(a) - parseInt(b))
    .map(([rank, amount]) => ({
      rank: parseInt(rank),
      amount,
      label: rank === '1' ? '1st Place' : rank === '2' ? '2nd Place' : rank === '3' ? '3rd Place' : `${rank}th Place`,
      color: rank === '1' ? 'hsl(var(--chart-1))' : rank === '2' ? 'hsl(var(--chart-2))' : rank === '3' ? 'hsl(var(--chart-3))' : 'hsl(var(--chart-4))'
    }));

  const userPotentialPrize = userRank && prizePool[userRank.toString()] 
    ? prizePool[userRank.toString()] 
    : null;

  const getMedalEmoji = (rank: number) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return '🏆';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            Prize Pool
          </span>
          <Badge variant="secondary" className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDistanceToNow(new Date(endDate), { addSuffix: true })}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-center">
          <div className="text-4xl font-bold text-primary">
            ${totalPrize.toLocaleString()}
          </div>
          <p className="text-sm text-muted-foreground">Total Prize Pool</p>
        </div>

        {userPotentialPrize && (
          <div className="p-3 bg-primary/10 rounded-lg text-center">
            <p className="text-sm font-medium">Your potential prize</p>
            <p className="text-2xl font-bold text-primary">${userPotentialPrize}</p>
            <Badge variant="secondary" className="mt-1">
              Current rank: #{userRank}
            </Badge>
          </div>
        )}

        <div className="space-y-2">
          {prizeDistribution.map(({ rank, amount, label, color }) => (
            <div key={rank} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2">
                <span className="text-xl">{getMedalEmoji(rank)}</span>
                <span className="font-medium">{label}</span>
              </div>
              <div className="flex items-center gap-2">
                <div 
                  className="h-2 w-16 rounded-full" 
                  style={{ 
                    backgroundColor: color,
                    width: `${(amount / totalPrize) * 100}px`
                  }}
                />
                <span className="font-bold">${amount}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
