import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Eye, Copy, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface EmailTemplate {
  id: string;
  name: string;
  template_type: string;
  subject: string;
  html_body: string;
  is_default: boolean;
}

interface TemplateGalleryProps {
  onSelectTemplate: (template: EmailTemplate) => void;
}

const CATEGORY_CONFIG: Record<string, { label: string; icon: string; color: string; description: string }> = {
  onboarding: { 
    label: "Onboarding", 
    icon: "🎉", 
    color: "bg-emerald-500/10 text-emerald-600 border-emerald-200",
    description: "Welcome new users and companies"
  },
  announcement: { 
    label: "Announcements", 
    icon: "📢", 
    color: "bg-blue-500/10 text-blue-600 border-blue-200",
    description: "Company news and updates"
  },
  followup: { 
    label: "Follow-ups", 
    icon: "📩", 
    color: "bg-purple-500/10 text-purple-600 border-purple-200",
    description: "Re-engagement and follow-up emails"
  },
  reminder: { 
    label: "Reminders", 
    icon: "⏰", 
    color: "bg-amber-500/10 text-amber-600 border-amber-200",
    description: "Action reminders and notifications"
  },
  feature: { 
    label: "Feature Updates", 
    icon: "🚀", 
    color: "bg-indigo-500/10 text-indigo-600 border-indigo-200",
    description: "Product and feature announcements"
  },
  maintenance: { 
    label: "Maintenance", 
    icon: "🔧", 
    color: "bg-slate-500/10 text-slate-600 border-slate-200",
    description: "System maintenance notices"
  },
  urgent: { 
    label: "Urgent", 
    icon: "⚠️", 
    color: "bg-red-500/10 text-red-600 border-red-200",
    description: "Critical alerts and warnings"
  },
  custom: { 
    label: "Custom", 
    icon: "✉️", 
    color: "bg-gray-500/10 text-gray-600 border-gray-200",
    description: "Your custom templates"
  },
};

