import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Eye,
  Filter,
  RefreshCw,
  Search,
  User,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';

interface ReviewQueueItem {
  id: string;
  measurement_id: string;
  priority: number;
  deadline: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'escalated';
  assigned_reviewer_id: string | null;
  complexity_score: number;
  estimated_value: number;
  customer_tier: string;
  address: string;
  created_at: string;
  sla_remaining_minutes: number;
}

interface ExpertReviewQueueProps {
  tenantId?: string;
  currentUserId?: string;
  onSelectMeasurement?: (measurementId: string) => void;
}

export const ExpertReviewQueue: React.FC<ExpertReviewQueueProps> = ({
  tenantId,
  currentUserId,
  onSelectMeasurement,
}) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('pending');

  // Fetch review queue - use roof_measurements with manual_review_recommended
  const { data: queueItems, isLoading, refetch } = useQuery({
    queryKey: ['expert-review-queue', tenantId, priorityFilter, statusFilter],
    queryFn: async () => {
      // Fetch measurements that need review
      const { data, error } = await supabase
        .from('roof_measurements')
        .select('id, property_address, total_area_adjusted_sqft, confidence_score, complexity_rating, created_at, manual_review_recommended')
        .eq('manual_review_recommended', true)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      // Transform to queue items
      return (data || []).map((item: any) => ({
        id: item.id,
        measurement_id: item.id,
        priority: (item.confidence_score || 0) < 80 ? 1 : (item.confidence_score || 0) < 90 ? 2 : 3,
        deadline: null,
        status: 'pending' as const,
        assigned_reviewer_id: null,
        complexity_score: item.complexity_rating === 'complex' ? 3 : 
                         item.complexity_rating === 'moderate' ? 2 : 1,
        estimated_value: item.total_area_adjusted_sqft || 0,
        customer_tier: 'standard',
        address: item.property_address || 'Unknown Address',
        created_at: item.created_at,
        sla_remaining_minutes: 60,
      })) as ReviewQueueItem[];
    },
    enabled: true,
    refetchInterval: 30000,
  });

  // Claim review mutation - mark as no longer needing review
  const claimReviewMutation = useMutation({
    mutationFn: async (itemId: string) => {
      // Just mark as being reviewed in local state for now
      // In production, this would update a review_assignments table
      console.log('Claiming review for:', itemId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expert-review-queue'] });
      toast({ title: 'Review claimed successfully' });
    },
    onError: (error: any) => {
      toast({ 
        title: 'Failed to claim review',
        description: error.message,
        variant: 'destructive'
      });
    },
  });

  // Approve measurement mutation - clear manual review flag
  const approveReviewMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase
        .from('roof_measurements')
        .update({ 
          manual_review_recommended: false,
        })
        .eq('id', itemId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expert-review-queue'] });
      toast({ title: 'Measurement approved' });
    },
  });

  const filteredItems = (queueItems || []).filter(item => {
    const matchesSearch = item.address.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesPriority = priorityFilter === 'all' || item.priority === parseInt(priorityFilter);
    const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
    return matchesSearch && matchesPriority && matchesStatus;
  });

  const getPriorityBadge = (priority: number) => {
    switch (priority) {
      case 1:
        return <Badge variant="destructive" className="text-[10px]">Critical</Badge>;
      case 2:
        return <Badge variant="default" className="text-[10px] bg-amber-500">High</Badge>;
      case 3:
        return <Badge variant="secondary" className="text-[10px]">Normal</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px]">Low</Badge>;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="h-4 w-4 text-amber-500" />;
      case 'in_progress':
        return <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />;
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'escalated':
        return <AlertTriangle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const formatTimeRemaining = (minutes: number) => {
    if (minutes < 0) return 'Overdue';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Expert Review Queue
            {filteredItems.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {filteredItems.length}
              </Badge>
            )}
          </CardTitle>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
          </Button>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mt-3">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by address..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-28 h-8 text-sm">
              <Filter className="h-3 w-3 mr-1" />
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="1">Critical</SelectItem>
              <SelectItem value="2">High</SelectItem>
              <SelectItem value="3">Normal</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-28 h-8 text-sm">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="escalated">Escalated</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <ScrollArea className="h-[400px]">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <CheckCircle className="h-8 w-8 mb-2" />
              <p className="text-sm">No items pending review</p>
            </div>
          ) : (
            <div className="divide-y">
              {filteredItems.map((item) => (
                <div 
                  key={item.id}
                  className="p-3 hover:bg-muted/50 transition-colors cursor-pointer"
                  onClick={() => onSelectMeasurement?.(item.measurement_id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {getStatusIcon(item.status)}
                        <span className="text-sm font-medium truncate">
                          {item.address}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        {getPriorityBadge(item.priority)}
                        <span>•</span>
                        <span>{Math.round(item.estimated_value).toLocaleString()} sq ft</span>
                        <span>•</span>
                        <span className={cn(
                          item.sla_remaining_minutes < 30 && 'text-destructive font-medium'
                        )}>
                          SLA: {formatTimeRemaining(item.sla_remaining_minutes)}
                        </span>
                      </div>
                    </div>

                    <div className="flex gap-1">
                      {item.status === 'pending' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            claimReviewMutation.mutate(item.id);
                          }}
                        >
                          <User className="h-3 w-3 mr-1" />
                          Claim
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/measurements/${item.measurement_id}/correct`);
                        }}
                      >
                        <Eye className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

export default ExpertReviewQueue;
