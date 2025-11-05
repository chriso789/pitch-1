import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Sparkles, CheckCircle2, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export const ClaudeAITester = () => {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("claude-sonnet-4-5");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<any>(null);
  const { toast } = useToast();

  const models = [
    { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5 (Most Capable)", description: "Best for complex reasoning" },
    { value: "claude-opus-4-1-20250805", label: "Claude Opus 4.1 (Highly Intelligent)", description: "Expensive but powerful" },
    { value: "claude-3-7-sonnet-20250219", label: "Claude 3.7 Sonnet", description: "Extended thinking" },
    { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku", description: "Fastest, cheapest" },
  ];

  const samplePrompts = [
    "Analyze this lead: John Smith, homeowner in Miami, roof is 15 years old, interested in metal roofing. What's the best follow-up strategy?",
    "Draft a professional email to follow up with a customer who requested an estimate 3 days ago but hasn't responded.",
    "What are the key factors I should consider when scoring a roofing lead for qualification?",
  ];

  const handleTest = async () => {
    if (!prompt.trim()) {
      toast({
        title: "Prompt Required",
        description: "Please enter a prompt to test",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    setError(null);
    setResponse("");
    setUsage(null);

    try {
      console.log('🧪 Testing Claude AI with prompt:', prompt.substring(0, 100) + '...');
      
      const { data, error: invokeError } = await supabase.functions.invoke('ai-claude-processor', {
        body: {
          prompt: prompt,
          model: model,
          feature: 'claude-ai-tester',
        }
      });

      if (invokeError) throw invokeError;

      if (data.error) {
        throw new Error(data.error);
      }

      if (!data.success) {
        throw new Error("AI processing failed");
      }

      setResponse(data.response);
      setUsage(data.usage);
      
      toast({
        title: "Success",
        description: `Claude AI responded successfully using ${model}`
      });

    } catch (err: any) {
      console.error('❌ Claude test error:', err);
      setError(err.message || "Failed to get response from Claude AI");
      
      toast({
        title: "Test Failed",
        description: err.message || "Failed to get response from Claude AI",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Sparkles className="h-8 w-8 text-primary" />
          <div>
            <CardTitle>Test Claude AI Integration</CardTitle>
            <CardDescription>
              Test your Claude AI integration using Anthropic API directly
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <Alert>
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription>
            Using ANTHROPIC_API_KEY - Direct connection to Anthropic API
          </AlertDescription>
        </Alert>

        <div className="space-y-4">
          <div>
            <Label htmlFor="model">Select Model</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger id="model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    <div className="flex flex-col">
                      <span>{m.label}</span>
                      <span className="text-xs text-muted-foreground">{m.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="prompt">Test Prompt</Label>
            <Textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Enter your prompt here..."
              rows={4}
              className="resize-none"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <p className="text-xs text-muted-foreground w-full">Quick examples:</p>
              {samplePrompts.map((sample, idx) => (
                <Button
                  key={idx}
                  variant="outline"
                  size="sm"
                  onClick={() => setPrompt(sample)}
                  className="text-xs"
                >
                  Example {idx + 1}
                </Button>
              ))}
            </div>
          </div>

          <Button 
            onClick={handleTest} 
            disabled={loading || !prompt.trim()}
            className="w-full"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Testing Claude AI...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Test Claude AI
              </>
            )}
          </Button>
        </div>

        {error && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {response && (
          <div className="space-y-3">
            <div>
              <Label>AI Response</Label>
              <div className="mt-2 p-4 bg-muted rounded-lg border">
                <p className="text-sm whitespace-pre-wrap">{response}</p>
              </div>
            </div>

            {usage && (
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-muted rounded-lg border">
                  <p className="text-xs text-muted-foreground">Input Tokens</p>
                  <p className="text-lg font-semibold">{usage.input_tokens || 0}</p>
                </div>
                <div className="p-3 bg-muted rounded-lg border">
                  <p className="text-xs text-muted-foreground">Output Tokens</p>
                  <p className="text-lg font-semibold">{usage.output_tokens || 0}</p>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="bg-muted/50 p-4 rounded-lg space-y-2">
          <h4 className="font-semibold text-sm">Model Selection Guide</h4>
          <ul className="text-xs space-y-1.5 text-muted-foreground">
            <li>• <strong>Sonnet 4.5</strong>: Best all-around choice for CRM tasks</li>
            <li>• <strong>Opus 4.1</strong>: Use for complex analysis, more expensive</li>
            <li>• <strong>3.7 Sonnet</strong>: Extended thinking for multi-step reasoning</li>
            <li>• <strong>3.5 Haiku</strong>: Fast and cheap for simple tasks</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
};
