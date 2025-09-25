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
import { ClientList } from "@/components/ClientList";
import { Dialer } from "@/components/Dialer";
import SmartDocs from "@/components/SmartDocs";
import { LeadSources } from "@/components/LeadSources";
import { LeadScoring } from "@/components/LeadScoring";
import { LeadNurturing } from "@/components/LeadNurturing";
import { DuplicateDetection } from "@/components/DuplicateDetection";
import { EnhancedPipeline } from "@/components/EnhancedPipeline";
import { PipelineStageManager } from "@/components/PipelineStageManager";
import { CollapsibleSidebar } from "@/components/ui/collapsible-sidebar";
import { DeveloperToolbar } from "@/components/DeveloperToolbar";
import { useLocationPermission } from "@/hooks/useLocationPermission";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import DemoWalkthrough from "@/components/DemoWalkthrough";

const Index = () => {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { requestLocationPermission } = useLocationPermission();

  useEffect(() => {
    let mounted = true;
    
    // Set up auth state listener FIRST to avoid missing events
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;
        
        console.log('Auth state changed:', event, session?.user?.email);
        
        if (event === 'SIGNED_OUT' || !session) {
          console.log('User signed out, redirecting to login');
          setSession(null);
          setUser(null);
          setProfile(null);
          setLoading(false);
          navigate('/login');
        } else if (event === 'SIGNED_IN' && session) {
          console.log('User signed in, fetching profile');
          setSession(session);
          setUser(session.user);
          
          // Fetch user profile asynchronously to avoid deadlock
          setTimeout(async () => {
            if (!mounted) return;
            
            try {
              const { data: profileData } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', session.user.id)
                .maybeSingle();
                
              if (mounted && profileData) {
                setProfile(profileData);
                
                // Request location permission after successful login
                setTimeout(() => {
                  requestLocationPermission();
                }, 1000);
              }
            } catch (error) {
              console.error('Error fetching profile:', error);
            } finally {
              if (mounted) {
                setLoading(false);
              }
            }
          }, 0);
        }
      }
    );

    // THEN check for existing session
    const initAuth = async () => {
      if (!mounted) return;
      
      try {
        console.log('Checking for existing session...');
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!mounted) return;
        
        if (!session) {
          console.log('No existing session, redirecting to login');
          setLoading(false);
          navigate('/login');
          return;
        }

        console.log('Existing session found:', session.user.email);
        setSession(session);
        setUser(session.user);

        // Fetch user profile
        try {
          const { data: profileData } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .maybeSingle();
            
          if (mounted && profileData) {
            setProfile(profileData);
            
            // Request location permission after loading existing session
            setTimeout(() => {
              requestLocationPermission();
            }, 1000);
          }
        } catch (error) {
          console.error('Error fetching profile:', error);
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
        if (mounted) {
          navigate('/login');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    initAuth();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-muted/20 to-primary/5">
        <div className="flex flex-col items-center space-y-4">
          <div className="flex items-center space-x-2">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span>Loading PITCH...</span>
          </div>
          <p className="text-sm text-muted-foreground">Authenticating and setting up your workspace</p>
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
      case "client-list":
        return <ClientList />;
      case "lead-sources":
        return <LeadSources />;
      case "lead-scoring":
        return <LeadScoring />;
      case "lead-nurturing":
        return <LeadNurturing />;
      case "duplicates":
        return <DuplicateDetection />;
      case "enhanced-pipeline":
        return <EnhancedPipeline />;
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
      <DemoWalkthrough />
      <PipelineStageManager />
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
      
      {/* Developer Toolbar - Only shows in developer mode */}
      <DeveloperToolbar />
    </div>
  );
};

export default Index;
