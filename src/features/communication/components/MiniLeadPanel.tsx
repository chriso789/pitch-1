import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  User, Phone, Mail, MapPin, DollarSign, Home,
  MessageSquare, Send, Clock, Plus, Loader2
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface LeadDetails {
  contact: {
    id: string;
    first_name: string;
    last_name: string;
    phone: string;
    email?: string;
    address_street?: string;
    address_city?: string;
    address_state?: string;
    address_zip?: string;
    qualification_status?: string;
    lead_score?: number;
    type?: string;
  };
  pipeline?: {
    id: string;
    stage_name?: string;
    priority?: string;
    estimated_value?: number;
    assigned_to_name?: string;
    custom_fields?: Record<string, any>;
  };
  recentNotes: Array<{
    id: string;
    content: string;
    created_at: string;
    author_name?: string;
  }>;
  recentCalls: Array<{
    id: string;
    direction: string;
    status: string;
    duration_seconds?: number;
    created_at: string;
  }>;
}

interface MiniLeadPanelProps {
  lead: LeadDetails | null;
  loading?: boolean;
  onSmsClick?: () => void;
  onEmailClick?: () => void;
}

export const MiniLeadPanel: React.FC<MiniLeadPanelProps> = ({
  lead,
  loading = false,
  onSmsClick,
  onEmailClick,
}) => {
  const { toast } = useToast();
  const [newNote, setNewNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const handleAddNote = async () => {
    if (!newNote.trim() || !lead?.contact.id) return;
    setSavingNote(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", userData.user?.id)
        .single();

      if (!profile?.tenant_id) throw new Error("No tenant");

      // Find pipeline entry for this contact to attach note
      const { data: pe } = await supabase
        .from("pipeline_entries")
        .select("id")
        .eq("contact_id", lead.contact.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (pe) {
        await supabase.from("internal_notes").insert({
          tenant_id: profile.tenant_id,
          pipeline_entry_id: pe.id,
          content: newNote.trim(),
          author_id: userData.user?.id,
        });
      }

      setNewNote("");
      toast({ title: "Note saved" });
    } catch (err) {
      console.error("Failed to save note:", err);
      toast({ title: "Failed to save note", variant: "destructive" });
    } finally {
      setSavingNote(false);
    }
  };

  if (loading) {
    return (
      <Card className="h-full">
        <CardContent className="flex items-center justify-center h-full py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading lead...</span>
        </CardContent>
      </Card>
    );
  }

  if (!lead) {
    return (
      <Card className="h-full">
        <CardContent className="flex items-center justify-center h-full py-12">
          <p className="text-muted-foreground text-sm">No lead selected</p>
        </CardContent>
      </Card>
    );
  }

  const { contact, pipeline, recentNotes, recentCalls } = lead;
  const fullName = `${contact.first_name} ${contact.last_name}`.trim();
  const fullAddress = [contact.address_street, contact.address_city, contact.address_state, contact.address_zip]
    .filter(Boolean)
    .join(", ");

  const statusColor = (status?: string) => {
    switch (status) {
      case "qualified": return "default";
      case "unqualified": return "secondary";
      case "hot": return "destructive";
      default: return "outline";
    }
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <User className="h-4 w-4" />
          Lead Details
        </CardTitle>
      </CardHeader>

      <ScrollArea className="flex-1">
        <CardContent className="space-y-4 pt-0">
          {/* Contact Info */}
          <div className="space-y-2">
            <h3 className="font-semibold text-lg">{fullName}</h3>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Phone className="h-3.5 w-3.5" />
              <span>{contact.phone}</span>
            </div>
            {contact.email && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Mail className="h-3.5 w-3.5" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
            {fullAddress && (
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{fullAddress}</span>
              </div>
            )}
          </div>

          <Separator />

          {/* Lead Status */}
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {contact.qualification_status && (
                <Badge variant={statusColor(contact.qualification_status)}>
                  {contact.qualification_status}
                </Badge>
              )}
              {pipeline?.priority && (
                <Badge variant="outline">{pipeline.priority} priority</Badge>
              )}
              {contact.type && (
                <Badge variant="secondary">{contact.type}</Badge>
              )}
            </div>

            {pipeline?.estimated_value && (
              <div className="flex items-center gap-2 text-sm">
                <DollarSign className="h-3.5 w-3.5 text-green-500" />
                <span className="font-medium">
                  ${pipeline.estimated_value.toLocaleString()}
                </span>
              </div>
            )}

            {pipeline?.stage_name && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Home className="h-3.5 w-3.5" />
                <span>Stage: {pipeline.stage_name}</span>
              </div>
            )}

            {pipeline?.assigned_to_name && (
              <p className="text-xs text-muted-foreground">
                Assigned to: {pipeline.assigned_to_name}
              </p>
            )}
          </div>

          <Separator />

          {/* Quick Actions */}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1" onClick={onSmsClick}>
              <MessageSquare className="h-3.5 w-3.5 mr-1" />
              SMS
            </Button>
            <Button size="sm" variant="outline" className="flex-1" onClick={onEmailClick}>
              <Mail className="h-3.5 w-3.5 mr-1" />
              Email
            </Button>
          </div>

          <Separator />

          {/* Notes */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-1">
              <Plus className="h-3.5 w-3.5" /> Notes
            </h4>
            <div className="flex gap-2">
              <Textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Add a note..."
                className="text-xs min-h-[60px]"
              />
              <Button
                size="icon"
                variant="ghost"
                onClick={handleAddNote}
                disabled={!newNote.trim() || savingNote}
                className="shrink-0 self-end"
              >
                {savingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            {recentNotes.length > 0 && (
              <div className="space-y-1.5 mt-2">
                {recentNotes.slice(0, 3).map((note) => (
                  <div key={note.id} className="text-xs bg-muted/50 rounded p-2">
                    <p className="text-foreground">{note.content}</p>
                    <p className="text-muted-foreground mt-1">
                      {new Date(note.created_at).toLocaleDateString()}
                      {note.author_name ? ` · ${note.author_name}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Recent Calls */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> Recent Calls
            </h4>
            {recentCalls.length > 0 ? (
              <div className="space-y-1.5">
                {recentCalls.slice(0, 3).map((call) => (
                  <div key={call.id} className="flex items-center justify-between text-xs bg-muted/50 rounded p-2">
                    <div className="flex items-center gap-1.5">
                      <Phone className="h-3 w-3" />
                      <span className="capitalize">{call.direction}</span>
                      <Badge variant="outline" className="text-[10px] px-1 py-0">
                        {call.status}
                      </Badge>
                    </div>
                    <span className="text-muted-foreground">
                      {call.duration_seconds ? `${Math.floor(call.duration_seconds / 60)}m ${call.duration_seconds % 60}s` : "—"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No recent calls</p>
            )}
          </div>
        </CardContent>
      </ScrollArea>
    </Card>
  );
};
