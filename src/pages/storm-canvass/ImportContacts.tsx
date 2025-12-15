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
import { ColumnMapper, ColumnMapping } from '@/components/storm-canvass/ColumnMapper';

type ImportStep = 'upload' | 'map' | 'preview' | 'importing' | 'complete';

interface ImportResults {
  imported: number;
  duplicates: number;
  errors: number;
  errorMessages: string[];
}

export default function ImportContacts() {
  const navigate = useNavigate();
  const [step, setStep] = useState<ImportStep>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [rawData, setRawData] = useState<Record<string, unknown>[]>([]);
  const [excelColumns, setExcelColumns] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({
    name: null,
    address: null,
    city: null,
    state: null,
    zipcode: null,
    phone: null,
    email: null,
    status: null,
    repName: null,
    repEmail: null,
    notes: null,
  });
  const [mappedData, setMappedData] = useState<Record<string, unknown>[]>([]);
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
        const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);
        
        // Extract column headers from first row
        const headers = Object.keys(jsonData[0] || {});
        
        setRawData(jsonData);
        setExcelColumns(headers);
        setStep('map');
        toast.success(`Found ${jsonData.length} rows with ${headers.length} columns`);
      } catch (error) {
        console.error('Parse error:', error);
        toast.error('Failed to parse file. Please ensure it\'s a valid Excel file.');
      }
    };
    reader.readAsArrayBuffer(uploadedFile);
  }, []);

  const handleMappingConfirm = useCallback(() => {
    // Transform raw data using the column mapping
    const transformed = rawData.map(row => {
      const mapped: Record<string, unknown> = {};
      
      // Map each field using the column mapping
      if (columnMapping.name) mapped.ho_name = row[columnMapping.name];
      if (columnMapping.address) mapped.address = row[columnMapping.address];
      if (columnMapping.city) mapped.city = row[columnMapping.city];
      if (columnMapping.state) mapped.state = row[columnMapping.state];
      if (columnMapping.zipcode) mapped.zipcode = row[columnMapping.zipcode];
      if (columnMapping.phone) mapped.phone = row[columnMapping.phone];
      if (columnMapping.email) mapped.email = row[columnMapping.email];
      if (columnMapping.status) mapped.status_name = row[columnMapping.status];
      if (columnMapping.repName) mapped.rep_name = row[columnMapping.repName];
      if (columnMapping.repEmail) mapped.rep_email = row[columnMapping.repEmail];
      if (columnMapping.notes) mapped.last_note = row[columnMapping.notes];
      
      return mapped;
    });

    setMappedData(transformed);
    setStep('preview');
  }, [rawData, columnMapping]);

  const handleImport = async () => {
    if (mappedData.length === 0) {
      toast.error('No data to import');
      return;
    }

    setStep('importing');
    setProgress(10);

    try {
      const { data, error } = await supabase.functions.invoke('import-canvass-contacts', {
        body: { 
          contacts: mappedData,
          columnMapping 
        },
      });

      setProgress(100);

      if (error) throw error;

      setResults(data.results);
      setStep('complete');
      
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
      setStep('preview');
    }
  };

  const getStatusBadge = (status: unknown) => {
    if (!status) return <Badge variant="outline">Unknown</Badge>;
    
    const normalized = String(status).toLowerCase();
    if (normalized.includes('interested') && !normalized.includes('not')) {
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
    return <Badge variant="outline">{String(status)}</Badge>;
  };

  const resetImport = () => {
    setStep('upload');
    setFile(null);
    setRawData([]);
    setExcelColumns([]);
    setMappedData([]);
    setResults(null);
    setColumnMapping({
      name: null,
      address: null,
      city: null,
      state: null,
      zipcode: null,
      phone: null,
      email: null,
      status: null,
      repName: null,
      repEmail: null,
      notes: null,
    });
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
            <p className="text-muted-foreground">
              {step === 'upload' && 'Step 1: Upload your Excel file'}
              {step === 'map' && 'Step 2: Map columns to CRM fields'}
              {step === 'preview' && 'Step 3: Review and import'}
              {step === 'importing' && 'Importing contacts...'}
              {step === 'complete' && 'Import complete!'}
            </p>
          </div>
        </div>

        {/* Step Progress Indicator */}
        <div className="flex items-center gap-2">
          {['upload', 'map', 'preview', 'complete'].map((s, i) => (
            <React.Fragment key={s}>
              <div 
                className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                  step === s || (step === 'importing' && s === 'preview')
                    ? 'bg-primary text-primary-foreground' 
                    : step === 'complete' || ['upload', 'map', 'preview'].indexOf(step) > i
                      ? 'bg-green-500 text-white'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {step === 'complete' || ['upload', 'map', 'preview'].indexOf(step) > i ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  i + 1
                )}
              </div>
              {i < 3 && <div className="flex-1 h-0.5 bg-muted" />}
            </React.Fragment>
          ))}
        </div>

        {/* Upload Step */}
        {step === 'upload' && (
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
            <CardContent>
              <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <FileSpreadsheet className="w-12 h-12 mb-3 text-muted-foreground" />
                  <p className="text-lg font-medium">
                    {file ? file.name : 'Click to upload or drag and drop'}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Excel (.xlsx, .xls) or CSV files supported
                  </p>
                </div>
                <input
                  type="file"
                  className="hidden"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileUpload}
                />
              </label>
            </CardContent>
          </Card>
        )}

        {/* Column Mapping Step */}
        {step === 'map' && (
          <ColumnMapper
            excelColumns={excelColumns}
            mapping={columnMapping}
            onMappingChange={setColumnMapping}
            onConfirm={handleMappingConfirm}
            sampleData={rawData.slice(0, 3)}
          />
        )}

        {/* Preview Step */}
        {(step === 'preview' || step === 'importing') && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Preview ({mappedData.length} contacts)</span>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setStep('map')}>
                      Back to Mapping
                    </Button>
                    <Button onClick={handleImport} disabled={step === 'importing'}>
                      {step === 'importing' ? 'Importing...' : `Import ${mappedData.length} Contacts`}
                    </Button>
                  </div>
                </CardTitle>
                <CardDescription>
                  Review the mapped data before importing
                </CardDescription>
              </CardHeader>
              <CardContent>
                {step === 'importing' && (
                  <div className="space-y-2 mb-4">
                    <Progress value={progress} />
                    <p className="text-sm text-muted-foreground text-center">
                      Importing contacts...
                    </p>
                  </div>
                )}
                
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Address</TableHead>
                        <TableHead>City</TableHead>
                        <TableHead>State</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Rep</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mappedData.slice(0, 20).map((contact, index) => (
                        <TableRow key={index}>
                          <TableCell className="font-medium">{String(contact.ho_name || '-')}</TableCell>
                          <TableCell className="max-w-[200px] truncate">{String(contact.address || '-')}</TableCell>
                          <TableCell>{String(contact.city || '-')}</TableCell>
                          <TableCell>{String(contact.state || '-')}</TableCell>
                          <TableCell>{String(contact.phone || '-')}</TableCell>
                          <TableCell>{getStatusBadge(contact.status_name)}</TableCell>
                          <TableCell className="text-xs">{String(contact.rep_name || contact.rep_email || '-')}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {mappedData.length > 20 && (
                  <p className="text-sm text-muted-foreground mt-2 text-center">
                    Showing first 20 of {mappedData.length} contacts
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Complete Step */}
        {step === 'complete' && results && (
          <Card>
            <CardHeader>
              <CardTitle>Import Complete</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="flex items-center gap-2 p-4 bg-green-500/10 rounded-lg">
                  <CheckCircle2 className="h-6 w-6 text-green-600" />
                  <div>
                    <p className="text-3xl font-bold">{results.imported}</p>
                    <p className="text-sm text-muted-foreground">Imported</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-4 bg-yellow-500/10 rounded-lg">
                  <AlertCircle className="h-6 w-6 text-yellow-600" />
                  <div>
                    <p className="text-3xl font-bold">{results.duplicates}</p>
                    <p className="text-sm text-muted-foreground">Duplicates</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 p-4 bg-red-500/10 rounded-lg">
                  <XCircle className="h-6 w-6 text-red-600" />
                  <div>
                    <p className="text-3xl font-bold">{results.errors}</p>
                    <p className="text-sm text-muted-foreground">Errors</p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <Button onClick={() => navigate('/client-list')} className="flex-1">
                  View Imported Contacts
                </Button>
                <Button variant="outline" onClick={resetImport}>
                  Import More
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </GlobalLayout>
  );
}
