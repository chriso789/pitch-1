import React, { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

interface CollapsibleSidebarProps {
  children: React.ReactNode;
  defaultCollapsed?: boolean;
}

export const CollapsibleSidebar = ({ children, defaultCollapsed = false }: CollapsibleSidebarProps) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const isMobile = useIsMobile();

  // Close mobile menu when navigating
  useEffect(() => {
    const handleRouteChange = () => setIsMobileOpen(false);
    window.addEventListener('popstate', handleRouteChange);
    return () => window.removeEventListener('popstate', handleRouteChange);
  }, []);

  // Mobile: Use Sheet drawer
  if (isMobile) {
    return (
      <>
        {/* Mobile Menu Button - Fixed position */}
        <Button
          variant="ghost"
          size="icon"
          className="fixed top-3 left-3 z-50 h-10 w-10 bg-background/80 backdrop-blur-sm border shadow-md md:hidden"
          onClick={() => setIsMobileOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </Button>

        {/* Mobile Sheet Drawer */}
        <Sheet open={isMobileOpen} onOpenChange={setIsMobileOpen}>
          <SheetContent side="left" className="p-0 w-72 bg-card">
            <div className="flex flex-col h-full">
              {React.cloneElement(children as React.ReactElement, { 
                isCollapsed: false,
                onNavigate: () => setIsMobileOpen(false)
              })}
            </div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  // Desktop: Collapsible sidebar
  return (
    <div className={cn(
      "relative bg-card border-r border-border shadow-soft h-screen flex flex-col transition-all duration-300 hidden md:flex",
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
