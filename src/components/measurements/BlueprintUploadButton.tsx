import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { FileStack, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useActiveTenantId } from '@/hooks/useActiveTenantId';
import {
  uploadBlueprintDocument,
  parseBlueprintDocument,
} from '@/integrations/blueprintApi';

interface BlueprintUploadButtonProps {
  pipelineEntryId: string;
  contactId?: string;
  address?: string;
}

export const BlueprintUploadButton: React.FC<BlueprintUploadButtonProps> = ({
  pipelineEntryId,
  contactId,
  address,
}) => {
  const { activeTenantId: tenantId } = useActiveTenantId();
  const { toast } = useToast();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleClick = () => inputRef.current?.click();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!file) return;
    if (!tenantId) {
      toast({ title: 'No active company', variant: 'destructive' });
      return;
    }
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast({ title: 'PDF only', description: 'Blueprint upload requires a PDF.', variant: 'destructive' });
      return;
    }

    setUploading(true);
    try {
      const docId = crypto.randomUUID();
      const path = `${tenantId}/${docId}/${file.name}`;
      const { error: upErr } = await supabase.storage
        .from('blueprint-documents')
        .upload(path, file, { contentType: 'application/pdf', upsert: false });
      if (upErr) {
        const { error: upErr2 } = await supabase.storage
          .from('blueprints')
          .upload(path, file, { contentType: 'application/pdf', upsert: false });
        if (upErr2) throw upErr2;
      }

      const result = await uploadBlueprintDocument({
        file_name: file.name,
        file_path: path,
        property_address: address,
        contact_id: contactId,
        pipeline_entry_id: pipelineEntryId,
      });

      await parseBlueprintDocument(result.document.id).catch(() => {});

      toast({
        title: 'Blueprint uploaded',
        description: 'Parsing started. Opening document…',
      });
      navigate(`/blueprints/${result.document.id}`);
    } catch (err: any) {
      toast({
        title: 'Upload failed',
        description: err?.message || String(err),
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={handleFile}
      />
      <Button
        variant="outline"
        onClick={handleClick}
        disabled={uploading}
        className="w-full sm:w-auto"
      >
        {uploading ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Uploading…
          </>
        ) : (
          <>
            <FileStack className="h-4 w-4 mr-2" /> Upload Blueprint
          </>
        )}
      </Button>
    </>
  );
};
