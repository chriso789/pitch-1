import React from "react";
import { Link, useLocation } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation as useLocationContext } from "@/contexts/LocationContext";
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
  Presentation,
  HardHat,
  Activity,
  Building2,
  ChevronDown,
  ChevronRight,
  Inbox,
  MessageSquare,
  Bot,
  PhoneCall,
  Mic,
  ClipboardCheck
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
import { clearAllSessionData } from "@/services/sessionManager";
import { useQueryClient } from "@tanstack/react-query";
import { QuickLocationSwitcher } from "@/components/layout/QuickLocationSwitcher";

interface SidebarProps {
  isCollapsed?: boolean;
  onNavigate?: () => void;
}

const Sidebar = ({ isCollapsed = false, onNavigate }: SidebarProps) => {
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user: currentUser, loading: userLoading, refetch: refetchUser } = useCurrentUser();
  const { user: authUser } = useAuth();
  const { currentLocation } = useLocationContext();
  const [followUpExpanded, setFollowUpExpanded] = React.useState(false);
  
  // Instant display name from auth user_metadata (no loading state)
  const getInstantDisplayName = () => {
    if (currentUser?.first_name && currentUser?.last_name) {
      return `${currentUser.first_name} ${currentUser.last_name}`;
    }
    // Fallback to auth user_metadata (instant, no DB call)
    if (authUser?.user_metadata?.first_name) {
      return `${authUser.user_metadata.first_name} ${authUser.user_metadata.last_name || ''}`.trim();
    }
    if (currentUser?.email) {
      return currentUser.email.split('@')[0];
    }
    if (authUser?.email) {
      return authUser.email.split('@')[0];
    }
    return 'User';
  };

  // Instant initials from any available source
  const getInstantInitials = () => {
    const first = currentUser?.first_name?.[0] || authUser?.user_metadata?.first_name?.[0] || authUser?.email?.[0] || 'U';
    const last = currentUser?.last_name?.[0] || authUser?.user_metadata?.last_name?.[0] || '';
    return `${first}${last}`.toUpperCase();
  };
  
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
    if (path.startsWith('/communications')) return 'communications';
    if (path.startsWith('/smartdocs')) return 'smartdocs';
    if (path.startsWith('/presentations')) return 'presentations';
    if (path.startsWith('/permits')) return 'permits';
    if (path.startsWith('/crew')) return 'crew';
    if (path.startsWith('/homeowner')) return 'homeowner';
    if (path.startsWith('/admin/monitoring')) return 'monitoring';
    if (path.startsWith('/settings')) return 'settings';
    if (path.startsWith('/help')) return 'help';
    return 'dashboard';
  };
  
  const activeSection = getActiveSection();

  const handleSignOut = async () => {
    try {
      // Clear all session data (localStorage, sessionStorage, cookies)
      clearAllSessionData();
      
      // Clear React Query cache
      queryClient.clear();
      
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      
      toast({
        title: "Signed out successfully",
        description: "You have been logged out of the system.",
      });
      
      // Navigate to landing page
      navigate('/', { replace: true });
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

      // Refetch user data to update the UI
      refetchUser();
      
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
      name: "Storm Canvas Pro",
      href: "storm-canvass",
      path: "/storm-canvass",
      icon: CloudRain,
      description: "Lead generation & canvasing"
    },
    // Communications is now an expandable section - see communicationsSubNav below
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
    },
    {
      name: "Permit Expediter",
      href: "permits",
      path: "/permits/expediter",
      icon: ClipboardCheck,
      description: "Permit packet builder & tracker"
    }
  ];

  const portalNavigation = [
    {
      name: "Crew Portal",
      href: "crew",
      path: "/crew",
      icon: HardHat,
      description: "Field crew workspace"
    },
    {
      name: "Homeowner Portal",
      href: "admin/portal-users",
      path: "/admin/portal-users",
      icon: Home,
      description: "Manage homeowner portal access"
    },
    {
      name: "System Monitor",
      href: "monitoring",
      path: "/admin/monitoring",
      icon: Activity,
      description: "System health & crashes",
      masterOnly: true
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
      "bg-card border-r border-border h-screen flex flex-col transition-all duration-300",
      isCollapsed ? "w-16" : "w-64"
    )}>
      {/* Logo & Header */}
      <div className={cn("border-b border-border", isCollapsed ? "p-2" : "p-4")}>
        <div className={cn("flex items-center", isCollapsed ? "justify-center" : "gap-3")}>
          {/* Location/Company Logo */}
          {currentLocation?.logo_url ? (
            <img 
              src={currentLocation.logo_url} 
              alt={currentLocation.name}
              className="w-9 h-9 rounded-lg object-cover"
            />
          ) : (
            <div className="w-9 h-9 gradient-primary rounded-lg flex items-center justify-center">
              <Building2 className="h-5 w-5 text-white" />
            </div>
          )}
          {!isCollapsed && (
            <div>
              <h1 className="text-lg font-bold gradient-primary bg-clip-text text-transparent">
                {currentLocation?.name || 'PITCH'}
              </h1>
              <p className="text-xs text-muted-foreground">
                {currentLocation ? 'Location' : 'Roofing CRM'}
              </p>
            </div>
          )}
        </div>
        {/* Quick Location Switcher */}
        <div className="mt-3">
          <QuickLocationSwitcher isCollapsed={isCollapsed} />
        </div>
      </div>

      {/* Scrollable Navigation Area */}
      <div className="flex-1 overflow-y-auto">
        {/* Main Navigation Section */}
        <div className="p-3">
          {!isCollapsed && (
            <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Main
            </div>
          )}
          <nav className="space-y-0.5">
            {navigation.map((item) => (
              <Link
                key={item.href}
                to={item.path}
                data-testid={item.testId}
                onClick={onNavigate}
                className={cn(
                  "w-full flex items-center rounded-md text-left transition-colors group",
                  isCollapsed ? "px-2 py-2 justify-center" : "gap-3 px-3 py-2",
                  activeSection === item.href
                    ? "bg-primary/10 text-primary border-l-2 border-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground border-l-2 border-transparent"
                )}
                title={isCollapsed ? item.name : undefined}
              >
                <item.icon className={cn(
                  "h-4 w-4 flex-shrink-0",
                  activeSection === item.href 
                    ? "text-primary" 
                    : "text-muted-foreground group-hover:text-accent-foreground"
                )} />
                {!isCollapsed && (
                  <span className={cn(
                    "text-sm font-medium truncate",
                    activeSection === item.href ? "text-primary" : ""
                  )}>
                    {item.name}
                  </span>
                )}
              </Link>
            ))}
            
            {/* Communications Expandable Section */}
            <div className="space-y-0.5">
              <button
                onClick={() => setFollowUpExpanded(!followUpExpanded)}
                className={cn(
                  "w-full flex items-center rounded-md text-left transition-colors group",
                  isCollapsed ? "px-2 py-2 justify-center" : "gap-3 px-3 py-2",
                  activeSection === 'communications'
                    ? "bg-primary/10 text-primary border-l-2 border-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground border-l-2 border-transparent"
                )}
                title={isCollapsed ? "Follow Up Hub" : undefined}
              >
                <Phone className={cn(
                  "h-4 w-4 flex-shrink-0",
                  activeSection === 'communications' 
                    ? "text-primary" 
                    : "text-muted-foreground group-hover:text-accent-foreground"
                )} />
                {!isCollapsed && (
                  <>
                    <span className={cn(
                      "text-sm font-medium truncate flex-1",
                      activeSection === 'communications' ? "text-primary" : ""
                    )}>
                      Follow Up Hub
                    </span>
                    {followUpExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </>
                )}
              </button>
              
              {/* Communications Sub-items */}
              {(followUpExpanded || activeSection === 'communications') && !isCollapsed && (
                <div className="ml-4 pl-3 border-l border-border space-y-0.5">
                  <Link
                    to="/communications"
                    onClick={onNavigate}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-left transition-colors group",
                      location.pathname === '/communications'
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    )}
                  >
                    <Inbox className="h-3.5 w-3.5" />
                    <span className="text-sm">Inbox</span>
                  </Link>
                  <Link
                    to="/communications/unmatched"
                    onClick={onNavigate}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-left transition-colors group",
                      location.pathname === '/communications/unmatched'
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    )}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span className="text-sm">Unmatched</span>
                  </Link>
                  <Link
                    to="/communications/ai-queue"
                    onClick={onNavigate}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-left transition-colors group",
                      location.pathname === '/communications/ai-queue'
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    )}
                  >
                    <Bot className="h-3.5 w-3.5" />
                    <span className="text-sm">AI Queue</span>
                  </Link>
                  <Link
                    to="/communications/calls"
                    onClick={onNavigate}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-left transition-colors group",
                      location.pathname === '/communications/calls'
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    )}
                  >
                    <PhoneCall className="h-3.5 w-3.5" />
                    <span className="text-sm">Call Center</span>
                  </Link>
                </div>
              )}
            </div>
          </nav>
        </div>

        {/* Divider */}
        <div className={cn("mx-3 border-t border-border", isCollapsed ? "my-2" : "my-1")} />

        {/* Portal Navigation Section */}
        <div className="p-3 pt-1">
          {!isCollapsed && (
            <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Portals
            </div>
          )}
          <nav className="space-y-0.5">
            {portalNavigation
              .filter(item => !item.masterOnly || currentUser?.role === 'master')
              .map((item) => (
                <Link
                  key={item.href}
                  to={item.path}
                  onClick={onNavigate}
                  className={cn(
                    "w-full flex items-center rounded-md text-left transition-colors group",
                    isCollapsed ? "px-2 py-2 justify-center" : "gap-3 px-3 py-2",
                    activeSection === item.href
                      ? "bg-primary/10 text-primary border-l-2 border-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground border-l-2 border-transparent"
                  )}
                  title={isCollapsed ? item.name : undefined}
                >
                  <item.icon className={cn(
                    "h-4 w-4 flex-shrink-0",
                    activeSection === item.href 
                      ? "text-primary" 
                      : "text-muted-foreground group-hover:text-accent-foreground"
                  )} />
                  {!isCollapsed && (
                    <span className={cn(
                      "text-sm font-medium truncate",
                      activeSection === item.href ? "text-primary" : ""
                    )}>
                      {item.name}
                    </span>
                  )}
                </Link>
              ))}
          </nav>
        </div>
      </div>

      {/* Bottom Navigation - Fixed */}
      <div className="p-3 border-t border-border">
        <nav className="space-y-0.5">
          {bottomNavigation.map((item) => (
            <Link
              key={item.href}
              to={item.path}
              data-testid={item.testId}
              onClick={onNavigate}
              className={cn(
                "w-full flex items-center rounded-md text-left transition-colors group",
                isCollapsed ? "px-2 py-2 justify-center" : "gap-3 px-3 py-2",
                activeSection === item.href
                  ? "bg-primary/10 text-primary border-l-2 border-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground border-l-2 border-transparent"
              )}
              title={isCollapsed ? item.name : undefined}
            >
              <item.icon className={cn(
                "h-4 w-4 flex-shrink-0",
                activeSection === item.href 
                  ? "text-primary" 
                  : "text-muted-foreground group-hover:text-accent-foreground"
              )} />
              {!isCollapsed && (
                <span className={cn(
                  "text-sm font-medium truncate",
                  activeSection === item.href ? "text-primary" : ""
                )}>
                  {item.name}
                </span>
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
                  {getInstantInitials()}
                </span>
              </div>
              {!isCollapsed && (
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-sm font-medium truncate">
                    {getInstantDisplayName()}
                    {currentUser?.is_developer && (
                      <Code className="inline h-3 w-3 ml-1 text-destructive" />
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {currentUser?.title ? (
                      currentUser.title.charAt(0).toUpperCase() + currentUser.title.slice(1)
                    ) : currentUser?.role && currentUser.role !== '' ? (
                      getRoleDisplayName(currentUser.role)
                    ) : userLoading ? (
                      <div className="h-3 w-16 bg-muted-foreground/20 rounded animate-pulse" />
                    ) : (
                      'User'
                    )}
                  </div>
                </div>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium">
                  {currentUser?.first_name && currentUser?.last_name
                    ? `${currentUser.first_name} ${currentUser.last_name}`
                    : currentUser?.email || 'User'
                  }
                </p>
                <p className="text-xs text-muted-foreground">{currentUser?.email || 'No email'}</p>
                {currentUser?.role && currentUser.role !== '' && (
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