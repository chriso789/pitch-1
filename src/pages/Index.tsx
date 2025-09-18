import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Session, User } from '@supabase/supabase-js';
import Dashboard from "@/components/Dashboard";
import EnhancedDashboard from "@/components/EnhancedDashboard";
import Sidebar from "@/components/Sidebar";
import Pipeline from "@/components/Pipeline";
import Production from "@/components/Production";
import EstimatePreview from "@/components/EstimatePreview";
import Estimates from "@/components/Estimates";
import Projects from "@/components/Projects";
import JobCalendar from "@/components/JobCalendar";
import { Contacts } from "@/components/Contacts";
import { Settings } from "@/components/Settings";
import Auth from "@/components/Auth";
import { CollapsibleSidebar } from "@/components/ui/collapsible-sidebar";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const Index = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-muted/20 to-primary/5">
        <div className="flex items-center space-x-2">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span>Loading PITCH...</span>
        </div>
      </div>
    );
  }

  if (!session || !user) {
    return <Auth onAuthSuccess={() => {}} />;
  }

  const renderActiveSection = () => {
    switch (activeSection) {
      case "dashboard":
        return <EnhancedDashboard />;
      case "pipeline":
        return <Pipeline />;
      case "production":
        return <Production />;
      case "estimates":
        return <Estimates />;
      case "contacts":
        return <Contacts />;
      case "projects":
        return <Projects />;
      case "payments":
        return <div className="p-8 text-center text-muted-foreground">Payments section coming soon...</div>;
      case "calendar":
        return <JobCalendar />;
      case "dialer":
        return <div className="p-8 text-center text-muted-foreground">Dialer section coming soon...</div>;
      case "settings":
        return <Settings />;
      case "security":
        return <div className="p-8 text-center text-muted-foreground">Security section coming soon...</div>;
      case "help":
        return <div className="p-8 text-center text-muted-foreground">Help section coming soon...</div>;
      default:
        return <EnhancedDashboard />;
    }
  };

  return (
    <div className="flex h-screen bg-background w-full">
      {/* Collapsible Sidebar */}
      <div className="relative">
        <Sidebar 
          activeSection={activeSection} 
          onSectionChange={setActiveSection}
          isCollapsed={sidebarCollapsed}
        />
        {/* Sidebar Toggle Button */}
        <Button
          variant="ghost"
          size="sm"
          className="absolute -right-3 top-6 z-10 h-6 w-6 rounded-full border bg-background shadow-md hover:bg-accent"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          {sidebarCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>
      
      <main className="flex-1 overflow-auto">
        <div className="p-6">
          {renderActiveSection()}
        </div>
      </main>
    </div>
  );
};

export default Index;
