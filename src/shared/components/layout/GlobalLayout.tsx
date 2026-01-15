import React from "react";
import { CollapsibleSidebar } from "@/components/ui/collapsible-sidebar";
import Sidebar from "./Sidebar";
import { CLJSearchBar } from "@/components/CLJSearchBar";
import { CompanySwitcher } from "@/components/layout/CompanySwitcher";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
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
          <div className={cn(
            "flex h-14 md:h-16 items-center gap-2 md:gap-4 justify-between",
            isMobile ? "px-14 pr-3" : "px-6" // Leave space for mobile menu button
          )}>
            <CLJSearchBar />
            <div className="flex items-center gap-1 md:gap-2">
              <NotificationCenter />
              <CompanySwitcher />
            </div>
          </div>
        </div>
        <div className={cn(
          "p-3 md:p-6",
          "pb-32 md:pb-16" // Extra 30% scroll room at bottom
        )}>
          {children}
        </div>
      </main>
    </div>
  );
};
