import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, Printer, Loader2, FileText, MapPin, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { ReportPage } from './ReportPage';
import { useQueryClient } from '@tanstack/react-query';

interface EagleViewStyleReportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  measurementId?: string;
  measurement: any;
  tags: Record<string, any>;
  address: string;
  pipelineEntryId?: string;
  satelliteImageUrl?: string;
  companyInfo?: {
    name: string;
    logo?: string;
    phone?: string;
    email?: string;
    license?: string;
  };
  onReportGenerated?: (reportUrl: string) => void;
  onApproved?: () => void;
  tenantId?: string;
}

// EagleView waste percentages
const WASTE_PERCENTAGES = [0, 10, 12, 15, 17, 20, 22];

// Feature colors matching EagleView
const FEATURE_COLORS = {
  valley: '#ef4444',     // Red
  ridge: '#22c55e',      // Green
  hip: '#3b82f6',        // Blue
  eave: '#06b6d4',       // Cyan
  rake: '#8b5cf6',       // Purple
  step: '#f59e0b',       // Amber
  flashing: '#ec4899',   // Pink
  parapet: '#6b7280',    // Gray
};

// Facet colors for diagram
const FACET_COLORS = [
  'hsl(210, 80%, 60%)', 'hsl(150, 70%, 50%)', 'hsl(45, 90%, 55%)', 
  'hsl(0, 75%, 55%)', 'hsl(270, 65%, 55%)', 'hsl(320, 70%, 55%)',
  'hsl(180, 70%, 45%)', 'hsl(30, 85%, 55%)',
];

