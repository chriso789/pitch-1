import React from "react";
import { CollapsibleSidebar } from "@/components/ui/collapsible-sidebar";
import Sidebar from "./Sidebar";

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
        <div className="p-6">
          {children}
        </div>
      </main>
    </div>
  );
};