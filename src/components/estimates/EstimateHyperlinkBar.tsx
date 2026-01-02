import React from 'react';
import { cn } from '@/lib/utils';
import { 
  Calculator, 
  Package, 
  Hammer, 
  Settings, 
  TrendingUp, 
  DollarSign,
  FileText
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';

interface HyperlinkBarData {
  materials: number;
  labor: number;
  overhead: number;
  cost_pre_profit: number;
  profit: number;
  sale_price: number;
  margin_pct: number;
  mode: string;
  sections: {
    contract: { status: string };
    estimate: { status: string };
    materials: { status: string };
    labor: { status: string };
  };
  selected_estimate_id: string | null;
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
  // Fetch hyperlink bar data using useQuery for automatic refetch
  const { data: hyperlinkData } = useQuery({
    queryKey: ['hyperlink-data', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('api_estimate_hyperlink_bar', { p_pipeline_entry_id: pipelineEntryId });
      if (error) throw error;
      return data as unknown as HyperlinkBarData;
    },
    enabled: !!pipelineEntryId,
  });

  // Fetch sales rep's overhead rate
  const { data: salesRepData } = useQuery({
    queryKey: ['sales-rep-overhead', pipelineEntryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_entries')
        .select('assigned_to, profiles!pipeline_entries_assigned_to_fkey(personal_overhead_rate)')
        .eq('id', pipelineEntryId!)
        .single();
      if (error) throw error;
      return data?.profiles?.personal_overhead_rate || 0;
    },
    enabled: !!pipelineEntryId,
  });

  const salesRepOverheadRate = salesRepData || 0;

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

  // Check if an estimate is selected
  const hasSelectedEstimate = !!hyperlinkData?.selected_estimate_id;
  const isReady = hasSelectedEstimate || !!(calculations?.materials_cost && calculations?.labor_cost);

  const getIconForSection = (key: string) => {
    switch (key) {
      case 'estimate': return Calculator;
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
    if (!salesRepOverheadRate) return hyperlinkData?.overhead || 0;
    const salePrice = hyperlinkData?.sale_price || calculations?.selling_price || 0;
    return salePrice * (salesRepOverheadRate / 100);
  };

  // Build links from the new RPC response structure
  const links = hyperlinkData ? [
    {
      id: 'documents',
      label: 'Documents',
      icon: FileText,
      value: '—',
      hint: null,
      description: 'Project documents and files'
    },
    {
      id: 'estimate',
      label: 'Estimate',
      icon: Calculator,
      value: hasSelectedEstimate ? formatCurrency(hyperlinkData.sale_price) : '—',
      hint: !hasSelectedEstimate ? 'Select estimate' : null,
      description: 'Estimate templates and calculations'
    },
    {
      id: 'materials',
      label: `Materials: ${formatCurrency(hyperlinkData.materials)}`,
      icon: Package,
      value: formatCurrency(hyperlinkData.materials),
      hint: hyperlinkData.sections?.materials?.status === 'pending' ? 'Pending' : null,
      description: 'Material costs and specifications'
    },
    {
      id: 'labor',
      label: `Labor: ${formatCurrency(hyperlinkData.labor)}`,
      icon: Hammer,
      value: formatCurrency(hyperlinkData.labor),
      hint: hyperlinkData.sections?.labor?.status === 'pending' ? 'Pending' : null,
      description: 'Labor costs per square'
    },
    {
      id: 'overhead',
      label: 'Overhead',
      icon: Settings,
      value: formatCurrency(calculateRepOverhead()),
      hint: salesRepOverheadRate ? `Rep: ${salesRepOverheadRate}%` : null,
      description: 'Overhead and administrative costs'
    },
    {
      id: 'profit',
      label: 'Profit',
      icon: TrendingUp,
      value: `${Math.round(hyperlinkData.margin_pct || 30)}%`,
      hint: null,
      description: 'Target gross margin percentage'
    },
    {
      id: 'total',
      label: 'Total',
      icon: DollarSign,
      value: formatCurrency(hyperlinkData.sale_price),
      hint: null,
      description: 'Final selling price with guaranteed margin'
    }
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
