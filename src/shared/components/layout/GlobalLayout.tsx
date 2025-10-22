import React from "react";
import { CollapsibleSidebar } from "@/components/ui/collapsible-sidebar";
import Sidebar from "./Sidebar";
import { CLJSearchBar } from "@/components/CLJSearchBar";

interface GlobalLayoutProps {
  children: React.ReactNode;
}

export const GlobalLayout = ({ children }: GlobalLayoutProps) => {
  return (
    <div className="flex min-h-screen w-full">
      <CollapsibleSidebar>
        <Sidebar />
      </CollapsibleSidebar>
      <main className="flex-1 overflow-auto">
        <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex h-16 items-center px-6">
            <CLJSearchBar />
          </div>
        </div>
        <div className="p-6">
          {children}
        </div>
      </main>
    </div>
  );
};