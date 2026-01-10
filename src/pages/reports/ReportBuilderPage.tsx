import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { SidebarProvider, Sidebar, SidebarContent, SidebarHeader, SidebarFooter, SidebarInset } from '@/components/ui/sidebar';
import { 
  ArrowLeft, 
  Save, 
  Send, 
  FileText, 
  Image, 
  Calculator, 
  BookOpen, 
  PenTool,
  GripVertical,
  Eye,
  Link2,
  Loader2,
  FileDown,
  RefreshCw
} from 'lucide-react';
import { SectionLibrary } from '@/components/reports/SectionLibrary';
import { SectionOrderList } from '@/components/reports/SectionOrderList';
import { LivePreview } from '@/components/reports/LivePreview';
import { SendModal } from '@/components/reports/SendModal';
import { useReportPacket } from '@/hooks/useReportPacket';

export interface ReportSection {
  id: string;
  type: 'cover' | 'measurements' | 'photos' | 'estimate' | 'marketing' | 'signature';
  label: string;
  enabled: boolean;
  order: number;
  config?: Record<string, any>;
  fileId?: string;
  fileName?: string;
  pageCount?: number;
}

const defaultSections: ReportSection[] = [
  { id: 'cover', type: 'cover', label: 'Cover Page', enabled: true, order: 0, pageCount: 1 },
  { id: 'measurements', type: 'measurements', label: 'Measurements', enabled: false, order: 1, pageCount: 0 },
  { id: 'photos', type: 'photos', label: 'Photos', enabled: false, order: 2, pageCount: 0 },
  { id: 'estimate', type: 'estimate', label: 'Estimate', enabled: true, order: 3, pageCount: 0 },
  { id: 'marketing', type: 'marketing', label: 'Marketing Pages', enabled: false, order: 4, pageCount: 0 },
  { id: 'signature', type: 'signature', label: 'Signature Page', enabled: true, order: 5, pageCount: 1 },
];

