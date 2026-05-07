import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { PdfTemplateEngine, type PdfTemplate, STANDARD_SMART_TAGS } from '@/lib/pdf-engine/PdfTemplateEngine';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Save, FileText, Layers, Tag, Play, Download } from 'lucide-react';

const CATEGORIES = ['general', 'estimate', 'proposal', 'contract', 'invoice', 'insurance', 'permit'];

const PdfTemplateDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const tenantId = useEffectiveTenantId();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('general');
  const [reusable, setReusable] = useState(true);
  const [description, setDescription] = useState('');

  const templateQuery = useQuery({
    queryKey: ['pdf-template-detail', id],
    queryFn: () => PdfTemplateEngine.getTemplate(id!),
    enabled: !!id,
  });

  useEffect(() => {
    if (templateQuery.data) {
      setTitle(templateQuery.data.title);
      setCategory(templateQuery.data.category);
      setReusable(templateQuery.data.reusable);
      setDescription(templateQuery.data.description || '');
    }
  }, [templateQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await (supabase as any).from('pdf_templates')
        .update({ title, category, reusable, description })
        .eq('id', id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pdf-template-detail', id] });
      toast({ title: 'Template saved' });
    },
  });

  const template = templateQuery.data;
  const layoutGraph = template?.layout_graph;
  const smartFields = template?.smart_fields_loaded || [];

  if (templateQuery.isLoading) {
    return (
      <GlobalLayout>
        <div className="flex items-center justify-center h-64">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </GlobalLayout>
    );
  }

  return (
    <GlobalLayout>
      <div className="max-w-4xl mx-auto py-6 px-4">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate('/documents/pdf-engine/templates')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-bold">{template?.title || 'Template'}</h1>
            <p className="text-xs text-muted-foreground">Template Detail</p>
          </div>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Save className="h-4 w-4 mr-1" />
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>

        <Tabs defaultValue="settings">
          <TabsList className="mb-4">
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="layout">Layout Graph</TabsTrigger>
            <TabsTrigger value="fields">Smart Fields ({smartFields.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="settings">
            <Card>
              <CardContent className="p-6 space-y-4">
                <div>
                  <Label>Template Name</Label>
                  <Input value={title} onChange={e => setTitle(e.target.value)} />
                </div>
                <div>
                  <Label>Description</Label>
                  <Textarea value={description} onChange={e => setDescription(e.target.value)} className="min-h-[80px]" />
                </div>
                <div>
                  <Label>Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(c => (
                        <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-3">
                  <Switch checked={reusable} onCheckedChange={setReusable} />
                  <Label>Reusable template</Label>
                </div>
                <div className="grid grid-cols-2 gap-4 pt-4 border-t text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Pages</p>
                    <p>{template?.page_count || 0}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Source Document</p>
                    <p className="truncate">{template?.source_document_id || 'None'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Created</p>
                    <p>{template?.created_at ? new Date(template.created_at).toLocaleDateString() : '-'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Original File</p>
                    <p className="truncate">{template?.original_file_path || 'None'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="layout">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Layers className="h-4 w-4" /> Layout Graph
                </CardTitle>
              </CardHeader>
              <CardContent>
                {layoutGraph ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <div className="p-3 bg-muted rounded">
                        <p className="text-xs text-muted-foreground">Pages</p>
                        <p className="text-lg font-bold">{layoutGraph.metadata?.source_page_count || 0}</p>
                      </div>
                      <div className="p-3 bg-muted rounded">
                        <p className="text-xs text-muted-foreground">Objects</p>
                        <p className="text-lg font-bold">{layoutGraph.metadata?.total_objects || 0}</p>
                      </div>
                      <div className="p-3 bg-muted rounded">
                        <p className="text-xs text-muted-foreground">Smart Fields</p>
                        <p className="text-lg font-bold">{layoutGraph.metadata?.smart_field_count || 0}</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Operation Rules ({layoutGraph.operation_rules?.length || 0})</p>
                      <ScrollArea className="h-40 border rounded p-2">
                        {(layoutGraph.operation_rules || []).map((r, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs py-1 border-b last:border-0">
                            <Badge variant="outline" className="text-[9px]">{r.operation}</Badge>
                            <span className="font-mono text-muted-foreground">{r.field_key}</span>
                            <span className="text-muted-foreground ml-auto">p{r.page_number}</span>
                          </div>
                        ))}
                      </ScrollArea>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Font Map</p>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(layoutGraph.font_map || {}).map(([k, v]) => (
                          <Badge key={k} variant="secondary" className="text-[10px]">{k} → {v}</Badge>
                        ))}
                        {Object.keys(layoutGraph.font_map || {}).length === 0 && (
                          <p className="text-xs text-muted-foreground">No fonts mapped</p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No layout graph generated yet</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="fields">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Tag className="h-4 w-4" /> Smart Fields
                </CardTitle>
              </CardHeader>
              <CardContent>
                {smartFields.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No smart fields detected</p>
                ) : (
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-2">
                      {smartFields.map((f: any, i: number) => (
                        <div key={i} className="p-3 border rounded space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px]">{f.category || 'general'}</Badge>
                            <span className="text-sm font-mono font-medium">{`{{${f.fieldKey || f.field_key}}}`}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Confidence: {Math.round((f.confidence || 0) * 100)}%
                          </p>
                          {f.placeholderText && (
                            <p className="text-xs text-muted-foreground">Placeholder: {f.placeholderText}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}

                <div className="mt-4 pt-4 border-t">
                  <p className="text-xs text-muted-foreground mb-2">Available Standard Tags</p>
                  <div className="flex flex-wrap gap-1">
                    {STANDARD_SMART_TAGS.map(t => (
                      <Badge key={t.tag} variant="secondary" className="text-[10px]">{t.tag}</Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </GlobalLayout>
  );
};

export default PdfTemplateDetail;
