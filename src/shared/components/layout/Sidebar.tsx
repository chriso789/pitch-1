import React, { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
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
  LogOut,
  User,
  BarChart,
  Target,
  Mail,
  CloudRain,
  Presentation
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { useNavigate } from "react-router-dom";
import { TEST_IDS } from "@/../tests/utils/test-ids";
import { getRoleDisplayName } from "@/lib/roleUtils";

interface SidebarProps {
  isCollapsed?: boolean;
}

const Sidebar = ({ isCollapsed = false }: SidebarProps) => {
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentTenant, setCurrentTenant] = useState<any>(null);
  
  // Derive active section from current route
  const getActiveSection = () => {
    const path = location.pathname;
    if (path === '/' || path.startsWith('/dashboard')) return 'dashboard';
    if (path.startsWith('/pipeline')) return 'pipeline';
    if (path.startsWith('/contact') || path.startsWith('/lead') || path.startsWith('/client')) return 'client-list';
    if (path.startsWith('/jobs')) return 'jobs';
    if (path.startsWith('/estimates')) return 'estimates';
    if (path.startsWith('/production')) return 'production';
    if (path.startsWith('/calendar')) return 'calendar';
    if (path.startsWith('/storm-canvass')) return 'storm-canvass';
    if (path.startsWith('/dialer')) return 'dialer';
    if (path.startsWith('/smartdocs')) return 'smartdocs';
    if (path.startsWith('/presentations')) return 'presentations';
    if (path.startsWith('/settings')) return 'settings';
    if (path.startsWith('/help')) return 'help';
    return 'dashboard';
  };
  
  const activeSection = getActiveSection();

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
          .maybeSingle();
        
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
      
      // Navigate to login page
      navigate('/login');
    } catch (error: any) {
      console.error('Sign out error:', error);
      toast({
        title: "Sign out failed",
        description: error.message || "An error occurred while signing out",
        variant: "destructive",
      });
    }
  };

  const handleRoleChange = async (newRole: string) => {
    if (!currentUser) return;
    
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ role: newRole as any })
        .eq('id', currentUser.id);

      if (error) throw error;

      setCurrentUser({ ...currentUser, role: newRole });
      
      toast({
        title: "Role updated",
        description: `Your role has been changed to ${newRole}`,
      });
    } catch (error: any) {
      console.error('Role change error:', error);
      toast({
        title: "Role change failed",
        description: error.message || "Failed to update role",
        variant: "destructive",
      });
    }
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'master': return 'destructive';
      case 'corporate': return 'destructive';
      case 'office_admin': return 'default';
      case 'regional_manager': return 'default';
      case 'sales_manager': return 'secondary';
      case 'project_manager': return 'outline';
      default: return 'outline';
    }
  };

  const getAvailableRoles = () => {
    const allRoles = ['project_manager', 'sales_manager', 'regional_manager', 'office_admin', 'corporate'];
    if (currentUser?.is_developer || currentUser?.role === 'master') {
      allRoles.push('master');
    }
    return allRoles;
  };

  const navigation = [
    {
      name: "Dashboard",
      href: "dashboard",
      path: "/dashboard",
      icon: Home,
      description: "Overview & metrics",
      testId: TEST_IDS.sidebar.dashboard
    },
    {
      name: "Pipeline",
      href: "pipeline",
      path: "/pipeline",
      icon: TrendingUp,
      description: "Drag & drop sales pipeline",
      testId: TEST_IDS.sidebar.pipeline
    },
    {
      name: "Contacts",
      href: "client-list",
      path: "/client-list",
      icon: Users,
      description: "Contacts & jobs unified",
      testId: TEST_IDS.sidebar.contacts
    },
    {
      name: "Jobs",
      href: "jobs",
      path: "/jobs",
      icon: Wrench,
      description: "Job management",
      testId: TEST_IDS.sidebar.jobs
    },
    {
      name: "Estimates",
      href: "estimates",
      path: "/estimates",
      icon: FileText,
      description: "Estimate builder & tracking",
      testId: TEST_IDS.sidebar.estimates
    },
    {
      name: "Production",
      href: "production",
      path: "/production",
      icon: Target,
      description: "Production workflow"
    },
    {
      name: "Calendar",
      href: "calendar",
      path: "/calendar",
      icon: Calendar,
      description: "Schedule & appointments",
      testId: TEST_IDS.sidebar.calendar
    },
    {
      name: "Storm Canvass Pro",
      href: "storm-canvass",
      path: "/storm-canvass",
      icon: CloudRain,
      description: "Lead generation & canvassing"
    },
    {
      name: "Dialer",
      href: "dialer",
      path: "/dialer",
      icon: Phone,
      description: "AI calling system"
    },
    {
      name: "Smart Docs",
      href: "smartdocs",
      path: "/smartdocs",
      icon: BookOpen,
      description: "Document templates & library"
    },
    {
      name: "Presentations",
      href: "presentations",
      path: "/presentations",
      icon: Presentation,
      description: "Sales presentation builder"
    }
  ];

  const bottomNavigation = [
    {
      name: "Settings",
      href: "settings",
      path: "/settings",
      icon: Settings,
      description: "System configuration",
      testId: TEST_IDS.sidebar.settings
    },
    {
      name: "Help",
      href: "help",
      path: "/help",
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
            <Link
              key={item.href}
              to={item.path}
              data-testid={item.testId}
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
            </Link>
          ))}
        </nav>
      </div>

      {/* Bottom Navigation */}
      <div className="p-4 border-t border-border">
        <nav className="space-y-2">
          {bottomNavigation.map((item) => (
            <Link
              key={item.href}
              to={item.path}
              data-testid={item.testId}
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
            </Link>
          ))}
        </nav>
      </div>

      {/* User Info with Dropdown Menu */}
      <div className="p-4 border-t border-border bg-muted/30">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button 
              className={cn(
                "w-full flex items-center gap-3 p-2 rounded-lg hover:bg-accent transition-colors",
                isCollapsed ? "justify-center" : ""
              )}
              data-testid={TEST_IDS.sidebar.userMenu}
            >
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-primary-foreground">
                  {currentUser?.first_name?.[0] || 'U'}{currentUser?.last_name?.[0] || ''}
                </span>
              </div>
              {!isCollapsed && (
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-sm font-medium truncate">
                    {currentUser?.first_name} {currentUser?.last_name}
                    {currentUser?.is_developer && (
                      <Code className="inline h-3 w-3 ml-1 text-destructive" />
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {currentUser?.title || 'User'}
                  </div>
                </div>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium">
                  {currentUser?.first_name} {currentUser?.last_name}
                </p>
                <p className="text-xs text-muted-foreground">{currentUser?.email}</p>
                {currentUser?.role && (
                  <Badge variant={getRoleBadgeVariant(currentUser.role)} className="text-xs w-fit">
                    {getRoleDisplayName(currentUser.role)}
                  </Badge>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              onClick={() => navigate('/settings')}
              data-testid="user-menu-profile"
            >
              <User className="mr-2 h-4 w-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={() => navigate('/settings')}
              data-testid="user-menu-settings"
            >
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              onClick={handleSignOut}
              className="text-red-600 focus:text-red-600 focus:bg-red-50"
              data-testid="user-menu-logout"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};

export default Sidebar;