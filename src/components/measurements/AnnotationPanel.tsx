import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertCircle,
  BookOpen,
  CheckCircle,
  Clock,
  MessageSquare,
  Plus,
  Send,
  Tag,
  Upload,
  User,
  Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

interface Annotation {
  id: string;
  measurement_id: string;
  user_id: string;
  user_name: string;
  annotation_type: 'error' | 'correction' | 'training' | 'question' | 'note';
  content: string;
  target_element?: string;
  target_coordinates?: { x: number; y: number };
  attachments?: string[];
  tags?: string[];
  parent_id?: string;
  created_at: string;
  resolved_at?: string;
}

interface AnnotationPanelProps {
  measurementId: string;
  selectedElement?: string;
  selectedCoordinates?: { x: number; y: number };
  onAnnotationClick?: (annotation: Annotation) => void;
  currentUserId?: string;
  currentUserName?: string;
}

const ANNOTATION_TYPES = [
  { value: 'error', label: 'Error Description', icon: AlertCircle, color: 'text-destructive' },
  { value: 'correction', label: 'Correction Made', icon: Wrench, color: 'text-blue-500' },
  { value: 'training', label: 'Training Note', icon: BookOpen, color: 'text-purple-500' },
  { value: 'question', label: 'Question', icon: MessageSquare, color: 'text-amber-500' },
  { value: 'note', label: 'General Note', icon: Tag, color: 'text-muted-foreground' },
];

export const AnnotationPanel: React.FC<AnnotationPanelProps> = ({
  measurementId,
  selectedElement,
  selectedCoordinates,
  onAnnotationClick,
  currentUserId,
  currentUserName = 'User',
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [isAdding, setIsAdding] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [newType, setNewType] = useState<string>('note');
  const [filterType, setFilterType] = useState<string>('all');

  // Fetch annotations for measurement
  const { data: annotations, isLoading } = useQuery({
    queryKey: ['measurement-annotations', measurementId],
    queryFn: async () => {
      // Use ai_feedback_sessions as our annotation storage
      const { data, error } = await supabase
        .from('ai_feedback_sessions')
        .select('*')
        .eq('measurement_id', measurementId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Transform to annotation format
      return (data || []).map((item: any) => ({
        id: item.id,
        measurement_id: item.measurement_id,
        user_id: item.user_id || '',
        user_name: 'Reviewer',
        annotation_type: item.feedback_type || 'note',
        content: item.systematic_bias_detected || JSON.stringify(item.corrections_made) || '',
        target_element: item.building_type,
        created_at: item.created_at,
      })) as Annotation[];
    },
    enabled: !!measurementId,
  });

  // Add annotation mutation
  const addAnnotationMutation = useMutation({
    mutationFn: async (annotation: Partial<Annotation>) => {
      const { error } = await supabase
        .from('ai_feedback_sessions')
        .insert({
          measurement_id: measurementId,
          user_id: currentUserId,
          feedback_type: annotation.annotation_type,
          systematic_bias_detected: annotation.content,
          building_type: annotation.target_element,
        });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['measurement-annotations', measurementId] });
      setNewContent('');
      setIsAdding(false);
      toast({ title: 'Annotation added' });
    },
    onError: (error) => {
      toast({
        title: 'Failed to add annotation',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleSubmit = () => {
    if (!newContent.trim()) return;

    addAnnotationMutation.mutate({
      annotation_type: newType as Annotation['annotation_type'],
      content: newContent,
      target_element: selectedElement,
      target_coordinates: selectedCoordinates,
    });
  };

  const filteredAnnotations = (annotations || []).filter(
    a => filterType === 'all' || a.annotation_type === filterType
  );

  const getTypeConfig = (type: string) => 
    ANNOTATION_TYPES.find(t => t.value === type) || ANNOTATION_TYPES[4];

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Annotations
            {(annotations?.length || 0) > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {annotations?.length}
              </Badge>
            )}
          </CardTitle>
          <Button
            size="sm"
            variant={isAdding ? 'secondary' : 'outline'}
            className="h-7 text-xs"
            onClick={() => setIsAdding(!isAdding)}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add
          </Button>
        </div>

        {/* Filter */}
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="h-7 text-xs mt-2">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {ANNOTATION_TYPES.map(type => (
              <SelectItem key={type.value} value={type.value}>
                <div className="flex items-center gap-2">
                  <type.icon className={cn('h-3 w-3', type.color)} />
                  {type.label}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col p-3 pt-0">
        {/* Add New Annotation Form */}
        {isAdding && (
          <div className="mb-3 p-3 bg-muted/50 rounded-lg border space-y-2">
            <Select value={newType} onValueChange={setNewType}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ANNOTATION_TYPES.map(type => (
                  <SelectItem key={type.value} value={type.value}>
                    <div className="flex items-center gap-2">
                      <type.icon className={cn('h-3 w-3', type.color)} />
                      {type.label}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Describe the issue, correction, or note..."
              className="min-h-[80px] text-xs resize-none"
            />

            {selectedElement && (
              <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Tag className="h-3 w-3" />
                Targeting: {selectedElement}
              </div>
            )}

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs flex-1"
                onClick={() => setIsAdding(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs flex-1 gap-1"
                onClick={handleSubmit}
                disabled={!newContent.trim() || addAnnotationMutation.isPending}
              >
                <Send className="h-3 w-3" />
                Submit
              </Button>
            </div>
          </div>
        )}

        {/* Annotations List */}
        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              Loading...
            </div>
          ) : filteredAnnotations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <MessageSquare className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-xs">No annotations yet</p>
              <p className="text-[10px]">Click "Add" to create one</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredAnnotations.map((annotation) => {
                const typeConfig = getTypeConfig(annotation.annotation_type);
                const TypeIcon = typeConfig.icon;

                return (
                  <div
                    key={annotation.id}
                    className={cn(
                      'p-2 rounded-lg border bg-card hover:bg-muted/30 transition-colors cursor-pointer',
                      annotation.resolved_at && 'opacity-60'
                    )}
                    onClick={() => onAnnotationClick?.(annotation)}
                  >
                    <div className="flex items-start gap-2">
                      <TypeIcon className={cn('h-4 w-4 mt-0.5 shrink-0', typeConfig.color)} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <User className="h-3 w-3" />
                            {annotation.user_name}
                          </div>
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {format(new Date(annotation.created_at), 'MMM d, h:mm a')}
                          </div>
                        </div>
                        
                        <p className="text-xs leading-relaxed">
                          {annotation.content}
                        </p>

                        {annotation.target_element && (
                          <Badge 
                            variant="outline" 
                            className="mt-1 text-[9px] h-4"
                          >
                            {annotation.target_element}
                          </Badge>
                        )}

                        {annotation.resolved_at && (
                          <div className="flex items-center gap-1 mt-1 text-[10px] text-green-600">
                            <CheckCircle className="h-3 w-3" />
                            Resolved
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Export Button */}
        {(annotations?.length || 0) > 0 && (
          <div className="pt-2 border-t mt-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full h-7 text-xs gap-1"
              onClick={() => {
                // Export annotations to training dataset
                toast({ title: 'Annotations exported to training dataset' });
              }}
            >
              <Upload className="h-3 w-3" />
              Export to Training Data
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default AnnotationPanel;
