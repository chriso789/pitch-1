import React, { useState, useEffect } from "react";
import { 
  Home, 
  Users, 
  FileText, 
  DollarSign, 
  Calendar, 
  Settings, 
  Phone,
  MapPin,
  TrendingUp,
  Shield,
  HelpCircle,
  Wrench,
  Code,
  BookOpen,
  LogOut
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";

interface SidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
  isCollapsed?: boolean;
}

const Sidebar = ({ activeSection, onSectionChange, isCollapsed = false }: SidebarProps) => {
  const { toast } = useToast();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentTenant, setCurrentTenant] = useState<any>(null);

  useEffect(() => {
    loadUserInfo();
  }, []);

  const loadUserInfo = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();
        
        setCurrentUser(profile);
      }
    } catch (error) {
      console.error('Error loading user info:', error);
    }
  };

  const handleSignOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      
      toast({
        title: "Signed out successfully",
        description: "You have been logged out of the system.",
      });
    } catch (error: any) {
      console.error('Sign out error:', error);
      toast({
        title: "Sign out failed",
        description: error.message || "An error occurred while signing out",
        variant: "destructive",
      });
    }
  };

  const navigation = [
    {
      name: "Dashboard",
      href: "dashboard",
      icon: Home,
      description: "Overview & metrics"
    },
    {
      name: "Pipeline",
      href: "pipeline", 
      icon: TrendingUp,
      description: "Lead management"
    },
    {
      name: "Contacts",
      href: "contacts",
      icon: Users,
      description: "Customer database"
    },
    {
      name: "Estimates",
      href: "estimates",
      icon: FileText,
      description: "Pricing & proposals"
    },
    {
      name: "Projects",
      href: "projects",
      icon: MapPin,
      description: "Active jobs"
    },
    {
      name: "Production",
      href: "production",
      icon: Wrench,
      description: "Job tracking"
    },
    {
      name: "Payments", 
      href: "payments",
      icon: DollarSign,
      description: "Billing & revenue"
    },
    {
      name: "Calendar",
      href: "calendar",
      icon: Calendar,
      description: "Schedule & appointments"
    },
    {
      name: "Dialer",
      href: "dialer",
      icon: Phone,
      description: "AI calling system"
    },
    {
      name: "Smart Docs",
      href: "smartdocs",
      icon: BookOpen,
      description: "Document templates & library"
    }
  ];

  const bottomNavigation = [
    {
      name: "Settings",
      href: "settings",
      icon: Settings,
      description: "System configuration"
    },
    {
      name: "Security",
      href: "security", 
      icon: Shield,
      description: "Access & permissions"
    },
    {
      name: "Help",
      href: "help",
      icon: HelpCircle,
      description: "Support & documentation"
    }
  ];

  return (
    <div className={cn(
      "bg-card border-r border-border shadow-soft h-screen flex flex-col transition-all duration-300",
      isCollapsed ? "w-16" : "w-64"
    )}>
      {/* Logo & Header */}
      <div className={cn("border-b border-border", isCollapsed ? "p-2" : "p-6")}>
        <div className={cn("flex items-center", isCollapsed ? "justify-center" : "gap-3")}>
          <div className="w-10 h-10 gradient-primary rounded-lg flex items-center justify-center">
            <Home className="h-6 w-6 text-white" />
          </div>
          {!isCollapsed && (
            <div>
              <h1 className="text-xl font-bold gradient-primary bg-clip-text text-transparent">
                PITCH
              </h1>
              <p className="text-xs text-muted-foreground">Roofing CRM</p>
            </div>
          )}
        </div>
      </div>

      {/* Main Navigation */}
      <div className="flex-1 p-4">
        <nav className="space-y-2">
          {navigation.map((item) => (
            <button
              key={item.href}
              onClick={() => onSectionChange(item.href)}
              className={cn(
                "w-full flex items-center rounded-lg text-left transition-smooth group",
                isCollapsed ? "px-2 py-2.5 justify-center" : "gap-3 px-3 py-2.5",
                activeSection === item.href
                  ? "bg-primary text-primary-foreground shadow-soft"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
              title={isCollapsed ? item.name : undefined}
            >
              <item.icon className={cn(
                "h-5 w-5",
                activeSection === item.href 
                  ? "text-primary-foreground" 
                  : "text-muted-foreground group-hover:text-accent-foreground"
              )} />
              {!isCollapsed && (
                <div className="flex-1">
                  <div className="font-medium">{item.name}</div>
                  <div className={cn(
                    "text-xs",
                    activeSection === item.href
                      ? "text-primary-foreground/80"
                      : "text-muted-foreground group-hover:text-accent-foreground/80"
                  )}>
                    {item.description}
                  </div>
                </div>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Bottom Navigation */}
      <div className="p-4 border-t border-border">
        <nav className="space-y-2">
          {bottomNavigation.map((item) => (
            <button
              key={item.href}
              onClick={() => onSectionChange(item.href)}
              className={cn(
                "w-full flex items-center rounded-lg text-left transition-smooth group",
                isCollapsed ? "px-2 py-2.5 justify-center" : "gap-3 px-3 py-2.5",
                activeSection === item.href
                  ? "bg-primary text-primary-foreground shadow-soft"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
              title={isCollapsed ? item.name : undefined}
            >
              <item.icon className={cn(
                "h-4 w-4",
                activeSection === item.href 
                  ? "text-primary-foreground" 
                  : "text-muted-foreground group-hover:text-accent-foreground"
              )} />
              {!isCollapsed && (
                <div className="flex-1">
                  <div className="text-sm font-medium">{item.name}</div>
                  <div className={cn(
                    "text-xs",
                    activeSection === item.href
                      ? "text-primary-foreground/80"
                      : "text-muted-foreground group-hover:text-accent-foreground/80"
                  )}>
                    {item.description}
                  </div>
                </div>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* User Info */}
      <div className="p-4 border-t border-border bg-muted/30">
        <div className={cn("flex items-center", isCollapsed ? "justify-center" : "gap-3")}>
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
            <span className="text-sm font-bold text-primary-foreground">
              {currentUser?.first_name?.[0] || 'U'}{currentUser?.last_name?.[0] || ''}
            </span>
          </div>
          {!isCollapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">
                {currentUser?.first_name} {currentUser?.last_name}
                {currentUser?.is_developer && (
                  <Code className="inline h-3 w-3 ml-1 text-destructive" />
                )}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {currentUser?.title || 'User'}
              </div>
              <div className="text-xs text-muted-foreground/80 truncate">
                {currentUser?.company_name || 'Company'}
              </div>
            </div>
          )}
        </div>
        
        {/* Sign Out Button */}
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "w-full mt-2 text-red-600 hover:text-red-700 hover:bg-red-50",
            isCollapsed ? "px-2" : "justify-start"
          )}
          onClick={handleSignOut}
          title={isCollapsed ? "Sign Out" : undefined}
        >
          <LogOut className="h-4 w-4" />
          {!isCollapsed && <span className="ml-2">Sign Out</span>}
        </Button>
      </div>
    </div>
  );
};

export default Sidebar;