import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, AlertCircle } from "lucide-react";
import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";

interface VendorImportData {
  name: string;
  code: string;
  contact_email?: string;
  contact_phone?: string;
  is_active?: boolean;
}

interface VendorBulkImportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete: () => void;
}

export function VendorBulkImport({ open, onOpenChange, onImportComplete }: VendorBulkImportProps) {
  const { toast } = useToast();
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<VendorImportData[]>([]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const data = results.data as VendorImportData[];
        setPreview(data.slice(0, 5)); // Show first 5 rows
      },
      error: (error) => {
        toast({
          title: "Parse Error",
          description: error.message,
          variant: "destructive"
        });
      }
    });
  };

  const handleImport = async () => {
    const fileInput = document.getElementById('csv-upload') as HTMLInputElement;
    const file = fileInput?.files?.[0];
    if (!file) return;

    setImporting(true);
    
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) throw new Error('Not authenticated');

          const { data: profile } = await supabase
            .from('profiles')
            .select('tenant_id')
            .eq('id', user.id)
            .single();

          if (!profile?.tenant_id) throw new Error('No tenant found');

          const vendors = (results.data as VendorImportData[]).map(row => ({
            name: row.name,
            code: row.code,
            contact_email: row.contact_email || null,
            contact_phone: row.contact_phone || null,
            is_active: row.is_active !== false,
            tenant_id: profile.tenant_id
          }));

          const { data, error } = await supabase
            .from('vendors')
            .insert(vendors)
            .select();

          if (error) throw error;

          toast({
            title: "Import Successful",
            description: `Imported ${data.length} vendors successfully.`
          });

          onImportComplete();
          onOpenChange(false);
          setPreview([]);
        } catch (error: any) {
          console.error('Error importing vendors:', error);
          toast({
            title: "Import Failed",
            description: error.message,
            variant: "destructive"
          });
        } finally {
          setImporting(false);
        }
      }
    });
  };

  const downloadTemplate = () => {
    const csv = "name,code,contact_email,contact_phone,is_active\nAcme Corp,ACME001,contact@acme.com,555-0100,true\nExample Vendor,EX001,info@example.com,555-0200,true";
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vendor_import_template.csv';
    a.click();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk Import Vendors</DialogTitle>
          <DialogDescription>
            Upload a CSV file to import multiple vendors at once
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2 p-4 bg-muted/50 rounded-lg">
            <AlertCircle className="h-5 w-5 text-muted-foreground" />
            <div className="text-sm">
              <p className="font-medium">CSV Format Requirements:</p>
              <p className="text-muted-foreground">name, code, contact_email, contact_phone, is_active</p>
            </div>
          </div>

          <Button variant="outline" onClick={downloadTemplate} className="w-full">
            <FileText className="h-4 w-4 mr-2" />
            Download CSV Template
          </Button>

          <div className="border-2 border-dashed rounded-lg p-8 text-center">
            <input
              id="csv-upload"
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="hidden"
            />
            <label htmlFor="csv-upload" className="cursor-pointer">
              <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-sm font-medium">Click to upload CSV file</p>
              <p className="text-xs text-muted-foreground mt-1">or drag and drop</p>
            </label>
          </div>

          {preview.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Preview (first 5 rows):</p>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-3 py-2 text-left">Name</th>
                      <th className="px-3 py-2 text-left">Code</th>
                      <th className="px-3 py-2 text-left">Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-2">{row.name}</td>
                        <td className="px-3 py-2">{row.code}</td>
                        <td className="px-3 py-2">{row.contact_email || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleImport} disabled={importing || preview.length === 0}>
              {importing ? "Importing..." : "Import Vendors"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
