import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ArrowRight, ChevronRight, ExternalLink } from "lucide-react";

export interface NavigationLink {
  label: string;
  target_section?: string;
  target_slide_index?: number;
  style: 'button' | 'card' | 'link' | 'pill';
  icon?: string;
  description?: string;
  color?: string;
}

interface NavigationLinkRendererProps {
  links: NavigationLink[];
  onNavigate: (targetSection?: string, targetSlideIndex?: number) => void;
  layout?: 'horizontal' | 'vertical' | 'grid';
  size?: 'sm' | 'md' | 'lg';
}

export function NavigationLinkRenderer({
  links,
  onNavigate,
  layout = 'horizontal',
  size = 'md',
}: NavigationLinkRendererProps) {
  if (!links || links.length === 0) {
    return null;
  }

  const containerClasses = cn(
    "flex gap-4 mt-8",
    layout === 'horizontal' && "flex-wrap justify-center",
    layout === 'vertical' && "flex-col items-center max-w-md mx-auto",
    layout === 'grid' && "grid grid-cols-2 md:grid-cols-3 max-w-4xl mx-auto"
  );

  return (
    <div className={containerClasses}>
      {links.map((link, index) => (
        <NavigationLinkItem
          key={`${link.label}-${index}`}
          link={link}
          onNavigate={onNavigate}
          size={size}
        />
      ))}
    </div>
  );
}

interface NavigationLinkItemProps {
  link: NavigationLink;
  onNavigate: (targetSection?: string, targetSlideIndex?: number) => void;
  size: 'sm' | 'md' | 'lg';
}

function NavigationLinkItem({ link, onNavigate, size }: NavigationLinkItemProps) {
  const handleClick = () => {
    onNavigate(link.target_section, link.target_slide_index);
  };

  switch (link.style) {
    case 'button':
      return (
        <Button
          onClick={handleClick}
          size={size === 'lg' ? 'lg' : size === 'sm' ? 'sm' : 'default'}
          className={cn(
            "gap-2 transition-all hover:scale-105",
            size === 'lg' && "text-lg px-8 py-6"
          )}
          style={link.color ? { backgroundColor: link.color } : undefined}
        >
          {link.label}
          <ArrowRight className="h-4 w-4" />
        </Button>
      );

    case 'card':
      return (
        <Card
          className={cn(
            "cursor-pointer transition-all hover:scale-105 hover:shadow-lg",
            "flex flex-col items-center justify-center text-center p-6",
            size === 'lg' && "p-8",
            size === 'sm' && "p-4"
          )}
          onClick={handleClick}
          style={link.color ? { borderColor: link.color, borderWidth: 2 } : undefined}
        >
          <h3
            className={cn(
              "font-semibold",
              size === 'lg' && "text-xl",
              size === 'md' && "text-lg",
              size === 'sm' && "text-base"
            )}
            style={link.color ? { color: link.color } : undefined}
          >
            {link.label}
          </h3>
          {link.description && (
            <p className="text-sm text-muted-foreground mt-2">{link.description}</p>
          )}
          <ChevronRight
            className="h-5 w-5 mt-3 text-muted-foreground"
            style={link.color ? { color: link.color } : undefined}
          />
        </Card>
      );

    case 'pill':
      return (
        <button
          onClick={handleClick}
          className={cn(
            "inline-flex items-center gap-2 rounded-full transition-all hover:scale-105",
            "bg-primary/10 hover:bg-primary/20 text-primary",
            size === 'lg' && "px-6 py-3 text-lg",
            size === 'md' && "px-4 py-2 text-base",
            size === 'sm' && "px-3 py-1.5 text-sm"
          )}
          style={
            link.color
              ? { backgroundColor: `${link.color}20`, color: link.color }
              : undefined
          }
        >
          {link.label}
          <ArrowRight className="h-4 w-4" />
        </button>
      );

    case 'link':
    default:
      return (
        <button
          onClick={handleClick}
          className={cn(
            "inline-flex items-center gap-1 text-primary hover:underline transition-all",
            size === 'lg' && "text-xl",
            size === 'md' && "text-lg",
            size === 'sm' && "text-base"
          )}
          style={link.color ? { color: link.color } : undefined}
        >
          {link.label}
          <ExternalLink className="h-4 w-4" />
        </button>
      );
  }
}
