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
  Wrench
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
  isCollapsed?: boolean;
}

const Sidebar = ({ activeSection, onSectionChange, isCollapsed = false }: SidebarProps) => {
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
            <span className="text-sm font-bold text-primary-foreground">JD</span>
          </div>
          {!isCollapsed && (
            <div className="flex-1">
              <div className="text-sm font-medium">John Doe</div>
              <div className="text-xs text-muted-foreground">Master User</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Sidebar;