import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useToast } from '@/hooks/use-toast';
import { PdfTemplateEngine, type PdfTemplate } from '@/lib/pdf-engine/PdfTemplateEngine';
import { PdfTemplateQualityScorer, type QualityBadge } from '@/lib/pdf-engine/PdfTemplateQualityScorer';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText, Search, Copy, Library, Building2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const CATEGORIES = ['all', 'general', 'estimate', 'proposal', 'contract', 'invoice', 'insurance', 'permit'];

const SYSTEM_TEMPLATES: Array<{ title: string; category: string; description: string }> = [
  { title: 'Standard Estimate', category: 'estimate', description: 'Basic estimate template with line items and totals' },
  { title: 'Roofing Proposal', category: 'proposal', description: 'Professional roofing proposal with scope and pricing' },
  { title: 'Service Contract', category: 'contract', description: 'General service contract with terms and conditions' },
  { title: 'Insurance Claim', category: 'insurance', description: 'Insurance restoration claim documentation' },
];

function getQuickScore(template: PdfTemplate): { score: number; badge: QualityBadge } {
  const smartCount = (template.smart_tags || []).length;
  const result = PdfTemplateQualityScorer.score({
    smartFieldCount: smartCount,
    totalTextObjects: Math.max(smartCount, 10),
    unresolvedPlaceholders: [],
    missingRequiredFields: [],
    textOverflowWarnings: 0,
    fontFallbackCount: 0,
    hasRedactions: false,
    redactionVerified: false,
    ocrPageCount: 0,
    totalPageCount: template.page_count || 1,
    averageOcrConfidence: 100,
  });
  return { score: result.score, badge: result.badge };
}

const PdfTemplateLibrary = () => {
  const navigate = useNavigate();
  const tenantId = useEffectiveTenantId();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const templatesQuery = useQuery({
    queryKey: ['pdf-templates-library', tenantId, categoryFilter],
    queryFn: () => PdfTemplateEngine.listTemplates(
      tenantId!,
      categoryFilter !== 'all' ? categoryFilter : undefined
    ),
    enabled: !!tenantId,
  });

  const duplicateMutation = useMutation({
    mutationFn: async (template: PdfTemplate) => {
      await PdfTemplateEngine.saveAsTemplate(
        tenantId!, user!.id,
        `${template.title} (Copy)`,
        `Duplicated from ${template.title}`,
        template.source_document_id || '',
        template.smart_tags || [],
        template.category,
        template.original_file_path || undefined,
        template.page_count,
        template.layout_graph || undefined,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pdf-templates-library'] });
      toast({ title: 'Template duplicated into your library' });
    },
  });

  const filtered = (templatesQuery.data || []).filter(t =>
    !search || t.title.toLowerCase().includes(search.toLowerCase())
  );

  const systemFiltered = SYSTEM_TEMPLATES.filter(t =>
    (categoryFilter === 'all' || t.category === categoryFilter) &&
    (!search || t.title.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <GlobalLayout>
      <div className="max-w-5xl mx-auto py-6 px-4">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Library className="h-6 w-6" /> Template Library
            </h1>
            <p className="text-sm text-muted-foreground">Browse and import reusable PDF templates</p>
          </div>
          <Button variant="outline" onClick={() => navigate('/documents/pdf-engine/templates')}>
            My Templates
          </Button>
        </div>

        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search templates..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map(c => (
                <SelectItem key={c} value={c}>{c === 'all' ? 'All Categories' : c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Tabs defaultValue="company">
          <TabsList className="mb-4">
            <TabsTrigger value="company"><Building2 className="h-3.5 w-3.5 mr-1" />Company</TabsTrigger>
            <TabsTrigger value="system"><Library className="h-3.5 w-3.5 mr-1" />System</TabsTrigger>
          </TabsList>

          <TabsContent value="company">
            <ScrollArea className="h-[calc(100vh-340px)]">
              {templatesQuery.isLoading ? (
                <div className="flex justify-center py-20">
                  <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-20 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p>No company templates found</p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {filtered.map(t => {
                    const { score, badge } = getQuickScore(t);
                    return (
                      <Card key={t.id} className="hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() => navigate(`/documents/pdf-engine/template/${t.id}`)}
                      >
                        <CardContent className="p-4 flex items-center gap-4">
                          <FileText className="h-8 w-8 text-primary/60 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <h3 className="font-medium text-sm truncate">{t.title}</h3>
                            <p className="text-xs text-muted-foreground truncate">{t.description}</p>
                            <div className="flex gap-1 mt-1">
                              <Badge variant="outline" className="text-[10px]">{t.category}</Badge>
                              <Badge variant="secondary" className="text-[10px]">{t.page_count} pages</Badge>
                              <Badge className={`text-[10px] ${PdfTemplateQualityScorer.getBadgeColor(badge)}`}>
                                {badge} ({score})
                              </Badge>
                            </div>
                          </div>
                          <div className="flex gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                            <Button variant="ghost" size="icon" className="h-7 w-7"
                              onClick={() => duplicateMutation.mutate(t)} title="Duplicate">
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="system">
            <ScrollArea className="h-[calc(100vh-340px)]">
              {systemFiltered.length === 0 ? (
                <div className="text-center py-20 text-muted-foreground">
                  <Library className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p>No system templates match your filter</p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {systemFiltered.map((t, i) => (
                    <Card key={i} className="hover:bg-muted/30 transition-colors">
                      <CardContent className="p-4 flex items-center gap-4">
                        <Library className="h-8 w-8 text-muted-foreground flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-sm">{t.title}</h3>
                          <p className="text-xs text-muted-foreground">{t.description}</p>
                          <Badge variant="outline" className="text-[10px] mt-1">{t.category}</Badge>
                        </div>
                        <Badge variant="secondary" className="text-[10px]">Coming Soon</Badge>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>
    </GlobalLayout>
  );
};

export default PdfTemplateLibrary;
