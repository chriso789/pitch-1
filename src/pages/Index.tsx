import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Session, User } from '@supabase/supabase-js';
import Dashboard from "@/components/Dashboard";
import Sidebar from "@/components/Sidebar";
import Pipeline from "@/components/Pipeline";
import EstimatePreview from "@/components/EstimatePreview";
import Auth from "@/components/Auth";
import { Loader2 } from "lucide-react";

const Index = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState("dashboard");

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
        return <Dashboard />;
      case "pipeline":
        return <Pipeline />;
      case "estimates":
        return <EstimatePreview />;
      case "contacts":
        return <div className="p-8 text-center text-muted-foreground">Contacts section coming soon...</div>;
      case "projects":
        return <div className="p-8 text-center text-muted-foreground">Projects section coming soon...</div>;
      case "payments":
        return <div className="p-8 text-center text-muted-foreground">Payments section coming soon...</div>;
      case "calendar":
        return <div className="p-8 text-center text-muted-foreground">Calendar section coming soon...</div>;
      case "dialer":
        return <div className="p-8 text-center text-muted-foreground">Dialer section coming soon...</div>;
      case "settings":
        return <div className="p-8 text-center text-muted-foreground">Settings section coming soon...</div>;
      case "security":
        return <div className="p-8 text-center text-muted-foreground">Security section coming soon...</div>;
      case "help":
        return <div className="p-8 text-center text-muted-foreground">Help section coming soon...</div>;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="flex h-screen bg-background">
      <Sidebar activeSection={activeSection} onSectionChange={setActiveSection} />
      <main className="flex-1 overflow-auto">
        <div className="p-6">
          {renderActiveSection()}
        </div>
      </main>
    </div>
  );
};

export default Index;
