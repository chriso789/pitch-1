import React, { useState, useEffect, useRef } from "react";
import { Send, Paperclip, Smile } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FloatingWindow } from "./FloatingWindow";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  content: string;
  sender: 'user' | 'contact';
  timestamp: Date;
  status?: 'sending' | 'sent' | 'delivered' | 'read';
}

interface FloatingChatWidgetProps {
  isOpen: boolean;
  onClose: () => void;
  contactName: string;
  contactPhone: string;
  messages?: Message[];
  onSendMessage?: (message: string) => void;
}

export const FloatingChatWidget: React.FC<FloatingChatWidgetProps> = ({
  isOpen,
  onClose,
  contactName,
  contactPhone,
  messages = [],
  onSendMessage
}) => {
  const [isMinimized, setIsMinimized] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = () => {
    if (newMessage.trim() && onSendMessage) {
      onSendMessage(newMessage.trim());
      setNewMessage("");
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <FloatingWindow
      title={`${contactName} • ${contactPhone}`}
      isOpen={isOpen}
      onClose={onClose}
      onMinimize={() => setIsMinimized(!isMinimized)}
      isMinimized={isMinimized}
      width={380}
      height={500}
    >
      <div className="flex flex-col h-full">
        {/* Messages */}
        <ScrollArea className="flex-1 p-4">
          <div className="space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex",
                  message.sender === 'user' ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                    message.sender === 'user'
                      ? "bg-blue-500 text-white ml-4" // iMessage blue
                      : "bg-muted text-foreground mr-4"
                  )}
                >
                  <p className="break-words">{message.content}</p>
                  <p
                    className={cn(
                      "text-xs mt-1 opacity-70",
                      message.sender === 'user' ? "text-blue-100" : "text-muted-foreground"
                    )}
                  >
                    {message.timestamp.toLocaleTimeString([], { 
                      hour: '2-digit', 
                      minute: '2-digit' 
                    })}
                    {message.sender === 'user' && message.status && (
                      <span className="ml-1">
                        {message.status === 'sending' && '⏳'}
                        {message.status === 'sent' && '✓'}
                        {message.status === 'delivered' && '✓✓'}
                        {message.status === 'read' && '✓✓'}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="p-4 border-t border-border">
          <div className="flex items-end gap-2">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <Paperclip className="h-4 w-4" />
            </Button>
            <div className="flex-1 relative">
              <Input
                placeholder="Text message"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                className="pr-8 rounded-full border-2 resize-none"
              />
              <Button 
                variant="ghost" 
                size="sm" 
                className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
              >
                <Smile className="h-4 w-4" />
              </Button>
            </div>
            <Button 
              onClick={handleSendMessage}
              disabled={!newMessage.trim()}
              size="sm"
              className="h-8 w-8 p-0 rounded-full bg-blue-500 hover:bg-blue-600"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </FloatingWindow>
  );
};