import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { 
  FileText, 
  ExternalLink, 
  MoreHorizontal, 
  RefreshCw, 
  Trash2,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { format } from 'date-fns';
import { getCarrierDisplayName, getParseStatusInfo, getDocumentTypeLabel } from '@/lib/insurance/canonicalItems';
import type { ScopeDocumentWithHeader } from '@/hooks/useScopeDocumentsWithFilters';

interface ScopeDocumentRowProps {
  document: ScopeDocumentWithHeader;
  onView: (id: string) => void;
  onReprocess: (id: string) => void;
  onDelete: (id: string) => void;
  isReprocessing?: boolean;
}

export const ScopeDocumentRow: React.FC<ScopeDocumentRowProps> = ({
  document,
  onView,
  onReprocess,
  onDelete,
  isReprocessing = false,
}) => {
  const statusInfo = getParseStatusInfo(document.parse_status);
  const isStuck = document.parse_status === 'extracting' || document.parse_status === 'pending';
  const hasFailed = document.parse_status === 'failed';
  const isComplete = document.parse_status === 'complete';

  const formatCurrency = (value: number | null) => {
    if (!value) return null;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <div
      className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors group"
    >
      <div 
        className="flex items-center gap-4 flex-1 cursor-pointer min-w-0"
        onClick={() => onView(document.id)}
      >
        <div className="p-2 bg-muted rounded-lg shrink-0">
          <FileText className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium truncate" title={document.file_name}>
            {document.file_name}
          </p>
          <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
            <span>{getDocumentTypeLabel(document.document_type)}</span>
            {document.carrier_normalized && (
              <>
                <span>•</span>
                <span className="text-foreground font-medium">
                  {getCarrierDisplayName(document.carrier_normalized)}
                </span>
              </>
            )}
            {document.header?.property_state && (
              <>
                <span>•</span>
                <span>{document.header.property_state}</span>
              </>
            )}
            <span>•</span>
            <span>{format(new Date(document.created_at), 'MMM d, yyyy')}</span>
          </div>
          
          {/* Show pricing if available */}
          {isComplete && document.header && (document.header.total_rcv || document.header.total_acv) && (
            <div className="flex items-center gap-3 text-sm mt-1">
              {document.header.total_rcv && (
                <span className="text-muted-foreground">
                  RCV: <span className="text-foreground font-medium">{formatCurrency(document.header.total_rcv)}</span>
                </span>
              )}
              {document.header.total_acv && (
                <span className="text-muted-foreground">
                  ACV: <span className="text-foreground font-medium">{formatCurrency(document.header.total_acv)}</span>
                </span>
              )}
            </div>
          )}

          {/* Show error if failed */}
          {hasFailed && document.parse_error && (
            <div className="flex items-center gap-1 text-sm text-destructive mt-1">
              <AlertCircle className="h-3 w-3" />
              <span className="truncate">{document.parse_error}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Badge className={statusInfo.color}>{statusInfo.label}</Badge>
        
        {/* Quick action button for stuck/failed docs */}
        {(isStuck || hasFailed) && (
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onReprocess(document.id);
            }}
            disabled={isReprocessing}
          >
            {isReprocessing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-1 hidden sm:inline">Reprocess</span>
          </Button>
        )}

        {/* View button for complete docs */}
        {isComplete && (
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              onView(document.id);
            }}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        )}

        {/* More options menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onView(document.id)}>
              <ExternalLink className="h-4 w-4 mr-2" />
              View Details
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={() => onReprocess(document.id)}
              disabled={isReprocessing}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Reprocess
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              className="text-destructive"
              onClick={() => onDelete(document.id)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};
