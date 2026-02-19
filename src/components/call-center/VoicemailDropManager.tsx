import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Voicemail, Plus, Trash2, Loader2, Upload, Play, FileAudio
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { toast } from '@/hooks/use-toast';
import { format } from 'date-fns';

export const VoicemailDropManager: React.FC = () => {
  const tenantId = useEffectiveTenantId();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [script, setScript] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: templates, isLoading } = useQuery({
    queryKey: ['voicemail-templates', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from('voicemail_templates')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!tenantId,
  });

  const handleCreate = async () => {
    if (!tenantId || !name.trim()) {
      toast({ title: 'Enter a name', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      let audioUrl: string | null = null;

      // Upload audio file if provided
      if (file) {
        const ext = file.name.split('.').pop();
        const path = `${tenantId}/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from('voicemail-drops')
          .upload(path, file);
        if (uploadErr) throw uploadErr;

        const { data: urlData } = supabase.storage
          .from('voicemail-drops')
          .getPublicUrl(path);
        audioUrl = urlData.publicUrl;
      }

      const { error } = await supabase.from('voicemail_templates').insert({
        tenant_id: tenantId,
        name: name.trim(),
        script: script.trim() || null,
        audio_url: audioUrl,
        is_tts: !file && !!script.trim(),
        created_by: user?.id,
      });
      if (error) throw error;

      toast({ title: 'Voicemail template created' });
      queryClient.invalidateQueries({ queryKey: ['voicemail-templates'] });
      setShowCreate(false);
      setName('');
      setScript('');
      setFile(null);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await supabase.from('voicemail_templates').delete().eq('id', id);
      queryClient.invalidateQueries({ queryKey: ['voicemail-templates'] });
      toast({ title: 'Template deleted' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Voicemail className="h-5 w-5 text-primary" />
                Voicemail Templates
              </CardTitle>
              <CardDescription>Pre-recorded voicemails for auto-drop when calling</CardDescription>
            </div>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              New Template
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !templates || templates.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Voicemail className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No voicemail templates yet</p>
              <p className="text-xs mt-1">Create one to auto-drop voicemails during dialing</p>
            </div>
          ) : (
            <ScrollArea className="max-h-[400px]">
              <div className="space-y-3">
                {templates.map(t => (
                  <div key={t.id} className="flex items-center gap-3 p-3 border rounded-lg">
                    <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <FileAudio className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{t.name}</div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-xs">
                          {t.is_tts ? 'TTS' : 'Audio'}
                        </Badge>
                        {t.usage_count != null && (
                          <span>Used {t.usage_count}x</span>
                        )}
                        {t.created_at && (
                          <span>{format(new Date(t.created_at), 'MMM d, yyyy')}</span>
                        )}
                      </div>
                      {t.script && (
                        <p className="text-xs text-muted-foreground mt-1 truncate">{t.script}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {t.audio_url && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                          <a href={t.audio_url} target="_blank" rel="noreferrer">
                            <Play className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(t.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Voicemail Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Template Name</Label>
              <Input placeholder="e.g. Intro - Roofing" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Script (for reference or TTS)</Label>
              <Textarea
                placeholder="Hi, this is [name] from [company]..."
                value={script}
                onChange={e => setScript(e.target.value)}
                rows={4}
              />
            </div>
            <div className="space-y-2">
              <Label>Audio File (optional — overrides TTS)</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="file"
                  accept="audio/*"
                  onChange={e => setFile(e.target.files?.[0] || null)}
                />
                {file && (
                  <Badge variant="secondary" className="shrink-0">
                    <Upload className="h-3 w-3 mr-1" />
                    {file.name}
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || !name.trim()}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
