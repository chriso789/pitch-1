import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  Settings2,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ALL_TRADES, matchesTradeCategory } from '@/lib/trades';
import { CompanyTradeSettings } from './CompanyTradeSettings';
import type { Database } from '@/integrations/supabase/types';

type RoofType = Database['public']['Enums']['roof_type'];

interface Template {
  id: string;
  name: string;
  roof_type: RoofType;
  template_category: string;
  is_active: boolean;
  overhead_percentage: number;
  target_profit_percentage: number;
  created_at: string;
  updated_at: string;
  item_count: number;
}

const ROOF_TYPES = [
  { value: 'all', label: 'All Types' },
  { value: 'shingle', label: 'Shingle' },
  { value: 'metal', label: 'Metal' },
  { value: 'tile', label: 'Tile' },
  { value: 'flat', label: 'Flat' },
];

export function EstimateTemplateList() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const effectiveTenantId = useEffectiveTenantId();

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [activeTrade, setActiveTrade] = useState('roofing');
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateType, setNewTemplateType] = useState<RoofType>('shingle');
  const [templateToDelete, setTemplateToDelete] = useState<Template | null>(null);
  const [showTradeSettings, setShowTradeSettings] = useState(false);

  // Load enabled trades from app_settings
  const { data: enabledTrades = ['roofing'] } = useQuery({
    queryKey: ['enabled-estimate-trades', effectiveTenantId],
    queryFn: async () => {
      if (!effectiveTenantId) return ['roofing'];
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return ['roofing'];

      const { data } = await supabase
        .from('app_settings')
        .select('setting_value')
        .eq('tenant_id', effectiveTenantId)
        .eq('setting_key', 'enabled_estimate_trades')
        .maybeSingle();

      if (data?.setting_value) {
        try {
          const parsed = JSON.parse(data.setting_value as string);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed as string[];
        } catch {}
      }
      return ['roofing'];
    },
    enabled: !!effectiveTenantId,
  });

  const visibleTrades = ALL_TRADES.filter(t => enabledTrades.includes(t.value));

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['estimate-calculation-templates', effectiveTenantId],
    queryFn: async () => {
      if (!effectiveTenantId) return [];

      const { data, error } = await supabase
        .from('estimate_calculation_templates')
        .select(`
          id, 
          name, 
          roof_type, 
          template_category, 
          is_active, 
          overhead_percentage, 
          target_profit_percentage,
          created_at,
          updated_at
        `)
        .eq('tenant_id', effectiveTenantId)
        .order('name');

      if (error) throw error;

      const templatesWithCounts = await Promise.all(
        (data || []).map(async (t) => {
          const { count } = await supabase
            .from('estimate_calc_template_items')
            .select('*', { count: 'exact', head: true })
            .eq('calc_template_id', t.id);
          return { ...t, item_count: count || 0 };
        })
      );

      return templatesWithCounts as Template[];
    },
    enabled: !!effectiveTenantId,
  });

  const createMutation = useMutation({
    mutationFn: async ({ name, roof_type, template_category }: { name: string; roof_type: RoofType; template_category: string }) => {
      if (!effectiveTenantId) throw new Error('No tenant found');

      const { data, error } = await supabase
        .from('estimate_calculation_templates')
        .insert({
          name,
          roof_type,
          template_category,
          is_active: true,
          overhead_percentage: 15,
          target_profit_percentage: 30,
          tenant_id: effectiveTenantId,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['estimate-calculation-templates'] });
      setShowNewDialog(false);
      setNewTemplateName('');
      toast({ title: 'Template created' });
      navigate(`/templates/calc-editor/${data.id}`);
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
      if (!effectiveTenantId) throw new Error('No tenant found');

      const { data: newTemplate, error: templateError } = await supabase
        .from('estimate_calculation_templates')
        .insert({
          name: `${template.name} (Copy)`,
          roof_type: template.roof_type,
          template_category: template.template_category,
          is_active: true,
          overhead_percentage: template.overhead_percentage,
          target_profit_percentage: template.target_profit_percentage,
          tenant_id: effectiveTenantId,
        })
        .select()
        .single();

      if (templateError) throw templateError;

      const { data: groups } = await supabase
        .from('estimate_calc_template_groups')
        .select('*')
        .eq('calc_template_id', templateId);

      const groupMapping: Record<string, string> = {};
      for (const group of groups || []) {
        const { data: newGroup } = await supabase
          .from('estimate_calc_template_groups')
          .insert({
            calc_template_id: newTemplate.id,
            name: group.name,
            group_type: group.group_type,
            sort_order: group.sort_order,
            tenant_id: effectiveTenantId,
          })
          .select()
          .single();
        if (newGroup) {
          groupMapping[group.id] = newGroup.id;
        }
      }

      const { data: items } = await supabase
        .from('estimate_calc_template_items')
        .select('*')
        .eq('calc_template_id', templateId);

      for (const item of items || []) {
        await supabase.from('estimate_calc_template_items').insert({
          calc_template_id: newTemplate.id,
          group_id: item.group_id ? groupMapping[item.group_id] : null,
          item_name: item.item_name,
          description: item.description,
          item_type: item.item_type,
          unit: item.unit,
          unit_cost: item.unit_cost,
          measurement_type: item.measurement_type,
          coverage_per_unit: item.coverage_per_unit,
          sort_order: item.sort_order,
          qty_formula: item.qty_formula,
          tenant_id: effectiveTenantId,
        });
      }

      return newTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimate-calculation-templates'] });
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
        .from('estimate_calculation_templates')
        .delete()
        .eq('id', templateId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estimate-calculation-templates'] });
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

  // Filter templates by active trade tab + search + roof type (roofing only)
  const filteredTemplates = templates.filter((template) => {
    const matchesTrade = matchesTradeCategory(template.template_category, activeTrade);
    const matchesSearch = template.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType =
      activeTrade !== 'roofing' ||
      typeFilter === 'all' ||
      (template.roof_type || '').toLowerCase() === typeFilter.toLowerCase();
    return matchesTrade && matchesSearch && matchesType;
  });

  const getTypeBadgeVariant = (type?: string) => {
    switch (type?.toLowerCase()) {
      case 'shingle': return 'default';
      case 'metal': return 'secondary';
      case 'tile': return 'outline';
      case 'flat': return 'destructive';
      default: return 'outline';
    }
  };

  const activeTradeLabel = ALL_TRADES.find(t => t.value === activeTrade)?.label || 'Template';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Estimate Templates</h2>
          <p className="text-muted-foreground">
            Create and manage calculation templates for generating estimates
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowTradeSettings(true)}>
            <Settings2 className="h-4 w-4 mr-2" />
            Manage Trades
          </Button>
          <Button onClick={() => setShowNewDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Template
          </Button>
        </div>
      </div>

      <Tabs value={activeTrade} onValueChange={setActiveTrade}>
        <TabsList>
          {visibleTrades.map((trade) => (
            <TabsTrigger key={trade.value} value={trade.value} className="gap-1.5">
              <span className="text-sm">{trade.icon}</span>
              {trade.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {visibleTrades.map((trade) => (
          <TabsContent key={trade.value} value={trade.value}>
            <div className="space-y-4">
              {/* Search & filters */}
              <div className="flex items-center gap-4">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={`Search ${trade.label.toLowerCase()} templates...`}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
                {/* Only show roof type filter for roofing tab */}
                {trade.value === 'roofing' && (
                  <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Filter by type" />
                    </SelectTrigger>
                    <SelectContent>
                      {ROOF_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Template table */}
              {isLoading ? (
                <div className="border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[300px]">Template Name</TableHead>
                        {trade.value === 'roofing' && <TableHead>Type</TableHead>}
                        <TableHead className="text-center">Items</TableHead>
                        <TableHead className="text-right">Profit</TableHead>
                        <TableHead className="text-center">Status</TableHead>
                        <TableHead className="w-[60px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...Array(3)].map((_, i) => (
                        <TableRow key={i}>
                          <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                          {trade.value === 'roofing' && <TableCell><Skeleton className="h-5 w-16" /></TableCell>}
                          <TableCell><Skeleton className="h-5 w-8 mx-auto" /></TableCell>
                          <TableCell><Skeleton className="h-5 w-12 ml-auto" /></TableCell>
                          <TableCell><Skeleton className="h-5 w-16 mx-auto" /></TableCell>
                          <TableCell><Skeleton className="h-5 w-8" /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : filteredTemplates.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <FileStack className="h-12 w-12 text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold mb-1">No {trade.label.toLowerCase()} templates</h3>
                    <p className="text-muted-foreground text-center mb-4">
                      {searchQuery || (trade.value === 'roofing' && typeFilter !== 'all')
                        ? 'No templates match your search criteria'
                        : `Create your first ${trade.label.toLowerCase()} template to get started`}
                    </p>
                    {!searchQuery && (trade.value !== 'roofing' || typeFilter === 'all') && (
                      <Button onClick={() => setShowNewDialog(true)}>
                        <Plus className="h-4 w-4 mr-2" />
                        Create {trade.label} Template
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <div className="border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[300px]">Template Name</TableHead>
                        {trade.value === 'roofing' && <TableHead>Type</TableHead>}
                        <TableHead className="text-center">Items</TableHead>
                        <TableHead className="text-right">Profit</TableHead>
                        <TableHead className="text-center">Status</TableHead>
                        <TableHead className="w-[60px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredTemplates.map((template) => (
                        <TableRow
                          key={template.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => navigate(`/templates/calc-editor/${template.id}`)}
                        >
                          <TableCell className="font-medium">{template.name}</TableCell>
                          {trade.value === 'roofing' && (
                            <TableCell>
                              <Badge variant={getTypeBadgeVariant(template.roof_type)} className="capitalize">
                                {template.roof_type || 'Unknown'}
                              </Badge>
                            </TableCell>
                          )}
                          <TableCell className="text-center">{template.item_count}</TableCell>
                          <TableCell className="text-right">{template.target_profit_percentage}%</TableCell>
                          <TableCell className="text-center">
                            <Badge
                              variant={template.is_active ? 'default' : 'secondary'}
                              className={template.is_active ? 'bg-green-500/10 text-green-700 border-green-500/20' : ''}
                            >
                              {template.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigate(`/templates/calc-editor/${template.id}`);
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
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </TabsContent>
        ))}
      </Tabs>

      {/* New Template Dialog */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New {activeTradeLabel} Template</DialogTitle>
            <DialogDescription>
              Create a new calculation template for {activeTradeLabel.toLowerCase()} estimates
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Template Name</Label>
              <Input
                id="name"
                placeholder={activeTrade === 'roofing' ? 'e.g., GAF Timberline HDZ' : `e.g., ${activeTradeLabel} Standard`}
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
              />
            </div>
            {/* Only show roof type selector for roofing trade */}
            {activeTrade === 'roofing' && (
              <div className="space-y-2">
                <Label htmlFor="type">Roof Type</Label>
                <Select value={newTemplateType} onValueChange={(v) => setNewTemplateType(v as RoofType)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="shingle">Shingle</SelectItem>
                    <SelectItem value="metal">Metal</SelectItem>
                    <SelectItem value="tile">Tile</SelectItem>
                    <SelectItem value="flat">Flat</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                createMutation.mutate({
                  name: newTemplateName,
                  roof_type: activeTrade === 'roofing' ? newTemplateType : 'shingle',
                  template_category: activeTrade === 'roofing' ? 'standard' : activeTrade,
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

      {/* Trade Settings Dialog */}
      <CompanyTradeSettings
        open={showTradeSettings}
        onOpenChange={setShowTradeSettings}
        enabledTrades={enabledTrades}
        onSaved={() => {}}
      />
    </div>
  );
}