export function TemplateGallery({ onSelectTemplate }: TemplateGalleryProps) {
  const { toast } = useToast();
  const [activeCategory, setActiveCategory] = useState("all");
  const [previewTemplate, setPreviewTemplate] = useState<EmailTemplate | null>(null);

  const { data: templates, isLoading } = useQuery({
    queryKey: ["email-templates-gallery"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_templates")
        .select("*")
        .eq("is_active", true)
        .order("template_type")
        .order("is_default", { ascending: false });
      
      if (error) throw error;
      return data as EmailTemplate[];
    },
  });

  const categories = ['all', ...Object.keys(CATEGORY_CONFIG)];
  
  const filteredTemplates = templates?.filter(t => 
    activeCategory === 'all' || t.template_type === activeCategory
  ) || [];

  const groupedTemplates = filteredTemplates.reduce((acc, template) => {
    const type = template.template_type;
    if (!acc[type]) acc[type] = [];
    acc[type].push(template);
    return acc;
  }, {} as Record<string, EmailTemplate[]>);

  const handleUseTemplate = (template: EmailTemplate) => {
    onSelectTemplate(template);
    toast({ title: "Template selected", description: `"${template.name}" loaded into editor` });
  };

  if (previewTemplate) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">{previewTemplate.name}</h3>
            <p className="text-sm text-muted-foreground">{previewTemplate.subject}</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => handleUseTemplate(previewTemplate)}>
              <Copy className="h-4 w-4 mr-2" />
              Use This Template
            </Button>
            <Button variant="ghost" onClick={() => setPreviewTemplate(null)}>
              Back to Gallery
            </Button>
          </div>
        </div>
        
        <div className="border rounded-lg overflow-hidden">
          <iframe
            srcDoc={previewTemplate.html_body
              .replace(/\{\{first_name\}\}/g, 'John')
              .replace(/\{\{company_name\}\}/g, 'ABC Roofing')
              .replace(/\{\{action_url\}\}/g, 'https://pitch-crm.ai')
              .replace(/\{\{login_url\}\}/g, 'https://pitch-crm.ai/login')
              .replace(/\{\{feature_name\}\}/g, 'AI Measurements')
              .replace(/\{\{message\}\}/g, 'This is a sample message content.')
              .replace(/\{\{appointment_date\}\}/g, 'December 15, 2025 at 2:00 PM')
              .replace(/\{\{appointment_details\}\}/g, 'Roof inspection at 123 Main St')
              .replace(/\{\{amount\}\}/g, '$249.00')
              .replace(/\{\{due_date\}\}/g, 'December 20, 2025')
              .replace(/\{\{payment_url\}\}/g, 'https://pitch-crm.ai/pay')
              .replace(/\{\{renewal_date\}\}/g, 'January 1, 2026')
              .replace(/\{\{leads_count\}\}/g, '24')
              .replace(/\{\{estimates_count\}\}/g, '18')
              .replace(/\{\{jobs_won\}\}/g, '7')}
            className="w-full h-[500px] border-0"
            title="Template Preview"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold mb-1">Template Gallery</h3>
        <p className="text-sm text-muted-foreground">
          Browse and select from professional pre-designed templates
        </p>
      </div>

      <Tabs value={activeCategory} onValueChange={setActiveCategory}>
        <ScrollArea className="w-full">
          <TabsList className="inline-flex w-auto">
            <TabsTrigger value="all" className="text-xs">All Templates</TabsTrigger>
            {Object.entries(CATEGORY_CONFIG).map(([key, config]) => (
              <TabsTrigger key={key} value={key} className="text-xs">
                <span className="mr-1">{config.icon}</span>
                {config.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </ScrollArea>

        <TabsContent value={activeCategory} className="mt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : filteredTemplates.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>No templates found in this category</p>
            </div>
          ) : activeCategory === 'all' ? (
            <div className="space-y-6">
              {Object.entries(groupedTemplates).map(([type, typeTemplates]) => {
                const config = CATEGORY_CONFIG[type] || CATEGORY_CONFIG.custom;
                return (
                  <div key={type}>
                    <div className="flex items-center gap-2 mb-3">
                      <span>{config.icon}</span>
                      <h4 className="font-medium">{config.label}</h4>
                      <Badge variant="secondary" className="text-xs">{typeTemplates.length}</Badge>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {typeTemplates.map(template => (
                        <TemplateCard
                          key={template.id}
                          template={template}
                          onPreview={() => setPreviewTemplate(template)}
                          onUse={() => handleUseTemplate(template)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredTemplates.map(template => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onPreview={() => setPreviewTemplate(template)}
                  onUse={() => handleUseTemplate(template)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TemplateCard({ 
  template, 
  onPreview, 
  onUse 
}: { 
  template: EmailTemplate; 
  onPreview: () => void; 
  onUse: () => void;
}) {
  const config = CATEGORY_CONFIG[template.template_type] || CATEGORY_CONFIG.custom;

  return (
    <Card className="group hover:shadow-md transition-shadow overflow-hidden">
      <div className="h-32 bg-muted/30 relative overflow-hidden">
        <iframe
          srcDoc={template.html_body
            .replace(/\{\{[^}]+\}\}/g, 'Sample')}
          className="w-full h-[300px] border-0 pointer-events-none scale-[0.4] origin-top-left absolute"
          style={{ width: '250%' }}
          title={template.name}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent" />
        <div className="absolute bottom-2 left-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button size="sm" variant="secondary" className="flex-1 h-7 text-xs" onClick={onPreview}>
            <Eye className="h-3 w-3 mr-1" />
            Preview
          </Button>
          <Button size="sm" className="flex-1 h-7 text-xs" onClick={onUse}>
            <Copy className="h-3 w-3 mr-1" />
            Use
          </Button>
        </div>
      </div>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-1">
              <h5 className="font-medium text-sm truncate">{template.name}</h5>
              {template.is_default && (
                <Badge variant="outline" className="text-[10px] h-4 px-1">Default</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">{template.subject}</p>
          </div>
          <Badge className={`text-[10px] h-5 px-1.5 ${config.color}`}>
            {config.icon}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
