import React, { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { toast } from "sonner";
import {
  Bot, Send, Plus, Loader2, User, Sparkles,
  History, FolderKanban, Cpu, Paperclip, X, Image as ImageIcon
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────

interface MessageContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string | MessageContentPart[];
}

interface PendingImage {
  file: File;
  preview: string;
}

interface ChangeEntry {
  id: string;
  tool_name: string;
  description: string | null;
  created_at: string;
}

interface ProjectEntry {
  id: string;
  name: string;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

// ── Helpers ──────────────────────────────────────────────────

function getMessageText(content: string | MessageContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((p) => p.type === "text")
    .map((p) => p.text || "")
    .join(" ");
}

function getMessageImages(content: string | MessageContentPart[]): string[] {
  if (typeof content === "string") return [];
  return content
    .filter((p) => p.type === "image_url" && p.image_url?.url)
    .map((p) => p.image_url!.url);
}

/** Serialize content for DB storage (always a string column) */
function serializeContent(content: string | MessageContentPart[]): string {
  if (typeof content === "string") return content;
  return JSON.stringify(content);
}

/** Deserialize content coming from DB */
function deserializeContent(raw: string): string | MessageContentPart[] {
  if (!raw.startsWith("[")) return raw;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].type) return parsed;
  } catch { /* not json */ }
  return raw;
}

// ── Constants ────────────────────────────────────────────────

