import { useQuery } from "@tanstack/react-query";
import { Building2, Home, Wrench, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface TemplatePickerProps {
  selectedId?: string;
  onSelect: (templateId: string) => void;
  vertical?: string;
}

interface PresentationTemplate {
  id: string;
  name: string;
  description: string;
  vertical: string;
  slide_count: number;
  thumbnail_url?: string;
}

const verticalIcons: Record<string, React.ReactNode> = {
  residential_roofing: <Home className="h-8 w-8" />,
  commercial_roofing: <Building2 className="h-8 w-8" />,
  home_services: <Wrench className="h-8 w-8" />,
};

const verticalGradients: Record<string, string> = {
  residential_roofing: "from-blue-500/20 to-blue-600/20",
  commercial_roofing: "from-slate-500/20 to-slate-600/20",
  home_services: "from-amber-500/20 to-amber-600/20",
};

export function TemplatePicker({ selectedId, onSelect, vertical }: TemplatePickerProps) {
  const { data: templates, isLoading } = useQuery({
    queryKey: ["presentation-templates", vertical],
    queryFn: async () => {
      let query = supabase
        .from("presentation_templates")
        .select("*")
        .eq("is_active", true)
        .order("name");
      
      if (vertical) {
        query = query.eq("vertical", vertical);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data as PresentationTemplate[];
    },
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-48 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {templates?.map((template) => (
        <button
          key={template.id}
          onClick={() => onSelect(template.id)}
          className={cn(
            "relative flex flex-col items-center justify-center p-6 rounded-lg border-2 transition-all h-48",
            selectedId === template.id
              ? "border-primary bg-primary/5 shadow-lg"
              : "border-border hover:border-primary/50 hover:shadow-md"
          )}
        >
          {selectedId === template.id && (
            <div className="absolute top-3 right-3 p-1 rounded-full bg-primary text-primary-foreground">
              <Check className="h-4 w-4" />
            </div>
          )}
          
          <div className={cn(
            "p-4 rounded-full bg-gradient-to-br mb-4",
            verticalGradients[template.vertical] || "from-muted to-muted"
          )}>
            {verticalIcons[template.vertical] || <Building2 className="h-8 w-8" />}
          </div>
          
          <h3 className="font-semibold text-center">{template.name}</h3>
          <p className="text-sm text-muted-foreground text-center mt-1">
            {template.slide_count} slides
          </p>
          
          {template.description && (
            <p className="text-xs text-muted-foreground text-center mt-2 line-clamp-2">
              {template.description}
            </p>
          )}
        </button>
      ))}
    </div>
  );
}
