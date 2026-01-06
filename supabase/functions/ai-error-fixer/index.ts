import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ErrorDetails {
  message: string;
  type?: string;
  stackTrace?: string;
  url?: string;
  component?: string;
  metadata?: Record<string, any>;
}

interface DiagnosisResult {
  errorType: string;
  rootCause: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  recommendedFix: string;
  codeSnippet?: string;
  canAutoFix: boolean;
  autoFixAction?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { error: errorDetails } = await req.json() as { error: ErrorDetails };
    
    console.log("AI Error Fixer received error:", JSON.stringify(errorDetails, null, 2));

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const systemPrompt = `You are an expert software engineer specializing in debugging and fixing errors in web applications built with React, TypeScript, Supabase, and Edge Functions.

Your task is to analyze error details and provide a diagnosis with actionable fixes.

You MUST respond with valid JSON in this exact format:
{
  "errorType": "string - category of error (e.g., 'Database Schema Error', 'Edge Function Crash', 'API Error', 'Frontend Runtime Error', 'Authentication Error', 'Network Error')",
  "rootCause": "string - clear explanation of what caused the error",
  "severity": "low|medium|high|critical",
  "recommendedFix": "string - step-by-step instructions to fix the issue",
  "codeSnippet": "string|null - code fix if applicable",
  "canAutoFix": boolean - true if this can be fixed automatically,
  "autoFixAction": "string|null - action type if auto-fixable (e.g., 'run_migration', 'update_rls_policy', 'restart_function')"
}

Common patterns to detect:
1. "column X does not exist" → Database schema migration needed
2. "Edge Function returned non-2xx" → Check function logs for crashes
3. "RLS policy violation" → Row Level Security misconfiguration
4. "Maximum call stack size exceeded" → Recursive function or large data processing issue
5. "Failed to fetch" → Network/CORS issue or function crash
6. "Cannot read property of undefined" → Null check missing
7. "401 Unauthorized" → Authentication issue
8. "429 Too Many Requests" → Rate limiting

Always provide specific, actionable fixes. Never be vague.`;

    const userPrompt = `Analyze this error and provide a diagnosis:

Error Message: ${errorDetails.message}
Error Type: ${errorDetails.type || 'Unknown'}
URL: ${errorDetails.url || 'Unknown'}
Component: ${errorDetails.component || 'Unknown'}
Stack Trace: ${errorDetails.stackTrace || 'Not available'}
Additional Metadata: ${JSON.stringify(errorDetails.metadata || {}, null, 2)}

Provide your diagnosis in the JSON format specified.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI Gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ 
          error: "AI service rate limited. Please try again in a moment.",
          diagnosis: getDefaultDiagnosis(errorDetails)
        }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      throw new Error(`AI Gateway error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.choices?.[0]?.message?.content;
    
    console.log("AI Response:", aiResponse);

    // Parse the JSON response
    let diagnosis: DiagnosisResult;
    try {
      // Extract JSON from the response (handle markdown code blocks)
      let jsonStr = aiResponse;
      const jsonMatch = aiResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }
      diagnosis = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error("Failed to parse AI response as JSON:", parseError);
      // Fallback to extracting key information
      diagnosis = getDefaultDiagnosis(errorDetails, aiResponse);
    }

    // Log the diagnosis for future reference
    console.log("Diagnosis result:", JSON.stringify(diagnosis, null, 2));

    return new Response(JSON.stringify({ diagnosis }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("AI Error Fixer error:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Unknown error",
      diagnosis: {
        errorType: "Analysis Failed",
        rootCause: "Unable to analyze the error automatically",
        severity: "medium",
        recommendedFix: "Please review the error details manually or contact support.",
        canAutoFix: false
      }
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function getDefaultDiagnosis(errorDetails: ErrorDetails, aiHint?: string): DiagnosisResult {
  const message = errorDetails.message.toLowerCase();
  
  // Pattern matching for common errors
  if (message.includes("column") && message.includes("does not exist")) {
    const columnMatch = errorDetails.message.match(/column ['"]?(\w+)['"]?/i);
    const columnName = columnMatch ? columnMatch[1] : "unknown";
    return {
      errorType: "Database Schema Error",
      rootCause: `Missing column '${columnName}' in database table`,
      severity: "high",
      recommendedFix: `Run a database migration to add the missing column: ALTER TABLE table_name ADD COLUMN ${columnName} type;`,
      canAutoFix: true,
      autoFixAction: "run_migration"
    };
  }
  
  if (message.includes("edge function") && message.includes("non-2xx")) {
    return {
      errorType: "Edge Function Crash",
      rootCause: "The edge function encountered an error during execution",
      severity: "high",
      recommendedFix: "Check the edge function logs in Supabase dashboard for detailed error information. Common causes: missing environment variables, database query errors, or code exceptions.",
      canAutoFix: false
    };
  }
  
  if (message.includes("maximum call stack")) {
    return {
      errorType: "Stack Overflow Error",
      rootCause: "Infinite recursion or processing data too large for the call stack",
      severity: "critical",
      recommendedFix: "Review code for recursive function calls or use chunked processing for large data operations.",
      canAutoFix: false
    };
  }
  
  if (message.includes("401") || message.includes("unauthorized")) {
    return {
      errorType: "Authentication Error",
      rootCause: "User is not authenticated or session has expired",
      severity: "medium",
      recommendedFix: "Log out and log back in. If the issue persists, check that the API key or JWT token is valid.",
      canAutoFix: false
    };
  }

  if (message.includes("rls") || message.includes("policy")) {
    return {
      errorType: "Row Level Security Error",
      rootCause: "RLS policy is blocking the database operation",
      severity: "high",
      recommendedFix: "Review and update the RLS policies for the affected table to ensure proper access control.",
      canAutoFix: true,
      autoFixAction: "update_rls_policy"
    };
  }

  return {
    errorType: "Unknown Error",
    rootCause: aiHint || "Unable to determine the root cause automatically",
    severity: "medium",
    recommendedFix: "Please review the error details and stack trace. Check browser console and network tab for more information.",
    canAutoFix: false
  };
}
