import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  MapPin, 
  FileText, 
  CheckCircle, 
  AlertTriangle,
  ArrowRight,
  Ruler,
  Layers
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';

interface MeasurementGatingProps {
  pipelineEntryId: string;
  onReadinessChange: (isReady: boolean, data?: any) => void;
  className?: string;
}

interface MeasurementData {
  roof_area_sq_ft: number;
  measurements: any;
  has_template: boolean;
  template_id?: string;
}

const MeasurementGating: React.FC<MeasurementGatingProps> = ({
  pipelineEntryId,
  onReadinessChange,
  className
}) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [measurements, setMeasurements] = useState<MeasurementData | null>(null);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');

  useEffect(() => {
    checkMeasurementReadiness();
    loadTemplates();
  }, [pipelineEntryId]);

  useEffect(() => {
    if (measurements) {
      const isReady = measurements.roof_area_sq_ft > 0 && measurements.has_template;
      onReadinessChange(isReady, measurements);
    }
  }, [measurements, onReadinessChange]);

  const checkMeasurementReadiness = async () => {
    try {
      setLoading(true);
      
      // Check for existing measurements
      const { data: pipelineData, error: pipelineError } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .eq('id', pipelineEntryId)
        .single();

      if (pipelineError) throw pipelineError;

      const metadata = (pipelineData?.metadata as any) || {};
      const roofArea = metadata.roof_area_sq_ft || 0;
      const templateBinding = metadata.template_binding || null;

      setMeasurements({
        roof_area_sq_ft: roofArea,
        measurements: metadata.measurements || {},
        has_template: !!templateBinding?.template_id,
        template_id: templateBinding?.template_id
      });

      if (templateBinding?.template_id) {
        setSelectedTemplate(templateBinding.template_id);
      }

    } catch (error) {
      console.error('Error checking measurements:', error);
      toast({
        title: 'Error',
        description: 'Failed to check measurement readiness',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const loadTemplates = async () => {
    try {
      const { data, error } = await supabase
        .from('estimate_calculation_templates')
        .select('id, name, roof_type, template_category')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setTemplates(data || []);
    } catch (error) {
      console.error('Error loading templates:', error);
    }
  };

  const bindTemplate = async (templateId: string) => {
    try {
      // Update pipeline entry with template binding
      const { error } = await supabase
        .from('pipeline_entries')
        .update({
          metadata: {
            ...measurements?.measurements,
            roof_area_sq_ft: measurements?.roof_area_sq_ft,
            template_binding: {
              template_id: templateId,
              bound_at: new Date().toISOString()
            }
          }
        })
        .eq('id', pipelineEntryId);

      if (error) throw error;

      setMeasurements(prev => prev ? {
        ...prev,
        has_template: true,
        template_id: templateId
      } : null);

      setSelectedTemplate(templateId);

      toast({
        title: 'Template Bound',
        description: 'Measurements successfully mapped to calculation template',
      });

    } catch (error) {
      console.error('Error binding template:', error);
      toast({
        title: 'Error',
        description: 'Failed to bind template',
        variant: 'destructive'
      });
    }
  };

  const getReadinessStatus = () => {
    if (!measurements) return 'loading';
    
    const hasMeasurements = measurements.roof_area_sq_ft > 0;
    const hasTemplate = measurements.has_template;
    
    if (hasMeasurements && hasTemplate) return 'ready';
    if (hasMeasurements && !hasTemplate) return 'partial';
    return 'pending';
  };

  const getStatusDisplay = () => {
    const status = getReadinessStatus();
    
    switch (status) {
      case 'ready':
        return {
          icon: CheckCircle,
          color: 'text-success',
          bgColor: 'bg-success/10',
          message: 'Ready for cost calculations',
          action: null
        };
      case 'partial':
        return {
          icon: AlertTriangle,
          color: 'text-warning',
          bgColor: 'bg-warning/10',
          message: 'Measurements present, template binding required',
          action: 'bind_template'
        };
      case 'pending':
        return {
          icon: AlertTriangle,
          color: 'text-muted-foreground',
          bgColor: 'bg-muted/10',
          message: 'Measurements and template mapping required',
          action: 'add_measurements'
        };
      default:
        return {
          icon: AlertTriangle,
          color: 'text-muted-foreground',
          bgColor: 'bg-muted/10',
          message: 'Loading...',
          action: null
        };
    }
  };

  if (loading) {
    return (
      <Card className={className}>
        <CardContent className="p-6">
          <div className="text-center text-muted-foreground">
            Checking measurement readiness...
          </div>
        </CardContent>
      </Card>
    );
  }

  const status = getStatusDisplay();
  const StatusIcon = status.icon;
  const squares = measurements?.roof_area_sq_ft ? (measurements.roof_area_sq_ft / 100).toFixed(1) : '0';

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <MapPin className="h-5 w-5 text-primary" />
          <span>Measurement & Template Status</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status Overview */}
        <Alert className={status.bgColor}>
          <StatusIcon className={`h-4 w-4 ${status.color}`} />
          <AlertDescription className="flex items-center justify-between">
            <span>{status.message}</span>
            <Badge variant="outline" className="ml-2">
              {getReadinessStatus().toUpperCase()}
            </Badge>
          </AlertDescription>
        </Alert>

        {/* Measurement Info */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Ruler className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Roof Area</span>
            </div>
            <div className="text-lg font-semibold">
              {measurements?.roof_area_sq_ft ? 
                `${measurements.roof_area_sq_ft.toLocaleString()} sq ft` : 
                'Not set'
              }
            </div>
            {measurements?.roof_area_sq_ft > 0 && (
              <div className="text-sm text-muted-foreground">
                {squares} squares
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Layers className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Template Binding</span>
            </div>
            <div className="text-lg font-semibold">
              {measurements?.has_template ? 'Mapped' : 'Not mapped'}
            </div>
            {measurements?.has_template && (
              <div className="text-sm text-muted-foreground">
                Template bound
              </div>
            )}
          </div>
        </div>

        {/* Template Binding Interface */}
        {status.action === 'bind_template' && (
          <div className="space-y-3 p-4 border rounded-lg bg-accent/50">
            <h4 className="font-medium flex items-center space-x-2">
              <FileText className="h-4 w-4" />
              <span>Bind to Calculation Template</span>
            </h4>
            
            <div className="grid grid-cols-1 gap-2">
              {templates.map((template: any) => (
                <Button
                  key={template.id}
                  variant={selectedTemplate === template.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => bindTemplate(template.id)}
                  className="justify-start"
                >
                  <div className="flex items-center space-x-2">
                    <span>{template.name}</span>
                    <Badge variant="secondary" className="text-xs">
                      {template.roof_type?.replace('_', ' ')}
                    </Badge>
                  </div>
                  <ArrowRight className="h-3 w-3 ml-auto" />
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        {status.action === 'add_measurements' && (
          <div className="text-center p-4 border rounded-lg bg-accent/50">
            <p className="text-sm text-muted-foreground mb-3">
              Add roof measurements to enable cost calculations
            </p>
            <Button size="sm" className="flex items-center space-x-1">
              <MapPin className="h-4 w-4" />
              <span>Add Measurements</span>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default MeasurementGating;