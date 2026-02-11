import React from "react";
import { CollapsibleSidebar } from "@/components/ui/collapsible-sidebar";
import Sidebar from "./Sidebar";
import { CLJSearchBar } from "@/components/CLJSearchBar";
import { CompanySwitcher } from "@/components/layout/CompanySwitcher";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { QuickLocationSwitcher } from "@/components/layout/QuickLocationSwitcher";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

interface GlobalLayoutProps {
  children: React.ReactNode;
}

export const GlobalLayout = ({ children }: GlobalLayoutProps) => {
  const isMobile = useIsMobile();

  return (
    <div className="flex min-h-screen w-full">
      <CollapsibleSidebar>
        <Sidebar />
      </CollapsibleSidebar>
      <main className={cn(
        "flex-1 overflow-auto",
        isMobile && "pt-14" // Add padding for mobile menu button
      )}>
        <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40">
          {isMobile ? (
            /* Mobile: Two-row header */
            <div className="flex flex-col">
              {/* Row 1: Location switcher, notifications, company */}
              <div className="flex h-12 items-center gap-1 justify-between pl-14 pr-2">
                <QuickLocationSwitcher isCollapsed={false} />
                <div className="flex items-center gap-1">
                  <NotificationCenter />
                  <CompanySwitcher />
                </div>
              </div>
              {/* Row 2: Full-width search bar */}
              <div className="px-3 pb-2">
                <CLJSearchBar />
              </div>
            </div>
          ) : (
            /* Desktop: Single-row header (unchanged) */
            <div className="flex h-16 items-center gap-4 justify-between px-6">
              <CLJSearchBar />
              <div className="flex items-center gap-2">
                <NotificationCenter />
                <CompanySwitcher />
              </div>
            </div>
          )}
        </div>
        <div className={cn(
          "p-3 md:p-6",
          "pb-32 md:pb-16"
        )}>
          {children}
        </div>
      </main>
    </div>
  );
};
