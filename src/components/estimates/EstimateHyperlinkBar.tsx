import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { 
  FileText, 
  MapPin, 
  Package, 
  Hammer, 
  Settings, 
  TrendingUp, 
  DollarSign 
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

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
  const [costData, setCostData] = useState<any>(null);

  // Fetch current cost calculations from the new database system
  useEffect(() => {
    const fetchCostData = async () => {
      if (!pipelineEntryId) return;
      
      try {
        // Get estimate ID from pipeline entry
        const { data: estimates } = await supabase
          .from('estimates')
          .select('id')
          .eq('pipeline_entry_id', pipelineEntryId)
          .maybeSingle();

        if (estimates?.id) {
          // Fetch computed costs
          const { data: costs } = await supabase
            .from('estimate_costs')
            .select('*')
            .eq('estimate_id', estimates.id)
            .maybeSingle();

          if (costs) {
            setCostData(costs);
          }
        }
      } catch (error) {
        console.error('Error fetching cost data:', error);
      }
    };

    fetchCostData();
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

  // Use either new cost data or fallback to passed calculations
  const currentData = costData || calculations;
  const isReady = !!(currentData?.materials && currentData?.labor);

  const links = [
    {
      id: 'overview',
      label: 'Overview',
      icon: FileText,
      value: currentData?.measurements?.roof_area_sq_ft 
        ? formatSquares(currentData.measurements.roof_area_sq_ft)
        : '—',
      hint: currentData?.measurements?.roof_area_sq_ft ? null : 'Set measurements',
      description: 'Project overview and details'
    },
    {
      id: 'measurements',
      label: 'Measurements',
      icon: MapPin,
      value: currentData?.measurements?.has_template ? '✓ Mapped' : '—',
      hint: !currentData?.measurements?.has_template ? 'Bind to template' : null,
      description: 'Roof measurements and template mapping'
    },
    {
      id: 'materials',
      label: 'Materials',
      icon: Package,
      value: formatCurrency(currentData?.materials || 0),
      hint: !isReady ? 'Pending template' : null,
      description: 'Material costs and specifications'
    },
    {
      id: 'labor',
      label: 'Labor',
      icon: Hammer,
      value: formatCurrency(currentData?.labor || 0),
      hint: !isReady ? 'Pending template' : null,
      description: 'Labor costs per square'
    },
    {
      id: 'overhead',
      label: 'Overhead',
      icon: Settings,
      value: formatCurrency(currentData?.overhead || 0),
      hint: !isReady ? 'Pending calculations' : null,
      description: 'Overhead and administrative costs'
    },
    {
      id: 'profit',
      label: 'Profit',
      icon: TrendingUp,
      value: currentData?.margin_pct 
        ? `${Math.round(currentData.margin_pct * 100)}%` 
        : '30%',
      hint: !isReady ? 'Set after costs ready' : null,
      description: 'Target gross margin percentage'
    },
    {
      id: 'total',
      label: 'Total',
      icon: DollarSign,
      value: formatCurrency(currentData?.sale_price || 0),
      hint: !isReady ? 'Final price pending' : null,
      description: 'Final selling price with guaranteed margin'
    }
  ];

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