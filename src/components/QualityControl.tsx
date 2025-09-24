import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ClipboardCheck, Plus, FileText, AlertTriangle, CheckCircle, XCircle, Camera } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface QCTemplate {
  id: string;
  name: string;
  roof_type: string;
  template_data: any;
  is_active: boolean;
  created_at: string;
}

interface QCItem {
  id: string;
  name: string;
  description: string;
  is_critical: boolean;
  requires_photo: boolean;
  category: string;
}

interface QCInspection {
  id: string;
  project_id: string;
  template_id: string;
  inspector_id: string;
  inspection_data: any;
  overall_score: number;
  status: 'in_progress' | 'completed' | 'failed';
  critical_failures: number;
  total_items: number;
  passed_items: number;
  completed_at: string;
  created_at: string;
  projects?: {
    name: string;
    project_number: string;
  };
  qc_templates?: {
    name: string;
  };
}

interface QCResult {
  passed: boolean;
  notes?: string;
  photo_required: boolean;
  photo_uploaded: boolean;
  inspector_notes?: string;
}

interface Project {
  id: string;
  name: string;
  project_number: string;
}

export default function QualityControl() {
  const [templates, setTemplates] = useState<QCTemplate[]>([]);
  const [inspections, setInspections] = useState<QCInspection[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [showInspectionDialog, setShowInspectionDialog] = useState(false);
  const [selectedInspection, setSelectedInspection] = useState<QCInspection | null>(null);
  const [templateForm, setTemplateForm] = useState({
    name: '',
    roof_type: '',
    items: [] as QCItem[]
  });
  const [inspectionForm, setInspectionForm] = useState({
    project_id: '',
    template_id: ''
  });
  const { toast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [templatesResult, inspectionsResult, projectsResult] = await Promise.all([
        supabase
          .from('qc_templates')
          .select('*')
          .order('name'),
        supabase
          .from('qc_inspections')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase
          .from('projects')
          .select('id, name, project_number')
          .order('name')
      ]);

      if (templatesResult.error) throw templatesResult.error;
      if (inspectionsResult.error) throw inspectionsResult.error;
      if (projectsResult.error) throw projectsResult.error;

      setTemplates(templatesResult.data || []);
      setInspections((inspectionsResult.data || []).map(inspection => ({
        ...inspection,
        status: inspection.status as 'in_progress' | 'completed' | 'failed'
      })));
      setProjects(projectsResult.data || []);
    } catch (error) {
      console.error('Error loading data:', error);
      toast({
        title: "Error",
        description: "Failed to load QC data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const createTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const user = await supabase.auth.getUser();
      const { error } = await supabase
        .from('qc_templates')
        .insert({
          name: templateForm.name,
          roof_type: templateForm.roof_type,
          template_data: templateForm.items as any,
          created_by: user.data.user?.id || '',
          tenant_id: user.data.user?.user_metadata?.tenant_id || ''
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: "QC template created successfully",
      });

      setShowTemplateDialog(false);
      setTemplateForm({ name: '', roof_type: '', items: [] });
      loadData();
    } catch (error) {
      console.error('Error creating template:', error);
      toast({
        title: "Error",
        description: "Failed to create template",
        variant: "destructive",
      });
    }
  };

  const startInspection = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const template = templates.find(t => t.id === inspectionForm.template_id);
      if (!template) throw new Error('Template not found');

      const initialData: Record<string, QCResult> = {};
      template.template_data.forEach(item => {
        initialData[item.id] = {
          passed: false,
          photo_required: item.requires_photo,
          photo_uploaded: false
        };
      });

      const user = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('qc_inspections')
        .insert({
          project_id: inspectionForm.project_id,
          template_id: inspectionForm.template_id,
          inspector_id: user.data.user?.id || '',
          inspection_data: initialData as any,
          total_items: template.template_data.length,
          status: 'in_progress',
          tenant_id: user.data.user?.user_metadata?.tenant_id || ''
        })
        .select()
        .single();

      if (error) throw error;

      toast({
        title: "Success",
        description: "QC inspection started",
      });

      setShowInspectionDialog(false);
      setInspectionForm({ project_id: '', template_id: '' });
      loadData();
    } catch (error) {
      console.error('Error starting inspection:', error);
      toast({
        title: "Error",
        description: "Failed to start inspection",
        variant: "destructive",
      });
    }
  };

  const updateInspectionItem = async (inspectionId: string, itemId: string, result: Partial<QCResult>) => {
    try {
      const inspection = inspections.find(i => i.id === inspectionId);
      if (!inspection) return;

      const updatedData = {
        ...inspection.inspection_data,
        [itemId]: {
          ...inspection.inspection_data[itemId],
          ...result
        }
      };

      // Calculate scores
      const template = templates.find(t => t.id === inspection.template_id);
      if (!template) return;

      const results = Object.values(updatedData) as QCResult[];
      const passedItems = results.filter(r => r.passed).length;
      const criticalFailures = template.template_data
        .filter(item => item.is_critical && !updatedData[item.id]?.passed)
        .length;
      
      const overallScore = (passedItems / results.length) * 100;
      const status = criticalFailures > 0 ? 'failed' : 
                   results.every(r => r.passed) ? 'completed' : 'in_progress';

      const { error } = await supabase
        .from('qc_inspections')
        .update({
          inspection_data: updatedData,
          passed_items: passedItems,
          critical_failures: criticalFailures,
          overall_score: overallScore,
          status: status,
          completed_at: status === 'completed' ? new Date().toISOString() : null
        })
        .eq('id', inspectionId);

      if (error) throw error;

      loadData();
    } catch (error) {
      console.error('Error updating inspection:', error);
      toast({
        title: "Error",
        description: "Failed to update inspection",
        variant: "destructive",
      });
    }
  };

  const addTemplateItem = () => {
    const newItem: QCItem = {
      id: Date.now().toString(),
      name: '',
      description: '',
      is_critical: false,
      requires_photo: false,
      category: 'general'
    };
    setTemplateForm({
      ...templateForm,
      items: [...templateForm.items, newItem]
    });
  };

  const updateTemplateItem = (index: number, field: keyof QCItem, value: any) => {
    const updatedItems = [...templateForm.items];
    updatedItems[index] = { ...updatedItems[index], [field]: value };
    setTemplateForm({ ...templateForm, items: updatedItems });
  };

  const removeTemplateItem = (index: number) => {
    setTemplateForm({
      ...templateForm,
      items: templateForm.items.filter((_, i) => i !== index)
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'in_progress':
        return <Badge className="bg-blue-500 hover:bg-blue-600">In Progress</Badge>;
      case 'completed':
        return <Badge className="bg-green-500 hover:bg-green-600">Completed</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const stats = {
    totalInspections: inspections.length,
    completed: inspections.filter(i => i.status === 'completed').length,
    failed: inspections.filter(i => i.status === 'failed').length,
    avgScore: inspections.length > 0 ? 
      inspections.reduce((sum, i) => sum + (i.overall_score || 0), 0) / inspections.length : 0
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64">Loading...</div>;
  }

  return (
    <div className="container mx-auto py-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Quality Control</h1>
        <div className="flex gap-2">
          <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <FileText className="h-4 w-4 mr-2" />
                New Template
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create QC Template</DialogTitle>
                <DialogDescription>
                  Create a new quality control checklist template
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={createTemplate} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="template-name">Template Name</Label>
                    <Input
                      id="template-name"
                      value={templateForm.name}
                      onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="roof-type">Roof Type</Label>
                    <Select
                      value={templateForm.roof_type}
                      onValueChange={(value) => setTemplateForm({ ...templateForm, roof_type: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select roof type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="shingle">Shingle</SelectItem>
                        <SelectItem value="metal">Metal</SelectItem>
                        <SelectItem value="tpo">TPO</SelectItem>
                        <SelectItem value="tile">Tile</SelectItem>
                        <SelectItem value="slate">Slate</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <Label>Checklist Items</Label>
                    <Button type="button" onClick={addTemplateItem} size="sm">
                      <Plus className="h-4 w-4 mr-1" />
                      Add Item
                    </Button>
                  </div>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {templateForm.items.map((item, index) => (
                      <Card key={item.id} className="p-3">
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <Input
                            placeholder="Item name"
                            value={item.name}
                            onChange={(e) => updateTemplateItem(index, 'name', e.target.value)}
                          />
                          <div className="flex gap-2">
                            <div className="flex items-center space-x-2">
                              <Checkbox
                                id={`critical-${index}`}
                                checked={item.is_critical}
                                onCheckedChange={(checked) => updateTemplateItem(index, 'is_critical', checked)}
                              />
                              <Label htmlFor={`critical-${index}`} className="text-xs">Critical</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                              <Checkbox
                                id={`photo-${index}`}
                                checked={item.requires_photo}
                                onCheckedChange={(checked) => updateTemplateItem(index, 'requires_photo', checked)}
                              />
                              <Label htmlFor={`photo-${index}`} className="text-xs">Photo</Label>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeTemplateItem(index)}
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        <Textarea
                          placeholder="Description"
                          value={item.description}
                          onChange={(e) => updateTemplateItem(index, 'description', e.target.value)}
                          className="text-xs"
                          rows={2}
                        />
                      </Card>
                    ))}
                  </div>
                </div>

                <Button type="submit" className="w-full">Create Template</Button>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={showInspectionDialog} onOpenChange={setShowInspectionDialog}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Start Inspection
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Start QC Inspection</DialogTitle>
                <DialogDescription>
                  Begin a new quality control inspection
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={startInspection} className="space-y-4">
                <div>
                  <Label htmlFor="inspection-project">Project</Label>
                  <Select
                    value={inspectionForm.project_id}
                    onValueChange={(value) => setInspectionForm({ ...inspectionForm, project_id: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select project" />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name} ({project.project_number})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="inspection-template">QC Template</Label>
                  <Select
                    value={inspectionForm.template_id}
                    onValueChange={(value) => setInspectionForm({ ...inspectionForm, template_id: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select template" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.name} ({template.roof_type})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" className="w-full">Start Inspection</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Inspections</CardTitle>
            <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalInspections}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
            <p className="text-xs text-muted-foreground">
              {stats.totalInspections > 0 ? Math.round((stats.completed / stats.totalInspections) * 100) : 0}% pass rate
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Failed</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
            <p className="text-xs text-muted-foreground">
              Critical failures
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Score</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.avgScore.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">
              Overall quality
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="inspections" className="space-y-4">
        <TabsList>
          <TabsTrigger value="inspections">Inspections</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
        </TabsList>

        <TabsContent value="inspections">
          <div className="grid gap-4">
            {inspections.map((inspection) => (
              <Card 
                key={inspection.id} 
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => setSelectedInspection(inspection)}
              >
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        {inspection.projects?.name || 'Unknown Project'}
                        {getStatusBadge(inspection.status)}
                      </CardTitle>
                      <CardDescription>
                        {inspection.qc_templates?.name} • {new Date(inspection.created_at).toLocaleDateString()}
                      </CardDescription>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold">
                        {inspection.overall_score?.toFixed(0) || 0}%
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {inspection.passed_items}/{inspection.total_items} passed
                      </div>
                    </div>
                  </div>
                </CardHeader>
                {inspection.critical_failures > 0 && (
                  <CardContent>
                    <div className="flex items-center gap-2 text-red-600">
                      <AlertTriangle className="h-4 w-4" />
                      <span className="text-sm font-medium">
                        {inspection.critical_failures} critical failure(s)
                      </span>
                    </div>
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="templates">
          <div className="grid gap-4">
            {templates.map((template) => (
              <Card key={template.id}>
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle>{template.name}</CardTitle>
                      <CardDescription>
                        {template.roof_type} • {template.template_data.length} items
                      </CardDescription>
                    </div>
                    <Badge variant={template.is_active ? "default" : "secondary"}>
                      {template.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-muted-foreground">
                    Critical items: {template.template_data.filter(item => item.is_critical).length} • 
                    Photo required: {template.template_data.filter(item => item.requires_photo).length}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Inspection Detail Dialog */}
      <Dialog open={!!selectedInspection} onOpenChange={() => setSelectedInspection(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              QC Inspection - {selectedInspection?.projects?.name}
            </DialogTitle>
            <DialogDescription>
              {selectedInspection?.qc_templates?.name} • {selectedInspection && new Date(selectedInspection.created_at).toLocaleDateString()}
            </DialogDescription>
          </DialogHeader>
          {selectedInspection && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold">{selectedInspection.overall_score?.toFixed(0) || 0}%</div>
                  <div className="text-sm text-muted-foreground">Overall Score</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-green-600">{selectedInspection.passed_items}</div>
                  <div className="text-sm text-muted-foreground">Items Passed</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-red-600">{selectedInspection.critical_failures}</div>
                  <div className="text-sm text-muted-foreground">Critical Failures</div>
                </div>
              </div>

              <div className="space-y-2">
                {templates
                  .find(t => t.id === selectedInspection.template_id)
                  ?.template_data.map((item) => {
                    const result = selectedInspection.inspection_data[item.id];
                    return (
                      <Card key={item.id} className={`p-3 ${item.is_critical ? 'border-orange-200' : ''}`}>
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium">{item.name}</h4>
                              {item.is_critical && (
                                <Badge variant="destructive" className="text-xs">Critical</Badge>
                              )}
                              {item.requires_photo && (
                                <Badge variant="outline" className="text-xs">
                                  <Camera className="h-3 w-3 mr-1" />
                                  Photo
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">{item.description}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {selectedInspection.status === 'in_progress' ? (
                              <>
                                <Button
                                  size="sm"
                                  variant={result?.passed ? "default" : "outline"}
                                  onClick={() => updateInspectionItem(selectedInspection.id, item.id, { passed: true })}
                                >
                                  <CheckCircle className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant={result?.passed === false ? "destructive" : "outline"}
                                  onClick={() => updateInspectionItem(selectedInspection.id, item.id, { passed: false })}
                                >
                                  <XCircle className="h-4 w-4" />
                                </Button>
                              </>
                            ) : (
                              <Badge variant={result?.passed ? "default" : "destructive"}>
                                {result?.passed ? "Pass" : "Fail"}
                              </Badge>
                            )}
                          </div>
                        </div>
                        {result?.notes && (
                          <p className="text-sm text-muted-foreground mt-2">
                            Notes: {result.notes}
                          </p>
                        )}
                      </Card>
                    );
                  })}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}