import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Upload, Loader2, CheckCircle, Package, DollarSign, Calendar } from 'lucide-react';
import { SRS_PRICELIST_2026, SRS_EFFECTIVE_DATE, SRS_REP_NAME, SRS_REP_EMAIL, SRS_REP_PHONE } from '@/lib/srs/srsPricelistData2026';

interface SRSPricelistImporterProps {
  onImportComplete?: () => void;
}

export const SRSPricelistImporter: React.FC<SRSPricelistImporterProps> = ({
  onImportComplete,
}) => {
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    success: boolean;
    pricebook_count: number;
    product_count: number;
  } | null>(null);
  const { toast } = useToast();

  const handleImport = async () => {
    setImporting(true);
    setImportResult(null);

    try {
      // Get session for auth
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated');
      }

      // Get user profile to find vendor_id (if available)
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id, active_tenant_id')
        .eq('id', session.user.id)
        .single();

      const tenantId = profile?.active_tenant_id || profile?.tenant_id;
      if (!tenantId) {
        throw new Error('No tenant found');
      }

      // Find or create SRS vendor
      let vendorId: string;
      const { data: existingVendor } = await supabase
        .from('vendors')
        .select('id')
        .eq('tenant_id', tenantId)
        .ilike('name', '%SRS%')
        .limit(1)
        .maybeSingle();

      if (existingVendor) {
        vendorId = existingVendor.id;
      } else {
        const { data: newVendor, error: vendorError } = await supabase
          .from('vendors')
          .insert([{
            tenant_id: tenantId,
            name: 'SRS Distribution',
            code: 'SRS',
            contact_email: SRS_REP_EMAIL,
            contact_phone: SRS_REP_PHONE,
            is_active: true,
          }])
          .select('id')
          .single();

        if (vendorError) {
          console.error('Error creating vendor:', vendorError);
          throw new Error('Failed to create vendor');
        }
        vendorId = newVendor.id;
      }

      // Call the edge function to import
      const { data, error } = await supabase.functions.invoke('srs-pricelist-importer', {
        body: {
          items: SRS_PRICELIST_2026,
          vendor_id: vendorId,
          effective_date: SRS_EFFECTIVE_DATE,
        },
      });

      if (error) {
        console.error('Edge function error:', error);
        throw error;
      }

      if (!data.success) {
        throw new Error(data.error || 'Import failed');
      }

      setImportResult({
        success: true,
        pricebook_count: data.pricebook_count || 0,
        product_count: data.product_count || 0,
      });

      toast({
        title: 'SRS Pricelist Imported',
        description: `Updated ${data.pricebook_count} pricebook entries and ${data.product_count} products`,
      });

      if (onImportComplete) {
        onImportComplete();
      }
    } catch (error: any) {
      console.error('Import error:', error);
      toast({
        title: 'Import Failed',
        description: error.message || 'Failed to import SRS pricelist',
        variant: 'destructive',
      });
    } finally {
      setImporting(false);
    }
  };

  const categoryBreakdown = React.useMemo(() => {
    const categories: Record<string, number> = {};
    SRS_PRICELIST_2026.forEach(item => {
      categories[item.category] = (categories[item.category] || 0) + 1;
    });
    return Object.entries(categories).sort((a, b) => b[1] - a[1]);
  }, []);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              SRS Distribution Pricelist
            </CardTitle>
            <CardDescription>
              Import the latest SRS pricing for O'Brien Contracting
            </CardDescription>
          </div>
          <Badge variant="secondary" className="text-xs">
            <Calendar className="h-3 w-3 mr-1" />
            Effective: {SRS_EFFECTIVE_DATE}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Pricelist Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-3 bg-muted/50 rounded-lg text-center">
            <div className="text-2xl font-bold">{SRS_PRICELIST_2026.length}</div>
            <div className="text-xs text-muted-foreground">Total Items</div>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg text-center">
            <div className="text-2xl font-bold">{categoryBreakdown.length}</div>
            <div className="text-xs text-muted-foreground">Categories</div>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg text-center">
            <div className="text-sm font-medium truncate">{SRS_REP_NAME}</div>
            <div className="text-xs text-muted-foreground">Rep</div>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg text-center">
            <div className="text-sm font-medium">{SRS_REP_PHONE}</div>
            <div className="text-xs text-muted-foreground">Phone</div>
          </div>
        </div>

        {/* Category Breakdown */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Categories Included</h4>
          <div className="flex flex-wrap gap-2">
            {categoryBreakdown.map(([category, count]) => (
              <Badge key={category} variant="outline" className="text-xs">
                {category} ({count})
              </Badge>
            ))}
          </div>
        </div>

        {/* Import Button */}
        <div className="flex items-center gap-4">
          <Button
            onClick={handleImport}
            disabled={importing}
            className="flex-1"
          >
            {importing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Import SRS Pricelist
              </>
            )}
          </Button>

          {importResult?.success && (
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-5 w-5" />
              <span className="text-sm">
                {importResult.pricebook_count} items imported
              </span>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          This will update pricing for all SRS products in your pricebook and product catalog.
          Existing items will be updated with new prices.
        </p>
      </CardContent>
    </Card>
  );
};