export default function ReportBuilderPage() {
  const { subjectType, subjectId } = useParams<{ subjectType: string; subjectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  const [sections, setSections] = useState<ReportSection[]>(defaultSections);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [showSendModal, setShowSendModal] = useState(false);
  const [packetId, setPacketId] = useState<string | null>(null);
  
  const { 
    upsertDraft, 
    generatePdf, 
    isUpsertingDraft, 
    isGeneratingPdf 
  } = useReportPacket();

  // Fetch subject data (job, lead, or contact)
  const { data: subjectData, isLoading: isLoadingSubject } = useQuery({
    queryKey: ['report-subject', subjectType, subjectId],
    queryFn: async () => {
      if (!subjectType || !subjectId) return null;
      
      let query;
      switch (subjectType) {
        case 'job':
          query = supabase.from('jobs').select('*, contacts(*)').eq('id', subjectId).single();
          break;
        case 'pipeline_entry':
          query = supabase.from('pipeline_entries').select('*, contacts(*)').eq('id', subjectId).single();
          break;
        case 'contact':
          query = supabase.from('contacts').select('*').eq('id', subjectId).single();
          break;
        default:
          return null;
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!subjectType && !!subjectId,
  });

  // Fetch available documents for measurements
  const { data: documents } = useQuery({
    queryKey: ['subject-documents', subjectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .or(`pipeline_entry_id.eq.${subjectId},project_id.eq.${subjectId}`)
        .in('document_type', ['measurement_report', 'roof_report', 'pdf']);
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!subjectId,
  });

  // Fetch available estimates
  const { data: estimates } = useQuery({
    queryKey: ['subject-estimates', subjectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('estimates')
        .select('*')
        .or(`pipeline_entry_id.eq.${subjectId},project_id.eq.${subjectId}`)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!subjectId,
  });

  // Set initial title based on subject
  useEffect(() => {
    if (subjectData) {
      const address = subjectData.address || subjectData.contacts?.address || '';
      const contactName = subjectData.contacts?.first_name 
        ? `${subjectData.contacts.first_name} ${subjectData.contacts.last_name || ''}`
        : '';
      setTitle(`Report for ${contactName || address || 'Property'}`);
    }
  }, [subjectData]);

  const handleSectionToggle = (sectionId: string, enabled: boolean) => {
    setSections(prev => prev.map(s => 
      s.id === sectionId ? { ...s, enabled } : s
    ));
  };

  const handleSectionReorder = (reorderedSections: ReportSection[]) => {
    setSections(reorderedSections.map((s, i) => ({ ...s, order: i })));
  };

  const handleSaveDraft = async () => {
    if (!subjectType || !subjectId) {
      toast({ title: 'Error', description: 'Missing subject information', variant: 'destructive' });
      return;
    }

    try {
      const result = await upsertDraft({
        packetId: packetId || undefined,
        subjectType: subjectType as 'lead' | 'job' | 'contact' | 'pipeline_entry',
        subjectId,
        title,
        messageToClient: message,
        sectionManifest: sections.filter(s => s.enabled).sort((a, b) => a.order - b.order),
      });
      
      if (result?.id) {
        setPacketId(result.id);
        toast({ title: 'Draft saved', description: 'Your report packet has been saved.' });
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleGeneratePdf = async () => {
    if (!packetId) {
      // Save draft first
      await handleSaveDraft();
    }
    
    if (!packetId) {
      toast({ title: 'Error', description: 'Please save the draft first', variant: 'destructive' });
      return;
    }

    try {
      await generatePdf(packetId);
      toast({ title: 'PDF Generated', description: 'Your report packet PDF is ready.' });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleSend = () => {
    if (!packetId) {
      toast({ title: 'Error', description: 'Please save the draft first', variant: 'destructive' });
      return;
    }
    setShowSendModal(true);
  };

  const enabledSections = sections.filter(s => s.enabled).sort((a, b) => a.order - b.order);
  const totalPages = enabledSections.reduce((sum, s) => sum + (s.pageCount || 1), 0);

  if (isLoadingSubject) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full bg-background">
        {/* Left Sidebar - Section Library */}
        <Sidebar variant="sidebar" className="w-72 border-r">
          <SidebarHeader className="border-b p-4">
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="mb-2">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <h2 className="font-semibold text-lg">Report Sections</h2>
            <p className="text-sm text-muted-foreground">Select sections to include</p>
          </SidebarHeader>
          <SidebarContent className="p-4">
            <SectionLibrary 
              sections={sections}
              documents={documents || []}
              estimates={estimates || []}
              onToggle={handleSectionToggle}
              onConfigChange={(id, config) => {
                setSections(prev => prev.map(s => 
                  s.id === id ? { ...s, ...config } : s
                ));
              }}
            />
          </SidebarContent>
          <SidebarFooter className="border-t p-4">
            <div className="text-sm text-muted-foreground">
              {enabledSections.length} sections • ~{totalPages} pages
            </div>
          </SidebarFooter>
        </Sidebar>

        {/* Main Content Area */}
        <SidebarInset className="flex flex-col flex-1 overflow-hidden">
          {/* Header */}
          <header className="border-b p-4 flex items-center justify-between bg-card">
            <div className="flex-1 max-w-xl">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Report Title"
                className="text-lg font-semibold border-0 bg-transparent focus-visible:ring-0 px-0"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleSaveDraft} disabled={isUpsertingDraft}>
                {isUpsertingDraft ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Save Draft
              </Button>
              <Button variant="outline" size="sm" onClick={handleGeneratePdf} disabled={isGeneratingPdf}>
                {isGeneratingPdf ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileDown className="h-4 w-4 mr-2" />}
                Generate PDF
              </Button>
              <Button size="sm" onClick={handleSend}>
                <Send className="h-4 w-4 mr-2" />
                Send
              </Button>
            </div>
          </header>

          {/* Content - Section Order + Preview */}
          <div className="flex-1 flex overflow-hidden">
            {/* Center - Section Order */}
            <div className="w-80 border-r p-4 overflow-y-auto bg-muted/30">
              <div className="mb-4">
                <h3 className="font-medium mb-1">Section Order</h3>
                <p className="text-sm text-muted-foreground">Drag to reorder sections</p>
              </div>
              <SectionOrderList 
                sections={enabledSections}
                onReorder={handleSectionReorder}
              />
              
              {/* Message to Client */}
              <div className="mt-6">
                <h3 className="font-medium mb-2">Message to Client</h3>
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Add a personal message..."
                  rows={4}
                  className="resize-none"
                />
              </div>
            </div>

            {/* Right - Live Preview */}
            <div className="flex-1 p-4 overflow-y-auto bg-muted/10">
              <LivePreview 
                sections={enabledSections}
                subjectData={subjectData}
                title={title}
              />
            </div>
          </div>
        </SidebarInset>

        {/* Send Modal */}
        <SendModal 
          open={showSendModal}
          onOpenChange={setShowSendModal}
          packetId={packetId}
          subjectData={subjectData}
          title={title}
        />
      </div>
    </SidebarProvider>
  );
}
