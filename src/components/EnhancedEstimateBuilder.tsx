import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Calculator, Plus, Trash2, FileText, DollarSign, Target, TrendingUp, MapPin, Satellite, Loader2, AlertTriangle } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ProfitBreakdownDisplay } from './ProfitBreakdownDisplay';
import { AddEstimateLineDialog } from './estimates/AddEstimateLineDialog';
import { PullMeasurementsButton } from './measurements/PullMeasurementsButton';
import { useLatestMeasurement } from '@/hooks/useMeasurement';

interface LineItem {
  item_category: string;
  item_name: string;
  description: string;
  quantity: number;
  unit_cost: number;
  unit_type: string;
  markup_percent: number;
}

interface EnhancedEstimateBuilderProps {
  pipelineEntryId?: string;
  contactId?: string;
  onEstimateCreated?: (estimate: any) => void;
}

export const EnhancedEstimateBuilder: React.FC<EnhancedEstimateBuilderProps> = ({
  pipelineEntryId,
  contactId,
  onEstimateCreated
}) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [savingEstimate, setSavingEstimate] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [salesReps, setSalesReps] = useState([]);
  const [selectedSalesRep, setSelectedSalesRep] = useState<any>(null);
  
  const [propertyDetails, setPropertyDetails] = useState({
    roof_area_sq_ft: 0,
    roof_type: 'asphalt_shingle',
    complexity_level: 'moderate',
    roof_pitch: '4/12',
    customer_name: '',
    customer_address: ''
  });

  const [lineItems, setLineItems] = useState<LineItem[]>([
    {
      item_category: 'material',
      item_name: 'Asphalt Shingles',
      description: 'Architectural shingles',
      quantity: 1,
      unit_cost: 150,
      unit_type: 'square',
      markup_percent: 25
    }
  ]);

  // Excel-style calculation controls
  const [excelConfig, setExcelConfig] = useState({
    target_margin_percent: 30.0,  // Guaranteed 30% margin
    overhead_percent: 15.0,       // Overhead as % of selling price
    commission_percent: 5.0,      // Commission as % of selling price
    waste_factor_percent: 10.0,   // Material waste factor
    contingency_percent: 5.0      // Labor contingency
  });

  const [templateId, setTemplateId] = useState('');
  const [salesRepId, setSalesRepId] = useState('');
  const [secondaryRepIds, setSecondaryRepIds] = useState<string[]>([]);
  const [calculationResults, setCalculationResults] = useState<any>(null);
  const [measurementData, setMeasurementData] = useState<any>(null);
  const [hasMeasurements, setHasMeasurements] = useState(false);
  const [savedEstimates, setSavedEstimates] = useState<any[]>([]);
  const [editingEstimateId, setEditingEstimateId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('builder');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showNewEstimateConfirm, setShowNewEstimateConfirm] = useState(false);

  const [showAddLineDialog, setShowAddLineDialog] = useState(false);
  const [pullingSolarMeasurements, setPullingSolarMeasurements] = useState(false);
  const [solarMeasurementData, setSolarMeasurementData] = useState<any>(null);
  const [coordinates, setCoordinates] = useState<{lat: number, lng: number} | null>(null);

  useEffect(() => {
    loadTemplates();
    loadSalesReps();
    if (pipelineEntryId) {
      loadSavedEstimates();
    }
  }, [pipelineEntryId]);

  // Load measurement data from pipeline entry
  useEffect(() => {
    if (!pipelineEntryId) return;

    const loadMeasurementData = async () => {
      try {
        const { data: pipelineEntry, error } = await supabase
          .from('pipeline_entries')
          .select(`
            roof_type,
            metadata,
            contacts (
              first_name,
              last_name,
              address_street,
              address_city,
              address_state,
              address_zip
            )
          `)
          .eq('id', pipelineEntryId)
          .single();

        if (error) throw error;

        if (pipelineEntry) {
          const metadata = (pipelineEntry.metadata as any) || {};
          const roofAreaSqFt = metadata.roof_area_sq_ft || metadata.comprehensive_measurements?.adjustedArea || 0;
          const comprehensiveMeasurements = metadata.comprehensive_measurements;
          const hasValidMeasurements = roofAreaSqFt > 0;
          
          // Extract coordinates from verified address
          const verifiedAddress = metadata.verified_address;
          if (verifiedAddress?.geometry?.location) {
            setCoordinates({
              lat: verifiedAddress.geometry.location.lat,
              lng: verifiedAddress.geometry.location.lng
            });
          }
          
          setHasMeasurements(hasValidMeasurements);
          setMeasurementData(comprehensiveMeasurements);

          // Load roof type from pipeline metadata if not set
          const roofTypeFromMetadata = metadata.roof_type || pipelineEntry.roof_type;

          // Update property details with measurement data
          setPropertyDetails(prev => ({
            ...prev,
            roof_area_sq_ft: roofAreaSqFt || prev.roof_area_sq_ft,
            roof_type: roofTypeFromMetadata || prev.roof_type,
            customer_name: pipelineEntry.contacts 
              ? `${pipelineEntry.contacts.first_name || ''} ${pipelineEntry.contacts.last_name || ''}`.trim()
              : prev.customer_name,
            customer_address: pipelineEntry.contacts
              ? [
                  pipelineEntry.contacts.address_street,
                  pipelineEntry.contacts.address_city,
                  `${pipelineEntry.contacts.address_state || ''} ${pipelineEntry.contacts.address_zip || ''}`.trim()
                ].filter(Boolean).join(', ')
              : prev.customer_address,
            roof_pitch: comprehensiveMeasurements?.pitch || prev.roof_pitch,
            complexity_level: comprehensiveMeasurements?.complexity || prev.complexity_level
          }));

          if (hasValidMeasurements) {
            toast({
              title: "Measurements Loaded",
              description: `${roofAreaSqFt.toFixed(0)} sq ft loaded from satellite measurements`,
            });
          }
        }
      } catch (error: any) {
        console.error('Error loading measurement data:', error);
      }
    };

    loadMeasurementData();
  }, [pipelineEntryId]);

  const loadTemplates = async () => {
    try {
      const { data, error } = await supabase
        .from('estimate_calculation_templates')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setTemplates(data || []);
    } catch (error: any) {
      console.error('Error loading templates:', error);
    }
  };

  const loadSalesReps = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, overhead_rate, commission_structure, commission_rate')
        .in('role', ['sales_manager', 'regional_manager', 'corporate'])  // Include sales managers and higher
        .eq('is_active', true)
        .order('first_name');

      if (error) throw error;
      setSalesReps(data || []);
    } catch (error: any) {
      console.error('Error loading sales reps:', error);
    }
  };

  const loadSavedEstimates = async () => {
    if (!pipelineEntryId) return;
    
    try {
      const { data, error } = await supabase
        .from('enhanced_estimates')
        .select(`
          id,
          estimate_number,
          selling_price,
          actual_profit_percent,
          roof_type,
          status,
          created_at,
          template_id,
          estimate_calculation_templates (
            name
          )
        `)
        .eq('pipeline_entry_id', pipelineEntryId)
        .order('created_at', { ascending: false });
        
      if (!error && data) {
        setSavedEstimates(data);
      }
    } catch (error: any) {
      console.error('Error loading saved estimates:', error);
    }
  };

  const addLineItem = () => {
    setShowAddLineDialog(true);
    if (editingEstimateId) setHasUnsavedChanges(true);
  };

  const handleAddLineFromDialog = (line: any) => {
    setLineItems(prev => [...prev, {
      item_category: line.item_category || 'material',
      item_name: line.item_name,
      description: line.description,
      quantity: line.quantity,
      unit_cost: line.unit_cost,
      unit_type: line.unit_type,
      markup_percent: line.markup_percent
    }]);
  };

  const removeLineItem = (index: number) => {
    setLineItems(prev => prev.filter((_, i) => i !== index));
    if (editingEstimateId) setHasUnsavedChanges(true);
  };

  const updateLineItem = (index: number, field: keyof LineItem, value: any) => {
    setLineItems(prev => prev.map((item, i) => 
      i === index ? { ...item, [field]: value } : item
    ));
    if (editingEstimateId) setHasUnsavedChanges(true);
  };

  const calculateEstimate = async () => {
    if (!propertyDetails.roof_area_sq_ft || propertyDetails.roof_area_sq_ft <= 0) {
      toast({
        title: "Validation Error",
        description: "Please enter a valid roof area",
        variant: "destructive",
      });
      return;
    }

    if (!propertyDetails.customer_name.trim()) {
      toast({
        title: "Validation Error",
        description: "Please enter customer name",
        variant: "destructive",
      });
      return;
    }

    setCalculating(true);
    try {
      const { data, error } = await supabase.functions.invoke('excel-style-estimate-calculator', {
        body: {
          pipeline_entry_id: pipelineEntryId,
          template_id: templateId || null,
          property_details: {
            ...propertyDetails,
            linear_measurements: solarMeasurementData ? {
              perimeter: solarMeasurementData.perimeter,
              ridges: solarMeasurementData.ridges.totalLength,
              hips: solarMeasurementData.hips.totalLength,
              valleys: solarMeasurementData.valleys.totalLength,
              eaves: solarMeasurementData.eaves,
              rakes: solarMeasurementData.rakes
            } : undefined
          },
          line_items: lineItems.filter(item => item.item_name.trim()),
          sales_rep_id: salesRepId || null,
          target_margin_percent: excelConfig.target_margin_percent,
          overhead_percent: excelConfig.overhead_percent,
          commission_percent: excelConfig.commission_percent,
          waste_factor_percent: excelConfig.waste_factor_percent,
          contingency_percent: excelConfig.contingency_percent
        }
      });

      if (error) throw error;

      setCalculationResults(data.calculations);
      onEstimateCreated?.(data.estimate);

      toast({
        title: "Excel-Style Estimate Created",
        description: `Estimate ${data.estimate.estimate_number} created with guaranteed ${excelConfig.target_margin_percent}% margin`,
      });

    } catch (error: any) {
      console.error('Error calculating estimate:', error);
      toast({
        title: "Calculation Error",
        description: error.message || 'Failed to calculate estimate',
        variant: "destructive",
      });
    } finally {
      setCalculating(false);
    }
  };

  const handlePullSolarMeasurements = async () => {
    if (!pipelineEntryId) {
      toast({
        title: "No Pipeline Entry",
        description: "Cannot pull measurements without a pipeline entry",
        variant: "destructive"
      });
      return;
    }

    setPullingSolarMeasurements(true);
    toast({
      title: "Pulling Measurements",
      description: "Fetching detailed roof geometry from Google Solar API...",
    });

    try {
      const { data, error } = await supabase.functions.invoke('google-solar-measurements', {
        body: { pipeline_entry_id: pipelineEntryId }
      });

      if (error) throw error;

      if (data.success) {
        const measurements = data.measurements;
        
        // Update property details with Solar API data
        setPropertyDetails(prev => ({
          ...prev,
          roof_area_sq_ft: measurements.roofArea,
          roof_pitch: measurements.averagePitch,
          complexity_level: measurements.complexity
        }));

        setSolarMeasurementData(measurements);
        setHasMeasurements(true);
        setMeasurementData(measurements);

        toast({
          title: "Roof Report Retrieved",
          description: `${(measurements.roofArea / 100).toFixed(1)} squares from satellite measurements`,
        });
      } else {
        throw new Error(data.error || 'Failed to retrieve measurements');
      }
    } catch (error) {
      console.error('Solar measurement error:', error);
      toast({
        title: "Measurement Failed",
        description: error instanceof Error ? error.message : "Please try manual measurement",
        variant: "destructive"
      });
    } finally {
      setPullingSolarMeasurements(false);
    }
  };

  const handleSaveEstimate = async () => {
    if (!pipelineEntryId) {
      toast({
        title: "Error",
        description: "Pipeline entry ID is required",
        variant: "destructive",
      });
      return;
    }

    if (!calculationResults || calculationResults.selling_price === 0) {
      toast({
        title: "Error",
        description: "Please calculate the estimate first",
        variant: "destructive",
      });
      return;
    }

    setSavingEstimate(true);
    try {
      // Get user and tenant info
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile?.tenant_id) throw new Error('Tenant ID not found');

      // Generate estimate number
      const { count } = await supabase
        .from('enhanced_estimates')
        .select('*', { count: 'exact', head: true });
      
      const estimateNumber = `EST-${String((count || 0) + 1).padStart(5, '0')}`;

      // Save estimate (tenant_id will be set by RLS/trigger)
      const { data: newEstimate, error } = await (supabase
        .from('enhanced_estimates') as any)
        .insert({
          pipeline_entry_id: pipelineEntryId,
          estimate_number: estimateNumber,
          customer_name: propertyDetails.customer_name || 'Unknown',
          customer_address: propertyDetails.customer_address || '',
          roof_area_sq_ft: calculationResults.roof_area_sq_ft || propertyDetails.roof_area_sq_ft || 0,
          roof_pitch: propertyDetails.roof_pitch || '4/12',
          complexity_level: propertyDetails.complexity_level || 'moderate',
          material_cost: calculationResults.material_cost || 0,
          material_markup_percent: 0,
          material_total: calculationResults.material_cost || 0,
          labor_hours: calculationResults.labor_hours || 0,
          labor_rate_per_hour: calculationResults.labor_rate_per_hour || 50,
          labor_cost: calculationResults.labor_cost || 0,
          labor_markup_percent: 0,
          labor_total: calculationResults.labor_cost || 0,
          overhead_percent: excelConfig.overhead_percent || 20,
          overhead_amount: calculationResults.overhead_amount || 0,
          subtotal: calculationResults.cost_pre_profit || 0,
          target_profit_percent: excelConfig.target_margin_percent || 30,
          target_profit_amount: calculationResults.profit_amount || 0,
          actual_profit_amount: calculationResults.profit_amount || 0,
          actual_profit_percent: calculationResults.actual_margin_percent || 0,
          selling_price: calculationResults.selling_price || 0,
          price_per_sq_ft: calculationResults.roof_area_sq_ft > 0 ? (calculationResults.selling_price / calculationResults.roof_area_sq_ft) : 0,
          permit_costs: 0,
          waste_factor_percent: excelConfig.waste_factor_percent || 10,
          contingency_percent: excelConfig.contingency_percent || 5,
          line_items: lineItems as any || [],
          status: 'draft',
          created_by: user.id
        })
        .select()
        .single();

      if (error) throw error;

      toast({
        title: "Estimate Saved",
        description: `Estimate ${estimateNumber} saved successfully`,
      });

      onEstimateCreated?.(newEstimate);
      
      // Refresh the saved estimates list
      await loadSavedEstimates();
      
      // Clear editing state and unsaved changes after saving
      setEditingEstimateId(null);
      setHasUnsavedChanges(false);
    } catch (error: any) {
      console.error('Error saving estimate:', error);
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save estimate",
        variant: "destructive",
      });
    } finally {
      setSavingEstimate(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const handleLoadEstimate = async (estimateId: string) => {
    try {
      setLoading(true);
      
      // Fetch the full estimate details
      const { data: estimate, error } = await supabase
        .from('enhanced_estimates')
        .select('*')
        .eq('id', estimateId)
        .maybeSingle();

      if (error) throw error;
      
      if (!estimate) {
        toast({
          title: "Estimate Not Found",
          description: "The selected estimate could not be loaded",
          variant: "destructive",
        });
        return;
      }

      // Populate property details
      setPropertyDetails({
        roof_area_sq_ft: estimate.roof_area_sq_ft || 0,
        roof_type: (estimate as any).roof_type || 'asphalt_shingle',
        complexity_level: estimate.complexity_level || 'moderate',
        roof_pitch: estimate.roof_pitch || '4/12',
        customer_name: estimate.customer_name || '',
        customer_address: estimate.customer_address || ''
      });

      // Populate line items
      if (estimate.line_items && Array.isArray(estimate.line_items)) {
        setLineItems(estimate.line_items as unknown as LineItem[]);
      }

      // Populate excel config
      setExcelConfig({
        target_margin_percent: estimate.target_profit_percent || 30.0,
        overhead_percent: estimate.overhead_percent || 15.0,
        commission_percent: 5.0, // Not stored in estimate, use default
        waste_factor_percent: estimate.waste_factor_percent || 10.0,
        contingency_percent: estimate.contingency_percent || 5.0
      });

      // Set template if exists
      if (estimate.template_id) {
        setTemplateId(estimate.template_id);
      }

      // Populate calculation results for display
      setCalculationResults({
        roof_area_sq_ft: estimate.roof_area_sq_ft,
        material_cost: estimate.material_cost,
        material_total: estimate.material_total,
        labor_cost: estimate.labor_cost,
        labor_hours: estimate.labor_hours,
        labor_rate_per_hour: estimate.labor_rate_per_hour,
        labor_total: estimate.labor_total,
        subtotal: estimate.subtotal,
        overhead_amount: estimate.overhead_amount,
        overhead_percent: estimate.overhead_percent,
        sales_rep_commission_amount: 0, // Calculate if needed
        cost_pre_profit: estimate.subtotal,
        target_profit_amount: estimate.target_profit_amount || estimate.actual_profit_amount,
        actual_profit_percent: estimate.actual_profit_percent,
        selling_price: estimate.selling_price,
        price_per_sq_ft: estimate.price_per_sq_ft,
        waste_factor_percent: estimate.waste_factor_percent
      });

      // Set editing state
      setEditingEstimateId(estimateId);
      setHasUnsavedChanges(false);

      // Switch to builder tab
      setActiveTab('builder');

      toast({
        title: "Estimate Loaded",
        description: `${estimate.estimate_number} is ready for editing`,
      });

    } catch (error: any) {
      console.error('Error loading estimate:', error);
      toast({
        title: "Load Failed",
        description: error.message || "Failed to load estimate",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleNewEstimate = () => {
    if (hasUnsavedChanges && editingEstimateId) {
      setShowNewEstimateConfirm(true);
      return;
    }
    
    performNewEstimate();
  };

  const performNewEstimate = () => {
    // Reset all form fields to create a new estimate
    setEditingEstimateId(null);
    setLineItems([
      {
        item_category: 'material',
        item_name: 'Asphalt Shingles',
        description: 'Architectural shingles',
        quantity: 1,
        unit_cost: 150,
        unit_type: 'square',
        markup_percent: 25
      }
    ]);
    setExcelConfig({
      target_margin_percent: 30.0,
      overhead_percent: 15.0,
      commission_percent: 5.0,
      waste_factor_percent: 10.0,
      contingency_percent: 5.0
    });
    setTemplateId('');
    setSalesRepId('');
    setSecondaryRepIds([]);
    setCalculationResults(null);
    setHasUnsavedChanges(false);
    setShowNewEstimateConfirm(false);
    
    toast({
      title: "New Estimate",
      description: "Form cleared for new estimate",
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Estimate Builder
            <div className="ml-auto flex items-center gap-2">
              {templateId && templates.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  Template: {templates.find((t: any) => t.id === templateId)?.name || 'Selected'}
                </Badge>
              )}
              {selectedSalesRep && (
                <>
                  <Badge variant="secondary" className="text-xs">
                    Primary: {selectedSalesRep.first_name} {selectedSalesRep.last_name}
                  </Badge>
                  {secondaryRepIds.length > 0 && (
                    <Badge variant="outline" className="text-xs">
                      +{secondaryRepIds.length} Secondary Rep{secondaryRepIds.length > 1 ? 's' : ''}
                    </Badge>
                  )}
                </>
              )}
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Target className="h-4 w-4" />
                Guaranteed {excelConfig.target_margin_percent}% Margin
              </div>
            </div>
          </CardTitle>
        </CardHeader>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="builder">
            Builder
            {editingEstimateId && (
              <Badge variant="outline" className="ml-2 text-xs">
                Editing
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="estimates">
            Saved Estimates
            {savedEstimates.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {savedEstimates.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="builder" className="space-y-6">
          {editingEstimateId && (
            <Card className="border-primary/50 bg-primary/5">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="default">Editing Mode</Badge>
                    <span className="text-sm text-muted-foreground">
                      Make changes and click "Save Estimate" to update
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleNewEstimate}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    New Estimate
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column - Input Forms */}
        <div className="space-y-6">
          {/* Property Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Property Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="roof_area">Squares (1 square = 100 sq ft)</Label>
                  {hasMeasurements && (
                    <Badge variant="secondary" className="text-xs">
                      <MapPin className="h-3 w-3 mr-1" />
                      Satellite Measured
                    </Badge>
                  )}
                </div>
                <Input
                  id="roof_area"
                  type="number"
                  step="0.1"
                  value={(propertyDetails.roof_area_sq_ft / 100).toFixed(2)}
                  onChange={(e) => {
                    setPropertyDetails(prev => ({ ...prev, roof_area_sq_ft: (parseFloat(e.target.value) || 0) * 100 }));
                    if (editingEstimateId) setHasUnsavedChanges(true);
                  }}
                />
                {hasMeasurements && measurementData && (
                  <p className="text-xs text-muted-foreground">
                    Confidence: {Math.round((measurementData.accuracyScore || 0.85) * 100)}%
                    {measurementData.perimeter && ` • Perimeter: ${measurementData.perimeter.toFixed(0)} ft`}
                  </p>
                )}
                
                <div className="mt-2">
                    <PullMeasurementsButton
                      propertyId={pipelineEntryId || ''}
                      lat={coordinates?.lat || 0}
                      lng={coordinates?.lng || 0}
                      onSuccess={(measurement, tags) => {
                        setPropertyDetails(prev => ({
                          ...prev,
                          roof_area_sq_ft: tags['roof.total_sqft'] || 0,
                        }));
                        setHasMeasurements(true);
                        toast({
                          title: "Smart Tags Ready",
                          description: `${tags['roof.squares']?.toFixed(1)} squares available for templates`,
                        });
                      }}
                    />
                  </div>

                  {solarMeasurementData && (
                    <div className="border rounded-lg p-3 space-y-2 mt-3 bg-muted/50">
                      <div className="text-sm font-medium">Roof Geometry Details:</div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Perimeter:</span>{' '}
                          <span className="font-medium">{solarMeasurementData.perimeter.toFixed(0)} ft</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Ridge:</span>{' '}
                          <span className="font-medium">{solarMeasurementData.ridges.totalLength.toFixed(0)} ft</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Hips:</span>{' '}
                          <span className="font-medium">{solarMeasurementData.hips.totalLength.toFixed(0)} ft</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Valleys:</span>{' '}
                          <span className="font-medium">{solarMeasurementData.valleys.totalLength.toFixed(0)} ft</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Eaves:</span>{' '}
                          <span className="font-medium">{solarMeasurementData.eaves.toFixed(0)} ft</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Rakes:</span>{' '}
                          <span className="font-medium">{solarMeasurementData.rakes.toFixed(0)} ft</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <Badge variant="secondary" className="text-xs">
                          Roof Report
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {solarMeasurementData.imageryDate}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

              <div className="space-y-2">
                <Label>Roof Type</Label>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-sm">
                    {propertyDetails.roof_type?.replace('_', ' ') || 'Not specified'}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    (Set during lead creation)
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Line Items - Only show after template is selected */}
          {templateId && (
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle className="text-lg">Line Items</CardTitle>
                  <Button onClick={addLineItem} size="sm" variant="outline">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Item
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {lineItems.map((item, index) => (
                  <div key={index} className="border rounded-lg p-4 space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">Item {index + 1}</span>
                      {lineItems.length > 1 && (
                        <Button
                          onClick={() => removeLineItem(index)}
                          size="sm"
                          variant="ghost"
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Category</Label>
                        <Select
                          value={item.item_category}
                          onValueChange={(value) => updateLineItem(index, 'item_category', value)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="material">Material</SelectItem>
                            <SelectItem value="labor">Labor</SelectItem>
                            <SelectItem value="equipment">Equipment</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Item Name</Label>
                        <Input
                          value={item.item_name}
                          onChange={(e) => updateLineItem(index, 'item_name', e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Description</Label>
                      <Input
                        value={item.description}
                        onChange={(e) => updateLineItem(index, 'description', e.target.value)}
                      />
                    </div>

                    <div className="grid grid-cols-4 gap-3">
                      <div className="space-y-2">
                        <Label>Quantity</Label>
                        <Input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => updateLineItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Unit Cost</Label>
                        <Input
                          type="number"
                          value={item.unit_cost}
                          onChange={(e) => updateLineItem(index, 'unit_cost', parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Unit Type</Label>
                        <Select
                          value={item.unit_type}
                          onValueChange={(value) => updateLineItem(index, 'unit_type', value)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="each">Each</SelectItem>
                            <SelectItem value="square">Square</SelectItem>
                            <SelectItem value="linear_ft">Linear Ft</SelectItem>
                            <SelectItem value="hour">Hour</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Markup %</Label>
                        <Input
                          type="number"
                          value={item.markup_percent}
                          onChange={(e) => updateLineItem(index, 'markup_percent', parseFloat(e.target.value) || 0)}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column - Configuration & Results */}
        <div className="space-y-6">
          {/* Template Selection */}
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="space-y-2">
                <Label htmlFor="template" className="text-sm">Template</Label>
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select template (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((template: any) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Pre Cap Margin */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Pre Cap Margin
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Target Margin Slider */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label className="text-sm font-medium">Target Margin (Guaranteed)</Label>
                  <span className="text-sm font-bold text-primary">{excelConfig.target_margin_percent}%</span>
                </div>
                <Slider
                  value={[excelConfig.target_margin_percent]}
                  onValueChange={(value) => setExcelConfig(prev => ({ ...prev, target_margin_percent: value[0] }))}
                  min={15}
                  max={50}
                  step={1}
                  className="w-full"
                />
                <div className="text-xs text-muted-foreground">15% - 50%</div>
              </div>

              {/* Commission Slider */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label className="text-sm font-medium">Sales Commission (% of Selling Price)</Label>
                  <span className="text-sm font-bold text-accent">{excelConfig.commission_percent}%</span>
                </div>
                <Slider
                  value={[excelConfig.commission_percent]}
                  onValueChange={(value) => setExcelConfig(prev => ({ ...prev, commission_percent: value[0] }))}
                  min={2}
                  max={10}
                  step={0.5}
                  className="w-full"
                />
                <div className="text-xs text-muted-foreground">2% - 10%</div>
                
                {/* Commission Split Preview */}
                {(salesRepId || secondaryRepIds.length > 0) && (
                  <div className="mt-3 p-3 bg-muted/50 rounded-lg border border-border/50">
                    <div className="text-xs font-medium text-muted-foreground mb-2">Commission Split Preview</div>
                    {(() => {
                      const totalReps = (salesRepId ? 1 : 0) + secondaryRepIds.length;
                      const commissionPerRep = totalReps > 0 ? excelConfig.commission_percent / totalReps : 0;
                      const totalCommissionAmount = calculationResults?.sales_rep_commission_amount || 0;
                      const amountPerRep = totalReps > 0 ? totalCommissionAmount / totalReps : 0;
                      
                      return (
                        <div className="space-y-1.5">
                          {salesRepId && selectedSalesRep && (
                            <div className="flex justify-between items-center text-xs">
                              <span className="text-foreground font-medium">
                                {selectedSalesRep.first_name} {selectedSalesRep.last_name}
                                <span className="text-primary ml-1">(Primary)</span>
                              </span>
                              <span className="font-semibold text-accent">
                                {commissionPerRep.toFixed(1)}%
                                {totalCommissionAmount > 0 && (
                                  <span className="text-muted-foreground ml-1">
                                    ({formatCurrency(amountPerRep)})
                                  </span>
                                )}
                              </span>
                            </div>
                          )}
                          {secondaryRepIds.map((repId, index) => {
                            const rep = salesReps.find((r: any) => r.id === repId);
                            return rep ? (
                              <div key={repId} className="flex justify-between items-center text-xs">
                                <span className="text-foreground font-medium">
                                  {rep.first_name} {rep.last_name}
                                  <span className="text-muted-foreground ml-1">(Secondary)</span>
                                </span>
                                <span className="font-semibold text-accent">
                                  {commissionPerRep.toFixed(1)}%
                                  {totalCommissionAmount > 0 && (
                                    <span className="text-muted-foreground ml-1">
                                      ({formatCurrency(amountPerRep)})
                                    </span>
                                  )}
                                </span>
                              </div>
                            ) : null;
                          })}
                          {totalReps > 1 && (
                            <div className="pt-1.5 mt-1.5 border-t border-border/50 flex justify-between items-center text-xs font-semibold">
                              <span className="text-foreground">Total ({totalReps} reps)</span>
                              <span className="text-primary">
                                {excelConfig.commission_percent}%
                                {totalCommissionAmount > 0 && (
                                  <span className="text-muted-foreground ml-1">
                                    ({formatCurrency(totalCommissionAmount)})
                                  </span>
                                )}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

              <Separator />

              <div className="space-y-2">
                <Label htmlFor="sales_rep">Sales Representative</Label>
                <Select value={salesRepId} onValueChange={(value) => {
                  setSalesRepId(value);
                  const rep = salesReps.find((r: any) => r.id === value);
                  setSelectedSalesRep(rep);
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select sales rep (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {salesReps.map((rep: any) => (
                      <SelectItem key={rep.id} value={rep.id}>
                        {rep.first_name} {rep.last_name}
                        {rep.commission_structure && (
                          <span className="text-xs text-muted-foreground ml-2">
                            ({rep.commission_structure === 'profit_split' ? 'Profit Split' : 'Sales %'} - {rep.commission_rate}%)
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {salesRepId && (
                <div className="space-y-2">
                  <Label>Secondary Reps (optional)</Label>
                  <div className="border rounded-md p-3 space-y-2 max-h-40 overflow-y-auto">
                    {salesReps
                      .filter((rep: any) => rep.id !== salesRepId)
                      .map((rep: any) => (
                        <label key={rep.id} className="flex items-center space-x-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={secondaryRepIds.includes(rep.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSecondaryRepIds(prev => [...prev, rep.id]);
                              } else {
                                setSecondaryRepIds(prev => prev.filter(id => id !== rep.id));
                              }
                            }}
                            className="rounded border-input"
                          />
                          <span className="text-sm">
                            {rep.first_name} {rep.last_name}
                          </span>
                        </label>
                      ))}
                  </div>
                </div>
              )}


              <Button 
                onClick={calculateEstimate} 
                disabled={calculating || !propertyDetails.customer_name.trim() || !propertyDetails.roof_area_sq_ft}
                className="w-full"
                variant={propertyDetails.customer_name.trim() && propertyDetails.roof_area_sq_ft ? "default" : "outline"}
              >
                {calculating ? 'Calculating Excel-Style Estimate...' : 'Calculate Guaranteed Margin Estimate'}
              </Button>
            </CardContent>
          </Card>

          {/* Results */}
          {calculationResults && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5" />
                  Calculation Results
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Material Total:</span>
                    <p className="font-medium">{formatCurrency(calculationResults.material_total)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Labor Total:</span>
                    <p className="font-medium">{formatCurrency(calculationResults.labor_total)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Subtotal:</span>
                    <p className="font-medium">{formatCurrency(calculationResults.subtotal)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Overhead:</span>
                    <p className="font-medium">{formatCurrency(calculationResults.overhead_amount)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Commission:</span>
                    <p className="font-medium">{formatCurrency(calculationResults.sales_rep_commission_amount)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Profit:</span>
                    <p className="font-medium">{formatCurrency(calculationResults.target_profit_amount)}</p>
                  </div>
                </div>

                <Separator />

                <div className="text-center">
                  <div className="text-2xl font-bold text-primary">
                    {formatCurrency(calculationResults.selling_price)}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {formatCurrency(calculationResults.price_per_sq_ft)}/sq ft
                  </div>
                </div>

                <div className="text-xs text-muted-foreground space-y-1">
                  <p><span className="font-medium text-primary">Guaranteed Margin:</span> {calculationResults.actual_profit_percent?.toFixed(1)}%</p>
                  <p><span className="font-medium">Labor Hours:</span> {calculationResults.labor_hours?.toFixed(1)}</p>
                  <p><span className="font-medium">Waste Factor:</span> {calculationResults.waste_factor_percent || 10}%</p>
                  <p><span className="font-medium">Overhead on Selling Price:</span> {calculationResults.overhead_percent?.toFixed(1)}%</p>
                </div>

                <Separator />

                <Button
                  onClick={handleSaveEstimate}
                  disabled={!calculationResults || savingEstimate || calculationResults.selling_price === 0}
                  size="lg"
                  className="w-full gradient-primary"
                >
                  {savingEstimate ? (
                    <>
                      <Calculator className="h-5 w-5 mr-2 animate-spin" />
                      Saving Estimate...
                    </>
                  ) : (
                    <>
                      <FileText className="h-5 w-5 mr-2" />
                      Save Estimate with Budget
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </TabsContent>

    <TabsContent value="estimates" className="space-y-4">
      {savedEstimates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No saved estimates yet</p>
            <p className="text-sm text-muted-foreground">
              Create your first estimate using the Builder tab
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {savedEstimates.map((estimate) => (
            <Card 
              key={estimate.id} 
              className="hover:shadow-md transition-all cursor-pointer hover:border-primary/50 group"
              onClick={() => handleLoadEstimate(estimate.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold group-hover:text-primary transition-colors">
                        {estimate.estimate_calculation_templates?.name || 'Custom Estimate'}
                      </h4>
                      <Badge variant="secondary" className="text-xs">
                        {estimate.estimate_number}
                      </Badge>
                      <Badge variant={
                        estimate.status === 'approved' ? 'default' :
                        estimate.status === 'draft' ? 'secondary' : 'outline'
                      }>
                        {estimate.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span>Type: {(estimate as any).roof_type?.replace('_', ' ') || 'Not specified'}</span>
                      <span>•</span>
                      <span>{new Date(estimate.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <div className="text-2xl font-bold text-primary">
                      {formatCurrency(estimate.selling_price)}
                    </div>
                    <div className="flex items-center gap-1">
                      <TrendingUp className="h-4 w-4 text-green-600" />
                      <span className="text-sm font-medium text-green-600">
                        {estimate.actual_profit_percent?.toFixed(1)}% Profit
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      Click to edit
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </TabsContent>
  </Tabs>

      <AddEstimateLineDialog
        open={showAddLineDialog}
        onOpenChange={setShowAddLineDialog}
        onAddLine={handleAddLineFromDialog}
        measurements={{
          surface_area_sf: propertyDetails.roof_area_sq_ft || 0,
          surface_squares: (propertyDetails.roof_area_sq_ft || 0) / 100,
          perimeter_lf: measurementData?.perimeter || 0,
          ridge_lf: measurementData?.ridge_length || 0,
          valley_lf: measurementData?.valley_length || 0,
          hip_lf: measurementData?.hip_length || 0,
          rake_lf: measurementData?.rake_length || 0,
          eave_lf: measurementData?.eave_length || 0
        }}
      />

      <AlertDialog open={showNewEstimateConfirm} onOpenChange={setShowNewEstimateConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Unsaved Changes
            </AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes to the current estimate. If you create a new estimate, these changes will be lost. Are you sure you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={performNewEstimate}>
              Discard Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};