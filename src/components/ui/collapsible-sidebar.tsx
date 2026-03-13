import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { ChevronLeft, ChevronRight, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

interface CollapsibleSidebarProps {
  children: React.ReactNode;
  defaultCollapsed?: boolean;
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
}

export const CollapsibleSidebar = ({ children, defaultCollapsed = false, mobileOpen, onMobileOpenChange }: CollapsibleSidebarProps) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const isMobile = useIsMobile();
  const location = useLocation();
  
  // Auto-collapse on settings page and lead details page
  const isSettingsRoute = location.pathname === '/settings' || location.pathname.startsWith('/settings/');
  const isLeadDetailsRoute = location.pathname.startsWith('/lead/');
  
  // Auto-collapse on detail pages that need more screen space
  const shouldAutoCollapse = isSettingsRoute || isLeadDetailsRoute;
  
  useEffect(() => {
    if (shouldAutoCollapse && !isCollapsed) {
      setIsCollapsed(true);
    }
  }, [location.pathname, shouldAutoCollapse]);

  // Mobile: Use Sheet drawer (trigger is in GlobalLayout header)
  if (isMobile) {
    return (
      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent side="left" className="p-0 w-72 bg-card overflow-hidden">
          <div className="flex flex-col h-full overflow-y-auto overscroll-contain">
            {React.cloneElement(children as React.ReactElement, { 
              isCollapsed: false,
              onNavigate: () => onMobileOpenChange?.(false)
            })}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: Collapsible sidebar
  return (
    <div className={cn(
      "relative bg-card border-r border-border shadow-3d h-screen flex flex-col transition-all duration-300 hidden md:flex",
      isCollapsed ? "w-16" : "w-64"
    )}>
      {/* Toggle Button */}
      <Button
        variant="ghost"
        size="sm"
        className="absolute -right-3 top-6 z-10 h-6 w-6 rounded-full border bg-background shadow-3d hover:shadow-3d-hover hover:bg-accent"
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
