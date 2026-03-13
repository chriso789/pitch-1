import React from "react";
import { CollapsibleSidebar } from "@/components/ui/collapsible-sidebar";
import Sidebar from "./Sidebar";
import { CLJSearchBar } from "@/components/CLJSearchBar";
import { CompanySwitcher } from "@/components/layout/CompanySwitcher";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { QuickLocationSwitcher } from "@/components/layout/QuickLocationSwitcher";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { isMobileApp } from "@/utils/mobileDetection";

interface GlobalLayoutProps {
  children: React.ReactNode;
}

export const GlobalLayout = ({ children }: GlobalLayoutProps) => {
  const isMobile = useIsMobile();
  const isNative = isMobileApp();
  const isNativeLaunch = typeof window !== 'undefined' && sessionStorage.getItem('pitch_native_launch') === 'true';
  return (
    <div className="flex min-h-screen w-full">
      <CollapsibleSidebar>
        <Sidebar />
      </CollapsibleSidebar>
      <main className={cn(
        "flex-1 overflow-auto",
        isMobile && "pt-14" // Add padding for mobile menu button
      )}>
        <div className="border-b glass-heavy sticky top-0 z-40 shadow-[0_1px_3px_hsl(214_100%_25%/0.06),0_4px_12px_hsl(214_100%_25%/0.04)]">
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
