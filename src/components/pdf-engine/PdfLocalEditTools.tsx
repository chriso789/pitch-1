import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PdfTextInspector } from './PdfTextInspector';
import { PdfFormEditor } from './PdfFormEditor';

export function PdfLocalEditTools() {
  const [file, setFile] = useState<{ bytes: Uint8Array; name: string } | null>(null);
  return <div className="space-y-3"><Input type="file" accept="application/pdf,.pdf" aria-label="Open PDF for text inspection and forms" onChange={async e => { const f = e.target.files?.[0]; if (f) setFile({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }); }} />
    {file && <Tabs defaultValue="text"><TabsList><TabsTrigger value="text">Original text</TabsTrigger><TabsTrigger value="forms">Fill Forms</TabsTrigger></TabsList><TabsContent value="text"><PdfTextInspector bytes={file.bytes} /></TabsContent><TabsContent value="forms"><PdfFormEditor bytes={file.bytes} name={file.name} /></TabsContent></Tabs>}
  </div>;
}