import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
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
import Payments from "@/components/Payments";
import JobCalendar from "@/components/JobCalendar";
import { Contacts } from "@/components/Contacts";
import { Settings } from "@/components/Settings";
import { Dialer } from "@/components/Dialer";
import SmartDocs from "@/components/SmartDocs";
import { LeadSources } from "@/components/LeadSources";
import { LeadScoring } from "@/components/LeadScoring";
import { CollapsibleSidebar } from "@/components/ui/collapsible-sidebar";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const Index = () => {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    const initAuth = async () => {
      try {
        // Get initial session
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session) {
          navigate('/login');
          return;
        }

        setSession(session);
        setUser(session.user);

        // Fetch user profile
        const { data: profileData } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .maybeSingle();
          
        if (profileData) {
          setProfile(profileData);
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
        navigate('/login');
      } finally {
        setLoading(false);
      }
    };

    initAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth state changed:', event, session?.user?.email);
        
        if (event === 'SIGNED_OUT' || !session) {
          setSession(null);
          setUser(null);
          setProfile(null);
          navigate('/login');
        } else if (event === 'SIGNED_IN' && session) {
          setSession(session);
          setUser(session.user);
          
          // Fetch user profile
          try {
            const { data: profileData } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', session.user.id)
              .maybeSingle();
              
            if (profileData) {
              setProfile(profileData);
            }
          } catch (error) {
            console.error('Error fetching profile:', error);
          }
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, [navigate]);

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
    // This should not happen as we redirect to login, but just in case
    return null;
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
      case "lead-sources":
        return <LeadSources />;
      case "lead-scoring":
        return <LeadScoring />;
      case "projects":
        return <Projects />;
      case "payments":
        return <Payments />;
      case "calendar":
        return <JobCalendar />;
      case "dialer":
        return <Dialer />;
      case "smartdocs":
        return <SmartDocs />;
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
