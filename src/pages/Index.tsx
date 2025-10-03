import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Session, User } from '@supabase/supabase-js';
import Sidebar from "@/shared/components/layout/Sidebar";
import KanbanPipeline from "@/features/pipeline/components/KanbanPipeline";
import Pipeline from "@/features/pipeline/components/Pipeline";
import { DeveloperSnippetTool } from "@/components/DeveloperSnippetTool";
import { Production } from "@/features/production";
import EstimatePreview from "@/features/estimates/components/EstimatePreview";
import Estimates from "@/features/estimates/components/Estimates";
import Dashboard from "@/features/dashboard/components/Dashboard";
import { Projects } from "@/features/projects";
import { Payments } from "@/features/payments";
import { JobCalendar } from "@/features/jobs";
import { Contacts } from "@/features/contacts/components/Contacts";
import { Settings } from "@/features/settings";
import { EnhancedClientList } from "@/features/contacts";
import { Dialer } from "@/features/communication";
import { SmartDocs } from "@/features/documents";
import { LeadSources, LeadScoring, LeadNurturing } from "@/features/leads";
import { DuplicateDetection } from "@/features/contacts/components/DuplicateDetection";
import { EnhancedPipeline } from "@/features/pipeline/components/EnhancedPipeline";
import { PipelineStageManager } from "@/features/pipeline/components/PipelineStageManager";
import { CollapsibleSidebar } from "@/components/ui/collapsible-sidebar";
import { DeveloperToolbar } from "@/shared/components/DeveloperToolbar";
import { useLocationPermission } from "@/hooks/useLocationPermission";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import DemoWalkthrough from "@/shared/components/DemoWalkthrough";
import ComprehensiveWalkthrough from "@/shared/components/ComprehensiveWalkthrough";
import StormCanvassPro from "./StormCanvassPro";

const Index = () => {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState("dashboard");
  const [dialerContact, setDialerContact] = useState<any>(null);
  const [loadingContact, setLoadingContact] = useState(false);
  const [showDeveloperTool, setShowDeveloperTool] = useState(false);

  // Handle URL parameters for section and contact routing
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const section = urlParams.get('section');
    const contactId = urlParams.get('contact');
    
    if (section) {
      setActiveSection(section);
    }
    
    if (contactId && section === 'dialer') {
      fetchContactForDialer(contactId);
    }
  }, []);

  // Fetch contact data for dialer
  const fetchContactForDialer = async (contactId: string) => {
    setLoadingContact(true);
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', contactId)
        .single();
        
      if (!error && data) {
        setDialerContact(data);
      } else {
        console.error('Error fetching contact:', error);
      }
    } catch (error) {
      console.error('Error fetching contact:', error);
    } finally {
      setLoadingContact(false);
    }
  };
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showWalkthrough, setShowWalkthrough] = useState(false);
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

    // Listen for walkthrough test trigger from floating button
    const handleStartTest = () => {
      setShowWalkthrough(true);
      setTimeout(() => {
        const event = new CustomEvent('start-walkthrough-test');
        window.dispatchEvent(event);
      }, 100);
    };

    // Check URL params for test trigger
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('test') === 'true') {
      setTimeout(handleStartTest, 1000);
    }

    window.addEventListener('start-walkthrough-test', handleStartTest);

    // Add developer tool shortcut listener (Ctrl + Alt + E)
    const handleKeyboardShortcut = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key === 'E' && profile?.role === 'master') {
        e.preventDefault();
        setShowDeveloperTool(true);
      }
    };

    window.addEventListener('keydown', handleKeyboardShortcut);

    return () => {
      mounted = false;
      subscription.unsubscribe();
      window.removeEventListener('start-walkthrough-test', handleStartTest);
      window.removeEventListener('keydown', handleKeyboardShortcut);
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
        return <Dashboard />;
      case "pipeline":
        return <Pipeline />;
      case "production":
        return <Production />;
      case "estimates":
        return <Estimates />;
      case "client-list":
        return <EnhancedClientList />;
      case "lead-sources":
        return <LeadSources />;
      case "lead-scoring":
        return <LeadScoring />;
      case "lead-nurturing":
        return <LeadNurturing />;
      case "duplicates":
        return <DuplicateDetection />;
      case "projects":
        return <Projects />;
      case "payments":
        return <Payments />;
      case "calendar":
        return <JobCalendar />;
      case "storm-canvass":
        return <StormCanvassPro />;
      case "dialer":
        return <Dialer preloadedContact={dialerContact} isLoadingContact={loadingContact} />;
      case "smartdocs":
        return <SmartDocs />;
      case "settings":
        return <Settings />;
      case "security":
        return <div className="p-8 text-center text-muted-foreground">Security section coming soon...</div>;
      case "help":
        return <div className="p-8 text-center text-muted-foreground">Help section coming soon...</div>;
      default:
        return <div>Dashboard placeholder</div>;
    }
  };

  return (
    <div className="flex h-screen bg-background w-full">
        <DemoWalkthrough />
        {showWalkthrough && (
          <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
            <div className="fixed left-[50%] top-[50%] z-50 grid w-full max-w-4xl translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 sm:rounded-lg">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">System Test & Walkthrough</h2>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setShowWalkthrough(false)}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Close
                </Button>
              </div>
              <ComprehensiveWalkthrough onSectionChange={setActiveSection} />
            </div>
          </div>
        )}
      <PipelineStageManager />
      {/* Collapsible Sidebar */}
      <div className="relative">
        <Sidebar 
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
      
      {/* Developer Snippet Tool - Only for master users */}
      {profile?.role === 'master' && (
        <DeveloperSnippetTool
          isOpen={showDeveloperTool}
          onClose={() => setShowDeveloperTool(false)}
        />
      )}
    </div>
  );
};

export default Index;
