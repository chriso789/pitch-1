import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Download, Printer, Mail, Share2, Loader2 } from 'lucide-react';
import { usePDFGeneration } from '@/hooks/usePDFGeneration';
import { calculateMaterialQuantities, formatMaterialList } from '@/utils/materialCalculations';
import { format } from 'date-fns';
import { toast } from 'sonner';

interface Facet {
  id: string;
  label: string;
  area: number;
  perimeter: number;
  pitch?: string;
  direction?: string;
  ridgeLength?: number;
  hipLength?: number;
  valleyLength?: number;
}

interface ProfessionalMeasurementReportProps {
  propertyAddress: string;
  customerName?: string;
  facets: Facet[];
  totalArea: number;
  satelliteImageUrl?: string;
  overlayImageUrl?: string;
  wastePercentage?: number;
  measuredBy?: string;
  notes?: string;
  companyName?: string;
  companyLogo?: string;
  showMaterials?: boolean;
}

export function ProfessionalMeasurementReport({
  propertyAddress,
  customerName,
  facets,
  totalArea,
  satelliteImageUrl,
  overlayImageUrl,
  wastePercentage = 10,
  measuredBy = 'System',
  notes,
  companyName = 'Your Roofing Company',
  companyLogo,
  showMaterials = true,
}: ProfessionalMeasurementReportProps) {
  const { downloadPDF, printPDF, isGenerating, progress } = usePDFGeneration();
  const [showPreview, setShowPreview] = useState(true);

  const reportId = `RPT-${format(new Date(), 'yyyyMMdd-HHmmss')}`;
  const measurementDate = format(new Date(), 'MMMM dd, yyyy');

  // Calculate totals
  const totalPerimeter = facets.reduce((sum, f) => sum + f.perimeter, 0);
  const totalRidge = facets.reduce((sum, f) => sum + (f.ridgeLength || 0), 0);
  const totalHip = facets.reduce((sum, f) => sum + (f.hipLength || 0), 0);
  const totalValley = facets.reduce((sum, f) => sum + (f.valleyLength || 0), 0);

  // Calculate with waste
  const adjustedArea = totalArea * (1 + wastePercentage / 100);
  const squares = adjustedArea / 100;

  // Calculate materials
  const materials = calculateMaterialQuantities({
    totalArea,
    perimeter: totalPerimeter,
    ridgeLength: totalRidge,
    hipLength: totalHip,
    valleyLength: totalValley,
    eaveLength: totalPerimeter * 0.5,
    rakeLength: totalPerimeter * 0.5,
    wastePercentage,
  });

  const materialList = formatMaterialList(materials);

  const handleDownload = async () => {
    await downloadPDF('measurement-report', {
      filename: `measurement-report-${reportId}.pdf`,
      orientation: 'portrait',
      format: 'letter',
    });
  };

  const handlePrint = async () => {
    await printPDF('measurement-report', {
      orientation: 'portrait',
      format: 'letter',
    });
  };

  const handleEmail = () => {
    toast.info('Email functionality coming soon');
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Roof Measurement Report - ${propertyAddress}`,
          text: `Professional roof measurement report for ${propertyAddress}`,
        });
      } catch (error) {
        console.error('Share failed:', error);
      }
    } else {
      toast.info('Share functionality not supported in this browser');
    }
  };

  return (
    <div className="space-y-4">
      {/* Action Buttons */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold">Measurement Report</h3>
            <Badge variant="outline">{reportId}</Badge>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={handleDownload}
              disabled={isGenerating}
              size="sm"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {progress}%
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  Download PDF
                </>
              )}
            </Button>

            <Button
              variant="outline"
              onClick={handlePrint}
              disabled={isGenerating}
              size="sm"
            >
              <Printer className="w-4 h-4 mr-2" />
              Print
            </Button>

            <Button
              variant="outline"
              onClick={handleEmail}
              disabled={isGenerating}
              size="sm"
            >
              <Mail className="w-4 h-4 mr-2" />
              Email
            </Button>

            <Button
              variant="outline"
              onClick={handleShare}
              disabled={isGenerating}
              size="sm"
            >
              <Share2 className="w-4 h-4 mr-2" />
              Share
            </Button>
          </div>
        </div>
      </Card>

      {/* Report Preview */}
      {showPreview && (
        <Card className="overflow-hidden">
          <div
            id="measurement-report"
            className="bg-white text-gray-900 p-8 max-w-[8.5in] mx-auto"
            style={{ minHeight: '11in' }}
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-8 pb-6 border-b-2 border-gray-300">
              <div>
                {companyLogo ? (
                  <img src={companyLogo} alt={companyName} className="h-12 mb-2" />
                ) : (
                  <h1 className="text-2xl font-bold text-gray-900">{companyName}</h1>
                )}
                <p className="text-sm text-gray-600 mt-1">Professional Roof Measurement Report</p>
              </div>
              <div className="text-right">
                <div className="text-sm text-gray-600">Report ID</div>
                <div className="font-mono text-sm font-semibold">{reportId}</div>
                <div className="text-sm text-gray-600 mt-2">{measurementDate}</div>
              </div>
            </div>

            {/* Property Information */}
            <div className="mb-8">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Property Information</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-gray-600">Address</div>
                  <div className="font-semibold">{propertyAddress}</div>
                </div>
                {customerName && (
                  <div>
                    <div className="text-sm text-gray-600">Customer</div>
                    <div className="font-semibold">{customerName}</div>
                  </div>
                )}
                <div>
                  <div className="text-sm text-gray-600">Measured By</div>
                  <div className="font-semibold">{measuredBy}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Measurement Date</div>
                  <div className="font-semibold">{measurementDate}</div>
                </div>
              </div>
            </div>

            {/* Aerial Photo with Overlays */}
            {(satelliteImageUrl || overlayImageUrl) && (
              <div className="mb-8">
                <h2 className="text-xl font-bold text-gray-900 mb-4">Aerial View</h2>
                <div className="relative rounded-lg overflow-hidden border border-gray-300">
                  <img
                    src={overlayImageUrl || satelliteImageUrl}
                    alt="Property aerial view"
                    className="w-full h-auto"
                  />
                  <div className="absolute top-2 right-2 bg-white/90 px-3 py-1 rounded text-xs font-semibold">
                    Scale: 1px ≈ 0.3ft
                  </div>
                </div>
              </div>
            )}

            {/* Measurement Summary Table */}
            <div className="mb-8">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Measurement Summary</h2>
              <div className="border border-gray-300 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="text-left p-3 font-semibold">Facet</th>
                      <th className="text-right p-3 font-semibold">Area (sq ft)</th>
                      <th className="text-right p-3 font-semibold">Perimeter (ft)</th>
                      <th className="text-center p-3 font-semibold">Pitch</th>
                      <th className="text-center p-3 font-semibold">Direction</th>
                    </tr>
                  </thead>
                  <tbody>
                    {facets.map((facet, index) => (
                      <tr key={facet.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="p-3">{facet.label}</td>
                        <td className="text-right p-3">{facet.area.toFixed(0)}</td>
                        <td className="text-right p-3">{facet.perimeter.toFixed(0)}</td>
                        <td className="text-center p-3">{facet.pitch || 'N/A'}</td>
                        <td className="text-center p-3">{facet.direction || 'N/A'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Totals Section */}
            <div className="mb-8">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Totals</h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                  <div className="text-sm text-gray-600">Total Roof Area</div>
                  <div className="text-2xl font-bold text-blue-600">{totalArea.toFixed(0)} sq ft</div>
                </div>
                <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                  <div className="text-sm text-gray-600">Adjusted Area ({wastePercentage}% waste)</div>
                  <div className="text-2xl font-bold text-green-600">{adjustedArea.toFixed(0)} sq ft</div>
                </div>
                <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
                  <div className="text-sm text-gray-600">Total Squares</div>
                  <div className="text-2xl font-bold text-purple-600">{squares.toFixed(2)}</div>
                </div>
                <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
                  <div className="text-sm text-gray-600">Total Perimeter</div>
                  <div className="text-2xl font-bold text-orange-600">{totalPerimeter.toFixed(0)} ft</div>
                </div>
              </div>

              {(totalRidge > 0 || totalHip > 0 || totalValley > 0) && (
                <div className="grid grid-cols-3 gap-4 mt-4">
                  {totalRidge > 0 && (
                    <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                      <div className="text-xs text-gray-600">Total Ridge</div>
                      <div className="text-lg font-bold">{totalRidge.toFixed(0)} ft</div>
                    </div>
                  )}
                  {totalHip > 0 && (
                    <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                      <div className="text-xs text-gray-600">Total Hip</div>
                      <div className="text-lg font-bold">{totalHip.toFixed(0)} ft</div>
                    </div>
                  )}
                  {totalValley > 0 && (
                    <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                      <div className="text-xs text-gray-600">Total Valley</div>
                      <div className="text-lg font-bold">{totalValley.toFixed(0)} ft</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Material Calculations */}
            {showMaterials && (
              <div className="mb-8">
                <h2 className="text-xl font-bold text-gray-900 mb-4">Material Calculations</h2>
                <div className="border border-gray-300 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="text-left p-3 font-semibold">Material</th>
                        <th className="text-right p-3 font-semibold">Quantity</th>
                        <th className="text-right p-3 font-semibold">Unit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {materialList.map((item, index) => (
                        <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="p-3">{item.item}</td>
                          <td className="text-right p-3 font-semibold">{item.quantity}</td>
                          <td className="text-right p-3 text-gray-600">{item.unit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  * Material quantities are estimates based on standard calculations and include {wastePercentage}% waste factor.
                  Actual requirements may vary based on job conditions.
                </p>
              </div>
            )}

            {/* Notes */}
            {notes && (
              <div className="mb-8">
                <h2 className="text-xl font-bold text-gray-900 mb-4">Notes</h2>
                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <p className="text-sm whitespace-pre-wrap">{notes}</p>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="mt-12 pt-6 border-t-2 border-gray-300">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <div>
                  <p className="font-semibold">{companyName}</p>
                  <p className="mt-1">Professional Roof Measurement System</p>
                </div>
                <div className="text-right">
                  <p>Report generated: {format(new Date(), 'PPpp')}</p>
                  <p className="mt-1">Report ID: {reportId}</p>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-4 text-center">
                This report is provided for estimation purposes only. Measurements are approximate and should be verified on-site.
                {companyName} is not responsible for material shortages or overages.
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
