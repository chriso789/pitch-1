import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui/use-toast';
import {
  Plus, Trash2, FileText, Download, ClipboardList, AlertTriangle,
  CheckCircle, Edit2, Copy, ChevronDown, ChevronRight, Loader2,
  FileSpreadsheet, FileDown, Sparkles, Zap, Ruler
} from 'lucide-react';
import { XactScopeItemEditor } from './XactScopeItemEditor';
import { XactAreaManager } from './XactAreaManager';
import { ROOFING_SCOPE_CATALOG } from './roofingScopeCatalog';

interface XactScopeBuilderProps {
  pipelineEntryId: string;
  jobId?: string;
}

type ScopeProject = {
  id: string;
  tenant_id: string;
  job_id: string;
  estimate_type: string;
  title: string;
  xactimate_profile: string | null;
  price_list_region: string | null;
  price_list_date: string | null;
  status: string;
  overhead_profit_enabled: boolean;
  overhead_percent: number;
  profit_percent: number;
  tax_enabled: boolean;
  default_tax_rate: number;
  notes: string | null;
  created_at: string;
};

type ScopeArea = {
  id: string;
  scope_project_id: string;
  area_name: string;
  area_type: string;
  measurements: Record<string, any>;
  notes: string | null;
  sort_order: number;
};

type ScopeItem = {
  id: string;
  scope_project_id: string;
  scope_area_id: string | null;
  trade: string;
  xactimate_code: string | null;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  waste_percent: number;
  tax_rate: number;
  line_total: number;
  source: string;
  confidence: number | null;
  ai_reason: string | null;
  sort_order: number;
};

