import React, { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Send, Pin, PinOff, Trash2, Loader2, AtSign, MessageSquareText, History, Search, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from '@/components/ui/use-toast';

interface ContactNotesSectionProps {
  contactId: string;
  tenantId: string;
}

const MANAGER_ROLES = ['master', 'owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager'];

const getFullName = (firstName: string | null, lastName: string | null): string =>
  [firstName, lastName].filter(Boolean).join(' ') || 'Unknown';

const getInitials = (firstName: string | null, lastName: string | null): string =>
  ((firstName?.[0] || '') + (lastName?.[0] || '')).toUpperCase() || '?';

export function ContactNotesSection({ contactId, tenantId }: ContactNotesSectionProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [newNote, setNewNote] = useState('');
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [mentionStartIndex, setMentionStartIndex] = useState<number | null>(null);
  const [deleteNoteId, setDeleteNoteId] = useState<string | null>(null);
  const [showAllNotes, setShowAllNotes] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddingNote, setIsAddingNote] = useState(false);

  const { data: userProfile } = useQuery({
    queryKey: ['user-profile-role', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('role').eq('id', user?.id).maybeSingle();
      return data;
    },
    enabled: !!user?.id,
  });

  const canDeleteNotes = userProfile?.role && MANAGER_ROLES.includes(userProfile.role);

  const { data: notes = [], isLoading: notesLoading } = useQuery({
    queryKey: ['contact-notes', contactId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('internal_notes')
        .select('id, content, author_id, mentioned_user_ids, is_pinned, created_at')
        .eq('contact_id', contactId)
        .is('pipeline_entry_id', null)
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;

      const authorIds = [...new Set((data || []).map(n => n.author_id))];
      if (authorIds.length === 0) return [];
      const { data: authors } = await supabase.from('profiles').select('id, first_name, last_name').in('id', authorIds);
      const authorMap = new Map(authors?.map(a => [a.id, a]) || []);

      return (data || []).map(note => ({ ...note, author: authorMap.get(note.author_id) }));
    },
    enabled: !!contactId,
  });

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['team-members', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, email, role, is_developer')
        .eq('tenant_id', tenantId)
        .neq('role', 'master')
        .neq('is_developer', true)
        .order('first_name');
      if (error) return [];
      return data || [];
    },
    enabled: !!tenantId,
  });

  const filteredMembers = teamMembers.filter(member => {
    if (!mentionSearch) return true;
    const name = getFullName(member.first_name, member.last_name).toLowerCase();
    return name.includes(mentionSearch.toLowerCase()) || member.email?.toLowerCase().includes(mentionSearch.toLowerCase());
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    setNewNote(value);
    const textBeforeCursor = value.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      const charBeforeAt = lastAtIndex > 0 ? value[lastAtIndex - 1] : ' ';
      if ((charBeforeAt === ' ' || charBeforeAt === '\n' || lastAtIndex === 0) && !textAfterAt.includes(' ')) {
        setShowMentionDropdown(true);
        setMentionSearch(textAfterAt);
        setMentionStartIndex(lastAtIndex);
        return;
      }
    }
    setShowMentionDropdown(false);
    setMentionStartIndex(null);
  };

  const handleSelectMention = (member: typeof teamMembers[0]) => {
    if (mentionStartIndex === null) return;
    const displayName = getFullName(member.first_name, member.last_name);
    const beforeMention = newNote.slice(0, mentionStartIndex);
    const afterMentionStart = newNote.slice(mentionStartIndex + 1);
    const spaceIndex = afterMentionStart.indexOf(' ');
    const restOfText = spaceIndex >= 0 ? afterMentionStart.slice(spaceIndex) : '';
    const newText = `${beforeMention}@${displayName} ${restOfText}`;
    setNewNote(newText);
    setShowMentionDropdown(false);
    setMentionStartIndex(null);
    const cursorPosition = mentionStartIndex + displayName.length + 2;
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.selectionStart = cursorPosition;
        textareaRef.current.selectionEnd = cursorPosition;
      }
    }, 0);
  };

  const extractMentionedUserIds = (content: string): string[] => {
    const mentionedIds: string[] = [];
    teamMembers.forEach(member => {
      const name = getFullName(member.first_name, member.last_name);
      if (content.includes(`@${name}`)) mentionedIds.push(member.id);
    });
    return mentionedIds;
  };

  const handleSubmit = async () => {
    if (!newNote.trim() || !user?.id) return;
    setIsSubmitting(true);
    try {
      const mentionedUserIds = extractMentionedUserIds(newNote);
      const { error } = await supabase.from('internal_notes').insert({
        tenant_id: tenantId,
        contact_id: contactId,
        author_id: user.id,
        content: newNote.trim(),
        mentioned_user_ids: mentionedUserIds,
      });
      if (error) throw error;

      // Send notifications to mentioned users
      if (mentionedUserIds.length > 0) {
        try {
          await supabase.functions.invoke('send-mention-notification', {
            body: {
              contact_id: contactId,
              mentioned_user_ids: mentionedUserIds,
              author_id: user.id,
              note_content: newNote.trim(),
            }
          });
        } catch (notifyError) {
          console.error('Failed to send mention notifications:', notifyError);
        }
      }

      setNewNote('');
      setIsAddingNote(false);
      queryClient.invalidateQueries({ queryKey: ['contact-notes', contactId] });
      toast({ title: 'Note added' });
    } catch (error) {
      console.error('Error adding note:', error);
      toast({ title: 'Error', description: 'Failed to add note', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelAdd = () => { setNewNote(''); setIsAddingNote(false); setShowMentionDropdown(false); };

  const handleTogglePin = async (noteId: string, currentlyPinned: boolean) => {
    const { error } = await supabase.from('internal_notes').update({ is_pinned: !currentlyPinned }).eq('id', noteId);
    if (!error) queryClient.invalidateQueries({ queryKey: ['contact-notes', contactId] });
  };

  const handleDeleteNote = async () => {
    if (!deleteNoteId) return;
    const { error } = await supabase.from('internal_notes').delete().eq('id', deleteNoteId);
    if (!error) {
      queryClient.invalidateQueries({ queryKey: ['contact-notes', contactId] });
      toast({ title: 'Note deleted' });
    }
    setDeleteNoteId(null);
  };

  const renderNoteContent = (content: string) => {
    const memberNames = teamMembers.map(m => getFullName(m.first_name, m.last_name)).filter(name => name && name !== 'Unknown');
    if (memberNames.length === 0) return <span>{content}</span>;
    memberNames.sort((a, b) => b.length - a.length);
    const escapedNames = memberNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(`(@(?:${escapedNames.join('|')}))`, 'gi');
    const parts = content.split(pattern);
    return parts.map((part, index) =>
      part.startsWith('@') ? (
        <span key={index} className="text-primary font-medium bg-primary/10 px-1 rounded">{part}</span>
      ) : <span key={index}>{part}</span>
    );
  };

  const filteredNotes = notes.filter(note =>
    !searchTerm ||
    note.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
    getFullName(note.author?.first_name, note.author?.last_name).toLowerCase().includes(searchTerm.toLowerCase())
  );

  const previewNotes = notes.slice(0, 5);

  return (
    <>
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="p-4 pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquareText className="h-4 w-4 text-primary" />
              <span>Contact Notes</span>
              {notes.length > 0 && <Badge variant="secondary" className="text-xs">{notes.length}</Badge>}
            </CardTitle>
            {notes.length > 0 && (
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowAllNotes(true)}>
                <History className="h-3 w-3 mr-1" />
                View All
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          {!isAddingNote && (
            <Button
              variant="outline"
              className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
              onClick={() => { setIsAddingNote(true); setTimeout(() => textareaRef.current?.focus(), 0); }}
            >
              <Plus className="h-4 w-4" />
              Add a contact note...
            </Button>
          )}

          {isAddingNote && (
            <div className="space-y-2 p-3 border rounded-lg bg-background">
              <div className="relative">
                <Textarea
                  ref={textareaRef}
                  value={newNote}
                  onChange={handleInputChange}
                  placeholder="Add a note about this contact... Use @name to mention team members"
                  className="min-h-[80px] resize-none text-sm pr-8"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSubmit(); }
                    if (e.key === 'Escape') { handleCancelAdd(); }
                  }}
                />
                <AtSign className="absolute right-2 top-2 h-4 w-4 text-muted-foreground/50" />
                {showMentionDropdown && filteredMembers.length > 0 && (
                  <div className="absolute bottom-full left-0 mb-1 w-64 bg-popover border rounded-md shadow-lg z-50 max-h-[150px] overflow-y-auto">
                    {filteredMembers.slice(0, 5).map((member) => (
                      <button key={member.id} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent text-left text-sm" onClick={() => handleSelectMention(member)}>
                        <Avatar className="h-5 w-5"><AvatarFallback className="text-[8px]">{getInitials(member.first_name, member.last_name)}</AvatarFallback></Avatar>
                        <span className="truncate">{getFullName(member.first_name, member.last_name)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex justify-between items-center">
                <p className="text-[10px] text-muted-foreground">Press ⌘+Enter to send • @mention to notify</p>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleCancelAdd}>Cancel</Button>
                  <Button size="sm" className="h-7 text-xs" onClick={handleSubmit} disabled={!newNote.trim() || isSubmitting}>
                    {isSubmitting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Send className="h-3 w-3 mr-1" />}
                    Send
                  </Button>
                </div>
              </div>
            </div>
          )}

          {notesLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : previewNotes.length > 0 ? (
            <div className="space-y-2">
              {previewNotes.map((note) => (
                <div key={note.id} className={`p-2 rounded-lg border text-sm ${note.is_pinned ? 'bg-warning/10 border-warning/30' : 'bg-background border-border'}`}>
                  <div className="flex items-start gap-2">
                    <Avatar className="h-6 w-6 shrink-0">
                      <AvatarFallback className="text-[10px]">{getInitials(note.author?.first_name, note.author?.last_name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-xs">{getFullName(note.author?.first_name, note.author?.last_name)}</span>
                        <span className="text-[10px] text-muted-foreground">{format(new Date(note.created_at), 'MMM d, h:mm a')}</span>
                        {note.is_pinned && <Pin className="h-3 w-3 text-warning" />}
                      </div>
                      <p className="text-xs mt-1 whitespace-pre-wrap break-words">{renderNoteContent(note.content)}</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleTogglePin(note.id, note.is_pinned)}>
                        {note.is_pinned ? <PinOff className="h-3 w-3 text-muted-foreground" /> : <Pin className="h-3 w-3 text-muted-foreground" />}
                      </Button>
                      {canDeleteNotes && (
                        <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => setDeleteNoteId(note.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {notes.length > 5 && (
                <button onClick={() => setShowAllNotes(true)} className="w-full text-xs text-primary hover:underline py-1">
                  +{notes.length - 5} more notes
                </button>
              )}
            </div>
          ) : !isAddingNote && (
            <p className="text-xs text-muted-foreground text-center py-2">No contact notes yet. Track follow-ups and important details here.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={showAllNotes} onOpenChange={setShowAllNotes}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquareText className="h-5 w-5 text-primary" />
              All Contact Notes
            </DialogTitle>
            <DialogDescription>
              Complete history of notes for this contact ({notes.length} total)
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search notes..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" />
          </div>
          <ScrollArea className="flex-1 min-h-0 max-h-[400px]">
            <div className="space-y-3 pr-4">
              {filteredNotes.length > 0 ? filteredNotes.map((note) => (
                <div key={note.id} className={`p-3 rounded-lg border ${note.is_pinned ? 'bg-warning/10 border-warning/30' : 'bg-card border-border'}`}>
                  <div className="flex items-start gap-3">
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarFallback className="text-xs">{getInitials(note.author?.first_name, note.author?.last_name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{getFullName(note.author?.first_name, note.author?.last_name)}</span>
                        <span className="text-xs text-muted-foreground">{format(new Date(note.created_at), 'MMM d, yyyy at h:mm a')}</span>
                        {note.is_pinned && <Pin className="h-3 w-3 text-warning" />}
                      </div>
                      <p className="text-sm mt-2 whitespace-pre-wrap break-words">{renderNoteContent(note.content)}</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleTogglePin(note.id, note.is_pinned)}>
                        {note.is_pinned ? <PinOff className="h-4 w-4 text-muted-foreground" /> : <Pin className="h-4 w-4 text-muted-foreground" />}
                      </Button>
                      {canDeleteNotes && (
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteNoteId(note.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )) : (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {searchTerm ? 'No notes match your search' : 'No notes yet'}
                </p>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteNoteId} onOpenChange={(open) => !open && setDeleteNoteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Note?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete this note.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteNote} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
