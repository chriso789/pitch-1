import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { 
  Popover, 
  PopoverContent, 
  PopoverTrigger 
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText, Sparkles, ChevronRight, Mail, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TemplateContext {
  customer_name?: string;
  first_name?: string;
  last_name?: string;
  property_address?: string;
  estimate_total?: number;
  estimate_number?: string;
  selected_tier?: string;
  company_name?: string;
  rep_name?: string;
  rep_phone?: string;
  rep_email?: string;
  proposal_link?: string;
}

interface QuickTemplateSelectorProps {
  type?: 'email' | 'sms' | 'all';
  context?: TemplateContext;
  onSelect: (content: string, subject?: string) => void;
  triggerClassName?: string;
}

interface MessageTemplate {
  id: string;
  name: string;
  template_type: string;
  subject: string | null;
  content: string;
  category: string | null;
  usage_count?: number;
}

// Built-in proposal follow-up templates
const proposalTemplates = [
  {
    id: 'proposal-sent',
    name: 'Proposal Sent Follow-up',
    template_type: 'email',
    subject: 'Your Roofing Proposal from {{company_name}}',
    content: `Hi {{first_name}},

I wanted to follow up on the roofing proposal I sent over. The estimate for your project comes to {{estimate_total}}.

You can view and compare the different options here: {{proposal_link}}

Please let me know if you have any questions about the materials, warranty options, or financing. I'm happy to walk through everything with you.

Best regards,
{{rep_name}}
{{rep_phone}}`,
    category: 'proposal_followup'
  },
  {
    id: 'tier-reminder',
    name: 'Tier Selection Reminder',
    template_type: 'email',
    subject: 'Have you decided on your roofing option?',
    content: `Hi {{first_name}},

I noticed you viewed the proposal but haven't selected an option yet. I wanted to check in and see if you have any questions.

Quick recap of your options:
• Good - Basic coverage with standard warranty
• Better - Enhanced materials with extended protection  
• Best - Premium materials with lifetime warranty

Let me know which direction you're leaning and I can help finalize everything.

Talk soon,
{{rep_name}}`,
    category: 'proposal_followup'
  },
  {
    id: 'proposal-expiring',
    name: 'Proposal Expiring Soon',
    template_type: 'email',
    subject: 'Your roofing proposal expires in 5 days',
    content: `Hi {{first_name}},

Just a friendly reminder that your roofing proposal (Estimate #{{estimate_number}}) expires in 5 days.

The current pricing of {{estimate_total}} is locked in until then. After that, material costs may change.

If you're ready to move forward, you can accept the proposal directly online: {{proposal_link}}

Questions? Just reply to this email.

Thanks,
{{rep_name}}`,
    category: 'proposal_followup'
  },
  {
    id: 'thank-you-accepted',
    name: 'Thank You for Accepting',
    template_type: 'email',
    subject: 'Thank you for choosing {{company_name}}!',
    content: `Hi {{first_name}},

Thank you for accepting our proposal! We're excited to get started on your new roof.

Here's what happens next:
1. Our project coordinator will reach out within 24 hours
2. We'll schedule a material delivery date
3. Installation will be scheduled at your convenience

If you have any questions in the meantime, don't hesitate to reach out.

Thanks again for choosing us!

{{rep_name}}
{{company_name}}`,
    category: 'proposal_followup'
  }
];

// Token replacement function
function replaceTokens(text: string, context: TemplateContext): string {
  return text
    .replace(/\{\{customer_name\}\}/g, context.customer_name || context.first_name || 'Customer')
    .replace(/\{\{first_name\}\}/g, context.first_name || 'there')
    .replace(/\{\{last_name\}\}/g, context.last_name || '')
    .replace(/\{\{property_address\}\}/g, context.property_address || '[Property Address]')
    .replace(/\{\{estimate_total\}\}/g, context.estimate_total 
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(context.estimate_total) 
      : '[Estimate Total]')
    .replace(/\{\{estimate_number\}\}/g, context.estimate_number || '[Estimate #]')
    .replace(/\{\{selected_tier\}\}/g, context.selected_tier || '[Selected Tier]')
    .replace(/\{\{company_name\}\}/g, context.company_name || '[Company Name]')
    .replace(/\{\{rep_name\}\}/g, context.rep_name || '[Your Name]')
    .replace(/\{\{rep_phone\}\}/g, context.rep_phone || '[Phone]')
    .replace(/\{\{rep_email\}\}/g, context.rep_email || '[Email]')
    .replace(/\{\{proposal_link\}\}/g, context.proposal_link || '[Proposal Link]');
}

export function QuickTemplateSelector({ 
  type = 'all', 
  context = {}, 
  onSelect,
  triggerClassName 
}: QuickTemplateSelectorProps) {
  const [open, setOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('all');

  const { data: savedTemplates = [] } = useQuery({
    queryKey: ['message-templates', type],
    queryFn: async () => {
      let query = supabase
        .from('message_templates')
        .select('*')
        .order('usage_count', { ascending: false });

      if (type !== 'all') {
        query = query.eq('template_type', type);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as MessageTemplate[];
    },
  });

  // Combine saved templates with built-in proposal templates
  const allTemplates = [
    ...proposalTemplates.filter(t => type === 'all' || t.template_type === type),
    ...savedTemplates
  ];

  const categories = [
    { id: 'all', label: 'All' },
    { id: 'proposal_followup', label: 'Proposal Follow-up' },
    { id: 'welcome', label: 'Welcome' },
    { id: 'follow_up', label: 'Follow Up' },
    { id: 'reminder', label: 'Reminder' },
  ];

  const filteredTemplates = selectedCategory === 'all' 
    ? allTemplates 
    : allTemplates.filter(t => t.category === selectedCategory);

  const handleSelect = async (template: typeof allTemplates[0]) => {
    const processedContent = replaceTokens(template.content, context);
    const processedSubject = template.subject ? replaceTokens(template.subject, context) : undefined;
    
    onSelect(processedContent, processedSubject);
    setOpen(false);

    // Increment usage count for saved templates (only for DB templates with id)
    if (!template.id.startsWith('proposal-') && 'usage_count' in template) {
      await supabase
        .from('message_templates')
        .update({ usage_count: ((template as MessageTemplate).usage_count || 0) + 1 })
        .eq('id', template.id);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button 
          variant="outline" 
          size="sm" 
          className={cn('gap-2', triggerClassName)}
        >
          <FileText className="h-4 w-4" />
          Use Template
          <Sparkles className="h-3 w-3 text-amber-500" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="start">
        <div className="p-3 border-b">
          <h4 className="font-medium">Quick Templates</h4>
          <p className="text-xs text-muted-foreground">
            Select a template to auto-fill with personalized content
          </p>
        </div>

        <Tabs value={selectedCategory} onValueChange={setSelectedCategory}>
          <div className="px-3 pt-2">
            <TabsList className="w-full h-auto flex-wrap gap-1 bg-transparent p-0">
              {categories.map(cat => (
                <TabsTrigger 
                  key={cat.id} 
                  value={cat.id}
                  className="text-xs px-2 py-1 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                >
                  {cat.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <ScrollArea className="h-72">
            <div className="p-3 space-y-2">
              {filteredTemplates.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No templates in this category
                </p>
              ) : (
                filteredTemplates.map(template => (
                  <button
                    key={template.id}
                    onClick={() => handleSelect(template)}
                    className="w-full text-left p-3 rounded-lg border hover:bg-muted/50 transition-colors group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {template.template_type === 'email' ? (
                            <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                          ) : (
                            <MessageCircle className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                          <span className="font-medium text-sm truncate">
                            {template.name}
                          </span>
                        </div>
                        {template.subject && (
                          <p className="text-xs text-muted-foreground truncate">
                            Subject: {template.subject}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                          {template.content.substring(0, 100)}...
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 group-hover:text-foreground transition-colors" />
                    </div>
                    {template.id.startsWith('proposal-') && (
                      <Badge variant="secondary" className="mt-2 text-[10px]">
                        Built-in
                      </Badge>
                    )}
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </Tabs>

        <div className="p-2 border-t bg-muted/50">
          <p className="text-[10px] text-muted-foreground text-center">
            Tokens like {'{{first_name}}'} are auto-replaced with contact data
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
