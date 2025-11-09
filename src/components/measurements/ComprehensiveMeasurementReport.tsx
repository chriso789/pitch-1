import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Eye, Edit, Download, Printer, MapPin } from 'lucide-react';
import { ComprehensiveMeasurementOverlay } from './ComprehensiveMeasurementOverlay';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface RoofFace {
  id: string;
  wkt: string;
  area_sqft: number;
  plan_area_sqft?: number;
  pitch?: string;
}

interface LinearFeature {
  id: string;
  wkt: string;
  length_ft: number;
  type: string;
}

interface MeasurementSummary {
  total_area_sqft: number;
  total_squares: number;
  waste_pct: number;
  perimeter_ft?: number;
  ridge_ft?: number;
  hip_ft?: number;
  valley_ft?: number;
  eave_ft?: number;
  rake_ft?: number;
}

interface MeasurementData {
  id: string;
  property_id: string;
  faces?: RoofFace[];
  linear_features?: LinearFeature[];
  summary: MeasurementSummary;
  mapbox_visualization_url?: string;
  center_lat?: number;
  center_lng?: number;
  visualization_metadata?: any;
  confidence?: number;
}

interface ComprehensiveMeasurementReportProps {
  measurement: MeasurementData;
  tags?: Record<string, any>;
  address?: string;
  onMeasurementUpdate?: (measurement: any, tags: any) => void;
}

const ComprehensiveMeasurementReport: React.FC<ComprehensiveMeasurementReportProps> = ({
  measurement,
  tags,
  address,
  onMeasurementUpdate,
}) => {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [isExporting, setIsExporting] = useState(false);

  const handleExportPDF = async () => {
    setIsExporting(true);
    try {
      const element = document.getElementById('measurement-report-content');
      if (!element) return;

      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const imgWidth = 210;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
      pdf.save(`measurement-report-${measurement.id}.pdf`);
    } catch (error) {
      console.error('PDF export error:', error);
    } finally {
      setIsExporting(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleMeasurementChange = (updatedMeasurement: any, updatedTags: any) => {
    if (onMeasurementUpdate) {
      onMeasurementUpdate(updatedMeasurement, updatedTags);
    }
  };

  const summary = measurement.summary;
  const confidence = measurement.confidence || 0.85;

  return (
    <div className="space-y-6" id="measurement-report-content">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Comprehensive Measurement Report
              </CardTitle>
              {address && (
                <p className="text-sm text-muted-foreground mt-1">{address}</p>
              )}
            </div>
            <Badge variant={confidence >= 0.9 ? 'default' : 'secondary'}>
              {Math.round(confidence * 100)}% Confidence
            </Badge>
          </div>
        </CardHeader>
      </Card>

      {/* Mode Toggle & Actions */}
      <div className="flex items-center justify-between">
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'view' | 'edit')}>
          <TabsList>
            <TabsTrigger value="view">
              <Eye className="h-4 w-4 mr-2" />
              View Mode
            </TabsTrigger>
            <TabsTrigger value="edit">
              <Edit className="h-4 w-4 mr-2" />
              Edit Mode
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleExportPDF}
            disabled={isExporting}
          >
            <Download className="h-4 w-4 mr-2" />
            {isExporting ? 'Exporting...' : 'Export PDF'}
          </Button>
        </div>
      </div>

      {/* Visualization */}
      <Card>
        <CardHeader>
          <CardTitle>Satellite Visualization</CardTitle>
        </CardHeader>
        <CardContent>
          {mode === 'view' && measurement.mapbox_visualization_url ? (
            <div className="relative">
              <img
                src={measurement.mapbox_visualization_url}
                alt="Roof measurement visualization"
                className="w-full h-auto rounded-lg border"
              />
              <div className="absolute bottom-4 right-4 bg-background/90 backdrop-blur-sm px-3 py-1.5 rounded-md text-xs text-muted-foreground">
                Generated: {measurement.visualization_metadata?.generated_at 
                  ? new Date(measurement.visualization_metadata.generated_at).toLocaleDateString()
                  : 'N/A'}
              </div>
            </div>
          ) : mode === 'edit' ? (
            <ComprehensiveMeasurementOverlay
              satelliteImageUrl={measurement.mapbox_visualization_url || ''}
              measurement={measurement}
              tags={tags || {}}
              centerLat={measurement.center_lat || 0}
              centerLng={measurement.center_lng || 0}
              zoom={measurement.visualization_metadata?.zoom || 18}
              onMeasurementUpdate={handleMeasurementChange}
            />
          ) : (
            <div className="flex items-center justify-center h-64 bg-muted rounded-lg">
              <p className="text-muted-foreground">No visualization available</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <Card>
        <CardHeader>
          <CardTitle>Measurement Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Total Area</p>
              <p className="text-2xl font-bold">{Math.round(summary.total_area_sqft).toLocaleString()} sq ft</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Squares</p>
              <p className="text-2xl font-bold">{summary.total_squares.toFixed(1)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Waste Factor</p>
              <p className="text-2xl font-bold">{summary.waste_pct}%</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Roof Facets</p>
              <p className="text-2xl font-bold">{measurement.faces?.length || 0}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-6 pt-6 border-t">
            {summary.ridge_ft !== undefined && (
              <div>
                <p className="text-sm text-muted-foreground">Ridge</p>
                <p className="text-lg font-semibold">{Math.round(summary.ridge_ft)} ft</p>
              </div>
            )}
            {summary.hip_ft !== undefined && (
              <div>
                <p className="text-sm text-muted-foreground">Hip</p>
                <p className="text-lg font-semibold">{Math.round(summary.hip_ft)} ft</p>
              </div>
            )}
            {summary.valley_ft !== undefined && (
              <div>
                <p className="text-sm text-muted-foreground">Valley</p>
                <p className="text-lg font-semibold">{Math.round(summary.valley_ft)} ft</p>
              </div>
            )}
            {summary.eave_ft !== undefined && (
              <div>
                <p className="text-sm text-muted-foreground">Eave</p>
                <p className="text-lg font-semibold">{Math.round(summary.eave_ft)} ft</p>
              </div>
            )}
            {summary.rake_ft !== undefined && (
              <div>
                <p className="text-sm text-muted-foreground">Rake</p>
                <p className="text-lg font-semibold">{Math.round(summary.rake_ft)} ft</p>
              </div>
            )}
            {summary.perimeter_ft !== undefined && (
              <div>
                <p className="text-sm text-muted-foreground">Perimeter</p>
                <p className="text-lg font-semibold">{Math.round(summary.perimeter_ft)} ft</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Facet Details */}
      {measurement.faces && measurement.faces.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Facet Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {measurement.faces.map((face, index) => (
                <div key={face.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">Facet {index + 1}</Badge>
                    <span className="text-sm">
                      {Math.round(face.area_sqft).toLocaleString()} sq ft
                    </span>
                    {face.pitch && (
                      <span className="text-sm text-muted-foreground">
                        Pitch: {face.pitch}
                      </span>
                    )}
                  </div>
                  <span className="text-sm font-medium">
                    {(face.area_sqft / 100).toFixed(1)} squares
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ComprehensiveMeasurementReport;
