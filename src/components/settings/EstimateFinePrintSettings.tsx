import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId, useEffectiveTenantIdLoading } from '@/hooks/useEffectiveTenantId';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { 
  FileText, 
  Eye, 
  Save, 
  RotateCcw,
  Info
} from 'lucide-react';

const DEFAULT_FINE_PRINT = `TERMS AND CONDITIONS

1. ESTIMATE VALIDITY
This estimate is valid for 30 days from the date shown above. Prices are subject to change after this period.

2. PAYMENT TERMS
• A 50% deposit is required to schedule the project
• Final balance is due upon completion
• We accept check, credit card, and financing options

3. WORKMANSHIP WARRANTY
All work performed is backed by our standard workmanship warranty. Manufacturer warranties apply to all materials used.

4. PERMITS AND INSPECTIONS
Unless otherwise noted, necessary permits and inspections are included in this estimate.

5. CHANGE ORDERS
Any changes to the scope of work after signing will be documented and may affect the final price.

6. PROPERTY ACCESS
Customer agrees to provide reasonable access to the property during work hours.

7. HIDDEN CONDITIONS
This estimate is based on visible conditions. Any unforeseen issues discovered during work may result in additional charges, which will be communicated and approved before proceeding.`;

export function EstimateFinePrintSettings() {
  const tenantId = useEffectiveTenantId();
  const tenantLoading = useEffectiveTenantIdLoading();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [finePrintContent, setFinePrintContent] = useState('');
  const [includeFineByDefault, setIncludeFineByDefault] = useState(true);
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch settings
  const { data: settings, isLoading } = useQuery({
    queryKey: ['tenant-estimate-settings', tenantId],
    queryFn: async () => {
      if (!tenantId) return null;
      const { data, error } = await supabase
        .from('tenant_estimate_settings')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!tenantId,
  });

  // Initialize form with fetched data
  useEffect(() => {
    if (settings) {
      setFinePrintContent(settings.fine_print_content || DEFAULT_FINE_PRINT);
      setIncludeFineByDefault(settings.default_include_fine_print ?? true);
    } else if (!isLoading && tenantId) {
      // No settings exist, use defaults
      setFinePrintContent(DEFAULT_FINE_PRINT);
      setIncludeFineByDefault(true);
    }
  }, [settings, isLoading, tenantId]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error('No tenant');
      
      const payload = {
        tenant_id: tenantId,
        fine_print_content: finePrintContent,
        default_include_fine_print: includeFineByDefault,
        updated_at: new Date().toISOString(),
      };

      if (settings?.id) {
        // Update existing
        const { error } = await supabase
          .from('tenant_estimate_settings')
          .update(payload)
          .eq('id', settings.id);
        if (error) throw error;
      } else {
        // Insert new
        const { error } = await supabase
          .from('tenant_estimate_settings')
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-estimate-settings', tenantId] });
      toast({ title: 'Settings saved' });
      setHasChanges(false);
    },
    onError: (error) => {
      toast({ title: 'Failed to save', description: error.message, variant: 'destructive' });
    },
  });

  const handleContentChange = (value: string) => {
    setFinePrintContent(value);
    setHasChanges(true);
  };

  const handleToggleChange = (value: boolean) => {
    setIncludeFineByDefault(value);
    setHasChanges(true);
  };

  const handleReset = () => {
    if (confirm('Reset to default fine print? This will replace your current content.')) {
      setFinePrintContent(DEFAULT_FINE_PRINT);
      setHasChanges(true);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading settings...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Estimate PDF Fine Print
        </CardTitle>
        <CardDescription>
          Customize the legal terms and conditions that appear at the bottom of estimate PDFs.
          This content will be included when exporting estimates.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Default Toggle */}
        <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
          <div className="space-y-0.5">
            <Label className="text-base">Include fine print by default</Label>
            <p className="text-sm text-muted-foreground">
              When enabled, fine print will be included in PDF exports by default (can be toggled per export)
            </p>
          </div>
          <Switch
            checked={includeFineByDefault}
            onCheckedChange={handleToggleChange}
          />
        </div>

        {/* Editor and Preview Tabs */}
        <Tabs defaultValue="edit" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="edit" className="gap-2">
              <FileText className="h-4 w-4" />
              Edit
            </TabsTrigger>
            <TabsTrigger value="preview" className="gap-2">
              <Eye className="h-4 w-4" />
              Preview
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="edit" className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Fine Print Content</Label>
                <Button variant="ghost" size="sm" onClick={handleReset}>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Reset to Default
                </Button>
              </div>
              <Textarea
                value={finePrintContent}
                onChange={(e) => handleContentChange(e.target.value)}
                placeholder="Enter your terms and conditions..."
                className="min-h-[400px] font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Use plain text formatting. Line breaks will be preserved in the PDF.
              </p>
            </div>
          </TabsContent>
          
          <TabsContent value="preview">
            <div className="border rounded-lg p-6 bg-white text-black min-h-[400px]">
              <h4 className="font-semibold text-gray-700 mb-3 text-sm">Additional Terms</h4>
              <div className="text-xs text-gray-500 whitespace-pre-wrap leading-relaxed">
                {finePrintContent || 'No fine print content yet.'}
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              This is how the fine print will appear on your estimate PDFs.
            </p>
          </TabsContent>
        </Tabs>

        {/* Info Box */}
        <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 text-sm border border-blue-200 dark:border-blue-900">
          <Info className="h-4 w-4 mt-0.5 text-blue-600 dark:text-blue-400" />
          <div className="text-blue-700 dark:text-blue-300">
            <strong>Tip:</strong> Include important terms like payment schedules, warranty information, 
            and project scope limitations. This protects both you and your customers.
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button 
            onClick={() => saveMutation.mutate()} 
            disabled={saveMutation.isPending || !hasChanges}
          >
            <Save className="h-4 w-4 mr-2" />
            {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
