import React, { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { safeStorageUpload } from '@/lib/storage/safeUpload';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Upload, FileText, Loader2, ExternalLink } from 'lucide-react';

/**
 * Renders the upload UI for a checklist item whose label starts with "Upload".
 * - Lists documents previously uploaded against this checklist item (matched
 *   via documents.metadata.checklist_template_id) and links them to the
 *   documents preview via a signed URL.
 * - Provides an Upload button that pushes a file to the 'documents' storage
 *   bucket under the tenant-scoped path and inserts a documents row tied to
 *   the project. After a successful upload it marks the checklist item
 *   complete (which triggers the existing stage auto-advance logic).
 */
interface Props {
  templateId: string;
  templateLabel: string;
  projectId: string;
  tenantId: string;
  pipelineEntryId: string | null;
  workflowId: string | null;
  onUploaded: () => void;
}

export const ChecklistItemUpload: React.FC<Props> = ({
  templateId,
  templateLabel,
  projectId,
  tenantId,
  pipelineEntryId,
  workflowId,
  onUploaded,
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  // Documents already uploaded against this checklist item for this project.
  const { data: docs = [] } = useQuery({
    queryKey: ['checklist-docs', projectId, templateId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('documents')
        .select('id, filename, file_path, mime_type, created_at, metadata')
        .eq('tenant_id', tenantId)
        .eq('project_id', projectId)
        .contains('metadata', { checklist_template_id: templateId } as any)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!projectId && !!tenantId && !!templateId,
  });

  const openSignedUrl = async (file_path: string) => {
    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(file_path, 60 * 10);
    if (error || !data?.signedUrl) {
      toast({ title: 'Could not open file', description: error?.message, variant: 'destructive' });
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
      const safeBase = templateLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'checklist_upload';
      const path = `${tenantId}/projects/${projectId}/checklist/${templateId}/${Date.now()}_${safeBase}.${ext}`;

      const { error: upErr } = await safeStorageUpload({
        bucket: 'documents',
        path,
        file,
        tenantId,
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });
      if (upErr) throw upErr;

      const { error: dbErr } = await supabase.from('documents').insert({
        tenant_id: tenantId,
        project_id: projectId,
        pipeline_entry_id: pipelineEntryId,
        filename: file.name,
        file_path: path,
        file_size: file.size,
        mime_type: file.type || 'application/octet-stream',
        document_type: 'checklist_upload',
        description: templateLabel,
        uploaded_by: user.id,
        metadata: {
          checklist_template_id: templateId,
          checklist_label: templateLabel,
          source: 'production_checklist',
        },
      } as any);
      if (dbErr) throw dbErr;

      // Mark item complete (mirrors toggleChecklistMutation insert path).
      if (workflowId) {
        const { data: existing } = await supabase
          .from('production_checklist_completions')
          .select('id')
          .eq('production_workflow_id', workflowId)
          .eq('checklist_template_id', templateId)
          .maybeSingle();
        if (existing) {
          await supabase.from('production_checklist_completions').update({
            completed: true,
            completed_by: user.id,
            completed_at: new Date().toISOString(),
          }).eq('id', existing.id);
        } else {
          await supabase.from('production_checklist_completions').insert({
            tenant_id: tenantId,
            production_workflow_id: workflowId,
            checklist_template_id: templateId,
            completed: true,
            completed_by: user.id,
            completed_at: new Date().toISOString(),
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checklist-docs', projectId, templateId] });
      queryClient.invalidateQueries({ queryKey: ['checklist-completions'] });
      queryClient.invalidateQueries({ queryKey: ['project-documents', projectId] });
      toast({ title: 'Uploaded', description: `${templateLabel} attached to the project.` });
      onUploaded();
    },
    onError: (e: any) => {
      toast({ title: 'Upload failed', description: e?.message || 'Unknown error', variant: 'destructive' });
    },
    onSettled: () => setBusy(false),
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {docs.map((d: any) => (
        <button
          key={d.id}
          type="button"
          onClick={() => openSignedUrl(d.file_path)}
          className="inline-flex items-center gap-1 rounded-md border bg-muted/30 hover:bg-muted px-2 py-1 text-xs"
          title={d.filename}
        >
          <FileText className="h-3 w-3" />
          <span className="max-w-[140px] truncate">{d.filename}</span>
          <ExternalLink className="h-3 w-3 opacity-60" />
        </button>
      ))}
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept="application/pdf,image/*"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setBusy(true);
          uploadMutation.mutate(f);
        }}
      />
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
      >
        {busy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Upload className="h-3 w-3 mr-1" />}
        Upload
      </Button>
    </div>
  );
};
