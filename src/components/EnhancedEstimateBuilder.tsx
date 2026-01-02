import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Calculator, Plus, Trash2, FileText, DollarSign, Target, TrendingUp, MapPin, Satellite, Loader2, AlertTriangle, RefreshCw, Clock, Edit } from 'lucide-react';
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
import { AddFromLibraryDialog } from './estimates/AddFromLibraryDialog';
import { PullMeasurementsButton } from './measurements/PullMeasurementsButton';
import { useLatestMeasurement } from '@/hooks/useMeasurement';
import { useLivePricing } from '@/hooks/useLivePricing';
import { useUserProfile } from '@/contexts/UserProfileContext';

// LineItemRow component for rendering individual line items
const LineItemRow: React.FC<{
  item: LineItem;
  index: number;
  updateLineItem: (index: number, field: keyof LineItem, value: any) => void;
  removeLineItem: (index: number) => void;
  lineItemsCount: number;
  isPriceStale: (lastUpdated?: string) => boolean;
  formatLastUpdated: (lastUpdated?: string) => string;
}> = ({ item, index, updateLineItem, removeLineItem, lineItemsCount, isPriceStale, formatLastUpdated }) => (
  <div className="border rounded-lg p-4 space-y-3">
    <div className="flex justify-between items-center">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{item.item_name || `New ${item.item_category}`}</span>
        {item.last_price_updated && isPriceStale(item.last_price_updated) && (
          <Badge variant="destructive" className="text-xs">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Stale Price
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-2">
        {item.last_price_updated && (
          <span className="text-xs text-muted-foreground">
            Updated: {formatLastUpdated(item.last_price_updated)}
          </span>
        )}
        <Button
          onClick={() => removeLineItem(index)}
          size="sm"
          variant="ghost"
          className="text-red-500 hover:text-red-700"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
    
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-2">
        <Label>Item Name</Label>
        <Input
          value={item.item_name}
          onChange={(e) => updateLineItem(index, 'item_name', e.target.value)}
          placeholder="Enter item name"
        />
      </div>
      <div className="space-y-2">
        <Label>Description</Label>
        <Input
          value={item.description}
          onChange={(e) => updateLineItem(index, 'description', e.target.value)}
          placeholder="Enter description"
        />
      </div>
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
            <SelectItem value="bundle">Bundle</SelectItem>
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
);

// PreCapCommissionCard - Auto-calculates commission based on logged-in user's profile settings
const PreCapCommissionCard: React.FC<{
  calculationResults: any;
  formatCurrency: (amount: number) => string;
}> = ({ calculationResults, formatCurrency }) => {
  const { profile } = useUserProfile();
  const [commissionSettings, setCommissionSettings] = useState<{
    commission_rate: number;
    commission_structure: string;
    personal_overhead_rate: number;
  } | null>(null);

  useEffect(() => {
    const fetchCommissionSettings = async () => {
      if (!profile?.id) return;
      
      const { data } = await supabase
        .from('profiles')
        .select('commission_rate, commission_structure, personal_overhead_rate')
        .eq('id', profile.id)
        .single();
      
      if (data) {
        setCommissionSettings({
          commission_rate: data.commission_rate || 50,
          commission_structure: data.commission_structure || 'profit_split',
          personal_overhead_rate: data.personal_overhead_rate || 10
        });
      }
    };
    
    fetchCommissionSettings();
  }, [profile?.id]);

  // Calculate commission based on user's settings
  const calculateCommission = () => {
    if (!calculationResults || !commissionSettings) return { netProfit: 0, commission: 0 };
    
    const sellingPrice = calculationResults.selling_price || 0;
    const materialCost = calculationResults.material_cost || 0;
    const laborCost = calculationResults.labor_cost || 0;
    const grossProfit = sellingPrice - materialCost - laborCost;
    
    // Calculate rep overhead as % of selling price
    const repOverhead = sellingPrice * (commissionSettings.personal_overhead_rate / 100);
    const netProfit = grossProfit - repOverhead;
    
    // Calculate commission based on structure
    let commission = 0;
    if (commissionSettings.commission_structure === 'profit_split') {
      commission = netProfit * (commissionSettings.commission_rate / 100);
    } else {
      // percent_of_sale
      commission = sellingPrice * (commissionSettings.commission_rate / 100);
    }
    
    return { netProfit: Math.max(0, netProfit), commission: Math.max(0, commission), grossProfit };
  };

  const { netProfit, commission, grossProfit } = calculateCommission();
  const structureLabel = commissionSettings?.commission_structure === 'profit_split' 
    ? 'Profit Split' 
    : 'Percent of Sale';

  if (!commissionSettings) {
    return (
      <div className="p-4 bg-muted/30 rounded-lg border border-border">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading commission settings...
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-gradient-to-br from-primary/5 to-primary/10 rounded-lg border border-primary/20">
      <div className="flex items-center gap-2 mb-3">
        <DollarSign className="h-5 w-5 text-primary" />
        <span className="font-semibold text-sm">Your Pre-Cap Commission</span>
      </div>
      
      <div className="space-y-2 text-sm">
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Commission Type:</span>
          <Badge variant="secondary">{structureLabel}</Badge>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Your Rate:</span>
          <span className="font-semibold">{commissionSettings.commission_rate}%</span>
        </div>
        
        {calculationResults && (
          <>
            <Separator className="my-2" />
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Gross Profit:</span>
              <span className="font-medium">{formatCurrency(grossProfit || 0)}</span>
            </div>
            {commissionSettings.commission_structure === 'profit_split' && (
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Net Profit:</span>
                <span className="font-medium">{formatCurrency(netProfit)}</span>
              </div>
            )}
            <div className="flex justify-between items-center pt-2 border-t border-border">
              <span className="font-semibold text-foreground">Your Commission:</span>
              <span className="text-xl font-bold text-primary">{formatCurrency(commission)}</span>
            </div>
          </>
        )}
      </div>
      
      <p className="text-xs text-muted-foreground mt-3">
        Based on your commission settings
      </p>
    </div>
  );
};

interface LineItem {
  item_category: string;
  item_name: string;
  description: string;
  quantity: number;
  unit_cost: number;
  unit_type: string;
  markup_percent: number;
  sku?: string;
  last_price_updated?: string;
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
  const [searchParams] = useSearchParams();
  const { fetchLivePricing, applyLivePricing, refreshing: livePricingRefreshing } = useLivePricing();
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
  const [autoPopulateRan, setAutoPopulateRan] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showNewEstimateConfirm, setShowNewEstimateConfirm] = useState(false);
  
  // Filtering and sorting state
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterRoofType, setFilterRoofType] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('date_desc');

  const [showAddLineDialog, setShowAddLineDialog] = useState(false);
  const [showAddFromLibraryDialog, setShowAddFromLibraryDialog] = useState(false);
  const [pullingSolarMeasurements, setPullingSolarMeasurements] = useState(false);
  const [solarMeasurementData, setSolarMeasurementData] = useState<any>(null);
  const [coordinates, setCoordinates] = useState<{lat: number, lng: number} | null>(null);

  // Clear stale measurement data
  const handleClearMeasurements = async () => {
    if (!pipelineEntryId) return;
    
    try {
      const { data: entry, error: fetchError } = await supabase
        .from('pipeline_entries')
        .select('metadata')
        .eq('id', pipelineEntryId)
        .single();
      
      if (fetchError) throw fetchError;
      
      const currentMetadata = (entry?.metadata as any) || {};
      const { roof_area_sq_ft, comprehensive_measurements, ...cleanedMetadata } = currentMetadata;
      
      const { error } = await supabase
        .from('pipeline_entries')
        .update({ metadata: cleanedMetadata })
        .eq('id', pipelineEntryId);
      
      if (error) throw error;
      
      setMeasurementData(null);
      setHasMeasurements(false);
      setPropertyDetails(prev => ({ ...prev, roof_area_sq_ft: 0 }));
      
      toast({
        title: "Measurements Cleared",
        description: "Stale measurement data has been removed. Pull new measurements when ready.",
      });
    } catch (error: any) {
      console.error('Error clearing measurements:', error);
      toast({
        title: "Error",
        description: "Failed to clear measurements",
        variant: "destructive",
      });
    }
  };

  // Add measurement summary card near line items
  const MeasurementSummaryCard = () => {
    if (!measurementData) return null;

    const measurements = measurementData.comprehensive_measurements || measurementData;
    const summary = measurements.summary || {};
    
    return (
      <Card className="mb-4">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Satellite className="h-4 w-4" />
              Measurement Summary
            </CardTitle>
            <div className="flex gap-2">
              <Button 
                variant="ghost" 
                size="sm"
                onClick={handleClearMeasurements}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Clear
              </Button>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => {
                  if (pipelineEntryId) {
                    window.location.href = `/professional-measurement/${pipelineEntryId}`;
                  }
                }}
              >
                <Edit className="h-4 w-4 mr-2" />
                Re-verify
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Total Area:</span>
              <p className="font-semibold">{(summary.total_area_sqft || 0).toFixed(0)} sq ft</p>
            </div>
            <div>
              <span className="text-muted-foreground">Adjusted Squares:</span>
              <p className="font-semibold">{(summary.total_squares || 0).toFixed(2)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Waste Factor:</span>
              <p className="font-semibold">{summary.waste_pct || 10}%</p>
            </div>
            <div>
              <span className="text-muted-foreground">Roof Pitch:</span>
              <p className="font-semibold">{summary.pitch || '6/12'}</p>
            </div>
          </div>
          
          {measurementData.tags && (
            <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Ridge:</span>
                <p className="font-semibold">{(measurementData.tags['lf.ridge'] || 0).toFixed(0)} ft</p>
              </div>
              <div>
                <span className="text-muted-foreground">Hip:</span>
                <p className="font-semibold">{(measurementData.tags['lf.hip'] || 0).toFixed(0)} ft</p>
              </div>
              <div>
                <span className="text-muted-foreground">Valley:</span>
                <p className="font-semibold">{(measurementData.tags['lf.valley'] || 0).toFixed(0)} ft</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

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
        // First, check if there's an ACTIVE verified measurement in the measurements table
        const { data: activeMeasurement } = await supabase
          .from('measurements')
          .select('id, summary, linear_features')
          .eq('property_id', pipelineEntryId)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        
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
              address_zip,
              latitude,
              longitude,
              verified_address
            )
          `)
          .eq('id', pipelineEntryId)
          .single();

        if (error) throw error;

        if (pipelineEntry) {
          const metadata = (pipelineEntry.metadata as any) || {};
          const contact = pipelineEntry.contacts as any;
          
          // CRITICAL FIX: Only use measurements if there's an ACTIVE measurement in the database
          // Don't show cached/stale metadata if no active measurement exists
          let roofAreaSqFt = 0;
          let comprehensiveMeasurements: any = null;
          
          const summary = activeMeasurement?.summary as any;
          if (summary?.total_area_sqft) {
            // Use verified measurement from database
            roofAreaSqFt = summary.total_area_sqft;
            const metaComprehensive = (metadata.comprehensive_measurements || {}) as any;
            comprehensiveMeasurements = {
              ...metaComprehensive,
              adjustedArea: roofAreaSqFt,
              adjustedSquares: roofAreaSqFt / 100,
              ...summary
            };
            console.log('✅ Using ACTIVE verified measurement:', roofAreaSqFt, 'sq ft');
          } else {
            // No active measurement - don't show stale cached data
            console.log('⚠️ No active measurement found - not displaying stale cached data');
          }
          
          const hasValidMeasurements = roofAreaSqFt > 0;
          
          // Extract coordinates with priority fallback chain
          const verifiedAddress = metadata.verified_address;
          let extractedCoords: { lat: number; lng: number } | null = null;
          
          // Priority 1: metadata.verified_address.geometry.location
          if (verifiedAddress?.geometry?.location?.lat && verifiedAddress?.geometry?.location?.lng) {
            extractedCoords = {
              lat: verifiedAddress.geometry.location.lat,
              lng: verifiedAddress.geometry.location.lng
            };
            console.log('📍 Coordinates from metadata.verified_address.geometry.location:', extractedCoords);
          }
          // Priority 2: contact.latitude/longitude (from database)
          else if (contact?.latitude && contact?.longitude) {
            extractedCoords = {
              lat: contact.latitude,
              lng: contact.longitude
            };
            console.log('📍 Coordinates from contact.latitude/longitude:', extractedCoords);
          }
          // Priority 3: contact.verified_address (JSON field)
          else if (contact?.verified_address?.lat && contact?.verified_address?.lng) {
            extractedCoords = {
              lat: contact.verified_address.lat,
              lng: contact.verified_address.lng
            };
            console.log('📍 Coordinates from contact.verified_address:', extractedCoords);
          }
          // Priority 4: metadata flat structure
          else if (metadata.verified_address?.lat && metadata.verified_address?.lng) {
            extractedCoords = {
              lat: metadata.verified_address.lat,
              lng: metadata.verified_address.lng
            };
            console.log('📍 Coordinates from metadata.verified_address flat:', extractedCoords);
          }
          
          if (extractedCoords && extractedCoords.lat !== 0 && extractedCoords.lng !== 0) {
            setCoordinates(extractedCoords);
          } else {
            console.warn('⚠️ No valid coordinates found for this pipeline entry');
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
            roof_pitch: comprehensiveMeasurements?.adjustedPitch || comprehensiveMeasurements?.pitch || prev.roof_pitch,
            complexity_level: comprehensiveMeasurements?.complexity || prev.complexity_level
          }));

          // Only show toast when autoPopulate=true (fresh measurement flow), not on page load
          const autoPopulateParam = new URLSearchParams(window.location.search).get('autoPopulate') === 'true';
          if (hasValidMeasurements && autoPopulateParam) {
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

  // Auto-populate line items when autoPopulate parameter is present
  useEffect(() => {
    const autoPopulate = searchParams.get('autoPopulate') === 'true';
    
    console.log('🔍 Auto-populate check:', {
      autoPopulate,
      hasMeasurementData: !!measurementData,
      hasMeasurements,
      autoPopulateRan,
      propertyDetails,
      shouldRun: autoPopulate && measurementData && hasMeasurements && !autoPopulateRan
    });
    
    if (autoPopulate && measurementData && hasMeasurements && !autoPopulateRan) {
      console.log('✅ Running auto-populate...');
      autoPopulateLineItems();
      setAutoPopulateRan(true);
    }
  }, [searchParams, measurementData, hasMeasurements, autoPopulateRan]);

  const autoPopulateLineItems = useCallback(() => {
    // 📊 Performance Monitoring: Start timing
    const autoPopStartTime = Date.now();
    console.log('🔧 Starting auto-populate with data:', {
      measurementData,
      propertyDetails,
      excelConfig,
      hasMeasurements,
      timestamp: new Date().toISOString()
    });

    if (!measurementData) {
      console.warn('⚠️ No measurement data available');
      console.log('📊 Auto-population failed: No measurement data (duration: 0ms)');
      return;
    }

    // Calculate pitch multiplier (define early for fallback calculation)
    const pitchMultipliers: Record<string, number> = {
      'flat': 1.0000, '1/12': 1.0035, '2/12': 1.0138, '3/12': 1.0308,
      '4/12': 1.0541, '5/12': 1.0833, '6/12': 1.1180, '7/12': 1.1577,
      '8/12': 1.2019, '9/12': 1.2500, '10/12': 1.3017, '11/12': 1.3566, '12/12': 1.4142
    };

    const measurements = measurementData.comprehensive_measurements || measurementData;
    
    console.log('📊 Measurement structure:', {
      hasComprehensive: !!measurementData.comprehensive_measurements,
      adjustedSquares: measurements.adjustedSquares,
      summary: measurements.summary,
      linearFeatures: measurements.linear_features?.length || 0,
      tags: Object.keys(measurementData.tags || {}).length
    });

    // Try comprehensive_measurements first, then fallback to propertyDetails
    const totalSquares = measurements.adjustedSquares || 
                        measurements.summary?.total_squares || 
                        (measurements.summary?.total_area_sqft ? measurements.summary.total_area_sqft / 100 : 0) ||
                        ((propertyDetails.roof_area_sq_ft || 0) * (pitchMultipliers[propertyDetails.roof_pitch] || 1.05) * (1 + (excelConfig.waste_factor_percent / 100)) / 100);
    
    const wastePercent = measurements.adjustedWastePercent || measurements.summary?.waste_pct || excelConfig.waste_factor_percent;
    const pitch = measurements.adjustedPitch || measurements.summary?.pitch || propertyDetails.roof_pitch;
    const pitchMultiplier = pitchMultipliers[pitch] || 1.0541;
    
    console.log('📐 Using measurements:', {
      totalSquares: totalSquares.toFixed(2),
      pitch,
      wastePercent,
      pitchMultiplier
    });
    
    // Get linear features from comprehensive_measurements or tags
    // Handle both object format { ridge: 40, hip: 40 } and array format [{ type: 'ridge', length_ft: 40 }]
    const linearFeatures = measurements.linear_features || {};
    
    const getLinearFt = (type: string): number => {
      // Check if it's an array format
      if (Array.isArray(linearFeatures)) {
        return linearFeatures
          .filter((f: any) => f.type === type)
          .reduce((sum: number, f: any) => sum + (f.length_ft || 0), 0);
      }
      // Object format - direct property access
      if (typeof linearFeatures === 'object' && linearFeatures !== null) {
        return linearFeatures[type] || 0;
      }
      return 0;
    };
    
    const ridgeFt = getLinearFt('ridge') || measurementData?.tags?.['lf.ridge'] || 0;
    const hipFt = getLinearFt('hip') || measurementData?.tags?.['lf.hip'] || 0;
    const valleyFt = getLinearFt('valley') || measurementData?.tags?.['lf.valley'] || 0;
    const eaveFt = getLinearFt('eave') || measurementData?.tags?.['lf.eave'] || 0;
    const rakeFt = getLinearFt('rake') || measurementData?.tags?.['lf.rake'] || 0;
    const perimeterFt = measurements.adjustedPerimeter || measurements.summary?.perimeter || (eaveFt + rakeFt) || 0;
    
    console.log('📏 Linear features:', {
      ridgeFt: ridgeFt.toFixed(0),
      hipFt: hipFt.toFixed(0),
      valleyFt: valleyFt.toFixed(0),
      eaveFt: eaveFt.toFixed(0),
      rakeFt: rakeFt.toFixed(0),
      perimeterFt: perimeterFt.toFixed(0)
    });

    if (totalSquares === 0) {
      console.error('❌ Cannot auto-populate: total_squares is zero');
      toast({
        title: "Auto-Population Failed",
        description: "Measurement data is incomplete. Please verify measurements first.",
        variant: "destructive",
      });
      return;
    }
    
    const newLineItems: LineItem[] = [
      {
        item_category: 'material',
        item_name: 'Asphalt Shingles',
        description: `Architectural shingles (${totalSquares.toFixed(1)} squares with ${wastePercent}% waste)`,
        quantity: totalSquares,
        unit_cost: 150,
        unit_type: 'square',
        markup_percent: 25,
        sku: 'SHINGLE-ARCH-001',
        last_price_updated: new Date().toISOString()
      },
      {
        item_category: 'material',
        item_name: 'Ridge Cap',
        description: `Hip & Ridge cap shingles (${(ridgeFt + hipFt).toFixed(0)} ft ÷ 3)`,
        quantity: Math.max(1, Math.ceil((ridgeFt + hipFt) / 3)), // 3 ft per bundle, min 1
        unit_cost: 45,
        unit_type: 'bundle',
        markup_percent: 25,
        sku: 'RIDGE-CAP-001',
        last_price_updated: new Date().toISOString()
      },
      {
        item_category: 'material',
        item_name: 'Starter Strip',
        description: `Starter strip shingles (${(eaveFt + rakeFt).toFixed(0)} ft)`,
        quantity: Math.max(1, Math.ceil((eaveFt + rakeFt) / 100)), // 100 ft per bundle
        unit_cost: 35,
        unit_type: 'bundle',
        markup_percent: 25,
        sku: 'STARTER-001',
        last_price_updated: new Date().toISOString()
      },
      {
        item_category: 'material',
        item_name: 'Ice & Water Shield',
        description: `Ice & water barrier (${(valleyFt + eaveFt * 0.25).toFixed(0)} ft coverage)`,
        quantity: Math.max(1, Math.ceil((valleyFt + (eaveFt * 0.25)) / 65)), // 65 ft per roll
        unit_cost: 85,
        unit_type: 'roll',
        markup_percent: 25,
        sku: 'ICE-WATER-001',
        last_price_updated: new Date().toISOString()
      },
      {
        item_category: 'material',
        item_name: 'Drip Edge',
        description: `Aluminum drip edge (${perimeterFt.toFixed(0)} ft perimeter)`,
        quantity: Math.max(1, Math.ceil(perimeterFt / 10)), // 10 ft pieces
        unit_cost: 8,
        unit_type: 'piece',
        markup_percent: 25,
        sku: 'DRIP-EDGE-001',
        last_price_updated: new Date().toISOString()
      },
    ];
    
    if (valleyFt > 0) {
      newLineItems.push({
        item_category: 'material',
        item_name: 'Valley Material',
        description: `Valley flashing (${valleyFt.toFixed(0)} ft)`,
        quantity: Math.ceil(valleyFt / 10),
        unit_cost: 15,
        unit_type: 'piece',
        markup_percent: 25,
        sku: 'VALLEY-001',
        last_price_updated: new Date().toISOString()
      });
    }
    
    console.log('✅ Auto-populated line items:', newLineItems);
    setLineItems(newLineItems);
    
    // 📊 Performance Monitoring: Calculate validation metrics
    const autoPopEndTime = Date.now();
    const autoPopDuration = autoPopEndTime - autoPopStartTime;
    
    const validationResults = {
      expectedItems: 6,
      actualItems: newLineItems.length,
      allQuantitiesValid: newLineItems.every(item => item.quantity > 0),
      totalSquares: totalSquares.toFixed(2),
      duration: autoPopDuration,
      target: 1000,
      status: autoPopDuration < 1000 ? 'PASS' : 'SLOW'
    };
    
    console.log(`📊 Auto-population validation:`, validationResults);
    
    if (autoPopDuration > 1000) {
      console.warn(`⚠️ Slow auto-population: ${autoPopDuration}ms (target: <1000ms)`);
    }
    
    toast({
      title: "Materials Auto-Populated",
      description: `${newLineItems.length} line items added from measurements`,
    });

    // Trigger calculation automatically
    setTimeout(() => {
      calculateEstimate();
    }, 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measurementData, propertyDetails, excelConfig, toast]);

  const loadTemplates = async () => {
    try {
      const { data, error } = await supabase
        .from('estimate_templates')
        .select('id, name, roof_type, template_data, is_active')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setTemplates(data || []);
    } catch (error: any) {
      console.error('Error loading templates:', error);
    }
  };

  // Auto-populate line items when template is selected
  const handleTemplateSelect = (selectedTemplateId: string) => {
    setTemplateId(selectedTemplateId);
    
    if (!selectedTemplateId) return;
    
    const template = templates.find((t: any) => t.id === selectedTemplateId);
    if (!template?.template_data) return;
    
    const templateData = template.template_data as any;
    const roofArea = propertyDetails.roof_area_sq_ft || 0;
    
    // Helper to evaluate formula with roof_area
    const evaluateFormula = (formula: string, roofAreaSqFt: number): number => {
      try {
        // Replace roof_area with actual value and evaluate
        const expression = formula.replace(/roof_area/g, roofAreaSqFt.toString());
        // Safe eval for simple math expressions
        return Function(`"use strict"; return (${expression})`)();
      } catch {
        return 0;
      }
    };
    
    const newLineItems: LineItem[] = [];
    
    // Add materials
    if (templateData.materials && Array.isArray(templateData.materials)) {
      templateData.materials.forEach((material: any) => {
        newLineItems.push({
          item_category: 'material',
          item_name: material.item || material.name || 'Material',
          description: `${material.item || material.name} (${template.name})`,
          quantity: evaluateFormula(material.formula || '0', roofArea),
          unit_cost: material.unit_cost || 0,
          unit_type: material.unit || 'each',
          markup_percent: 25,
          sku: '',
          last_price_updated: new Date().toISOString()
        });
      });
    }
    
    // Add labor
    if (templateData.labor && Array.isArray(templateData.labor)) {
      templateData.labor.forEach((labor: any) => {
        newLineItems.push({
          item_category: 'labor',
          item_name: labor.task || labor.name || 'Labor',
          description: `${labor.task || labor.name} (${template.name})`,
          quantity: evaluateFormula(labor.formula || '0', roofArea),
          unit_cost: labor.rate || 0,
          unit_type: labor.unit || 'hour',
          markup_percent: 0,
          sku: '',
          last_price_updated: new Date().toISOString()
        });
      });
    }
    
    if (newLineItems.length > 0) {
      setLineItems(newLineItems);
      if (editingEstimateId) setHasUnsavedChanges(true);
      
      toast({
        title: "Template Applied",
        description: `${newLineItems.length} items loaded from "${template.name}"`,
      });
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
          property_details,
          status,
          created_at,
          template_id
        `)
        .eq('pipeline_entry_id', pipelineEntryId)
        .order('created_at', { ascending: false });
        
      if (!error && data) {
        // Enrich with template names from estimate_templates
        const enrichedData = await Promise.all(data.map(async (estimate: any) => {
          let templateName = null;
          if (estimate.template_id) {
            const { data: template } = await supabase
              .from('estimate_templates')
              .select('name')
              .eq('id', estimate.template_id)
              .single();
            templateName = template?.name;
          }
          return { 
            ...estimate, 
            template_name: templateName,
            roof_type: estimate.property_details?.roof_type 
          };
        }));
        setSavedEstimates(enrichedData);
      }
    } catch (error: any) {
      console.error('Error loading saved estimates:', error);
    }
  };

  const addLineItem = (category?: string) => {
    if (category) {
      // Direct add with specified category
      setLineItems(prev => [...prev, {
        item_category: category,
        item_name: '',
        description: '',
        quantity: 1,
        unit_cost: 0,
        unit_type: category === 'labor' ? 'hour' : 'each',
        markup_percent: 25
      }]);
      if (editingEstimateId) setHasUnsavedChanges(true);
    } else {
      // Open dialog for selection
      setShowAddLineDialog(true);
      if (editingEstimateId) setHasUnsavedChanges(true);
    }
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
    
    // 📊 Performance Monitoring: Start timing
    const saveStartTime = Date.now();
    console.log('💾 Starting estimate save:', {
      pipelineEntryId,
      lineItemCount: lineItems.length,
      sellingPrice: calculationResults.selling_price,
      timestamp: new Date().toISOString()
    });
    
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

      // 📊 Performance Monitoring: Record save time
      const saveEndTime = Date.now();
      const saveDuration = saveEndTime - saveStartTime;
      
      console.log('📊 Estimate save success:', {
        duration: saveDuration,
        estimateNumber,
        lineItemCount: lineItems.length,
        totalCost: calculationResults.selling_price,
        target: 2000,
        status: saveDuration < 2000 ? 'PASS' : 'SLOW'
      });
      
      if (saveDuration > 2000) {
        console.warn(`⚠️ Slow estimate save: ${saveDuration}ms (target: <2000ms)`);
      }

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
      const saveEndTime = Date.now();
      const saveDuration = saveEndTime - saveStartTime;
      
      console.error('📊 Estimate save failed:', {
        duration: saveDuration,
        error: error.message,
        lineItemCount: lineItems.length
      });
      
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

  const handleRefreshPricing = async () => {
    const itemsWithSKU = lineItems.filter(item => item.sku && item.sku.trim());
    
    if (itemsWithSKU.length === 0) {
      toast({
        title: "No SKUs Found",
        description: "Add SKUs to line items to refresh pricing",
        variant: "destructive"
      });
      return;
    }

    console.log('🔄 Refreshing pricing for items:', itemsWithSKU);

    try {
      const pricingItems = itemsWithSKU.map(item => ({
        sku: item.sku,
        item_description: item.item_name,
        quantity: item.quantity,
        unit_price: item.unit_cost,
        last_price_updated: item.last_price_updated
      }));

      const enrichedItems = await fetchLivePricing(pricingItems);
      
      // Track price changes for variance warnings
      const significantChanges: string[] = [];
      
      // Update line items with new pricing
      setLineItems(prev => prev.map(item => {
        if (!item.sku) return item;
        
        const enriched = enrichedItems.find(e => e.sku === item.sku);
        if (!enriched || !enriched.live_price) return item;

        const variance = enriched.price_variance_pct || 0;
        if (Math.abs(variance) > 10) {
          significantChanges.push(`${item.item_name}: ${variance > 0 ? '+' : ''}${variance.toFixed(1)}%`);
        }

        return {
          ...item,
          unit_cost: enriched.live_price,
          last_price_updated: enriched.last_price_updated || new Date().toISOString()
        };
      }));

      // Show variance warnings
      if (significantChanges.length > 0) {
        toast({
          title: "⚠️ Significant Price Changes Detected",
          description: significantChanges.join(' | '),
          variant: "default"
        });
      }

      toast({
        title: "Pricing Updated",
        description: `${itemsWithSKU.length} items refreshed`,
      });
      
      if (editingEstimateId) setHasUnsavedChanges(true);

    } catch (error) {
      console.error('Error refreshing pricing:', error);
      toast({
        title: "Pricing Refresh Failed",
        description: "Could not update prices. Please try again.",
        variant: "destructive"
      });
    }
  };

  const isPriceStale = (lastUpdated?: string) => {
    if (!lastUpdated) return false;
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return new Date(lastUpdated) < twentyFourHoursAgo;
  };

  const formatLastUpdated = (lastUpdated?: string) => {
    if (!lastUpdated) return 'Never updated';
    const date = new Date(lastUpdated);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return 'Just now';
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  // Filter and sort saved estimates
  const getFilteredAndSortedEstimates = () => {
    let filtered = [...savedEstimates];

    // Apply status filter
    if (filterStatus !== 'all') {
      filtered = filtered.filter(est => est.status === filterStatus);
    }

    // Apply roof type filter
    if (filterRoofType !== 'all') {
      filtered = filtered.filter(est => est.roof_type === filterRoofType);
    }

    // Apply sorting
    switch (sortBy) {
      case 'date_desc':
        filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        break;
      case 'date_asc':
        filtered.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        break;
      case 'price_desc':
        filtered.sort((a, b) => b.selling_price - a.selling_price);
        break;
      case 'price_asc':
        filtered.sort((a, b) => a.selling_price - b.selling_price);
        break;
      case 'profit_desc':
        filtered.sort((a, b) => (b.actual_profit_percent || 0) - (a.actual_profit_percent || 0));
        break;
      case 'profit_asc':
        filtered.sort((a, b) => (a.actual_profit_percent || 0) - (b.actual_profit_percent || 0));
        break;
    }

    return filtered;
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
                      address={propertyDetails.customer_address}
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

            </CardContent>
          </Card>

          {/* Measurement Summary Card */}
          <MeasurementSummaryCard />

          {/* Line Items - Only show after template is selected */}
          {templateId && (
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle className="text-lg">Line Items</CardTitle>
                  <div className="flex gap-2">
                    <Button 
                      onClick={handleRefreshPricing} 
                      size="sm" 
                      variant="secondary"
                      disabled={livePricingRefreshing || lineItems.every(item => !item.sku)}
                    >
                      {livePricingRefreshing ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-2" />
                      )}
                      Refresh Pricing
                    </Button>
                    <Button onClick={() => setShowAddFromLibraryDialog(true)} size="sm" variant="outline">
                      <Plus className="h-4 w-4 mr-2" />
                      Add from Library
                    </Button>
                    <Button onClick={() => addLineItem()} size="sm" variant="ghost">
                      <Plus className="h-4 w-4 mr-2" />
                      Custom Item
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Materials Section */}
                {lineItems.some(item => item.item_category === 'material') && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 pb-2 border-b border-border">
                      <div className="h-5 w-5 rounded bg-blue-500/20 flex items-center justify-center">
                        <span className="text-xs">📦</span>
                      </div>
                      <span className="font-semibold text-sm">Materials</span>
                      <Badge variant="secondary" className="ml-auto text-xs">
                        {lineItems.filter(item => item.item_category === 'material').length} items
                      </Badge>
                    </div>
                    {lineItems.map((item, index) => (
                      item.item_category === 'material' && (
                        <LineItemRow 
                          key={index} 
                          item={item} 
                          index={index}
                          updateLineItem={updateLineItem}
                          removeLineItem={removeLineItem}
                          lineItemsCount={lineItems.length}
                          isPriceStale={isPriceStale}
                          formatLastUpdated={formatLastUpdated}
                        />
                      )
                    ))}
                    <Button
                      onClick={() => addLineItem('material')}
                      size="sm"
                      variant="ghost"
                      className="w-full border-dashed border"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Material
                    </Button>
                  </div>
                )}

                {/* Labor Section */}
                {lineItems.some(item => item.item_category === 'labor') && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 pb-2 border-b border-border">
                      <div className="h-5 w-5 rounded bg-green-500/20 flex items-center justify-center">
                        <span className="text-xs">👷</span>
                      </div>
                      <span className="font-semibold text-sm">Labor</span>
                      <Badge variant="secondary" className="ml-auto text-xs">
                        {lineItems.filter(item => item.item_category === 'labor').length} items
                      </Badge>
                    </div>
                    {lineItems.map((item, index) => (
                      item.item_category === 'labor' && (
                        <LineItemRow 
                          key={index} 
                          item={item} 
                          index={index}
                          updateLineItem={updateLineItem}
                          removeLineItem={removeLineItem}
                          lineItemsCount={lineItems.length}
                          isPriceStale={isPriceStale}
                          formatLastUpdated={formatLastUpdated}
                        />
                      )
                    ))}
                    <Button
                      onClick={() => addLineItem('labor')}
                      size="sm"
                      variant="ghost"
                      className="w-full border-dashed border"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Labor
                    </Button>
                  </div>
                )}

                {/* Other Items (equipment, other) */}
                {lineItems.some(item => !['material', 'labor'].includes(item.item_category)) && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 pb-2 border-b border-border">
                      <div className="h-5 w-5 rounded bg-orange-500/20 flex items-center justify-center">
                        <span className="text-xs">🔧</span>
                      </div>
                      <span className="font-semibold text-sm">Other</span>
                    </div>
                    {lineItems.map((item, index) => (
                      !['material', 'labor'].includes(item.item_category) && (
                        <LineItemRow 
                          key={index} 
                          item={item} 
                          index={index}
                          updateLineItem={updateLineItem}
                          removeLineItem={removeLineItem}
                          lineItemsCount={lineItems.length}
                          isPriceStale={isPriceStale}
                          formatLastUpdated={formatLastUpdated}
                        />
                      )
                    ))}
                  </div>
                )}

                {/* Show empty state if no items after template selection */}
                {lineItems.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>No line items yet. Add materials or labor to build your estimate.</p>
                    <div className="flex gap-2 justify-center mt-4">
                      <Button onClick={() => addLineItem('material')} size="sm" variant="outline">
                        <Plus className="h-4 w-4 mr-2" />
                        Add Material
                      </Button>
                      <Button onClick={() => addLineItem('labor')} size="sm" variant="outline">
                        <Plus className="h-4 w-4 mr-2" />
                        Add Labor
                      </Button>
                    </div>
                  </div>
                )}
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
                <Select value={templateId} onValueChange={handleTemplateSelect}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select template to auto-populate items" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((template: any) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name} {template.roof_type && `(${template.roof_type})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {templates.length === 0 && (
                  <p className="text-xs text-muted-foreground">No templates available</p>
                )}
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

              {/* Your Pre-Cap Commission - Auto-calculated from logged-in user's profile */}
              <PreCapCommissionCard 
                calculationResults={calculationResults}
                formatCurrency={formatCurrency}
              />

              <Button 
                onClick={calculateEstimate} 
                disabled={calculating || !propertyDetails.roof_area_sq_ft}
                className="w-full"
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
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-sm text-muted-foreground">Material Total:</span>
                    <p className="text-base font-medium">{formatCurrency(calculationResults.material_total)}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Labor Total:</span>
                    <p className="text-base font-medium">{formatCurrency(calculationResults.labor_total)}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Subtotal:</span>
                    <p className="text-base font-medium">{formatCurrency(calculationResults.subtotal)}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Overhead:</span>
                    <p className="text-base font-medium">{formatCurrency(calculationResults.overhead_amount)}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Commission:</span>
                    <p className="text-base font-medium">{formatCurrency(calculationResults.sales_rep_commission_amount)}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Profit:</span>
                    <p className="text-base font-medium">{formatCurrency(calculationResults.target_profit_amount)}</p>
                  </div>
                </div>

                <Separator className="my-4" />

                <div className="text-center py-2">
                  <div className="text-sm text-muted-foreground mb-1">Total Selling Price</div>
                  <div className="text-4xl font-bold text-primary">
                    {formatCurrency(calculationResults.selling_price)}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {formatCurrency(calculationResults.price_per_sq_ft)}/sq ft
                  </div>
                </div>

                <div className="text-xs text-muted-foreground space-y-1 bg-muted/30 p-3 rounded-md">
                  <p><span className="font-medium text-primary">Guaranteed Margin:</span> {calculationResults.actual_profit_percent?.toFixed(1)}%</p>
                  <p><span className="font-medium">Labor Hours:</span> {calculationResults.labor_hours?.toFixed(1)}</p>
                  <p><span className="font-medium">Waste Factor:</span> {calculationResults.waste_factor_percent || 10}%</p>
                  <p><span className="font-medium">Overhead on Selling Price:</span> {calculationResults.overhead_percent?.toFixed(1)}%</p>
                </div>

                <Separator className="my-4" />

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
                      Save Estimate
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
        <div className="space-y-4">
          {/* Filter and Sort Controls */}
          <Card>
            <CardContent className="pt-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Status Filter */}
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Filter by Status</Label>
                  <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Roof Type Filter */}
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Filter by Roof Type</Label>
                  <Select value={filterRoofType} onValueChange={setFilterRoofType}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Roof Types</SelectItem>
                      <SelectItem value="asphalt_shingle">Asphalt Shingle</SelectItem>
                      <SelectItem value="metal">Metal</SelectItem>
                      <SelectItem value="tile">Tile</SelectItem>
                      <SelectItem value="flat">Flat</SelectItem>
                      <SelectItem value="slate">Slate</SelectItem>
                      <SelectItem value="wood_shake">Wood Shake</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Sort By */}
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Sort By</Label>
                  <Select value={sortBy} onValueChange={setSortBy}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="date_desc">Newest First</SelectItem>
                      <SelectItem value="date_asc">Oldest First</SelectItem>
                      <SelectItem value="price_desc">Highest Price</SelectItem>
                      <SelectItem value="price_asc">Lowest Price</SelectItem>
                      <SelectItem value="profit_desc">Highest Profit %</SelectItem>
                      <SelectItem value="profit_asc">Lowest Profit %</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Active Filters Summary */}
              {(filterStatus !== 'all' || filterRoofType !== 'all') && (
                <div className="flex items-center gap-2 mt-3 pt-3 border-t">
                  <span className="text-xs text-muted-foreground">Active filters:</span>
                  {filterStatus !== 'all' && (
                    <Badge variant="secondary" className="text-xs">
                      Status: {filterStatus}
                    </Badge>
                  )}
                  {filterRoofType !== 'all' && (
                    <Badge variant="secondary" className="text-xs">
                      Type: {filterRoofType.replace('_', ' ')}
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs ml-auto"
                    onClick={() => {
                      setFilterStatus('all');
                      setFilterRoofType('all');
                    }}
                  >
                    Clear Filters
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Estimates List */}
          <div className="space-y-3">
            {getFilteredAndSortedEstimates().length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-8">
                  <FileText className="h-10 w-10 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">No estimates match your filters</p>
                  <Button
                    variant="link"
                    size="sm"
                    className="mt-2"
                    onClick={() => {
                      setFilterStatus('all');
                      setFilterRoofType('all');
                    }}
                  >
                    Clear filters to see all estimates
                  </Button>
                </CardContent>
              </Card>
            ) : (
              getFilteredAndSortedEstimates().map((estimate) => (
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
              ))
            )}
          </div>
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

      <AddFromLibraryDialog
        open={showAddFromLibraryDialog}
        onClose={() => setShowAddFromLibraryDialog(false)}
        tenantId=""
        onAddItems={(items) => {
          items.forEach(item => {
            setLineItems(prev => [...prev, item]);
          });
          if (editingEstimateId) setHasUnsavedChanges(true);
        }}
        measurementTags={measurementData?.tags || {}}
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