const SUGGESTED_PROMPTS = [
  "Show me all pipeline stages",
  "What changes have been made recently?",
  "Suggest system improvements",
  "How many stagnant leads do we have?",
  "Create a project to reorganize our pipeline",
  "Show me the schema of the contacts table",
  "Search contacts for 'Smith'",
  "How many calls were made this month?",
];

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-admin-agent`;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

// ── Component ────────────────────────────────────────────────

export const AIAdminChat: React.FC = () => {
  const { user } = useCurrentUser();
  const { activeTenantId } = useActiveTenantId();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<"openai" | "claude">("openai");
  const [sidebarTab, setSidebarTab] = useState<"changes" | "projects">("changes");
  const [changes, setChanges] = useState<ChangeEntry[]>([]);
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (!user?.id || !activeTenantId) return;
    loadLatestSession();
    loadChanges();
    loadProjects();
  }, [user?.id, activeTenantId]);

  // Cleanup preview URLs on unmount
  useEffect(() => {
    return () => {
      pendingImages.forEach((img) => URL.revokeObjectURL(img.preview));
    };
  }, []);

  const loadChanges = async () => {
    if (!activeTenantId) return;
    const { data } = await supabase
      .from("ai_admin_changes")
      .select("id, tool_name, description, created_at")
      .eq("tenant_id", activeTenantId)
      .order("created_at", { ascending: false })
      .limit(30);
    if (data) setChanges(data as ChangeEntry[]);
  };

  const loadProjects = async () => {
    if (!activeTenantId) return;
    const { data } = await supabase
      .from("ai_admin_projects")
      .select("id, name, description, status, created_at, updated_at")
      .eq("tenant_id", activeTenantId)
      .order("updated_at", { ascending: false })
      .limit(20);
    if (data) setProjects(data as ProjectEntry[]);
  };

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
      const { data: msgs } = await supabase
        .from("ai_chat_messages")
        .select("id, role, content")
        .eq("session_id", data.id)
        .order("created_at", { ascending: true });
      if (msgs) {
        setMessages(msgs.map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: deserializeContent(m.content),
        })));
      }
    }
  };

  const createSession = async (): Promise<string | null> => {
    if (!user?.id || !activeTenantId) return null;
    const { data, error } = await supabase
      .from("ai_chat_sessions")
      .insert({ user_id: user.id, tenant_id: activeTenantId, session_type: "admin" })
      .select("id")
      .single();
    if (error) { console.error("Failed to create session:", error); return null; }
    setSessionId(data.id);
    return data.id;
  };

  const persistMessage = async (sid: string, role: string, content: string | MessageContentPart[], actionsTaken?: unknown) => {
    if (!activeTenantId) return;
    await supabase.from("ai_chat_messages").insert({
      session_id: sid, tenant_id: activeTenantId, role, content: serializeContent(content),
      actions_taken: (actionsTaken || null) as any,
    } as any);
    await supabase.from("ai_chat_sessions")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", sid);
  };

  // ── Image handling ─────────────────────────────────────────

  const addPendingImage = useCallback((file: File) => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast.error("Only PNG, JPEG, WebP, and GIF images are supported.");
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      toast.error("Image must be under 10MB.");
      return;
    }
    const preview = URL.createObjectURL(file);
    setPendingImages((prev) => [...prev, { file, preview }]);
  }, []);

  const removePendingImage = useCallback((index: number) => {
    setPendingImages((prev) => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const uploadImages = async (): Promise<string[]> => {
    if (!activeTenantId || pendingImages.length === 0) return [];
    setIsUploading(true);
    const urls: string[] = [];
    try {
      for (const img of pendingImages) {
        const ext = img.file.name.split(".").pop()?.toLowerCase() || "png";
        const path = `${activeTenantId}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage
          .from("ai-admin-uploads")
          .upload(path, img.file, { contentType: img.file.type, upsert: false });
        if (error) throw error;
        const { data: urlData } = supabase.storage.from("ai-admin-uploads").getPublicUrl(path);
        urls.push(urlData.publicUrl);
      }
    } finally {
      setIsUploading(false);
    }
    return urls;
  };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    let hasImage = false;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) { addPendingImage(file); hasImage = true; }
      }
    }
    // Only prevent default if we captured an image (allow text paste)
    if (hasImage) e.preventDefault();
  }, [addPendingImage]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach((f) => { if (f.type.startsWith("image/")) addPendingImage(f); });
  }, [addPendingImage]);

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragOver(false); }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach((f) => addPendingImage(f));
    e.target.value = "";
  }, [addPendingImage]);

  // ── Send ───────────────────────────────────────────────────

  const sendMessage = useCallback(async (text: string) => {
    if ((!text.trim() && pendingImages.length === 0) || isLoading) return;

    // Upload pending images first
    let imageUrls: string[] = [];
    if (pendingImages.length > 0) {
      try {
        imageUrls = await uploadImages();
      } catch (err) {
        toast.error("Failed to upload images");
        console.error(err);
        return;
      }
    }

    // Build content
    let msgContent: string | MessageContentPart[];
    if (imageUrls.length > 0) {
      const parts: MessageContentPart[] = [];
      imageUrls.forEach((url) => parts.push({ type: "image_url", image_url: { url } }));
      if (text.trim()) parts.push({ type: "text", text: text.trim() });
      msgContent = parts;
    } else {
      msgContent = text.trim();
    }

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: msgContent };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    // Clear pending images
    pendingImages.forEach((img) => URL.revokeObjectURL(img.preview));
    setPendingImages([]);
    setIsLoading(true);

    let sid = sessionId;
    if (!sid) {
      sid = await createSession();
      if (!sid) { toast.error("Failed to create chat session"); setIsLoading(false); return; }
    }
    await persistMessage(sid, "user", msgContent);

    // Build API messages — always send content as-is (string or array)
    const apiMessages = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }));
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
        body: JSON.stringify({
          messages: apiMessages,
          model: selectedModel === "claude" ? "claude" : "openai",
          session_id: sid,
        }),
      });

      if (!resp.ok) {
        if (resp.status === 429) toast.error("Rate limited — please try again in a moment.");
        else if (resp.status === 402) toast.error("AI credits exhausted.");
        else { const body = await resp.json().catch(() => ({})); toast.error((body as any).error || "AI request failed"); }
        setIsLoading(false);
        return;
      }

      const actionsTaken = resp.headers.get("X-Actions-Taken");
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const upsertAssistant = (chunk: string) => {
        assistantContent += chunk;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantContent } : m);
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
          } catch { /* ignore */ }
        }
      }

      if (assistantContent) {
        await persistMessage(sid, "assistant", assistantContent, actionsTaken ? JSON.parse(actionsTaken) : null);
      }
      loadChanges();
      loadProjects();
    } catch (err) {
      console.error("AI Admin chat error:", err);
      toast.error("Failed to get AI response");
    } finally {
      setIsLoading(false);
    }
  }, [messages, isLoading, sessionId, activeTenantId, selectedModel, pendingImages]);

  const handleNewConversation = async () => {
    setMessages([]);
    setSessionId(null);
    setPendingImages([]);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const formatDate = (d: string) => {
    const date = new Date(d);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
  };

  // ── Render ─────────────────────────────────────────────────

  return (
    <div
      className="flex h-[calc(100vh-280px)] min-h-[500px] gap-4"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm border-2 border-dashed border-primary rounded-lg pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-primary">
            <ImageIcon className="h-10 w-10" />
            <p className="text-sm font-medium">Drop images here</p>
          </div>
        </div>
      )}

      {/* Main Chat Area */}
      <div className="flex flex-col flex-1 min-w-0 relative">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Bot className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">AI Admin Assistant</h2>
              <p className="text-xs text-muted-foreground">
                Powered by {selectedModel === "openai" ? "OpenAI GPT-4o" : "Anthropic Claude"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
              <button
                onClick={() => setSelectedModel("openai")}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                  selectedModel === "openai"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="flex items-center gap-1.5"><Cpu className="h-3 w-3" />GPT-4o</span>
              </button>
              <button
                onClick={() => setSelectedModel("claude")}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                  selectedModel === "claude"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="flex items-center gap-1.5"><Cpu className="h-3 w-3" />Claude</span>
              </button>
            </div>
            <Button variant="outline" size="sm" onClick={handleNewConversation}>
              <Plus className="h-4 w-4 mr-1" />New Chat
            </Button>
          </div>
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
                  Manage settings, inspect your database, track changes, or analyze your pipeline.
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
            messages.map((msg) => {
              const images = getMessageImages(msg.content);
              const text = getMessageText(msg.content);
              return (
                <div
                  key={msg.id}
                  className={cn("flex gap-3", msg.role === "user" ? "justify-end" : "justify-start")}
                >
                  {msg.role === "assistant" && (
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                  )}
                  <Card className={cn(
                    "max-w-[80%] px-4 py-3",
                    msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                  )}>
                    {/* Render images inline */}
                    {images.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {images.map((url, i) => (
                          <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                            <img
                              src={url}
                              alt={`Uploaded image ${i + 1}`}
                              className="max-h-40 max-w-[200px] rounded-md object-cover border border-border/30"
                            />
                          </a>
                        ))}
                      </div>
                    )}
                    {msg.role === "assistant" ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none text-foreground">
                        <ReactMarkdown>{text}</ReactMarkdown>
                      </div>
                    ) : (
                      text && <p className="text-sm whitespace-pre-wrap">{text}</p>
                    )}
                  </Card>
                  {msg.role === "user" && (
                    <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center shrink-0 mt-1">
                      <User className="h-4 w-4 text-secondary-foreground" />
                    </div>
                  )}
                </div>
              );
            })
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

        {/* Input area */}
        <div className="border-t border-border pt-4">
          {/* Pending image previews */}
          {pendingImages.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {pendingImages.map((img, i) => (
                <div key={i} className="relative group">
                  <img
                    src={img.preview}
                    alt={`Pending ${i + 1}`}
                    className="h-16 w-16 rounded-md object-cover border border-border"
                  />
                  <button
                    onClick={() => removePendingImage(i)}
                    className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />
            <Button
              variant="outline"
              size="icon"
              className="shrink-0 h-[44px] w-[44px]"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || isUploading}
              title="Attach image"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={pendingImages.length > 0 ? "Add a message or send images..." : "Ask about settings, pipeline data, changes, projects..."}
              className="min-h-[44px] max-h-[120px] resize-none"
              disabled={isLoading}
              rows={1}
            />
            <Button
              onClick={() => sendMessage(input)}
              disabled={(!input.trim() && pendingImages.length === 0) || isLoading || isUploading}
              size="icon"
              className="shrink-0 h-[44px] w-[44px]"
            >
              {isLoading || isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <div className="w-72 border-l border-border pl-4 hidden lg:flex flex-col">
        <Tabs value={sidebarTab} onValueChange={(v) => setSidebarTab(v as any)} className="flex flex-col flex-1">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="changes" className="text-xs">
              <History className="h-3 w-3 mr-1" />Changes
            </TabsTrigger>
            <TabsTrigger value="projects" className="text-xs">
              <FolderKanban className="h-3 w-3 mr-1" />Projects
            </TabsTrigger>
          </TabsList>

          <TabsContent value="changes" className="flex-1 overflow-y-auto mt-2">
            {changes.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">No changes logged yet.</p>
            ) : (
              <div className="space-y-2">
                {changes.map((c) => (
                  <div key={c.id} className="p-2 rounded-md border border-border text-xs">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {c.tool_name.replace(/_/g, " ")}
                      </Badge>
                      <span className="text-muted-foreground ml-auto">{formatDate(c.created_at)}</span>
                    </div>
                    {c.description && (
                      <p className="text-muted-foreground truncate">{c.description}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="projects" className="flex-1 overflow-y-auto mt-2">
            {projects.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">No projects yet. Ask the AI to create one.</p>
            ) : (
              <div className="space-y-2">
                {projects.map((p) => (
                  <div key={p.id} className="p-2 rounded-md border border-border text-xs">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="font-medium text-foreground truncate">{p.name}</span>
                      <Badge
                        variant={p.status === "completed" ? "default" : "secondary"}
                        className="text-[10px] px-1.5 py-0 ml-auto shrink-0"
                      >
                        {p.status}
                      </Badge>
                    </div>
                    {p.description && (
                      <p className="text-muted-foreground truncate">{p.description}</p>
                    )}
                    <p className="text-muted-foreground mt-1">{formatDate(p.updated_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};
