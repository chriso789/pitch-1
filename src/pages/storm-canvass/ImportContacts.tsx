import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertCircle, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface ParsedContact {
  date_in_tz?: string;
  time_in_tz?: string;
  status_name?: string;
  sub_status_name?: string;
  email?: string;
  ho_name?: string;
  address?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  last_note?: string;
}

interface ImportResults {
  imported: number;
  duplicates: number;
  errors: number;
  errorMessages: string[];
}

export default function ImportContacts() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedContact[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<ImportResults | null>(null);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;

    setFile(uploadedFile);
    setResults(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json<ParsedContact>(worksheet);
        
        setParsedData(jsonData);
        toast.success(`Parsed ${jsonData.length} contacts from file`);
      } catch (error) {
        console.error('Parse error:', error);
        toast.error('Failed to parse file. Please ensure it\'s a valid Excel file.');
      }
    };
    reader.readAsArrayBuffer(uploadedFile);
  }, []);

  const handleImport = async () => {
    if (parsedData.length === 0) {
      toast.error('No data to import');
      return;
    }

    setIsImporting(true);
    setProgress(10);

    try {
      const { data, error } = await supabase.functions.invoke('import-canvass-contacts', {
        body: { contacts: parsedData },
      });

      setProgress(100);

      if (error) throw error;

      setResults(data.results);
      
      if (data.results.imported > 0) {
        toast.success(`Successfully imported ${data.results.imported} contacts`);
      }
      
      if (data.results.duplicates > 0) {
        toast.info(`Skipped ${data.results.duplicates} duplicate contacts`);
      }
      
      if (data.results.errors > 0) {
        toast.warning(`${data.results.errors} contacts had errors`);
      }
    } catch (error) {
      console.error('Import error:', error);
      toast.error('Import failed: ' + (error as Error).message);
    } finally {
      setIsImporting(false);
    }
  };

  const getStatusBadge = (status: string | undefined) => {
    if (!status) return <Badge variant="outline">Unknown</Badge>;
    
    const normalized = status.toLowerCase();
    if (normalized.includes('interested')) {
      return <Badge className="bg-green-500/20 text-green-700">Interested</Badge>;
    }
    if (normalized.includes('storm')) {
      return <Badge className="bg-orange-500/20 text-orange-700">Storm Damage</Badge>;
    }
    if (normalized.includes('old roof')) {
      return <Badge className="bg-blue-500/20 text-blue-700">Old Roof</Badge>;
    }
    if (normalized.includes('not interested')) {
      return <Badge className="bg-red-500/20 text-red-700">Not Interested</Badge>;
    }
    return <Badge variant="outline">{status}</Badge>;
  };

  return (
    <GlobalLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/storm-canvass')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Import Canvass Contacts</h1>
            <p className="text-muted-foreground">Upload your canvass Excel file to import contacts</p>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Upload Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Upload File
              </CardTitle>
              <CardDescription>
                Upload an Excel (.xlsx) or CSV file with canvass contacts
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <FileSpreadsheet className="w-8 h-8 mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {file ? file.name : 'Click to upload or drag and drop'}
                  </p>
                </div>
                <input
                  type="file"
                  className="hidden"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileUpload}
                />
              </label>

              {parsedData.length > 0 && (
                <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <span className="text-sm font-medium">{parsedData.length} contacts ready</span>
                  <Button onClick={handleImport} disabled={isImporting}>
                    {isImporting ? 'Importing...' : 'Import All'}
                  </Button>
                </div>
              )}

              {isImporting && (
                <div className="space-y-2">
                  <Progress value={progress} />
                  <p className="text-sm text-muted-foreground text-center">
                    Importing contacts...
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Results Section */}
          <Card>
            <CardHeader>
              <CardTitle>Import Results</CardTitle>
            </CardHeader>
            <CardContent>
              {results ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="flex items-center gap-2 p-3 bg-green-500/10 rounded-lg">
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                      <div>
                        <p className="text-2xl font-bold">{results.imported}</p>
                        <p className="text-xs text-muted-foreground">Imported</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 p-3 bg-yellow-500/10 rounded-lg">
                      <AlertCircle className="h-5 w-5 text-yellow-600" />
                      <div>
                        <p className="text-2xl font-bold">{results.duplicates}</p>
                        <p className="text-xs text-muted-foreground">Duplicates</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 p-3 bg-red-500/10 rounded-lg">
                      <XCircle className="h-5 w-5 text-red-600" />
                      <div>
                        <p className="text-2xl font-bold">{results.errors}</p>
                        <p className="text-xs text-muted-foreground">Errors</p>
                      </div>
                    </div>
                  </div>

                  {results.imported > 0 && (
                    <Button 
                      className="w-full" 
                      onClick={() => navigate('/client-list')}
                    >
                      View Imported Contacts
                    </Button>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <FileSpreadsheet className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>Upload a file to see import results</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Preview Table */}
        {parsedData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Preview ({Math.min(20, parsedData.length)} of {parsedData.length})</CardTitle>
              <CardDescription>
                First 20 rows from your file
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Address</TableHead>
                      <TableHead>City</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Rep Email</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedData.slice(0, 20).map((contact, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">{contact.ho_name || '-'}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{contact.address || '-'}</TableCell>
                        <TableCell>{contact.city || '-'}</TableCell>
                        <TableCell>{contact.state || '-'}</TableCell>
                        <TableCell>{getStatusBadge(contact.status_name)}</TableCell>
                        <TableCell className="text-xs">{contact.email || '-'}</TableCell>
                        <TableCell className="text-xs">{contact.date_in_tz || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </GlobalLayout>
  );
}
