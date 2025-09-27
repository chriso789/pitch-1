import React from 'react';
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
  calculations: EstimateCalculations;
  className?: string;
}

const EstimateHyperlinkBar: React.FC<EstimateHyperlinkBarProps> = ({
  activeSection,
  onSectionChange,
  calculations,
  className
}) => {
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

  const links = [
    {
      id: 'overview',
      label: 'Overview',
      icon: FileText,
      value: calculations.measurements?.roof_area_sq_ft 
        ? formatSquares(calculations.measurements.roof_area_sq_ft)
        : '—',
      hint: calculations.measurements?.roof_area_sq_ft ? null : 'Set measurements',
      description: 'Project overview and details'
    },
    {
      id: 'measurements',
      label: 'Measurements',
      icon: MapPin,
      value: calculations.measurements?.has_template ? '✓ Mapped' : '—',
      hint: !calculations.measurements?.has_template ? 'Bind to template' : null,
      description: 'Roof measurements and template mapping'
    },
    {
      id: 'materials',
      label: 'Materials',
      icon: Package,
      value: calculations.is_ready ? formatCurrency(calculations.materials_cost) : '$0',
      hint: !calculations.is_ready ? 'Pending' : null,
      description: 'Material costs and specifications'
    },
    {
      id: 'labor',
      label: 'Labor',
      icon: Hammer,
      value: calculations.is_ready ? formatCurrency(calculations.labor_cost) : '$0',
      hint: !calculations.is_ready ? 'Pending' : null,
      description: 'Labor costs per square'
    },
    {
      id: 'overhead',
      label: 'Overhead',
      icon: Settings,
      value: calculations.is_ready ? formatCurrency(calculations.overhead_amount) : '$0',
      hint: !calculations.is_ready ? 'Pending' : null,
      description: 'Overhead and administrative costs'
    },
    {
      id: 'profit',
      label: 'Profit',
      icon: TrendingUp,
      value: calculations.is_ready 
        ? `${calculations.margin_percent}%` 
        : '30%',
      hint: !calculations.is_ready ? 'Set after costs ready' : null,
      description: 'Target gross margin percentage'
    },
    {
      id: 'total',
      label: 'Total',
      icon: DollarSign,
      value: calculations.is_ready ? formatCurrency(calculations.selling_price) : '$0',
      hint: !calculations.is_ready ? 'Final price pending' : null,
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