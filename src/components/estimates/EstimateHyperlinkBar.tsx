import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { 
  Calculator, 
  MapPin, 
  Package, 
  Hammer, 
  Settings, 
  TrendingUp, 
  DollarSign,
  RefreshCw,
  FileText
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface HyperlinkBarData {
  estimate_id: string;
  currency: string;
  ready: boolean;
  template_bound: boolean;
  measurements_present: boolean;
  squares: number;
  materials: number;
  labor: number;
  overhead: number;
  cost_pre_profit: number;
  mode: string;
  margin_pct: number;
  sale_price: number;
  profit: number;
  sections: Array<{
    key: string;
    label: string;
    amount: number;
    pending: boolean;
    extra?: any;
  }>;
}

interface EstimateCalculations {
  measurements?: {
    roof_area_sq_ft: number;
    squares: number;
    has_template: boolean;
  };
  materials_cost: number;
  labor_cost: number;
  overhead_amount: number;
  profit_amount: number;
  selling_price: number;
  is_ready: boolean;
  margin_percent: number;
}

interface EstimateHyperlinkBarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
  pipelineEntryId?: string;
  calculations?: EstimateCalculations;
  className?: string;
}

const EstimateHyperlinkBar: React.FC<EstimateHyperlinkBarProps> = ({
  activeSection,
  onSectionChange,
  pipelineEntryId,
  calculations,
  className
}) => {
  const [hyperlinkData, setHyperlinkData] = useState<HyperlinkBarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [measuringRoof, setMeasuringRoof] = useState(false);
  const [salesRepOverheadRate, setSalesRepOverheadRate] = useState<number>(0);
  const { toast } = useToast();

  // Fetch hyperlink bar data using the new RPC function
  useEffect(() => {
    const fetchHyperlinkData = async () => {
      if (!pipelineEntryId) {
        setLoading(false);
        return;
      }
      
      try {
        const { data, error } = await supabase
          .rpc('api_estimate_hyperlink_bar', { p_estimate_id: pipelineEntryId });

        if (error) throw error;

        if (data) {
          setHyperlinkData(data as unknown as HyperlinkBarData);
        }
      } catch (error) {
        console.error('Error fetching hyperlink data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchHyperlinkData();
  }, [pipelineEntryId]);

  // Fetch sales rep's overhead rate
  useEffect(() => {
    const fetchSalesRepOverhead = async () => {
      if (!pipelineEntryId) return;
      
      try {
        // Get pipeline entry with assigned sales rep
        const { data: pipelineEntry, error: pipelineError } = await supabase
          .from('pipeline_entries')
          .select('assigned_to, profiles!pipeline_entries_assigned_to_fkey(personal_overhead_rate)')
          .eq('id', pipelineEntryId)
          .single();

        if (pipelineError) throw pipelineError;

        if (pipelineEntry?.profiles?.personal_overhead_rate) {
          setSalesRepOverheadRate(pipelineEntry.profiles.personal_overhead_rate);
        }
      } catch (error) {
        console.error('Error fetching sales rep overhead:', error);
      }
    };

    fetchSalesRepOverhead();
  }, [pipelineEntryId]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatSquares = (sqft: number) => {
    const squares = sqft / 100;
    return `${squares.toFixed(1)} sq`;
  };

  const handleRefreshMeasurements = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!pipelineEntryId || measuringRoof) return;

    setMeasuringRoof(true);
    toast({
      title: "Updating Measurements",
      description: "Fetching latest roof measurements from satellite data...",
    });

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No session');

      // Get property coordinates from pipeline entry
      const { data: pipelineEntry, error: entryError } = await supabase
        .from('pipeline_entries')
        .select('id, contacts(latitude, longitude, address_street, address_city, address_state, address_zip, verified_address)')
        .eq('id', pipelineEntryId)
        .single();

      if (entryError || !pipelineEntry) {
        throw new Error('Failed to fetch pipeline entry');
      }

      const contact = pipelineEntry.contacts as any;
      const verifiedAddress = contact?.verified_address as any;
      
      // Get coordinates - prefer verified address, fall back to contact coordinates
      const lat = verifiedAddress?.geometry?.location?.lat || contact?.latitude;
      const lng = verifiedAddress?.geometry?.location?.lng || contact?.longitude;
      
      if (!lat || !lng) {
        throw new Error('No coordinates available. Please verify the property address first.');
      }

      const address = verifiedAddress?.formatted_address || 
        `${contact?.address_street || ''}, ${contact?.address_city || ''}, ${contact?.address_state || ''} ${contact?.address_zip || ''}`.trim();

      // Use the existing measure function with 'pull' action
      const response = await supabase.functions.invoke('measure', {
        body: { 
          action: 'pull',
          propertyId: pipelineEntryId,
          lat,
          lng,
          address
        }
      });

      if (response.error) throw response.error;
      if (!response.data?.ok) throw new Error(response.data?.error || 'Measurement failed');

      const source = response.data?.data?.measurement?.source || 'satellite';
      toast({
        title: "Measurements Updated",
        description: `Source: ${source}`,
      });

      // Refresh the hyperlink data
      const { data } = await supabase
        .rpc('api_estimate_hyperlink_bar', { p_estimate_id: pipelineEntryId });
      if (data) setHyperlinkData(data as unknown as HyperlinkBarData);

    } catch (error) {
      console.error('Measurement update error:', error);
      toast({
        title: "Measurement Update Failed",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive"
      });
    } finally {
      setMeasuringRoof(false);
    }
  };

  // Use RPC data if available, otherwise fallback to passed calculations
  const isReady = hyperlinkData?.ready || !!(calculations?.materials_cost && calculations?.labor_cost);

  const getIconForSection = (key: string) => {
    switch (key) {
      case 'estimate': return Calculator;
      case 'measurements': return MapPin;
      case 'materials': return Package;
      case 'labor': return Hammer;
      case 'overhead': return Settings;
      case 'profit': return TrendingUp;
      case 'total': return DollarSign;
      case 'documents': return FileText;
      default: return Calculator;
    }
  };

  // Calculate overhead based on sales rep's personal overhead rate
  const calculateRepOverhead = () => {
    if (!salesRepOverheadRate) return 0;
    const salePrice = hyperlinkData?.sale_price || calculations?.selling_price || 0;
    return salePrice * (salesRepOverheadRate / 100);
  };

  // Use sections from RPC if available, otherwise build fallback
  const links = hyperlinkData ? [
    {
      id: 'documents',
      label: 'Documents',
      icon: FileText,
      value: '—',
      hint: null,
      description: 'Project documents and files'
    },
    ...hyperlinkData.sections
      .filter(section => section.key === 'measurements')
      .map(section => ({
        id: section.key,
        label: section.label,
        icon: getIconForSection(section.key),
        value: section.extra?.squares ? formatSquares(section.extra.squares) : '—',
        hint: section.pending ? 'Pending' : null,
        description: getDescriptionForSection(section.key)
      })),
    {
      id: 'estimate',
      label: 'Estimate',
      icon: Calculator,
      value: formatSquares(hyperlinkData.squares),
      hint: !hyperlinkData.template_bound ? 'Select template' : null,
      description: 'Estimate templates and calculations'
    },
    ...hyperlinkData.sections
      .filter(section => section.key !== 'measurements')
      .map(section => ({
      id: section.key,
      label: section.key === 'materials' || section.key === 'labor'
        ? `${section.label}: ${formatCurrency(section.amount)}`
        : section.label,
      icon: getIconForSection(section.key),
      value: section.key === 'profit'
        ? `${Math.round(hyperlinkData.margin_pct || 30)}%`
        : section.key === 'overhead'
        ? formatCurrency(calculateRepOverhead())
        : formatCurrency(section.amount),
      hint: section.pending 
        ? 'Pending' 
        : section.key === 'overhead' && salesRepOverheadRate 
        ? `Rep: ${salesRepOverheadRate}%` 
        : null,
      description: getDescriptionForSection(section.key)
    }))
  ] : [
    {
      id: 'documents',
      label: 'Documents',
      icon: FileText,
      value: '—',
      hint: null,
      description: 'Project documents and files'
    },
    {
      id: 'measurements',
      label: 'Measurements',
      icon: MapPin,
      value: calculations?.measurements?.has_template ? '✓ Mapped' : '—',
      hint: !calculations?.measurements?.has_template ? 'Bind to template' : null,
      description: 'Roof measurements and template mapping'
    },
    {
      id: 'estimate',
      label: 'Estimate',
      icon: Calculator,
      value: calculations?.measurements?.roof_area_sq_ft 
        ? formatSquares(calculations.measurements.roof_area_sq_ft)
        : '—',
      hint: calculations?.measurements?.has_template ? null : 'Select template',
      description: 'Estimate templates and calculations'
    },
    {
      id: 'materials',
      label: `Materials: ${formatCurrency(calculations?.materials_cost || 0)}`,
      icon: Package,
      value: formatCurrency(calculations?.materials_cost || 0),
      hint: !isReady ? 'Pending template' : null,
      description: 'Material costs and specifications'
    },
    {
      id: 'labor',
      label: `Labor: ${formatCurrency(calculations?.labor_cost || 0)}`,
      icon: Hammer,
      value: formatCurrency(calculations?.labor_cost || 0),
      hint: !isReady ? 'Pending template' : null,
      description: 'Labor costs per square'
    },
    {
      id: 'overhead',
      label: 'Overhead',
      icon: Settings,
      value: formatCurrency(calculateRepOverhead() || calculations?.overhead_amount || 0),
      hint: !isReady 
        ? 'Pending calculations' 
        : salesRepOverheadRate 
        ? `Rep: ${salesRepOverheadRate}%` 
        : null,
      description: 'Overhead and administrative costs'
    },
    {
      id: 'profit',
      label: 'Profit',
      icon: TrendingUp,
      value: calculations?.margin_percent 
        ? `${Math.round(calculations.margin_percent)}%` 
        : '30%',
      hint: !isReady ? 'Set after costs ready' : null,
      description: 'Target gross margin percentage'
    },
    {
      id: 'total',
      label: 'Total',
      icon: DollarSign,
      value: formatCurrency(calculations?.selling_price || 0),
      hint: !isReady ? 'Final price pending' : null,
      description: 'Final selling price with guaranteed margin'
    }
  ];

  function getDescriptionForSection(key: string) {
    switch (key) {
      case 'documents': return 'Project documents and files';
      case 'estimate': return 'Estimate templates and calculations';
      case 'measurements': return 'Roof measurements and template mapping';
      case 'materials': return 'Material costs and specifications';
      case 'labor': return 'Labor costs per square';
      case 'overhead': return 'Overhead and administrative costs';
      case 'profit': return 'Target gross margin percentage';
      case 'total': return 'Final selling price with guaranteed margin';
      default: return '';
    }
  }

  return (
    <nav 
      className={cn(
        "flex justify-space-evenly bg-card border border-border rounded-lg p-2",
        className
      )}
      role="navigation"
      aria-label="Estimate sections"
    >
      {links.map((link) => {
        const IconComponent = link.icon;
        const isActive = activeSection === link.id;
        const isPending = link.hint !== null;
        
        return (
          <a
            key={link.id}
            href={`#${link.id}`}
            onClick={(e) => {
              e.preventDefault();
              onSectionChange(link.id);
            }}
            className={cn(
              "flex-1 flex flex-col items-center p-3 rounded-md text-center transition-all duration-200",
              "hover:bg-accent hover:text-accent-foreground",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              isActive && "bg-primary text-primary-foreground",
              isPending && !isActive && "text-muted-foreground"
            )}
            aria-current={isActive ? "page" : undefined}
            title={link.description}
          >
            <div className="flex items-center space-x-1 mb-1">
              <IconComponent className="h-4 w-4" />
              <span className="text-sm font-medium truncate">{link.label}</span>
              {link.id === 'measurements' && pipelineEntryId && (
                <button
                  onClick={handleRefreshMeasurements}
                  disabled={measuringRoof}
                  className={cn(
                    "ml-1 p-0.5 rounded hover:bg-primary/10 transition-colors",
                    measuringRoof && "animate-spin"
                  )}
                  title="Refresh measurements from satellite data"
                >
                  <RefreshCw className="h-3 w-3" />
                </button>
              )}
            </div>
            
            <div className="flex items-center space-x-1">
              <span className={cn(
                "text-sm font-semibold",
                isActive ? "text-primary-foreground" : "text-foreground"
              )}>
                {link.value}
              </span>
              {link.hint && (
                <span className="text-xs text-muted-foreground/70 truncate max-w-[60px]">
                  {link.hint}
                </span>
              )}
            </div>
          </a>
        );
      })}
    </nav>
  );
};

export default EstimateHyperlinkBar;
