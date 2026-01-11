import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { 
  ChevronLeft, 
  ChevronRight, 
  Home, 
  FileText, 
  Image, 
  DollarSign,
  Shield,
  Clock,
  PenTool,
  MessageSquare,
  Star,
  Layers
} from "lucide-react";

export interface PresentationSection {
  id: string;
  name: string;
  slug: string;
  icon?: string;
  color?: string;
  section_order: number;
  is_visible: boolean;
  visibility_conditions?: Record<string, any>;
  firstSlideIndex: number;
}

interface SectionNavigatorProps {
  sections: PresentationSection[];
  currentSlideIndex: number;
  currentSectionSlug?: string;
  onNavigateToSection: (sectionSlug: string, slideIndex: number) => void;
  onNavigateToSlide: (slideIndex: number) => void;
  isCollapsed?: boolean;
  onToggleCollapsed?: () => void;
}

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  home: Home,
  document: FileText,
  file: FileText,
  text: FileText,
  image: Image,
  photo: Image,
  gallery: Image,
  dollar: DollarSign,
  pricing: DollarSign,
  money: DollarSign,
  estimate: DollarSign,
  shield: Shield,
  warranty: Shield,
  insurance: Shield,
  clock: Clock,
  timeline: Clock,
  schedule: Clock,
  pen: PenTool,
  signature: PenTool,
  sign: PenTool,
  message: MessageSquare,
  testimonial: MessageSquare,
  quote: MessageSquare,
  star: Star,
  review: Star,
  layers: Layers,
  materials: Layers,
  default: FileText,
};

function getIconComponent(iconName?: string): React.ComponentType<any> {
  if (!iconName) return ICON_MAP.default;
  const normalized = iconName.toLowerCase().replace(/[^a-z]/g, '');
  return ICON_MAP[normalized] || ICON_MAP.default;
}

export function SectionNavigator({
  sections,
  currentSlideIndex,
  currentSectionSlug,
  onNavigateToSection,
  onNavigateToSlide,
  isCollapsed = false,
  onToggleCollapsed,
}: SectionNavigatorProps) {
  const [hoveredSection, setHoveredSection] = useState<string | null>(null);
  
  const visibleSections = sections
    .filter(s => s.is_visible)
    .sort((a, b) => a.section_order - b.section_order);

  if (visibleSections.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed left-0 top-1/2 -translate-y-1/2 z-50 transition-all duration-300 ease-in-out",
        isCollapsed ? "w-12" : "w-56"
      )}
    >
      <div className="bg-background/95 backdrop-blur-sm border border-border rounded-r-lg shadow-lg overflow-hidden">
        {/* Toggle Button */}
        <Button
          variant="ghost"
          size="sm"
          className="absolute -right-8 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-background border border-border shadow-md"
          onClick={onToggleCollapsed}
        >
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>

        {/* Header */}
        <div className="px-3 py-2 border-b border-border bg-muted/50">
          {!isCollapsed && (
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Sections
            </span>
          )}
        </div>

        {/* Section List */}
        <ScrollArea className="max-h-[60vh]">
          <div className="py-2">
            {visibleSections.map((section) => {
              const IconComponent = getIconComponent(section.icon);
              const isActive = currentSectionSlug === section.slug;
              const isHovered = hoveredSection === section.id;
              
              return (
                <button
                  key={section.id}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-all duration-200",
                    "hover:bg-accent/50 focus:outline-none focus:bg-accent/50",
                    isActive && "bg-primary/10 border-l-2 border-primary"
                  )}
                  onClick={() => onNavigateToSection(section.slug, section.firstSlideIndex)}
                  onMouseEnter={() => setHoveredSection(section.id)}
                  onMouseLeave={() => setHoveredSection(null)}
                >
                  <div
                    className={cn(
                      "flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                      isActive ? "bg-primary text-primary-foreground" : "bg-muted"
                    )}
                    style={
                      section.color && !isActive
                        ? { backgroundColor: `${section.color}20`, color: section.color }
                        : undefined
                    }
                  >
                    <IconComponent className="h-4 w-4" />
                  </div>
                  
                  {!isCollapsed && (
                    <span
                      className={cn(
                        "text-sm font-medium truncate transition-colors",
                        isActive ? "text-primary" : "text-foreground"
                      )}
                    >
                      {section.name}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </ScrollArea>

        {/* Keyboard hint */}
        {!isCollapsed && (
          <div className="px-3 py-2 border-t border-border bg-muted/30">
            <span className="text-[10px] text-muted-foreground">
              Press 1-9 to jump to sections
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