export const XactScopeBuilder: React.FC<XactScopeBuilderProps> = ({ pipelineEntryId, jobId }) => {
  const effectiveTenantId = useEffectiveTenantId();
  const queryClient = useQueryClient();
  const [showNewProject, setShowNewProject] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState('items');

  // Resolve job_id from pipeline entry via jobs table
  const { data: resolvedJobId } = useQuery({
    queryKey: ['xact-resolve-job', pipelineEntryId],
    queryFn: async () => {
      if (jobId) return jobId;
      const { data } = await supabase
        .from('jobs')
        .select('id')
        .eq('pipeline_entry_id', pipelineEntryId)
        .limit(1)
        .maybeSingle();
      return data?.id || null;
    },
    enabled: !jobId
  });

  const activeJobId = jobId || resolvedJobId;

  // Fetch scope projects for this job
  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: ['xact-scope-projects', activeJobId, effectiveTenantId],
    queryFn: async () => {
      if (!activeJobId || !effectiveTenantId) return [];
      const { data, error } = await supabase
        .from('xact_scope_projects')
        .select('*')
        .eq('job_id', activeJobId)
        .eq('tenant_id', effectiveTenantId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as ScopeProject[];
    },
    enabled: !!activeJobId && !!effectiveTenantId
  });

  // Auto-select first project
  React.useEffect(() => {
    if (projects?.length && !selectedProjectId) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  const selectedProject = projects?.find(p => p.id === selectedProjectId);

  // Fetch areas for selected project
  const { data: areas } = useQuery({
    queryKey: ['xact-scope-areas', selectedProjectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('xact_scope_areas')
        .select('*')
        .eq('scope_project_id', selectedProjectId!)
        .order('sort_order');
      if (error) throw error;
      return (data || []) as ScopeArea[];
    },
    enabled: !!selectedProjectId
  });

  // Fetch items for selected project
  const { data: items } = useQuery({
    queryKey: ['xact-scope-items', selectedProjectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('xact_scope_items')
        .select('*')
        .eq('scope_project_id', selectedProjectId!)
        .order('sort_order');
      if (error) throw error;
      return (data || []) as ScopeItem[];
    },
    enabled: !!selectedProjectId
  });

  // Create new scope project
  const createProjectMutation = useMutation({
    mutationFn: async (formData: { title: string; estimate_type: string; price_list_region?: string }) => {
      if (!activeJobId || !effectiveTenantId) throw new Error('Missing job or tenant');
      const { data, error } = await supabase
        .from('xact_scope_projects')
        .insert({
          tenant_id: effectiveTenantId,
          job_id: activeJobId,
          title: formData.title,
          estimate_type: formData.estimate_type,
          price_list_region: formData.price_list_region || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['xact-scope-projects'] });
      setSelectedProjectId(data.id);
      setShowNewProject(false);
      toast({ title: 'Scope project created' });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  });

  // Check if measurement data exists for this pipeline entry
  const { data: hasMeasurement } = useQuery({
    queryKey: ['xact-has-measurement', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roof_measurements')
        .select('id, total_area_adjusted_sqft, total_squares, total_eave_length, total_valley_length, total_hip_length, total_ridge_length, predominant_pitch, facet_count')
        .eq('pipeline_entry_id', pipelineEntryId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return data;
    },
    enabled: !!pipelineEntryId
  });

  // Auto-generate scope from measurements
  const autoGenerateMutation = useMutation({
    mutationFn: async (scopeProjectId: string) => {
      const { data, error } = await supabase.functions.invoke('generate-estimate-from-measurement', {
        body: {
          pipeline_entry_id: pipelineEntryId,
          scope_project_id: scopeProjectId,
        }
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['xact-scope-items'] });
      toast({
        title: 'Scope auto-generated',
        description: `${data.line_item_count} line items created (${data.complexity_score} complexity, ${Math.round(data.waste_factor * 100)}% waste)`,
      });
    },
    onError: (err: any) => {
      toast({ title: 'Auto-generate failed', description: err.message, variant: 'destructive' });
    }
  });

  const subtotal = items?.reduce((sum, item) => sum + (item.line_total || 0), 0) || 0;
  const taxTotal = items?.reduce((sum, item) => {
    const taxable = item.line_total || 0;
    return sum + (taxable * (item.tax_rate / 100));
  }, 0) || 0;
  const opAmount = selectedProject?.overhead_profit_enabled
    ? subtotal * ((selectedProject.overhead_percent + selectedProject.profit_percent) / 100)
    : 0;
  const grandTotal = subtotal + taxTotal + opAmount;

  if (!activeJobId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <ClipboardList className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No job linked to this lead. Convert to a project first.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Project Selector */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              Xactimate Scope Builder
            </CardTitle>
            <Button size="sm" onClick={() => setShowNewProject(true)}>
              <Plus className="h-4 w-4 mr-1" /> New Scope
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {projectsLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading...
            </div>
          ) : !projects?.length ? (
            <div className="text-center py-6 text-muted-foreground">
              <p className="mb-2">No scope projects yet</p>
              <Button variant="outline" onClick={() => setShowNewProject(true)}>
                <Plus className="h-4 w-4 mr-1" /> Create First Scope
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {projects.map(proj => (
                <Button
                  key={proj.id}
                  variant={selectedProjectId === proj.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedProjectId(proj.id)}
                  className="gap-1"
                >
                  <Badge variant="secondary" className="text-[10px] px-1">
                    {proj.estimate_type.replace('_', ' ')}
                  </Badge>
                  {proj.title}
                  <Badge variant={
                    proj.status === 'approved' ? 'default' :
                    proj.status === 'pending_review' ? 'secondary' : 'outline'
                  } className="text-[10px] ml-1">
                    {proj.status}
                  </Badge>
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Selected Project Content */}
      {selectedProject && (
        <>
          {/* Project Settings Bar */}
          <Card>
            <CardContent className="py-3">
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <Label className="text-muted-foreground text-xs">O&P:</Label>
                  <Switch
                    checked={selectedProject.overhead_profit_enabled}
                    onCheckedChange={async (checked) => {
                      await supabase
                        .from('xact_scope_projects')
                        .update({ overhead_profit_enabled: checked })
                        .eq('id', selectedProject.id);
                      queryClient.invalidateQueries({ queryKey: ['xact-scope-projects'] });
                    }}
                  />
                  {selectedProject.overhead_profit_enabled && (
                    <span className="text-xs text-muted-foreground">
                      {selectedProject.overhead_percent}% OH + {selectedProject.profit_percent}% P
                    </span>
                  )}
                </div>
                <Separator orientation="vertical" className="h-6" />
                <div className="flex items-center gap-2">
                  <Label className="text-muted-foreground text-xs">Region:</Label>
                  <span className="text-xs font-medium">{selectedProject.price_list_region || 'Not set'}</span>
                </div>
                <Separator orientation="vertical" className="h-6" />
                <div className="flex items-center gap-4 ml-auto">
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Subtotal</div>
                    <div className="font-semibold">${subtotal.toFixed(2)}</div>
                  </div>
                  {selectedProject.overhead_profit_enabled && (
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">O&P</div>
                      <div className="font-semibold">${opAmount.toFixed(2)}</div>
                    </div>
                  )}
                  {taxTotal > 0 && (
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Tax</div>
                      <div className="font-semibold">${taxTotal.toFixed(2)}</div>
                    </div>
                  )}
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Total</div>
                    <div className="font-bold text-lg">${grandTotal.toFixed(2)}</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tabs for Areas / Items / Export */}
          <Card>
            <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
              <CardHeader className="pb-0">
                <TabsList className="w-full justify-start">
                  <TabsTrigger value="items" className="gap-1">
                    <ClipboardList className="h-3.5 w-3.5" /> Line Items ({items?.length || 0})
                  </TabsTrigger>
                  <TabsTrigger value="areas" className="gap-1">
                    <Edit2 className="h-3.5 w-3.5" /> Areas ({areas?.length || 0})
                  </TabsTrigger>
                  <TabsTrigger value="export" className="gap-1">
                    <Download className="h-3.5 w-3.5" /> Export
                  </TabsTrigger>
                </TabsList>
              </CardHeader>
              <CardContent className="pt-4">
                <TabsContent value="items" className="mt-0">
                  <XactScopeItemEditor
                    scopeProjectId={selectedProject.id}
                    items={items || []}
                    areas={areas || []}
                    defaultTaxRate={selectedProject.default_tax_rate}
                  />
                </TabsContent>
                <TabsContent value="areas" className="mt-0">
                  <XactAreaManager
                    scopeProjectId={selectedProject.id}
                    areas={areas || []}
                  />
                </TabsContent>
                <TabsContent value="export" className="mt-0">
                  <XactExportPanel
                    scopeProjectId={selectedProject.id}
                    project={selectedProject}
                    items={items || []}
                    areas={areas || []}
                    subtotal={subtotal}
                    opAmount={opAmount}
                    taxTotal={taxTotal}
                    grandTotal={grandTotal}
                  />
                </TabsContent>
              </CardContent>
            </Tabs>
          </Card>
        </>
      )}

      {/* New Project Dialog */}
      <NewScopeProjectDialog
        open={showNewProject}
        onOpenChange={setShowNewProject}
        onSubmit={(data) => createProjectMutation.mutate(data)}
        isLoading={createProjectMutation.isPending}
      />
    </div>
  );
};

// New Project Dialog
const NewScopeProjectDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { title: string; estimate_type: string; price_list_region?: string }) => void;
  isLoading: boolean;
}> = ({ open, onOpenChange, onSubmit, isLoading }) => {
  const [title, setTitle] = useState('');
  const [estimateType, setEstimateType] = useState('insurance');
  const [region, setRegion] = useState('');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Scope Project</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Initial Roof Estimate" />
          </div>
          <div>
            <Label>Estimate Type</Label>
            <Select value={estimateType} onValueChange={setEstimateType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="insurance">Insurance</SelectItem>
                <SelectItem value="retail">Retail</SelectItem>
                <SelectItem value="supplement">Supplement</SelectItem>
                <SelectItem value="change_order">Change Order</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Price List Region (optional)</Label>
            <Input value={region} onChange={e => setRegion(e.target.value)} placeholder="e.g. TX - Dallas" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => onSubmit({ title, estimate_type: estimateType, price_list_region: region || undefined })}
            disabled={!title.trim() || isLoading}
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// Export Panel
const XactExportPanel: React.FC<{
  scopeProjectId: string;
  project: ScopeProject;
  items: ScopeItem[];
  areas: ScopeArea[];
  subtotal: number;
  opAmount: number;
  taxTotal: number;
  grandTotal: number;
}> = ({ scopeProjectId, project, items, areas, subtotal, opAmount, taxTotal, grandTotal }) => {
  const [exporting, setExporting] = useState<string | null>(null);

  const handleExport = async (type: 'pdf' | 'excel' | 'xactimate_worksheet') => {
    setExporting(type);
    try {
      // Build CSV/worksheet data
      const rows = items.map(item => {
        const area = areas.find(a => a.id === item.scope_area_id);
        return {
          area: area?.area_name || 'General',
          trade: item.trade,
          xact_code: item.xactimate_code || '',
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unit_price: item.unit_price,
          waste_pct: item.waste_percent,
          line_total: item.line_total,
        };
      });

      if (type === 'excel' || type === 'xactimate_worksheet') {
        // Generate CSV download
        const headers = ['Area', 'Trade', 'Xact Code', 'Description', 'Qty', 'Unit', 'Unit Price', 'Waste %', 'Line Total'];
        const csvRows = [
          headers.join(','),
          ...rows.map(r => [
            `"${r.area}"`, `"${r.trade}"`, `"${r.xact_code}"`, `"${r.description}"`,
            r.quantity, `"${r.unit}"`, r.unit_price, r.waste_pct, r.line_total
          ].join(','))
        ];
        
        // Add totals
        csvRows.push('');
        csvRows.push(`,,,,,,,,Subtotal: $${subtotal.toFixed(2)}`);
        if (project.overhead_profit_enabled) {
          csvRows.push(`,,,,,,,,O&P (${project.overhead_percent}%+${project.profit_percent}%): $${opAmount.toFixed(2)}`);
        }
        if (taxTotal > 0) csvRows.push(`,,,,,,,,Tax: $${taxTotal.toFixed(2)}`);
        csvRows.push(`,,,,,,,,TOTAL: $${grandTotal.toFixed(2)}`);

        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${project.title.replace(/\s+/g, '_')}_${type === 'xactimate_worksheet' ? 'xact_worksheet' : 'export'}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast({ title: `${type === 'xactimate_worksheet' ? 'Xactimate worksheet' : 'Excel'} exported` });
      } else {
        // PDF - open print dialog with formatted content
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(`
            <html><head><title>${project.title}</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 40px; }
              h1 { font-size: 20px; margin-bottom: 4px; }
              .meta { color: #666; font-size: 12px; margin-bottom: 20px; }
              table { width: 100%; border-collapse: collapse; font-size: 11px; }
              th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
              th { background: #f5f5f5; font-weight: 600; }
              .right { text-align: right; }
              .totals { margin-top: 20px; text-align: right; font-size: 13px; }
              .totals .grand { font-size: 16px; font-weight: bold; }
            </style></head><body>
            <h1>${project.title}</h1>
            <div class="meta">
              Type: ${project.estimate_type.replace('_', ' ')} | 
              Region: ${project.price_list_region || 'N/A'} | 
              Status: ${project.status}
            </div>
            <table>
              <thead><tr>
                <th>Area</th><th>Trade</th><th>Xact Code</th><th>Description</th>
                <th class="right">Qty</th><th>Unit</th><th class="right">Unit Price</th>
                <th class="right">Waste %</th><th class="right">Line Total</th>
              </tr></thead>
              <tbody>
                ${rows.map(r => `<tr>
                  <td>${r.area}</td><td>${r.trade}</td><td>${r.xact_code}</td><td>${r.description}</td>
                  <td class="right">${r.quantity}</td><td>${r.unit}</td>
                  <td class="right">$${r.unit_price.toFixed(2)}</td>
                  <td class="right">${r.waste_pct}%</td>
                  <td class="right">$${r.line_total.toFixed(2)}</td>
                </tr>`).join('')}
              </tbody>
            </table>
            <div class="totals">
              <div>Subtotal: $${subtotal.toFixed(2)}</div>
              ${project.overhead_profit_enabled ? `<div>O&P: $${opAmount.toFixed(2)}</div>` : ''}
              ${taxTotal > 0 ? `<div>Tax: $${taxTotal.toFixed(2)}</div>` : ''}
              <div class="grand">Total: $${grandTotal.toFixed(2)}</div>
            </div>
            </body></html>
          `);
          printWindow.document.close();
          printWindow.print();
        }
        toast({ title: 'PDF export opened' });
      }
    } catch (err: any) {
      toast({ title: 'Export failed', description: err.message, variant: 'destructive' });
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Export your scope as a worksheet to import into Xactimate, a spreadsheet for review, or a printable PDF estimate.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Button
          variant="outline"
          className="h-auto py-4 flex flex-col items-center gap-2"
          onClick={() => handleExport('xactimate_worksheet')}
          disabled={!!exporting || !items?.length}
        >
          {exporting === 'xactimate_worksheet' ? <Loader2 className="h-6 w-6 animate-spin" /> : <FileSpreadsheet className="h-6 w-6" />}
          <span className="font-medium">Xactimate Worksheet</span>
          <span className="text-xs text-muted-foreground">CSV with codes for Xactimate import</span>
        </Button>
        <Button
          variant="outline"
          className="h-auto py-4 flex flex-col items-center gap-2"
          onClick={() => handleExport('excel')}
          disabled={!!exporting || !items?.length}
        >
          {exporting === 'excel' ? <Loader2 className="h-6 w-6 animate-spin" /> : <FileDown className="h-6 w-6" />}
          <span className="font-medium">Excel Export</span>
          <span className="text-xs text-muted-foreground">Full spreadsheet with all details</span>
        </Button>
        <Button
          variant="outline"
          className="h-auto py-4 flex flex-col items-center gap-2"
          onClick={() => handleExport('pdf')}
          disabled={!!exporting || !items?.length}
        >
          {exporting === 'pdf' ? <Loader2 className="h-6 w-6 animate-spin" /> : <FileText className="h-6 w-6" />}
          <span className="font-medium">PDF Estimate</span>
          <span className="text-xs text-muted-foreground">Print-ready estimate document</span>
        </Button>
      </div>
      {!items?.length && (
        <p className="text-xs text-muted-foreground text-center">Add line items before exporting.</p>
      )}
    </div>
  );
};
