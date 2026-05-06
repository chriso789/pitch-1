/**
 * PITCH PDF AI Rewriter
 * Uses the AI gateway to rewrite selected PDF text.
 */

import { supabase } from '@/integrations/supabase/client';

export type RewriteMode = 'professional' | 'concise' | 'formal' | 'friendly' | 'custom';

export interface RewriteRequest {
  originalText: string;
  mode: RewriteMode;
  customInstruction?: string;
  context?: string;
}

export interface RewriteResult {
  rewrittenText: string;
  mode: RewriteMode;
}

/**
 * Rewrite text using AI via the pdf-ai-rewrite edge function.
 */
export async function aiRewriteText(request: RewriteRequest): Promise<RewriteResult> {
  const { data, error } = await supabase.functions.invoke('pdf-ai-rewrite', {
    body: {
      original_text: request.originalText,
      mode: request.mode,
      custom_instruction: request.customInstruction || null,
      context: request.context || null,
    },
  });

  if (error) throw error;
  return {
    rewrittenText: data.rewritten_text,
    mode: request.mode,
  };
}
