import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Plus,
  Search,
  MoreVertical,
  Pencil,
  Copy,
  Trash2,
  FileStack,
  AlertCircle,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Template {
  id: string;
  name: string;
  status: string;
  template_type?: string;
  template_description?: string;
  created_at: string;
}

const TEMPLATE_TYPES = [
  { value: 'all', label: 'All Types' },
  { value: 'steep_slope', label: 'Steep Slope' },
  { value: 'low_slope', label: 'Low Slope' },
  { value: 'metal', label: 'Metal' },
  { value: 'tile', label: 'Tile' },
  { value: 'gutters', label: 'Gutters' },
];

export function EstimateTemplateList() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateType, setNewTemplateType] = useState('steep_slope');
  const [templateToDelete, setTemplateToDelete] = useState<Template | null>(null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['estimate-templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('templates')
        .select('id, name, status, template_type, template_description, created_at')
        .order('name');

      if (error) throw error;
      return data as Template[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async ({ name, template_type }: { name: string; template_type: string }) => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .single();

      if (!profile?.tenant_id) throw new Error('No tenant found');

      const { data, error } = await supabase
        .from('templates')
        .insert({
          name,
          template_type,
          status: 'active',
          tenant_id: profile.tenant_id,
        } as any)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['estimate-templates'] });
      setShowNewDialog(false);
      setNewTemplateName('');
      toast({ title: 'Template created' });
      navigate(`/templates/smart-editor/${data.id}`);
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create template',
        variant: 'destructive',
      });
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async (templateId: string) => {
      const template = templates.find((t) => t.id === templateId);
      if (!template) throw new Error('Template not found');

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .single();

      if (!profile?.tenant_id) throw new Error('No tenant found');

      // Create new template
      const { data: newTemplate, error: templateError } = await supabase
        .from('templates')
        .insert({
          name: `${template.name} (Copy)`,
          template_type: template.template_type,
          template_description: template.template_description,
          status: 'active',
          tenant_id: profile.tenant_id,
        } as any)
        .select()
        .single();

      if (templateError) throw templateError;

      // Copy groups
      const { data: groups } = await supabase
        .from('estimate_template_groups')
        .select('*')
        .eq('template_id', templateId);

      const groupMapping: Record<string, string> = {};
      for (const group of groups || []) {
        const { data: newGroup } = await supabase
          .from('estimate_template_groups')
          .insert({
            template_id: newTemplate.id,
            name: group.name,
            group_type: group.group_type,
            sort_order: group.sort_order,
            tenant_id: profile.tenant_id,
          })
          .select()
          .single();
        if (newGroup) {
          groupMapping[group.id] = newGroup.id;
        }
      }

      // Copy items
      const { data: items } = await supabase
        .from('template_items')
        .select('*')
        .eq('template_id', templateId);

      for (const item of items || []) {
        await supabase.from('template_items').insert({
          template_id: newTemplate.id,
          group_id: item.group_id ? groupMapping[item.group_id] : null,
          item_name: item.item_name,
          estimate_item_name: item.estimate_item_name,
          description: item.description,
          item_type: item.item_type,
          unit: item.unit,
          unit_cost: item.unit_cost,
          waste_pct: item.waste_pct,
          pricing_type: item.pricing_type,
          fixed_price: item.fixed_price,
          measurement_type: item.measurement_type,
          qty_formula: item.qty_formula,
          sort_order: item.sort_order,
        });
      }

      return newTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimate-templates'] });
      toast({ title: 'Template duplicated' });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to duplicate template',
        variant: 'destructive',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (templateId: string) => {
      const { error } = await supabase
        .from('templates')
        .delete()
        .eq('id', templateId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimate-templates'] });
      setTemplateToDelete(null);
      toast({ title: 'Template deleted' });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete template',
        variant: 'destructive',
      });
    },
  });

  const filteredTemplates = templates.filter((template) => {
    const matchesSearch = template.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType =
      typeFilter === 'all' ||
      (template.template_type || '').toLowerCase() === typeFilter.toLowerCase();
    return matchesSearch && matchesType;
  });

  const getTypeBadgeVariant = (type?: string) => {
    switch (type?.toLowerCase()) {
      case 'steep_slope':
        return 'default';
      case 'metal':
        return 'secondary';
      case 'tile':
        return 'outline';
      case 'low_slope':
        return 'destructive';
      case 'gutters':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Estimate Templates</h2>
          <p className="text-muted-foreground">
            Create and manage templates for generating estimates
          </p>
        </div>
        <Button onClick={() => setShowNewDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Template
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            {TEMPLATE_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-5 w-32 mb-2" />
                <Skeleton className="h-4 w-20 mb-4" />
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredTemplates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileStack className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-1">No templates found</h3>
            <p className="text-muted-foreground text-center mb-4">
              {searchQuery || typeFilter !== 'all'
                ? 'No templates match your search criteria'
                : 'Get started by creating your first estimate template'}
            </p>
            {!searchQuery && typeFilter === 'all' && (
              <Button onClick={() => setShowNewDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create Template
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredTemplates.map((template) => (
            <Card
              key={template.id}
              className="group hover:border-primary/50 transition-colors cursor-pointer"
              onClick={() => navigate(`/templates/smart-editor/${template.id}`)}
            >
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate">{template.name}</h3>
                    {template.template_description && (
                      <p className="text-sm text-muted-foreground truncate mt-1">
                        {template.template_description}
                      </p>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 opacity-0 group-hover:opacity-100"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/templates/smart-editor/${template.id}`);
                        }}
                      >
                        <Pencil className="h-4 w-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          duplicateMutation.mutate(template.id);
                        }}
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          setTemplateToDelete(template);
                        }}
                        className="text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex items-center gap-2 mt-4">
                  <Badge variant={getTypeBadgeVariant(template.template_type)}>
                    {(template.template_type || 'Unknown').replace('_', ' ')}
                  </Badge>
                  <Badge
                    variant={template.status === 'active' ? 'default' : 'secondary'}
                    className={
                      template.status === 'active'
                        ? 'bg-green-500/10 text-green-700 border-green-500/20'
                        : ''
                    }
                  >
                    {template.status}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* New Template Dialog */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Template</DialogTitle>
            <DialogDescription>
              Create a new estimate template for generating project estimates
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Template Name</Label>
              <Input
                id="name"
                placeholder="e.g., GAF Timberline HDZ"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="type">Template Type</Label>
              <Select value={newTemplateType} onValueChange={setNewTemplateType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="steep_slope">Steep Slope (Shingle)</SelectItem>
                  <SelectItem value="metal">Metal</SelectItem>
                  <SelectItem value="tile">Tile</SelectItem>
                  <SelectItem value="low_slope">Low Slope (Flat)</SelectItem>
                  <SelectItem value="gutters">Gutters</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                createMutation.mutate({
                  name: newTemplateName,
                  template_type: newTemplateType,
                })
              }
              disabled={!newTemplateName.trim() || createMutation.isPending}
            >
              Create Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!templateToDelete} onOpenChange={() => setTemplateToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Delete Template
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{templateToDelete?.name}"? This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTemplateToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => templateToDelete && deleteMutation.mutate(templateToDelete.id)}
              disabled={deleteMutation.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
