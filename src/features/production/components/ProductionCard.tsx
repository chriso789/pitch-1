import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GripVertical, AlertTriangle, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { CLJBadge } from "@/components/CLJBadge";

interface ProductionCardProps {
  id: string;
  project: {
    id: string;
    name: string;
    project_number: string;
    clj_formatted_number?: string;
    customer_name: string;
    customer_address: string;
    contract_value: number;
    amount_paid: number;
    balance_owed: number;
    stage: string;
    days_in_stage: number;
    created_at: string;
    contacts?: {
      id: string;
      first_name: string;
      last_name: string;
    };
  };
  onView: (contactId: string) => void;
  isDragging?: boolean;
}

export const ProductionCard: React.FC<ProductionCardProps> = ({ 
  id, 
  project, 
  onView, 
  isDragging = false 
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortableDragging ? 0.5 : 1,
  };

  // Get project number - use project_number or fallback
  const getProjectNumber = () => {
    return project.project_number || project.name || 'New Project';
  };

  // Get customer last name only
  const getCustomerName = () => {
    if (project.contacts?.last_name) {
      return project.contacts.last_name;
    }
    // Fallback to parsing customer_name
    const parts = project.customer_name.split(' ');
    return parts.length > 1 ? parts[parts.length - 1] : project.customer_name;
  };

  // Get status badge color based on days in stage
  const getStatusBadgeColor = () => {
    if (project.days_in_stage <= 7) return "bg-success/10 text-success border-success/20";
    if (project.days_in_stage <= 21) return "bg-warning/10 text-warning border-warning/20"; 
    return "bg-destructive/10 text-destructive border-destructive/20";
  };

  // Format currency
  const formatCurrency = (amount: number) => {
    if (!amount) return '$0';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const projectNumber = getProjectNumber();
  const customerName = getCustomerName();
  const isOverdue = project.days_in_stage > 14;
  const hasBalance = project.balance_owed > 0;

  return (
    <Card 
      ref={setNodeRef} 
      style={style}
      className={cn(
        "w-full min-w-0 max-w-full min-h-[90px] max-h-[110px]",
        "shadow-soft border-0 hover:shadow-medium transition-smooth",
        "cursor-grab active:cursor-grabbing",
        "relative group overflow-hidden",
        isDragging || isSortableDragging ? 'shadow-lg border-primary' : ''
      )}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        e.stopPropagation();
        if (project.contacts?.id) {
          onView(project.contacts.id);
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Project ${projectNumber}, ${customerName}, ${project.days_in_stage} days in stage`}
    >
      <CardContent className="p-2 h-full flex flex-col justify-between">
        {/* Row 1: Days Badge + CLJ Number + Overdue/Balance Alert */}
        <div className="flex items-center justify-between w-full mb-1">
          {/* Days in Stage Badge */}
          <Badge 
            className={cn(
              "text-[10px] px-1.5 py-0.5 border font-medium leading-none",
              getStatusBadgeColor()
            )}
          >
            {project.days_in_stage}d
          </Badge>

          {/* C-L-J Number - Centered */}
          <div className="flex-1 flex justify-center px-1 min-w-0">
            <CLJBadge 
              cljNumber={project.clj_formatted_number} 
              variant="outline" 
              size="sm"
            />
          </div>

          {/* Alert Badge */}
          <div className="flex items-center gap-1">
            {isOverdue && (
              <Badge 
                className="text-[8px] px-1 py-0.5 bg-destructive/10 text-destructive border-destructive/20 leading-none"
                title="Project overdue"
              >
                <AlertTriangle className="h-2 w-2" />
              </Badge>
            )}
            {hasBalance && (
              <Badge 
                className="text-[8px] px-1 py-0.5 bg-warning/10 text-warning border-warning/20 leading-none"
                title={`Balance: ${formatCurrency(project.balance_owed)}`}
              >
                <DollarSign className="h-2 w-2" />
              </Badge>
            )}
          </div>
        </div>

        {/* Row 2: Customer Name */}
        <div className="flex-1 flex items-center justify-center min-h-0">
          <div 
            className="text-center w-full min-w-0"
            title={customerName}
          >
            <span 
              className={cn(
                "font-medium text-foreground block truncate px-1",
                customerName.length > 15 ? "group-hover:text-clip" : ""
              )}
              style={{ fontSize: 'clamp(10px, 2.5vw, 13px)' }}
            >
              {customerName}
            </span>
          </div>
        </div>

        {/* Row 3: Contract Value */}
        <div className="flex items-center justify-center">
          <span 
            className="text-[10px] font-medium text-success"
            title={`Contract: ${formatCurrency(project.contract_value)}, Paid: ${formatCurrency(project.amount_paid)}`}
          >
            {formatCurrency(project.contract_value)}
          </span>
        </div>

        {/* Drag Handle */}
        <GripVertical 
          className="absolute top-0.5 right-0.5 h-2.5 w-2.5 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-hidden="true"
        />
      </CardContent>
    </Card>
  );
};