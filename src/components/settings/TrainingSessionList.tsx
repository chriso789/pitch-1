import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MapPin, Calendar, ChevronRight, Search, Filter } from 'lucide-react';
import { format } from 'date-fns';
import { useState } from 'react';
import { TrainingSession } from './RoofTrainingLab';

interface TrainingSessionListProps {
  sessions: TrainingSession[];
  isLoading: boolean;
  onSelectSession: (session: TrainingSession) => void;
}

const statusConfig = {
  draft: { label: 'Draft', variant: 'outline' as const, className: 'border-muted-foreground/50 text-muted-foreground' },
  in_progress: { label: 'In Progress', variant: 'default' as const, className: 'bg-blue-500 hover:bg-blue-600' },
  completed: { label: 'Completed', variant: 'default' as const, className: 'bg-green-500 hover:bg-green-600' },
  reviewed: { label: 'Reviewed', variant: 'default' as const, className: 'bg-purple-500 hover:bg-purple-600' },
};

export function TrainingSessionList({ sessions, isLoading, onSelectSession }: TrainingSessionListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const filteredSessions = sessions.filter(session => {
    const matchesSearch = !searchQuery || 
      session.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      session.property_address?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = !statusFilter || session.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        Loading training sessions...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or address..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1">
          {Object.entries(statusConfig).map(([key, config]) => (
            <Button
              key={key}
              variant={statusFilter === key ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(statusFilter === key ? null : key)}
            >
              {config.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Session List */}
      {filteredSessions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground mb-2">No training sessions found</p>
            <p className="text-sm text-muted-foreground">
              Create a new session to start training the AI
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredSessions.map((session) => {
            const status = statusConfig[session.status];
            return (
              <Card
                key={session.id}
                className="cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => onSelectSession(session)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium truncate">{session.name}</h3>
                        <Badge className={status.className} variant={status.variant}>
                          {status.label}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        {session.property_address && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            <span className="truncate max-w-[200px]">{session.property_address}</span>
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {format(new Date(session.created_at), 'MMM d, yyyy')}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
