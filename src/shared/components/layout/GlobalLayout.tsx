import React from "react";
import { CollapsibleSidebar } from "@/components/ui/collapsible-sidebar";
import Sidebar from "./Sidebar";

interface GlobalLayoutProps {
  children: React.ReactNode;
  activeSection: string;
  onSectionChange: (section: string) => void;
}

export const GlobalLayout = ({ children, activeSection, onSectionChange }: GlobalLayoutProps) => {
  return (
    <div className="flex min-h-screen w-full">
      <CollapsibleSidebar>
        <Sidebar 
          activeSection={activeSection} 
          onSectionChange={onSectionChange}
        />
      </CollapsibleSidebar>
      <main className="flex-1 overflow-auto">
        <div className="p-6">
          {children}
        </div>
      </main>
    </div>
  );
};