export function EagleViewStyleReport({
  open,
  onOpenChange,
  measurementId,
  measurement,
  tags,
  address,
  pipelineEntryId,
  satelliteImageUrl,
  companyInfo,
  onReportGenerated,
  onApproved,
  tenantId,
}: EagleViewStyleReportProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentPage, setCurrentPage] = useState(1);
  const [isApproving, setIsApproving] = useState(false);
  const [approvalNotes, setApprovalNotes] = useState('');
  const [showApprovalConfirm, setShowApprovalConfirm] = useState(false);

  const totalPages = 8;

  // Extract measurement data with EagleView-style formatting
  const reportData = useMemo(() => {
    const totalArea = measurement?.summary?.total_area_sqft || tags['roof.plan_area'] || 0;
    const facetCount = measurement?.faces?.length || tags['roof.faces_count'] || 0;
    const pitch = measurement?.summary?.pitch || measurement?.predominant_pitch || '6/12';
    const stories = measurement?.summary?.stories || 1;

    // Linear features
    const eaves = tags['lf.eave'] || measurement?.summary?.eave_ft || 0;
    const rakes = tags['lf.rake'] || measurement?.summary?.rake_ft || 0;
    const ridges = tags['lf.ridge'] || measurement?.summary?.ridge_ft || 0;
    const hips = tags['lf.hip'] || measurement?.summary?.hip_ft || 0;
    const valleys = tags['lf.valley'] || measurement?.summary?.valley_ft || 0;
    const stepFlashing = tags['lf.step'] || measurement?.summary?.step_ft || 0;
    const flashing = tags['lf.flashing'] || measurement?.summary?.flashing_ft || 0;
    const parapets = tags['lf.parapet'] || 0;

    // Drip edge is eaves + rakes
    const dripEdge = eaves + rakes;

    // Faces with pitch distribution
    const faces = measurement?.faces || [];
    const pitchDistribution: Record<string, { area: number; count: number }> = {};
    
    faces.forEach((face: any) => {
      const facePitch = face.pitch || pitch;
      if (!pitchDistribution[facePitch]) {
        pitchDistribution[facePitch] = { area: 0, count: 0 };
      }
      pitchDistribution[facePitch].area += face.area_sqft || face.plan_area_sqft || 0;
      pitchDistribution[facePitch].count += 1;
    });

    // If no pitch distribution, create default
    if (Object.keys(pitchDistribution).length === 0) {
      pitchDistribution[pitch] = { area: totalArea, count: facetCount || 1 };
    }

    // Waste calculation table
    const wasteTable = WASTE_PERCENTAGES.map(waste => ({
      waste,
      area: Math.round(totalArea * (1 + waste / 100)),
      squares: (totalArea * (1 + waste / 100) / 100).toFixed(1),
    }));

    return {
      totalArea,
      facetCount,
      pitch,
      stories,
      eaves,
      rakes,
      ridges,
      hips,
      valleys,
      stepFlashing,
      flashing,
      parapets,
      dripEdge,
      ridgesHips: ridges + hips,
      faces,
      pitchDistribution,
      wasteTable,
    };
  }, [measurement, tags]);

  // Generate facet labels (A-Z, AA-AZ, etc.)
  const getFacetLabel = (index: number): string => {
    if (index < 26) return String.fromCharCode(65 + index);
    const first = Math.floor(index / 26) - 1;
    const second = index % 26;
    return String.fromCharCode(65 + first) + String.fromCharCode(65 + second);
  };

  const handleApproveMeasurements = async () => {
    if (!pipelineEntryId || !tenantId) {
      toast({
        title: "Missing Information",
        description: "Pipeline entry or tenant ID is missing.",
        variant: "destructive",
      });
      return;
    }

    setIsApproving(true);
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // 1. Generate PDF report first
      const { data: reportData, error: reportError } = await supabase.functions.invoke('generate-eagleview-report', {
        body: {
          measurementId,
          measurement,
          tags,
          address,
          companyInfo: companyInfo || { name: 'PITCH CRM' },
        }
      });

      let reportDocumentId: string | null = null;
      let pdfUrl: string | null = null;

      if (!reportError && reportData?.pdfUrl) {
        pdfUrl = reportData.pdfUrl;
        onReportGenerated?.(pdfUrl);

        // 2. Create document record for the PDF
        const { data: docData, error: docError } = await supabase
          .from('documents')
          .insert({
            tenant_id: tenantId,
            pipeline_entry_id: pipelineEntryId,
            filename: `Measurement_Report_${address.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
            file_path: pdfUrl,
            mime_type: 'application/pdf',
            document_type: 'measurement_report',
            description: `Approved measurement report for ${address}`,
            uploaded_by: user.id,
          })
          .select('id')
          .single();

        if (!docError && docData) {
          reportDocumentId = docData.id;
        }
      }

      // 3. Save approval record with smart tags
      const { error: approvalError } = await supabase
        .from('measurement_approvals')
        .upsert({
          tenant_id: tenantId,
          pipeline_entry_id: pipelineEntryId,
          measurement_id: measurementId || null,
          approved_by: user.id,
          approved_at: new Date().toISOString(),
          saved_tags: tags,
          approval_notes: approvalNotes || null,
          report_generated: !!pdfUrl,
          report_document_id: reportDocumentId,
        }, {
          onConflict: 'pipeline_entry_id,measurement_id',
        });

      if (approvalError) throw approvalError;

      // 4. Update pipeline entry notes to record approval
      const { data: currentEntry } = await supabase
        .from('pipeline_entries')
        .select('notes')
        .eq('id', pipelineEntryId)
        .single();

      const approvalNote = `\n\n---\nMeasurements approved on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}\n${approvalNotes ? `Notes: ${approvalNotes}` : ''}`;
      
      await supabase
        .from('pipeline_entries')
        .update({
          notes: (currentEntry?.notes || '') + approvalNote
        })
        .eq('id', pipelineEntryId);

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['measurement-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      queryClient.invalidateQueries({ queryKey: ['pipeline-entry'] });

      toast({
        title: "Measurements Approved",
        description: "Smart tags saved and report added to Documents.",
      });

      setShowApprovalConfirm(false);
      onApproved?.();
      onOpenChange(false);

    } catch (err: any) {
      console.error('Failed to approve measurements:', err);
      toast({
        title: "Approval Failed",
        description: err.message || "Could not approve measurements.",
        variant: "destructive",
      });
    } finally {
      setIsApproving(false);
    }
  };

  const formatFeetInches = (feet: number): string => {
    const wholeFeet = Math.floor(feet);
    const inches = Math.round((feet - wholeFeet) * 12);
    if (inches === 0) return `${wholeFeet} ft`;
    return `${wholeFeet} ft ${inches} in`;
  };

  const formatDate = () => {
    return new Date().toLocaleDateString('en-US', { 
      month: '2-digit', 
      day: '2-digit', 
      year: 'numeric' 
    });
  };

  const reportNumber = measurementId?.slice(0, 8).toUpperCase() || 'XXXXXXXX';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] p-0">
        <DialogHeader className="p-4 border-b flex-row items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-primary" />
            <DialogTitle>Premium Measurement Report</DialogTitle>
            <Badge variant="outline" className="ml-2">
              Page {currentPage} of {totalPages}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-1" />
              Print
            </Button>
            <Button 
              size="sm" 
              onClick={() => setShowApprovalConfirm(true)} 
              disabled={isApproving}
              className="bg-green-600 hover:bg-green-700"
            >
              {isApproving ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-1" />
              )}
              Approve Measurements
            </Button>
          </div>
        </DialogHeader>

        {/* Approval Confirmation Dialog */}
        {showApprovalConfirm && (
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-6">
            <div className="bg-card border rounded-lg shadow-lg p-6 max-w-md w-full">
              <h3 className="text-lg font-semibold mb-2">Approve Measurements?</h3>
              <p className="text-sm text-muted-foreground mb-4">
                This will save the smart tags for future estimates and generate a PDF report in the Documents tab.
              </p>
              <div className="mb-4">
                <label className="text-sm font-medium mb-1 block">Approval Notes (optional)</label>
                <Textarea
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  placeholder="Any notes about these measurements..."
                  rows={3}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button 
                  variant="outline" 
                  onClick={() => setShowApprovalConfirm(false)}
                  disabled={isApproving}
                >
                  Cancel
                </Button>
                <Button 
                  onClick={handleApproveMeasurements}
                  disabled={isApproving}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {isApproving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      Approving...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      Approve & Save
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-1 min-h-0">
          {/* Page Navigation Sidebar */}
          <div className="w-36 border-r bg-muted/30 p-2">
            <ScrollArea className="h-full">
              <div className="space-y-1">
                {[
                  { num: 1, label: 'Cover' },
                  { num: 2, label: 'Summary' },
                  { num: 3, label: 'Images' },
                  { num: 4, label: 'Length Diagram' },
                  { num: 5, label: 'Pitch Diagram' },
                  { num: 6, label: 'Area Diagram' },
                  { num: 7, label: 'Notes Diagram' },
                  { num: 8, label: 'Report Summary' },
                ].map(({ num, label }) => (
                  <button
                    key={num}
                    onClick={() => setCurrentPage(num)}
                    className={`w-full text-left px-2 py-1.5 rounded text-xs ${
                      currentPage === num
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-muted'
                    }`}
                  >
                    {num}. {label}
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Report Content */}
          <ScrollArea className="flex-1">
            <div className="p-6" id="eagleview-report-content">
              
              {/* Page 1: Cover */}
              {currentPage === 1 && (
                <ReportPage pageNumber={1} companyInfo={companyInfo}>
                  <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold text-primary mb-1">Precise Aerial Measurement Report</h1>
                    <p className="text-lg text-muted-foreground">Prepared for you by {companyInfo?.name || 'PITCH CRM'}</p>
                  </div>

                  <div className="aspect-video bg-muted rounded-lg mb-6 overflow-hidden relative">
                    {satelliteImageUrl ? (
                      <img src={satelliteImageUrl} alt="Property aerial view" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        <MapPin className="h-12 w-12 mr-2" />
                        <span>Satellite imagery loading...</span>
                      </div>
                    )}
                    <div className="absolute bottom-2 right-2 bg-black/70 text-white px-2 py-1 rounded text-xs">
                      {formatDate()}
                    </div>
                  </div>

                  <div className="bg-muted/50 rounded-lg p-4 mb-6 text-center">
                    <p className="text-xl font-semibold">{address}</p>
                  </div>

                  <div className="border-t pt-6 text-sm text-muted-foreground">
                    <div className="flex justify-between">
                      <div>
                        <p className="font-semibold text-foreground">{companyInfo?.name || 'PITCH CRM'}</p>
                        {companyInfo?.phone && <p>Tel: {companyInfo.phone}</p>}
                        {companyInfo?.email && <p>Email: {companyInfo.email}</p>}
                        {companyInfo?.license && <p>License: {companyInfo.license}</p>}
                      </div>
                      <div className="text-right">
                        <p>Measurements provided by</p>
                        <p className="font-bold text-primary text-lg">PITCH CRM</p>
                      </div>
                    </div>
                  </div>
                </ReportPage>
              )}

              {/* Page 2: Summary / Table of Contents */}
              {currentPage === 2 && (
                <ReportPage pageNumber={2} companyInfo={companyInfo}>
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      <h2 className="text-2xl font-bold text-primary">Premium Report</h2>
                      <p className="text-muted-foreground">{formatDate()}</p>
                    </div>
                    <div className="text-right text-sm">
                      <p className="font-medium">{address}</p>
                      <p className="text-muted-foreground">Report: {reportNumber}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    {/* Table of Contents */}
                    <div>
                      <h3 className="font-bold text-lg mb-4 border-b pb-2">TABLE OF CONTENTS</h3>
                      <ul className="space-y-2 text-sm">
                        <li className="flex justify-between"><span>Images</span><span className="text-muted-foreground">...1</span></li>
                        <li className="flex justify-between"><span>Length Diagram</span><span className="text-muted-foreground">...4</span></li>
                        <li className="flex justify-between"><span>Pitch Diagram</span><span className="text-muted-foreground">...5</span></li>
                        <li className="flex justify-between"><span>Area Diagram</span><span className="text-muted-foreground">...6</span></li>
                        <li className="flex justify-between"><span>Notes Diagram</span><span className="text-muted-foreground">...7</span></li>
                        <li className="flex justify-between"><span>Report Summary</span><span className="text-muted-foreground">...8</span></li>
                      </ul>
                    </div>

                    {/* Measurements Summary */}
                    <div>
                      <h3 className="font-bold text-lg mb-4 border-b pb-2">MEASUREMENTS</h3>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span>Total Roof Area</span>
                          <span className="font-bold">{Math.round(reportData.totalArea).toLocaleString()} sq ft</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Total Roof Facets</span>
                          <span className="font-bold">{reportData.facetCount}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Predominant Pitch</span>
                          <span className="font-bold">{reportData.pitch}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Number of Stories</span>
                          <span className="font-bold">{reportData.stories > 1 ? '> 1' : '<= 1'}</span>
                        </div>
                        <div className="border-t pt-2 mt-2" />
                        <div className="flex justify-between">
                          <span>Total Ridges/Hips</span>
                          <span className="font-bold">{Math.round(reportData.ridgesHips)} ft</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Total Valleys</span>
                          <span className="font-bold">{Math.round(reportData.valleys)} ft</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Total Rakes</span>
                          <span className="font-bold">{Math.round(reportData.rakes)} ft</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Total Eaves</span>
                          <span className="font-bold">{Math.round(reportData.eaves)} ft</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 bg-muted/30 rounded p-4 text-xs text-muted-foreground">
                    <p>In this 3D model, facets appear as semi-transparent to reveal overhangs.</p>
                  </div>
                </ReportPage>
              )}

              {/* Page 3: Images */}
              {currentPage === 3 && (
                <ReportPage pageNumber={3} companyInfo={companyInfo} title="IMAGES">
                  <p className="text-sm text-muted-foreground mb-4">
                    The following aerial images show different angles of this structure for your reference.
                  </p>

                  <div className="grid grid-cols-1 gap-6">
                    <div>
                      <h4 className="font-semibold mb-2 text-center">Top View</h4>
                      <div className="aspect-video bg-muted rounded-lg overflow-hidden">
                        {satelliteImageUrl ? (
                          <img src={satelliteImageUrl} alt="Top view" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                            Satellite image
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground mt-4 text-center">
                    Imagery date: {formatDate()}
                  </p>
                </ReportPage>
              )}

              {/* Page 4: Length Diagram */}
              {currentPage === 4 && (
                <ReportPage pageNumber={4} companyInfo={companyInfo} title="LENGTH DIAGRAM">
                  {/* Length Summary Table */}
                  <div className="grid grid-cols-4 gap-2 mb-6 text-sm">
                    <div className="border rounded p-2 text-center" style={{ borderColor: FEATURE_COLORS.valley }}>
                      <div className="font-bold" style={{ color: FEATURE_COLORS.valley }}>
                        {Math.round(reportData.valleys)} ft
                      </div>
                      <div className="text-xs text-muted-foreground">Valleys</div>
                    </div>
                    <div className="border rounded p-2 text-center" style={{ borderColor: FEATURE_COLORS.ridge }}>
                      <div className="font-bold" style={{ color: FEATURE_COLORS.ridge }}>
                        {Math.round(reportData.ridges)} ft
                      </div>
                      <div className="text-xs text-muted-foreground">Ridges</div>
                    </div>
                    <div className="border rounded p-2 text-center" style={{ borderColor: FEATURE_COLORS.hip }}>
                      <div className="font-bold" style={{ color: FEATURE_COLORS.hip }}>
                        {Math.round(reportData.hips)} ft
                      </div>
                      <div className="text-xs text-muted-foreground">Hips</div>
                    </div>
                    <div className="border rounded p-2 text-center" style={{ borderColor: FEATURE_COLORS.eave }}>
                      <div className="font-bold" style={{ color: FEATURE_COLORS.eave }}>
                        {Math.round(reportData.eaves)} ft
                      </div>
                      <div className="text-xs text-muted-foreground">Eaves</div>
                    </div>
                    <div className="border rounded p-2 text-center" style={{ borderColor: FEATURE_COLORS.rake }}>
                      <div className="font-bold" style={{ color: FEATURE_COLORS.rake }}>
                        {Math.round(reportData.rakes)} ft
                      </div>
                      <div className="text-xs text-muted-foreground">Rakes</div>
                    </div>
                    <div className="border rounded p-2 text-center" style={{ borderColor: FEATURE_COLORS.step }}>
                      <div className="font-bold" style={{ color: FEATURE_COLORS.step }}>
                        {Math.round(reportData.stepFlashing)} ft
                      </div>
                      <div className="text-xs text-muted-foreground">Step Flashing</div>
                    </div>
                    <div className="border rounded p-2 text-center" style={{ borderColor: FEATURE_COLORS.flashing }}>
                      <div className="font-bold" style={{ color: FEATURE_COLORS.flashing }}>
                        {Math.round(reportData.flashing)} ft
                      </div>
                      <div className="text-xs text-muted-foreground">Flashing</div>
                    </div>
                    <div className="border rounded p-2 text-center" style={{ borderColor: FEATURE_COLORS.parapet }}>
                      <div className="font-bold" style={{ color: FEATURE_COLORS.parapet }}>
                        {Math.round(reportData.parapets)} ft
                      </div>
                      <div className="text-xs text-muted-foreground">Parapets</div>
                    </div>
                  </div>

                  {/* Diagram placeholder with color legend */}
                  <div className="aspect-square bg-slate-100 dark:bg-slate-800 rounded-lg relative overflow-hidden">
                    <LengthDiagramSVG 
                      measurement={measurement}
                      tags={tags}
                      reportData={reportData}
                    />
                  </div>

                  {/* Legend */}
                  <div className="flex flex-wrap gap-3 mt-4 text-xs justify-center">
                    {Object.entries(FEATURE_COLORS).map(([type, color]) => (
                      <span key={type} className="flex items-center gap-1">
                        <span className="w-4 h-0.5" style={{ background: color }} />
                        {type.charAt(0).toUpperCase() + type.slice(1)}
                      </span>
                    ))}
                  </div>

                  <p className="text-xs text-muted-foreground mt-4">
                    Note: This diagram contains segment lengths (rounded to the nearest whole number) over 5.0 Feet.
                  </p>
                </ReportPage>
              )}

              {/* Page 5: Pitch Diagram */}
              {currentPage === 5 && (
                <ReportPage pageNumber={5} companyInfo={companyInfo} title="PITCH DIAGRAM">
                  <p className="text-sm text-muted-foreground mb-4">
                    Pitch values are shown in inches per foot, and arrows indicate slope direction. 
                    The predominant pitch on this roof is <strong>{reportData.pitch}</strong>.
                  </p>

                  {/* Pitch distribution */}
                  <div className="grid grid-cols-3 gap-3 mb-6">
                    {Object.entries(reportData.pitchDistribution).map(([pitch, data]) => (
                      <div key={pitch} className="border rounded p-3 text-center bg-blue-50 dark:bg-blue-950">
                        <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">{pitch}</div>
                        <div className="text-xs text-muted-foreground">
                          {data.count} facets • {Math.round(data.area)} sqft
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {((data.area / reportData.totalArea) * 100).toFixed(1)}% of roof
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Diagram */}
                  <div className="aspect-square bg-slate-100 dark:bg-slate-800 rounded-lg relative overflow-hidden">
                    <PitchDiagramSVG
                      measurement={measurement}
                      reportData={reportData}
                    />
                  </div>

                  <p className="text-xs text-muted-foreground mt-4">
                    Note: Blue shading indicates a pitch of 3/12 and greater.
                  </p>
                </ReportPage>
              )}

              {/* Page 6: Area Diagram */}
              {currentPage === 6 && (
                <ReportPage pageNumber={6} companyInfo={companyInfo} title="AREA DIAGRAM">
                  <div className="text-center mb-4">
                    <p className="text-lg">
                      Total Area = <strong>{Math.round(reportData.totalArea).toLocaleString()} sq ft</strong>, 
                      with <strong>{reportData.facetCount} facets</strong>.
                    </p>
                  </div>

                  {/* Diagram */}
                  <div className="aspect-square bg-slate-100 dark:bg-slate-800 rounded-lg relative overflow-hidden">
                    <AreaDiagramSVG
                      measurement={measurement}
                      reportData={reportData}
                    />
                  </div>

                  <p className="text-xs text-muted-foreground mt-4">
                    Note: This diagram shows the square feet of each roof facet (rounded to the nearest foot).
                  </p>
                </ReportPage>
              )}

              {/* Page 7: Notes Diagram */}
              {currentPage === 7 && (
                <ReportPage pageNumber={7} companyInfo={companyInfo} title="NOTES DIAGRAM">
                  <p className="text-sm text-muted-foreground mb-4">
                    Roof facets are labeled from smallest to largest (A to Z) for easy reference.
                  </p>

                  {/* Diagram */}
                  <div className="aspect-square bg-slate-100 dark:bg-slate-800 rounded-lg relative overflow-hidden">
                    <NotesDiagramSVG
                      measurement={measurement}
                      reportData={reportData}
                      getFacetLabel={getFacetLabel}
                    />
                  </div>

                  {/* Facet reference table */}
                  <div className="mt-4">
                    <h4 className="font-semibold mb-2 text-sm">Facet Reference</h4>
                    <div className="grid grid-cols-6 gap-1 text-xs">
                      {reportData.faces
                        .slice()
                        .sort((a: any, b: any) => (a.area_sqft || 0) - (b.area_sqft || 0))
                        .slice(0, 24)
                        .map((face: any, i: number) => (
                          <div key={i} className="border rounded p-1 text-center bg-muted/30">
                            <span className="font-bold">{getFacetLabel(i)}</span>
                            <span className="text-muted-foreground ml-1">
                              {Math.round(face.area_sqft || face.plan_area_sqft || 0)}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                </ReportPage>
              )}

              {/* Page 8: Report Summary */}
              {currentPage === 8 && (
                <ReportPage pageNumber={8} companyInfo={companyInfo} title="REPORT SUMMARY">
                  <div className="grid grid-cols-2 gap-6">
                    {/* Areas per Pitch */}
                    <div>
                      <h3 className="font-bold mb-3 text-sm border-b pb-1">Areas per Pitch</h3>
                      <table className="w-full text-xs border">
                        <thead className="bg-muted">
                          <tr>
                            <th className="py-1.5 px-2 text-left">Roof Pitches</th>
                            {Object.keys(reportData.pitchDistribution).map(pitch => (
                              <th key={pitch} className="py-1.5 px-2 text-center">{pitch}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-t">
                            <td className="py-1.5 px-2">Area (sq ft)</td>
                            {Object.values(reportData.pitchDistribution).map((data, i) => (
                              <td key={i} className="py-1.5 px-2 text-center">{Math.round(data.area)}</td>
                            ))}
                          </tr>
                          <tr className="border-t">
                            <td className="py-1.5 px-2">% of Roof</td>
                            {Object.values(reportData.pitchDistribution).map((data, i) => (
                              <td key={i} className="py-1.5 px-2 text-center">
                                {((data.area / reportData.totalArea) * 100).toFixed(1)}%
                              </td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {/* Waste Calculation Table */}
                    <div>
                      <h3 className="font-bold mb-3 text-sm border-b pb-1">Waste Calculation Table</h3>
                      <table className="w-full text-xs border">
                        <thead className="bg-muted">
                          <tr>
                            <th className="py-1.5 px-2 text-left">Waste %</th>
                            {reportData.wasteTable.map(row => (
                              <th key={row.waste} className="py-1.5 px-1 text-center">{row.waste}%</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-t">
                            <td className="py-1.5 px-2">Area (sq ft)</td>
                            {reportData.wasteTable.map(row => (
                              <td key={row.waste} className="py-1.5 px-1 text-center">{row.area.toLocaleString()}</td>
                            ))}
                          </tr>
                          <tr className="border-t">
                            <td className="py-1.5 px-2">Squares</td>
                            {reportData.wasteTable.map(row => (
                              <td key={row.waste} className="py-1.5 px-1 text-center">{row.squares}</td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Lengths, Areas, and Pitches */}
                  <div className="mt-6">
                    <h3 className="font-bold mb-3 text-sm border-b pb-1">Lengths, Areas and Pitches</h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="space-y-1">
                        <div className="flex justify-between">
                          <span>Ridges</span>
                          <span className="font-medium">{Math.round(reportData.ridges)} ft</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Hips</span>
                          <span className="font-medium">{Math.round(reportData.hips)} ft</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Valleys</span>
                          <span className="font-medium">{Math.round(reportData.valleys)} ft</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Rakes*</span>
                          <span className="font-medium">{Math.round(reportData.rakes)} ft</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Eaves/Starter**</span>
                          <span className="font-medium">{Math.round(reportData.eaves)} ft</span>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between">
                          <span>Drip Edge (Eaves + Rakes)</span>
                          <span className="font-medium">{Math.round(reportData.dripEdge)} ft</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Step Flashing</span>
                          <span className="font-medium">{Math.round(reportData.stepFlashing)} ft</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Flashing</span>
                          <span className="font-medium">{Math.round(reportData.flashing)} ft</span>
                        </div>
                        <div className="flex justify-between border-t pt-1 mt-2">
                          <span className="font-semibold">Total Area</span>
                          <span className="font-bold">{Math.round(reportData.totalArea).toLocaleString()} sq ft</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-semibold">Predominant Pitch</span>
                          <span className="font-bold">{reportData.pitch}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Online Maps */}
                  <div className="mt-6 p-3 bg-muted/30 rounded">
                    <h4 className="font-semibold text-sm mb-2">Online Maps</h4>
                    <div className="flex gap-4 text-xs">
                      <a 
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline flex items-center gap-1"
                      >
                        <ExternalLink className="h-3 w-3" /> View on Google Maps
                      </a>
                    </div>
                  </div>

                  <div className="mt-4 text-xs text-muted-foreground">
                    <p>* Rakes are defined as roof edges that are sloped (not level).</p>
                    <p>** Eaves are defined as roof edges that are not sloped and level.</p>
                  </div>
                </ReportPage>
              )}

            </div>
          </ScrollArea>
        </div>

        {/* Page Navigation Footer */}
        <div className="flex items-center justify-between p-4 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>
          <div className="flex gap-1">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
              <button
                key={page}
                onClick={() => setCurrentPage(page)}
                className={`w-8 h-8 rounded text-sm ${
                  currentPage === page
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                }`}
              >
                {page}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============ SVG DIAGRAM COMPONENTS ============

interface DiagramProps {
  measurement: any;
  reportData: any;
  tags?: any;
  getFacetLabel?: (index: number) => string;
}

// Length Diagram SVG
function LengthDiagramSVG({ measurement, reportData }: DiagramProps) {
  const width = 500;
  const height = 500;
  const centerX = width / 2;
  const centerY = height / 2;

  // Generate estimated roof shape for diagram
  const roofWidth = width * 0.7;
  const roofHeight = height * 0.5;

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} className="p-4">
      {/* Roof outline */}
      <polygon
        points={`
          ${centerX},${centerY - roofHeight/2}
          ${centerX + roofWidth/2},${centerY}
          ${centerX + roofWidth/2},${centerY + roofHeight/3}
          ${centerX - roofWidth/2},${centerY + roofHeight/3}
          ${centerX - roofWidth/2},${centerY}
        `}
        fill="hsl(210, 80%, 90%)"
        stroke="hsl(210, 80%, 50%)"
        strokeWidth={2}
      />

      {/* Ridge line (green) */}
      <line
        x1={centerX - roofWidth/3}
        y1={centerY - roofHeight/4}
        x2={centerX + roofWidth/3}
        y2={centerY - roofHeight/4}
        stroke={FEATURE_COLORS.ridge}
        strokeWidth={3}
      />
      <text x={centerX} y={centerY - roofHeight/4 - 10} textAnchor="middle" fontSize={12} fontWeight="bold" fill={FEATURE_COLORS.ridge}>
        {Math.round(reportData.ridges)}'
      </text>

      {/* Hip lines (blue) */}
      <line
        x1={centerX - roofWidth/3}
        y1={centerY - roofHeight/4}
        x2={centerX - roofWidth/2}
        y2={centerY}
        stroke={FEATURE_COLORS.hip}
        strokeWidth={3}
      />
      <line
        x1={centerX + roofWidth/3}
        y1={centerY - roofHeight/4}
        x2={centerX + roofWidth/2}
        y2={centerY}
        stroke={FEATURE_COLORS.hip}
        strokeWidth={3}
      />

      {/* Eave lines (cyan) */}
      <line
        x1={centerX - roofWidth/2}
        y1={centerY + roofHeight/3}
        x2={centerX + roofWidth/2}
        y2={centerY + roofHeight/3}
        stroke={FEATURE_COLORS.eave}
        strokeWidth={3}
      />
      <text x={centerX} y={centerY + roofHeight/3 + 20} textAnchor="middle" fontSize={12} fontWeight="bold" fill={FEATURE_COLORS.eave}>
        {Math.round(reportData.eaves)}'
      </text>

      {/* Compass */}
      <g transform={`translate(${width - 50}, 50)`}>
        <circle cx={0} cy={0} r={20} fill="white" stroke="currentColor" strokeWidth={1} />
        <polygon points="0,-15 3,0 -3,0" fill="red" />
        <text x={0} y={-6} textAnchor="middle" fontSize={8} fontWeight="bold" fill="red">N</text>
      </g>
    </svg>
  );
}

// Pitch Diagram SVG
function PitchDiagramSVG({ measurement, reportData }: DiagramProps) {
  const width = 500;
  const height = 500;
  const faces = measurement?.faces || [];
  const cols = Math.ceil(Math.sqrt(faces.length || 4));
  const cellSize = (width - 80) / cols;

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} className="p-4">
      {faces.length > 0 ? (
        faces.map((face: any, i: number) => {
          const row = Math.floor(i / cols);
          const col = i % cols;
          const x = 40 + col * cellSize;
          const y = 40 + row * cellSize;
          const pitch = face.pitch || reportData.pitch;
          const pitchNum = parseInt(pitch.split('/')[0]) || 6;

          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={cellSize - 4}
                height={cellSize - 4}
                fill={`hsl(210, 70%, ${90 - pitchNum * 3}%)`}
                stroke="hsl(210, 50%, 60%)"
                strokeWidth={1}
              />
              <text
                x={x + cellSize/2 - 2}
                y={y + cellSize/2}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={14}
                fontWeight="bold"
                fill="hsl(210, 70%, 30%)"
              >
                {pitchNum}
              </text>
              {/* Arrow indicating slope direction */}
              <path
                d={`M ${x + cellSize/2} ${y + cellSize - 15} L ${x + cellSize/2} ${y + cellSize - 25} L ${x + cellSize/2 - 5} ${y + cellSize - 20} M ${x + cellSize/2} ${y + cellSize - 25} L ${x + cellSize/2 + 5} ${y + cellSize - 20}`}
                stroke="hsl(210, 70%, 40%)"
                strokeWidth={1.5}
                fill="none"
              />
            </g>
          );
        })
      ) : (
        <text x={width/2} y={height/2} textAnchor="middle" fontSize={16} fill="currentColor">
          {reportData.pitch}
        </text>
      )}

      {/* Compass */}
      <g transform={`translate(${width - 50}, 50)`}>
        <circle cx={0} cy={0} r={20} fill="white" stroke="currentColor" strokeWidth={1} />
        <polygon points="0,-15 3,0 -3,0" fill="red" />
        <text x={0} y={-6} textAnchor="middle" fontSize={8} fontWeight="bold" fill="red">N</text>
      </g>
    </svg>
  );
}

// Area Diagram SVG
function AreaDiagramSVG({ measurement, reportData }: DiagramProps) {
  const width = 500;
  const height = 500;
  const faces = measurement?.faces || [];
  const cols = Math.ceil(Math.sqrt(faces.length || 4));
  const cellSize = (width - 80) / cols;

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} className="p-4">
      {faces.length > 0 ? (
        faces.map((face: any, i: number) => {
          const row = Math.floor(i / cols);
          const col = i % cols;
          const x = 40 + col * cellSize;
          const y = 40 + row * cellSize;
          const area = Math.round(face.area_sqft || face.plan_area_sqft || 0);
          const color = FACET_COLORS[i % FACET_COLORS.length];

          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={cellSize - 4}
                height={cellSize - 4}
                fill={color}
                fillOpacity={0.3}
                stroke={color}
                strokeWidth={2}
              />
              <text
                x={x + cellSize/2 - 2}
                y={y + cellSize/2}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={area > 999 ? 10 : 12}
                fontWeight="bold"
                fill="currentColor"
              >
                {area}
              </text>
            </g>
          );
        })
      ) : (
        <text x={width/2} y={height/2} textAnchor="middle" fontSize={24} fontWeight="bold" fill="currentColor">
          {Math.round(reportData.totalArea).toLocaleString()} sqft
        </text>
      )}

      {/* Compass */}
      <g transform={`translate(${width - 50}, 50)`}>
        <circle cx={0} cy={0} r={20} fill="white" stroke="currentColor" strokeWidth={1} />
        <polygon points="0,-15 3,0 -3,0" fill="red" />
        <text x={0} y={-6} textAnchor="middle" fontSize={8} fontWeight="bold" fill="red">N</text>
      </g>
    </svg>
  );
}

// Notes Diagram SVG
function NotesDiagramSVG({ measurement, reportData, getFacetLabel }: DiagramProps) {
  const width = 500;
  const height = 500;
  const faces = measurement?.faces || [];
  
  // Sort faces by area (smallest to largest for labeling)
  const sortedFaces = [...faces].sort((a: any, b: any) => 
    (a.area_sqft || a.plan_area_sqft || 0) - (b.area_sqft || b.plan_area_sqft || 0)
  );
  
  const cols = Math.ceil(Math.sqrt(sortedFaces.length || 4));
  const cellSize = (width - 80) / cols;

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} className="p-4">
      {sortedFaces.length > 0 ? (
        sortedFaces.map((face: any, i: number) => {
          const row = Math.floor(i / cols);
          const col = i % cols;
          const x = 40 + col * cellSize;
          const y = 40 + row * cellSize;
          const label = getFacetLabel?.(i) || String(i + 1);
          const color = FACET_COLORS[i % FACET_COLORS.length];

          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={cellSize - 4}
                height={cellSize - 4}
                fill={color}
                fillOpacity={0.2}
                stroke={color}
                strokeWidth={2}
              />
              <text
                x={x + cellSize/2 - 2}
                y={y + cellSize/2}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={16}
                fontWeight="bold"
                fill="currentColor"
              >
                {label}
              </text>
            </g>
          );
        })
      ) : (
        Array.from({ length: 9 }).map((_, i) => {
          const row = Math.floor(i / 3);
          const col = i % 3;
          const x = 100 + col * 100;
          const y = 100 + row * 100;
          const label = getFacetLabel?.(i) || String.fromCharCode(65 + i);

          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={80}
                height={80}
                fill={FACET_COLORS[i % FACET_COLORS.length]}
                fillOpacity={0.2}
                stroke={FACET_COLORS[i % FACET_COLORS.length]}
                strokeWidth={2}
              />
              <text
                x={x + 40}
                y={y + 45}
                textAnchor="middle"
                fontSize={18}
                fontWeight="bold"
                fill="currentColor"
              >
                {label}
              </text>
            </g>
          );
        })
      )}

      {/* Compass */}
      <g transform={`translate(${width - 50}, 50)`}>
        <circle cx={0} cy={0} r={20} fill="white" stroke="currentColor" strokeWidth={1} />
        <polygon points="0,-15 3,0 -3,0" fill="red" />
        <text x={0} y={-6} textAnchor="middle" fontSize={8} fontWeight="bold" fill="red">N</text>
      </g>
    </svg>
  );
}

// Feature colors export for use elsewhere
export { FEATURE_COLORS };
