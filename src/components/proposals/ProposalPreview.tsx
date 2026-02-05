import { useState } from 'react';
import { Loader2, Download, Send, ExternalLink, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useProposalPreview } from '@/hooks/useProposalGenerator';
import { cn } from '@/lib/utils';

interface ProposalPreviewProps {
  estimateId: string;
  onSend?: () => void;
  onDownload?: () => void;
  downloading?: boolean;
  className?: string;
}

export const ProposalPreview = ({
  estimateId,
  onSend,
  onDownload,
  downloading = false,
  className,
}: ProposalPreviewProps) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { data, isLoading, error } = useProposalPreview(estimateId);

  if (isLoading) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <CardContent className="flex items-center justify-center h-96">
          <p className="text-destructive">Failed to load preview</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn(className, isFullscreen && 'fixed inset-4 z-50')}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg">Proposal Preview</CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setIsFullscreen(!isFullscreen)}>
            {isFullscreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </Button>
          {onDownload && (
            <Button variant="outline" size="sm" onClick={onDownload} disabled={downloading}>
              {downloading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              {downloading ? 'Generating...' : 'Download PDF'}
            </Button>
          )}
          {onSend && (
            <Button size="sm" onClick={onSend}>
              <Send className="h-4 w-4 mr-2" />
              Send Proposal
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div
          className={cn(
            'border rounded-b-lg overflow-auto bg-white',
            isFullscreen ? 'h-[calc(100vh-12rem)]' : 'h-[600px]'
          )}
        >
          <iframe
            srcDoc={data?.html}
            className="w-full h-full"
            title="Proposal Preview"
            sandbox="allow-same-origin"
          />
        </div>
      </CardContent>
    </Card>
  );
};
