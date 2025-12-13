import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Download, Printer, Share2, ChevronLeft, ChevronRight, Loader2, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { ReportPage } from './ReportPage';
import { RoofDiagramRenderer } from './RoofDiagramRenderer';

interface RoofrStyleReportPreviewProps {
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
}

// Waste percentage options for report
const WASTE_PERCENTAGES = [0, 10, 12, 15, 17, 20, 22];

export function RoofrStyleReportPreview({
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
}: RoofrStyleReportPreviewProps) {
  const { toast } = useToast();
  const [currentPage, setCurrentPage] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  
  const totalPages = 7;
  
  // Debug: Log what data we're receiving
  console.log('📊 RoofrStyleReportPreview data:', { measurement, tags, satelliteImageUrl });
  
  // Extract measurement data - check multiple sources
  const totalArea = measurement?.summary?.total_area_sqft || 
                    tags?.['roof.total_area'] || 
                    tags?.['roof.plan_area'] || 
                    measurement?.total_area_sqft || 0;
  const totalSquares = (totalArea / 100).toFixed(1);
  const pitch = measurement?.summary?.pitch || 
                measurement?.predominant_pitch || 
                tags?.['roof.pitch'] || '6/12';
  const facetCount = measurement?.faces?.length || 
                     tags?.['roof.faces_count'] || 
                     measurement?.facetCount || 1;
  
  // Linear features - check summary, tags, and direct measurement properties
  const eaves = measurement?.summary?.eave_ft || 
                tags?.['lf.eave'] || 
                measurement?.linear_features?.eave || 0;
  const rakes = measurement?.summary?.rake_ft || 
                tags?.['lf.rake'] || 
                measurement?.linear_features?.rake || 0;
  const ridges = measurement?.summary?.ridge_ft || 
                 tags?.['lf.ridge'] || 
                 measurement?.linear_features?.ridge || 0;
  const hips = measurement?.summary?.hip_ft || 
               tags?.['lf.hip'] || 
               measurement?.linear_features?.hip || 0;
  const valleys = measurement?.summary?.valley_ft || 
                  tags?.['lf.valley'] || 
                  measurement?.linear_features?.valley || 0;
  const stepFlashing = tags?.['lf.step'] || measurement?.linear_features?.step || 0;
  
  // Materials - calculate from actual measurements if tags missing
  const materials = {
    shingleBundles: tags?.['materials.shingle_bundles'] || Math.ceil((totalArea * 1.1) / 33.3),
    starterBundles: tags?.['materials.starter_bundles'] || Math.ceil((eaves + rakes) / 120),
    iceWaterRolls: tags?.['materials.ice_water_rolls'] || Math.ceil(valleys / 66) || 0,
    underlaymentRolls: tags?.['materials.underlayment_rolls'] || Math.ceil(totalArea / 400),
    hipRidgeBundles: tags?.['materials.ridge_cap_bundles'] || Math.ceil((ridges + hips) / 35),
    valleySheets: Math.ceil(valleys / 10) || 0,
    dripEdgeSheets: tags?.['materials.drip_edge_sheets'] || Math.ceil((eaves + rakes) / 10),
  };

  // Calculate waste table values
  const wasteTableData = WASTE_PERCENTAGES.map(waste => {
    const adjustedArea = totalArea * (1 + waste / 100);
    return {
      waste,
      area: adjustedArea.toFixed(0),
      squares: (adjustedArea / 100).toFixed(2),
    };
  });

  const handleGeneratePDF = async () => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-roofr-style-report', {
        body: {
          measurementId,
          measurement,
          tags,
          address,
          companyInfo: companyInfo || { name: 'PITCH CRM' },
        }
      });

      if (error) throw error;

      if (data?.pdfUrl) {
        setReportUrl(data.pdfUrl);
        onReportGenerated?.(data.pdfUrl);
        toast({
          title: "Report Generated",
          description: "Professional measurement report is ready for download.",
        });
      }
    } catch (err: any) {
      console.error('Failed to generate report:', err);
      toast({
        title: "Generation Failed",
        description: err.message || "Could not generate report",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = () => {
    if (reportUrl) {
      window.open(reportUrl, '_blank');
    } else {
      handleGeneratePDF();
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const formatFeetInches = (feet: number) => {
    if (!feet || feet === 0) return '0 ft';
    const wholeFeet = Math.floor(feet);
    const inches = Math.round((feet - wholeFeet) * 12);
    if (inches === 0) return `${wholeFeet} ft`;
    return `${wholeFeet}' ${inches}"`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] p-0 overflow-hidden">
        <DialogHeader className="p-4 border-b flex-row items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-primary" />
            <DialogTitle>Professional Measurement Report</DialogTitle>
            <Badge variant="outline" className="ml-2">
              Page {currentPage} of {totalPages}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-1" />
              Print
            </Button>
            <Button variant="outline" size="sm" disabled>
              <Share2 className="h-4 w-4 mr-1" />
              Share
            </Button>
            <Button size="sm" onClick={handleDownload} disabled={isGenerating}>
              {isGenerating ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-1" />
              )}
              Download PDF
            </Button>
          </div>
        </DialogHeader>

        <div className="flex flex-1 min-h-0">
          {/* Page Navigation */}
          <div className="w-32 border-r bg-muted/30 p-2">
            <ScrollArea className="h-full">
              <div className="space-y-1">
                {[
                  { num: 1, label: 'Cover' },
                  { num: 2, label: 'Diagram' },
                  { num: 3, label: 'Lengths' },
                  { num: 4, label: 'Areas' },
                  { num: 5, label: 'Pitch' },
                  { num: 6, label: 'Summary' },
                  { num: 7, label: 'Materials' },
                ].map(({ num, label }) => (
                  <button
                    key={num}
                    onClick={() => setCurrentPage(num)}
                    className={`w-full text-left px-2 py-1.5 rounded text-sm ${
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
            <div className="p-6" id="roofr-report-content">
              {/* Page 1: Cover */}
              {currentPage === 1 && (
                <ReportPage 
                  pageNumber={1}
                  companyInfo={companyInfo}
                >
                  <div className="text-center mb-8">
                    <h1 className="text-4xl font-bold text-primary mb-2">Roof Report</h1>
                    <p className="text-muted-foreground">AI-Powered Measurement</p>
                  </div>
                  
                  <div className="bg-muted/30 rounded-lg p-4 mb-6">
                    <p className="text-lg font-medium">{address}</p>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-6">
                    <div className="bg-primary/10 rounded-lg p-4 text-center">
                      <div className="text-3xl font-bold text-primary">{Math.round(totalArea).toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">Total Sq Ft</div>
                    </div>
                    <div className="bg-primary/10 rounded-lg p-4 text-center">
                      <div className="text-3xl font-bold text-primary">{facetCount}</div>
                      <div className="text-xs text-muted-foreground">Facets</div>
                    </div>
                    <div className="bg-primary/10 rounded-lg p-4 text-center">
                      <div className="text-3xl font-bold text-primary">{pitch}</div>
                      <div className="text-xs text-muted-foreground">Predominant Pitch</div>
                    </div>
                  </div>

                  {/* Satellite Image with Roof Overlay */}
                  <div className="aspect-video bg-muted rounded-lg overflow-hidden mb-4">
                    {satelliteImageUrl ? (
                      <div className="relative w-full h-full">
                        <img 
                          src={satelliteImageUrl} 
                          alt="Satellite view of property" 
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <RoofDiagramRenderer 
                            measurement={measurement}
                            tags={tags || {}}
                            width={500}
                            height={300}
                            showSatellite={true}
                            satelliteImageUrl={satelliteImageUrl}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-slate-200 dark:bg-slate-700">
                        <p className="text-muted-foreground text-sm">Satellite image loading...</p>
                      </div>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground text-center">
                    Report generated on {new Date().toLocaleDateString()} • Imagery source: Mapbox Satellite
                  </p>
                </ReportPage>
              )}

              {/* Page 2: Clean Diagram */}
              {currentPage === 2 && (
                <ReportPage pageNumber={2} companyInfo={companyInfo} title="Roof Diagram">
                  <div className="aspect-square bg-white rounded-lg border flex items-center justify-center">
                    <RoofDiagramRenderer 
                      measurement={measurement}
                      tags={tags}
                      width={500}
                      height={500}
                      showSatellite={false}
                      showLabels={false}
                    />
                  </div>
                  <div className="flex justify-end mt-4">
                    <div className="text-xs text-muted-foreground">
                      ↑ N
                    </div>
                  </div>
                </ReportPage>
              )}

              {/* Page 3: Length Measurement Report */}
              {currentPage === 3 && (
                <ReportPage pageNumber={3} companyInfo={companyInfo} title="Length Measurement Report">
                  <div className="grid grid-cols-4 gap-3 mb-6">
                    <div className="bg-cyan-50 dark:bg-cyan-950 border border-cyan-200 dark:border-cyan-800 rounded p-3 text-center">
                      <div className="text-xl font-bold text-cyan-700 dark:text-cyan-300">{formatFeetInches(eaves)}</div>
                      <div className="text-xs text-cyan-600 dark:text-cyan-400">Eaves</div>
                    </div>
                    <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded p-3 text-center">
                      <div className="text-xl font-bold text-red-700 dark:text-red-300">{formatFeetInches(valleys)}</div>
                      <div className="text-xs text-red-600 dark:text-red-400">Valleys</div>
                    </div>
                    <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded p-3 text-center">
                      <div className="text-xl font-bold text-blue-700 dark:text-blue-300">{formatFeetInches(hips)}</div>
                      <div className="text-xs text-blue-600 dark:text-blue-400">Hips</div>
                    </div>
                    <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded p-3 text-center">
                      <div className="text-xl font-bold text-green-700 dark:text-green-300">{formatFeetInches(ridges)}</div>
                      <div className="text-xs text-green-600 dark:text-green-400">Ridges</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-6">
                    <div className="bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-800 rounded p-3 text-center">
                      <div className="text-xl font-bold text-purple-700 dark:text-purple-300">{formatFeetInches(rakes)}</div>
                      <div className="text-xs text-purple-600 dark:text-purple-400">Rakes</div>
                    </div>
                    <div className="bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800 rounded p-3 text-center">
                      <div className="text-xl font-bold text-orange-700 dark:text-orange-300">{formatFeetInches(stepFlashing)}</div>
                      <div className="text-xs text-orange-600 dark:text-orange-400">Step Flashing</div>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded p-3 text-center">
                      <div className="text-xl font-bold text-gray-700 dark:text-gray-300">0ft 0in</div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">Wall Flashing</div>
                    </div>
                  </div>

                  <div className="aspect-video bg-white rounded-lg border flex items-center justify-center">
                    <RoofDiagramRenderer 
                      measurement={measurement}
                      tags={tags}
                      width={550}
                      height={350}
                      showSatellite={false}
                      showLengthLabels={true}
                    />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2 text-xs">
                    <Badge className="bg-cyan-500">Eaves</Badge>
                    <Badge className="bg-red-500">Valleys</Badge>
                    <Badge className="bg-blue-500">Hips</Badge>
                    <Badge className="bg-green-500">Ridges</Badge>
                    <Badge className="bg-purple-500">Rakes</Badge>
                    <Badge className="bg-orange-500">Step Flashing</Badge>
                  </div>
                </ReportPage>
              )}

              {/* Page 4: Area Measurement Report */}
              {currentPage === 4 && (
                <ReportPage pageNumber={4} companyInfo={companyInfo} title="Area Measurement Report">
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="bg-primary/10 rounded-lg p-4">
                      <div className="text-sm text-muted-foreground">Total Roof Area</div>
                      <div className="text-3xl font-bold">{Math.round(totalArea).toLocaleString()} sqft</div>
                    </div>
                    <div className="bg-primary/10 rounded-lg p-4">
                      <div className="text-sm text-muted-foreground">Predominant Pitch</div>
                      <div className="text-3xl font-bold">{pitch}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-6">
                    <div className="border rounded p-3 text-center">
                      <div className="text-xl font-bold">{Math.round(totalArea).toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">Pitched Roof Area (sqft)</div>
                    </div>
                    <div className="border rounded p-3 text-center">
                      <div className="text-xl font-bold">0</div>
                      <div className="text-xs text-muted-foreground">Flat Roof Area (sqft)</div>
                    </div>
                    <div className="border rounded p-3 text-center">
                      <div className="text-xl font-bold">0</div>
                      <div className="text-xs text-muted-foreground">Two Story Area (sqft)</div>
                    </div>
                  </div>

                  <div className="aspect-video bg-white rounded-lg border flex items-center justify-center">
                    <RoofDiagramRenderer 
                      measurement={measurement}
                      tags={tags}
                      width={550}
                      height={350}
                      showSatellite={false}
                      showAreaLabels={true}
                    />
                  </div>
                </ReportPage>
              )}

              {/* Page 5: Pitch & Direction */}
              {currentPage === 5 && (
                <ReportPage pageNumber={5} companyInfo={companyInfo} title="Pitch & Direction Report">
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="border rounded-lg p-4">
                      <div className="text-sm text-muted-foreground mb-2">Pitch Distribution</div>
                      <div className="space-y-2">
                        {(measurement?.faces || []).reduce((acc: any[], face: any) => {
                          const pitch = face.pitch || '6/12';
                          const existing = acc.find(p => p.pitch === pitch);
                          if (existing) {
                            existing.count++;
                            existing.area += face.area_sqft || face.plan_area_sqft || 0;
                          } else {
                            acc.push({ pitch, count: 1, area: face.area_sqft || face.plan_area_sqft || 0 });
                          }
                          return acc;
                        }, []).map((p: any, i: number) => (
                          <div key={i} className="flex justify-between items-center">
                            <span className="font-medium">{p.pitch}</span>
                            <span className="text-muted-foreground">{p.count} facets ({Math.round(p.area)} sqft)</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="border rounded-lg p-4">
                      <div className="text-sm text-muted-foreground mb-2">Predominant Direction</div>
                      <div className="text-2xl font-bold">South-Facing</div>
                      <p className="text-xs text-muted-foreground mt-2">
                        Based on largest facet orientation
                      </p>
                    </div>
                  </div>

                  <div className="aspect-video bg-white rounded-lg border flex items-center justify-center">
                    <RoofDiagramRenderer 
                      measurement={measurement}
                      tags={tags}
                      width={550}
                      height={350}
                      showSatellite={false}
                      showPitchLabels={true}
                    />
                  </div>
                </ReportPage>
              )}

              {/* Page 6: Report Summary */}
              {currentPage === 6 && (
                <ReportPage pageNumber={6} companyInfo={companyInfo} title="Report Summary">
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <h3 className="font-semibold mb-3 text-lg">Measurements Summary</h3>
                      <table className="w-full text-sm">
                        <tbody>
                          <tr className="border-b"><td className="py-2">Total Roof Area</td><td className="py-2 font-bold text-right">{Math.round(totalArea).toLocaleString()} sqft</td></tr>
                          <tr className="border-b"><td className="py-2">Predominant Pitch</td><td className="py-2 font-bold text-right">{pitch}</td></tr>
                          <tr className="border-b"><td className="py-2">Facet Count</td><td className="py-2 font-bold text-right">{facetCount}</td></tr>
                          <tr className="border-b"><td className="py-2">Eaves</td><td className="py-2 text-right">{formatFeetInches(eaves)}</td></tr>
                          <tr className="border-b"><td className="py-2">Rakes</td><td className="py-2 text-right">{formatFeetInches(rakes)}</td></tr>
                          <tr className="border-b"><td className="py-2">Ridges</td><td className="py-2 text-right">{formatFeetInches(ridges)}</td></tr>
                          <tr className="border-b"><td className="py-2">Hips</td><td className="py-2 text-right">{formatFeetInches(hips)}</td></tr>
                          <tr className="border-b"><td className="py-2">Valleys</td><td className="py-2 text-right">{formatFeetInches(valleys)}</td></tr>
                        </tbody>
                      </table>
                    </div>
                    
                    <div>
                      <h3 className="font-semibold mb-3 text-lg">Waste Factor Table</h3>
                      <table className="w-full text-sm border">
                        <thead className="bg-muted">
                          <tr>
                            <th className="py-2 px-3 text-left">Waste %</th>
                            <th className="py-2 px-3 text-right">Area (sqft)</th>
                            <th className="py-2 px-3 text-right">Squares</th>
                          </tr>
                        </thead>
                        <tbody>
                          {wasteTableData.map(row => (
                            <tr key={row.waste} className={`border-t ${row.waste === 10 ? 'bg-primary/10 font-medium' : ''}`}>
                              <td className="py-1.5 px-3">{row.waste}%</td>
                              <td className="py-1.5 px-3 text-right">{row.area}</td>
                              <td className="py-1.5 px-3 text-right">{row.squares}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="text-xs text-muted-foreground mt-2">
                        * Recommended waste factor: 10-15% for standard roofs
                      </p>
                    </div>
                  </div>
                </ReportPage>
              )}

              {/* Page 7: Material Calculations */}
              {currentPage === 7 && (
                <ReportPage pageNumber={7} companyInfo={companyInfo} title="Material Calculations">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border">
                      <thead className="bg-muted">
                        <tr>
                          <th className="py-2 px-3 text-left">Product</th>
                          <th className="py-2 px-3 text-center">Unit</th>
                          <th className="py-2 px-3 text-right">0%</th>
                          <th className="py-2 px-3 text-right">10%</th>
                          <th className="py-2 px-3 text-right">12%</th>
                          <th className="py-2 px-3 text-right">15%</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-t bg-primary/5">
                          <td className="py-2 px-3 font-medium" colSpan={6}>Shingles</td>
                        </tr>
                        {['IKO Cambridge', 'CertainTeed Landmark', 'GAF Timberline HDZ', 'Owens Corning Duration', 'Atlas Pristine'].map(brand => (
                          <tr key={brand} className="border-t">
                            <td className="py-1.5 px-3 pl-6">{brand}</td>
                            <td className="py-1.5 px-3 text-center">bundle</td>
                            <td className="py-1.5 px-3 text-right">{Math.ceil(totalArea / 33.3)}</td>
                            <td className="py-1.5 px-3 text-right">{Math.ceil((totalArea * 1.1) / 33.3)}</td>
                            <td className="py-1.5 px-3 text-right">{Math.ceil((totalArea * 1.12) / 33.3)}</td>
                            <td className="py-1.5 px-3 text-right">{Math.ceil((totalArea * 1.15) / 33.3)}</td>
                          </tr>
                        ))}
                        <tr className="border-t bg-primary/5">
                          <td className="py-2 px-3 font-medium" colSpan={6}>Starter Strip</td>
                        </tr>
                        <tr className="border-t">
                          <td className="py-1.5 px-3 pl-6">IKO Leading Edge</td>
                          <td className="py-1.5 px-3 text-center">bundle</td>
                          <td className="py-1.5 px-3 text-right">{materials.starterBundles}</td>
                          <td className="py-1.5 px-3 text-right">{materials.starterBundles}</td>
                          <td className="py-1.5 px-3 text-right">{materials.starterBundles}</td>
                          <td className="py-1.5 px-3 text-right">{materials.starterBundles}</td>
                        </tr>
                        <tr className="border-t bg-primary/5">
                          <td className="py-2 px-3 font-medium" colSpan={6}>Ice & Water Shield</td>
                        </tr>
                        <tr className="border-t">
                          <td className="py-1.5 px-3 pl-6">IKO GoldShield</td>
                          <td className="py-1.5 px-3 text-center">roll</td>
                          <td className="py-1.5 px-3 text-right">{materials.iceWaterRolls}</td>
                          <td className="py-1.5 px-3 text-right">{materials.iceWaterRolls}</td>
                          <td className="py-1.5 px-3 text-right">{materials.iceWaterRolls}</td>
                          <td className="py-1.5 px-3 text-right">{materials.iceWaterRolls}</td>
                        </tr>
                        <tr className="border-t bg-primary/5">
                          <td className="py-2 px-3 font-medium" colSpan={6}>Hip & Ridge Cap</td>
                        </tr>
                        <tr className="border-t">
                          <td className="py-1.5 px-3 pl-6">IKO Ultra HP</td>
                          <td className="py-1.5 px-3 text-center">bundle</td>
                          <td className="py-1.5 px-3 text-right">{materials.hipRidgeBundles}</td>
                          <td className="py-1.5 px-3 text-right">{materials.hipRidgeBundles}</td>
                          <td className="py-1.5 px-3 text-right">{materials.hipRidgeBundles}</td>
                          <td className="py-1.5 px-3 text-right">{materials.hipRidgeBundles}</td>
                        </tr>
                        <tr className="border-t bg-primary/5">
                          <td className="py-2 px-3 font-medium" colSpan={6}>Underlayment</td>
                        </tr>
                        <tr className="border-t">
                          <td className="py-1.5 px-3 pl-6">IKO RoofGard-SA</td>
                          <td className="py-1.5 px-3 text-center">roll</td>
                          <td className="py-1.5 px-3 text-right">{materials.underlaymentRolls}</td>
                          <td className="py-1.5 px-3 text-right">{Math.ceil(materials.underlaymentRolls * 1.1)}</td>
                          <td className="py-1.5 px-3 text-right">{Math.ceil(materials.underlaymentRolls * 1.12)}</td>
                          <td className="py-1.5 px-3 text-right">{Math.ceil(materials.underlaymentRolls * 1.15)}</td>
                        </tr>
                        <tr className="border-t bg-primary/5">
                          <td className="py-2 px-3 font-medium" colSpan={6}>Drip Edge</td>
                        </tr>
                        <tr className="border-t">
                          <td className="py-1.5 px-3 pl-6">Aluminum Drip Edge</td>
                          <td className="py-1.5 px-3 text-center">10ft pc</td>
                          <td className="py-1.5 px-3 text-right">{materials.dripEdgeSheets}</td>
                          <td className="py-1.5 px-3 text-right">{materials.dripEdgeSheets}</td>
                          <td className="py-1.5 px-3 text-right">{materials.dripEdgeSheets}</td>
                          <td className="py-1.5 px-3 text-right">{materials.dripEdgeSheets}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  
                  <div className="mt-6 p-4 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg">
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                      <strong>Disclaimer:</strong> Material quantities are estimates based on measurements. 
                      Always verify requirements before ordering. Local building codes may require additional materials.
                    </p>
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
