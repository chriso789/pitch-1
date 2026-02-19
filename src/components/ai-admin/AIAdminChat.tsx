import React, { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { toast } from "sonner";
import { Bot, Send, Plus, Loader2, User, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const SUGGESTED_PROMPTS = [
  "Show me all pipeline stages",
  "How many stagnant leads do we have?",
  "What are the contact stats by status?",
  "Add a new lead source called 'Google Ads'",
  "Search contacts for 'Smith'",
  "Show me pipeline value by stage",
];

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-admin-agent`;

export const AIAdminChat: React.FC = () => {
  const { user } = useCurrentUser();
  const { activeTenantId } = useActiveTenantId();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Load or create session
  useEffect(() => {
    if (!user?.id || !activeTenantId) return;
    loadLatestSession();
  }, [user?.id, activeTenantId]);

  const loadLatestSession = async () => {
    if (!user?.id || !activeTenantId) return;

    const { data } = await supabase
      .from("ai_chat_sessions")
      .select("id")
      .eq("user_id", user.id)
      .eq("tenant_id", activeTenantId)
      .eq("session_type", "admin")
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      setSessionId(data.id);
      // Load messages
      const { data: msgs } = await supabase
        .from("ai_chat_messages")
        .select("id, role, content")
        .eq("session_id", data.id)
        .order("created_at", { ascending: true });

      if (msgs) {
        setMessages(
          msgs.map((m) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
          }))
        );
      }
    }
  };

  const createSession = async (): Promise<string | null> => {
    if (!user?.id || !activeTenantId) return null;
    const { data, error } = await supabase
      .from("ai_chat_sessions")
      .insert({
        user_id: user.id,
        tenant_id: activeTenantId,
        session_type: "admin",
      })
      .select("id")
      .single();

    if (error) {
      console.error("Failed to create session:", error);
      return null;
    }
    setSessionId(data.id);
    return data.id;
  };

  const persistMessage = async (sid: string, role: string, content: string, actionsTaken?: unknown) => {
    if (!activeTenantId) return;
    await supabase.from("ai_chat_messages").insert({
      session_id: sid,
      tenant_id: activeTenantId,
      role,
      content,
      actions_taken: (actionsTaken || null) as any,
    } as any);
    // Update session timestamp
    await supabase
      .from("ai_chat_sessions")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", sid);
  };

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: text.trim(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setIsLoading(true);

      let sid = sessionId;
      if (!sid) {
        sid = await createSession();
        if (!sid) {
          toast.error("Failed to create chat session");
          setIsLoading(false);
          return;
        }
      }

      // Persist user message
      await persistMessage(sid, "user", userMsg.content);

      // Build message history for API
      const apiMessages = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      let assistantContent = "";

      try {
        const session = await supabase.auth.getSession();
        const accessToken = session.data.session?.access_token;

        const resp = await fetch(CHAT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ messages: apiMessages }),
        });

        if (!resp.ok) {
          if (resp.status === 429) {
            toast.error("Rate limited — please try again in a moment.");
          } else if (resp.status === 402) {
            toast.error("AI credits exhausted — please add funds.");
          } else {
            const body = await resp.json().catch(() => ({}));
            toast.error((body as { error?: string }).error || "AI request failed");
          }
          setIsLoading(false);
          return;
        }

        const actionsTaken = resp.headers.get("X-Actions-Taken");

        // Stream SSE
        const reader = resp.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const upsertAssistant = (chunk: string) => {
          assistantContent += chunk;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return prev.map((m, i) =>
                i === prev.length - 1 ? { ...m, content: assistantContent } : m
              );
            }
            return [...prev, { id: crypto.randomUUID(), role: "assistant", content: assistantContent }];
          });
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let newlineIndex: number;
          while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
            let line = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (line.startsWith(":") || line.trim() === "") continue;
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") break;
            try {
              const parsed = JSON.parse(jsonStr);
              const content = parsed.choices?.[0]?.delta?.content as string | undefined;
              if (content) upsertAssistant(content);
            } catch {
              buffer = line + "\n" + buffer;
              break;
            }
          }
        }

        // Flush remaining buffer
        if (buffer.trim()) {
          for (let raw of buffer.split("\n")) {
            if (!raw) continue;
            if (raw.endsWith("\r")) raw = raw.slice(0, -1);
            if (!raw.startsWith("data: ")) continue;
            const jsonStr = raw.slice(6).trim();
            if (jsonStr === "[DONE]") continue;
            try {
              const parsed = JSON.parse(jsonStr);
              const content = parsed.choices?.[0]?.delta?.content as string | undefined;
              if (content) upsertAssistant(content);
            } catch {
              /* ignore */
            }
          }
        }

        // Persist assistant message
        if (assistantContent) {
          await persistMessage(
            sid,
            "assistant",
            assistantContent,
            actionsTaken ? JSON.parse(actionsTaken) : null
          );
        }
      } catch (err) {
        console.error("AI Admin chat error:", err);
        toast.error("Failed to get AI response");
      } finally {
        setIsLoading(false);
      }
    },
    [messages, isLoading, sessionId, activeTenantId]
  );

  const handleNewConversation = async () => {
    setMessages([]);
    setSessionId(null);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-280px)] min-h-[500px]">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-foreground">AI Admin Assistant</h2>
            <p className="text-xs text-muted-foreground">Manage config & analyze CRM data</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleNewConversation}>
          <Plus className="h-4 w-4 mr-1" />
          New Chat
        </Button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-6">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-8 w-8 text-primary" />
            </div>
            <div className="text-center">
              <h3 className="font-semibold text-lg text-foreground">What can I help you with?</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Ask me to manage settings, query data, or analyze your pipeline.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  className="text-left text-sm px-4 py-3 rounded-lg border border-border hover:bg-accent transition-colors text-foreground"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex gap-3",
                msg.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              {msg.role === "assistant" && (
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
              )}
              <Card
                className={cn(
                  "max-w-[80%] px-4 py-3",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                )}
              >
                {msg.role === "assistant" ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none text-foreground">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                )}
              </Card>
              {msg.role === "user" && (
                <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center shrink-0 mt-1">
                  <User className="h-4 w-4 text-secondary-foreground" />
                </div>
              )}
            </div>
          ))
        )}
        {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex gap-3">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <Card className="bg-muted px-4 py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </Card>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border pt-4">
        <div className="flex gap-2">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about settings, pipeline data, contacts..."
            className="min-h-[44px] max-h-[120px] resize-none"
            disabled={isLoading}
            rows={1}
          />
          <Button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isLoading}
            size="icon"
            className="shrink-0 h-[44px] w-[44px]"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
