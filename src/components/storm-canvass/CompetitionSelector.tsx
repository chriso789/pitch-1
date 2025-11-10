import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Trophy, Users } from 'lucide-react';

interface Competition {
  id: string;
  name: string;
  competition_type: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  participant_count?: number;
}

interface CompetitionSelectorProps {
  competitions: Competition[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  userEnrolledIds?: string[];
}

export function CompetitionSelector({ 
  competitions, 
  selectedId, 
  onSelect,
  userEnrolledIds = []
}: CompetitionSelectorProps) {
  const getTimeRemaining = (endDate: string) => {
    const end = new Date(endDate);
    const now = new Date();
    const diff = end.getTime() - now.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (days > 0) return `${days}d ${hours}h left`;
    if (hours > 0) return `${hours}h left`;
    return 'Ending soon';
  };

  const getTypeBadge = (type: string) => {
    const variants: Record<string, string> = {
      daily: 'secondary',
      weekly: 'default',
      monthly: 'outline'
    };
    return variants[type.toLowerCase()] || 'secondary';
  };

  return (
    <Select value={selectedId || undefined} onValueChange={onSelect}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select a competition">
          {selectedId && (
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-primary" />
              {competitions.find(c => c.id === selectedId)?.name}
            </div>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {competitions.map((competition) => {
          const isEnrolled = userEnrolledIds.includes(competition.id);
          return (
            <SelectItem key={competition.id} value={competition.id}>
              <div className="flex items-center justify-between w-full gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium">{competition.name}</span>
                    {isEnrolled && (
                      <Badge variant="secondary" className="text-xs">
                        Enrolled
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant={getTypeBadge(competition.competition_type) as any} className="text-xs">
                      {competition.competition_type}
                    </Badge>
                    <span>{getTimeRemaining(competition.end_date)}</span>
                    {competition.participant_count && (
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {competition.participant_count}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
