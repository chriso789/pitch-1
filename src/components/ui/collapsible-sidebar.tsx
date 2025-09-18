import React, { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CollapsibleSidebarProps {
  children: React.ReactNode;
  defaultCollapsed?: boolean;
}

export const CollapsibleSidebar = ({ children, defaultCollapsed = false }: CollapsibleSidebarProps) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  return (
    <div className={cn(
      "relative bg-card border-r border-border shadow-soft h-screen flex flex-col transition-all duration-300",
      isCollapsed ? "w-16" : "w-64"
    )}>
      {/* Toggle Button */}
      <Button
        variant="ghost"
        size="sm"
        className="absolute -right-3 top-6 z-10 h-6 w-6 rounded-full border bg-background shadow-md hover:bg-accent"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        {isCollapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronLeft className="h-4 w-4" />
        )}
      </Button>

      {/* Content */}
      <div className={cn("flex flex-col h-full", isCollapsed && "items-center")}>
        {React.cloneElement(children as React.ReactElement, { isCollapsed })}
      </div>
    </div>
  );
};