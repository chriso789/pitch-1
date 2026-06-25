import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, MessageSquare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";

interface PortalMessage {
  id: string;
  message: string;
  sender_type: string;
  created_at: string;
  is_read: boolean | null;
}

interface Props {
  pipelineEntryId: string;
}

export function PortalMessagesPanel({ pipelineEntryId }: Props) {
  const { activeTenantId } = useActiveTenantId();
  const { toast } = useToast();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // resolve project_id from pipeline_entry_id
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("projects")
        .select("id")
        .eq("pipeline_entry_id", pipelineEntryId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setProjectId(data?.id ?? null);
    })();
    return () => { cancelled = true; };
  }, [pipelineEntryId]);

  // load + subscribe to messages for this project
  useEffect(() => {
    if (!projectId) return;
    const load = async () => {
      const { data } = await supabase
        .from("portal_messages")
        .select("id, message, sender_type, created_at, is_read")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });
      setMessages(data || []);
      // mark homeowner messages as read
      const unread = (data || []).filter(m => m.sender_type === "homeowner" && !m.is_read).map(m => m.id);
      if (unread.length) {
        await supabase
          .from("portal_messages")
          .update({ is_read: true, read_at: new Date().toISOString() })
          .in("id", unread);
      }
    };
    load();

    const channel = supabase
      .channel(`portal-msgs-${projectId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "portal_messages", filter: `project_id=eq.${projectId}` },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as PortalMessage]);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [projectId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  const sendReply = async () => {
    if (!input.trim() || !projectId || !activeTenantId) return;
    setSending(true);
    const { error } = await supabase.from("portal_messages").insert({
      tenant_id: activeTenantId,
      project_id: projectId,
      sender_type: "admin",
      recipient_type: "homeowner",
      message: input.trim(),
    });
    setSending(false);
    if (error) {
      toast({ title: "Could not send", description: error.message, variant: "destructive" });
      return;
    }
    setInput("");
  };

  if (!projectId) {
    return (
      <div className="text-center text-sm text-muted-foreground py-6">
        Portal messages will appear here once this lead is converted to a project.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[400px]">
      <ScrollArea className="flex-1 pr-3" ref={scrollRef as any}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-8">
            <MessageSquare className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm">No messages yet from the homeowner portal.</p>
          </div>
        ) : (
          <div className="space-y-2 py-2">
            {messages.map((m) => {
              const fromHomeowner = m.sender_type === "homeowner";
              return (
                <div key={m.id} className={`flex ${fromHomeowner ? "justify-start" : "justify-end"}`}>
                  <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${fromHomeowner ? "bg-muted" : "bg-primary text-primary-foreground"}`}>
                    <div className="whitespace-pre-wrap">{m.message}</div>
                    <div className={`text-[10px] mt-1 ${fromHomeowner ? "text-muted-foreground" : "text-primary-foreground/80"}`}>
                      {fromHomeowner ? "Homeowner" : "You"} • {formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
      <div className="flex gap-2 pt-2 border-t mt-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Reply to homeowner…"
          rows={2}
          className="resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendReply();
            }
          }}
        />
        <Button onClick={sendReply} disabled={sending || !input.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
