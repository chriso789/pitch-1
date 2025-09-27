import React from "react";
import { ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ActionsSelectorProps {
  actions: Array<{
    label: string;
    icon?: React.ComponentType<{ className?: string }>;
    onClick?: () => void;
    variant?: 'default' | 'destructive';
    separator?: boolean;
    disabled?: boolean;
  }>;
  className?: string;
}

export const ActionsSelector: React.FC<ActionsSelectorProps> = ({ 
  actions, 
  className 
}) => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="outline" 
          size="sm" 
          className={cn(
            "h-8 min-w-[80px] justify-between bg-background hover:bg-accent",
            className
          )}
        >
          <span className="text-muted-foreground">Actions</span>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {actions.map((action, index) => (
          <React.Fragment key={index}>
            {action.separator && <DropdownMenuSeparator />}
            <DropdownMenuItem 
              onClick={action.onClick}
              disabled={action.disabled}
              className={cn(
                action.variant === 'destructive' && "text-destructive focus:text-destructive"
              )}
            >
              {action.icon && (
                <action.icon className="mr-2 h-4 w-4" />
              )}
              {action.label}
            </DropdownMenuItem>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};