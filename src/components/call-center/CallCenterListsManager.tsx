import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { List, PlayCircle, Trash2, Loader2, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { toast } from '@/hooks/use-toast';
import { format } from 'date-fns';

interface CallCenterListsManagerProps {
  onSelectList: (listId: string) => void;
}

export const CallCenterListsManager: React.FC<CallCenterListsManagerProps> = ({ onSelectList }) => {
  const tenantId = useEffectiveTenantId();
  const queryClient = useQueryClient();

  const { data: lists, isLoading } = useQuery({
    queryKey: ['dialer-lists', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from('dialer_lists')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!tenantId,
  });

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete list "${name}"? This cannot be undone.`)) return;
    try {
      // Delete items first
      await supabase.from('dialer_list_items').delete().eq('list_id', id);
      await supabase.from('dialer_lists').delete().eq('id', id);
      queryClient.invalidateQueries({ queryKey: ['dialer-lists'] });
      toast({ title: 'List deleted' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!lists?.length) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <List className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p className="text-lg font-medium">No Dialer Lists</p>
        <p className="text-sm mt-1">Build a list to start making calls.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {lists.map(list => (
        <Card key={list.id} className="hover:border-primary/30 transition-colors">
          <CardContent className="py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="font-medium">{list.name}</div>
                <div className="text-xs text-muted-foreground">
                  {list.total_items} contacts • Created {format(new Date(list.created_at), 'MMM d, yyyy')}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={list.is_active ? 'default' : 'secondary'} className="text-xs">
                {list.is_active ? 'Active' : 'Inactive'}
              </Badge>
              <Button size="sm" onClick={() => onSelectList(list.id)}>
                <PlayCircle className="h-4 w-4 mr-1" />
                Dial
              </Button>
              <Button size="sm" variant="ghost" onClick={() => handleDelete(list.id, list.name)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};
