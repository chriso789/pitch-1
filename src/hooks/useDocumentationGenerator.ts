import { useState } from 'react';
import { documentationGenerator } from '@/services/documentationGenerator';
import type { GenerationOptions, DocumentationResult } from '@/types/documentationGenerator';
import { toast } from 'sonner';

export function useDocumentationGenerator() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<DocumentationResult | null>(null);

  const generate = async (
    options: GenerationOptions
  ): Promise<DocumentationResult | null> => {
    setIsGenerating(true);
    setProgress(10);

    try {
      toast.info('Starting documentation generation...');
      setProgress(30);

      const result = await documentationGenerator.generateDocumentation(options);

      setProgress(90);

      if (result.success) {
        toast.success(
          `Documentation generated successfully in ${options.outputFormats.join(', ')} formats`
        );
        setResult(result);
      } else {
        toast.error(result.error || 'Documentation generation failed');
      }

      setProgress(100);
      return result;
    } catch (error: any) {
      console.error('Documentation generation error:', error);
      toast.error(error.message || 'Failed to generate documentation');
      return null;
    } finally {
      setIsGenerating(false);
      setTimeout(() => setProgress(0), 1000);
    }
  };

  const downloadMarkdown = (content: string, filename: string = 'documentation.md') => {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('Markdown downloaded');
  };

  const downloadHTML = (content: string, filename: string = 'documentation.html') => {
    const blob = new Blob([content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('HTML downloaded');
  };

  const downloadPDF = (blob: Blob, filename: string = 'documentation.pdf') => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('PDF downloaded');
  };

  return {
    generate,
    downloadMarkdown,
    downloadHTML,
    downloadPDF,
    isGenerating,
    progress,
    result,
  };
}
