import React, { useMemo, useState } from 'react';
import { AlertTriangle, FileText, CheckCircle2, Eye, RotateCw, Trash2, Camera, ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { estimatePdfSizeBytes, formatBytes } from '@/utils/scannerPdfSize';
import { PDF_PROFILES, PdfProfile } from '@/utils/scannerExtras';
import { getPageSpec, DetectedPageSize, dominantPageSize } from '@/utils/documentPageSize';

export interface QAReviewPage {
  preview: string;
  pageSize: DetectedPageSize;
  pageSizeOverride?: DetectedPageSize | null;
  colorMode: 'color' | 'bw';
  cropMode: 'auto' | 'manual';
  blurOverridden: boolean;
  shadowSeverity: string;
  duplicateWarning?: boolean;
  quality?: any;
  edgeCleanupApplied?: boolean;
}

interface Props {
  pages: QAReviewPage[];
  pdfProfile: PdfProfile;
  onBack: () => void;
  onUpload: (acknowledged: boolean) => void;
  onPreview: (index: number) => void;
  onRetake: (index: number) => void;
  onDelete: (index: number) => void;
  onRotate: (index: number, degrees: 90 | -90 | 180) => void;
  onMove: (index: number, dir: -1 | 1) => void;
  onChangePageSize: (index: number, size: DetectedPageSize) => void;
  onCopyDiagnostics: () => void;
}

export function ScannerQAReview({
  pages, pdfProfile, onBack, onUpload, onPreview, onRetake, onDelete, onRotate, onMove, onChangePageSize,
  onCopyDiagnostics,
}: Props) {
  const [acknowledged, setAcknowledged] = useState(false);

  const profileCfg = PDF_PROFILES[pdfProfile];
  const sizes = pages.map(p => (p.pageSizeOverride ?? p.pageSize) as DetectedPageSize);
  const uniqueSizes = Array.from(new Set(sizes.filter(s => s !== 'unknown')));
  const dominant = dominantPageSize(sizes);
  const spec = getPageSpec(dominant === 'unknown' ? 'letter' : dominant);

  const colorPages = pages.filter(p => p.colorMode === 'color').length;
  const bwPages = pages.length - colorPages;

  const estimate = useMemo(() => estimatePdfSizeBytes({
    pageCount: pages.length,
    colorPages, bwPages,
    dpi: profileCfg.dpi,
    jpegQuality: profileCfg.jpegQuality,
    avgPageInchesW: spec.widthIn,
    avgPageInchesH: spec.heightIn,
  }), [pages.length, colorPages, bwPages, profileCfg, spec]);

  const warnings: { key: string; label: string; count: number; severity: 'warn' | 'info' }[] = [];
  const blurry = pages.filter(p => p.blurOverridden || p.quality?.blur_score < 25).length;
  const shadow = pages.filter(p => p.shadowSeverity === 'heavy' || p.shadowSeverity === 'moderate').length;
  const glare = pages.filter(p => p.quality?.glare_detected).length;
  const manualCrop = pages.filter(p => p.cropMode === 'manual').length;
  const dupes = pages.filter(p => p.duplicateWarning).length;
  if (blurry) warnings.push({ key: 'blurry', label: 'Blurry pages', count: blurry, severity: 'warn' });
  if (shadow) warnings.push({ key: 'shadow', label: 'Heavy shadow pages', count: shadow, severity: 'warn' });
  if (glare) warnings.push({ key: 'glare', label: 'Glare-overridden pages', count: glare, severity: 'warn' });
  if (dupes) warnings.push({ key: 'dupes', label: 'Possible duplicate pages', count: dupes, severity: 'warn' });
  if (manualCrop) warnings.push({ key: 'manual', label: 'Manual-crop pages', count: manualCrop, severity: 'info' });
  if (uniqueSizes.length > 1) warnings.push({ key: 'mixed', label: 'Mixed page sizes', count: uniqueSizes.length, severity: 'info' });

  const blocking: string[] = [];
  if (pages.length === 0) blocking.push('No pages captured.');
  pages.forEach((p, i) => {
    if (!p.preview) blocking.push(`Page ${i + 1} missing preview.`);
    const sz = (p.pageSizeOverride ?? p.pageSize);
    if (!sz) blocking.push(`Page ${i + 1} has no page size.`);
  });
  if (estimate > profileCfg.maxBytes && !profileCfg.allowOverLimit) {
    blocking.push(`Estimated PDF (${formatBytes(estimate)}) exceeds ${profileCfg.label} cap (${formatBytes(profileCfg.maxBytes)}). Reduce pages or pick High/Archive.`);
  }

  const needsAck = warnings.some(w => w.severity === 'warn');
  const uploadDisabled = blocking.length > 0 || (needsAck && !acknowledged);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-shrink-0 px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Scan
          </Button>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <FileText className="h-4 w-4" />
            <span>{pages.length} page{pages.length === 1 ? '' : 's'}</span>
            <span className="text-muted-foreground">• {profileCfg.label}</span>
            <span className="text-muted-foreground">• ~{formatBytes(estimate)}</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Summary */}
        <div className="rounded-lg border bg-card p-3 text-sm space-y-1">
          <div className="font-medium">Final review</div>
          <div className="text-xs text-muted-foreground">
            Page sizes: {uniqueSizes.length ? uniqueSizes.join(', ').toUpperCase() : 'unknown'} ·
            Color: {colorPages} · B/W: {bwPages}
          </div>
          <div className="text-xs text-muted-foreground">
            Profile cap: {formatBytes(profileCfg.maxBytes)} · Estimated: {formatBytes(estimate)}
          </div>
        </div>

        {/* Blocking issues */}
        {blocking.length > 0 && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium text-destructive">
              <AlertTriangle className="h-4 w-4" /> Fix before upload
            </div>
            <ul className="mt-2 list-disc list-inside space-y-1 text-destructive">
              {blocking.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </div>
        )}

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="rounded-lg border bg-card p-3 text-sm space-y-2">
            <div className="font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" /> Quality notices
            </div>
            <ul className="space-y-1 text-xs">
              {warnings.map(w => (
                <li key={w.key} className={cn(w.severity === 'warn' ? 'text-warning' : 'text-muted-foreground')}>
                  • {w.label}: {w.count}
                </li>
              ))}
            </ul>
            {needsAck && (
              <label className="flex items-center gap-2 pt-2 cursor-pointer">
                <Checkbox checked={acknowledged} onCheckedChange={v => setAcknowledged(!!v)} />
                <span className="text-xs">I reviewed the warnings and want to upload anyway.</span>
              </label>
            )}
          </div>
        )}

        {/* Page grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {pages.map((p, i) => (
            <div key={i} className={cn(
              'rounded-md border bg-card overflow-hidden flex flex-col',
              p.duplicateWarning && 'ring-2 ring-warning/60',
            )}>
              <div className="relative aspect-[3/4] bg-muted">
                <img src={p.preview} alt={`Page ${i + 1}`} className="w-full h-full object-cover cursor-pointer"
                  onClick={() => onPreview(i)} />
                <div className="absolute top-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
                  {i + 1}
                </div>
                {p.duplicateWarning && (
                  <div className="absolute top-1 right-1 bg-warning text-warning-foreground text-[10px] px-1.5 py-0.5 rounded">
                    dup?
                  </div>
                )}
              </div>
              <div className="p-1.5 space-y-1.5">
                <Select
                  value={(p.pageSizeOverride ?? p.pageSize) || 'letter'}
                  onValueChange={(v) => onChangePageSize(i, v as DetectedPageSize)}
                >
                  <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="letter">Letter</SelectItem>
                    <SelectItem value="legal">Legal</SelectItem>
                    <SelectItem value="a4">A4</SelectItem>
                    <SelectItem value="unknown">Preserve</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex justify-between gap-0.5">
                  <button title="Move left" onClick={() => onMove(i, -1)} disabled={i === 0}
                    className="p-1 rounded hover:bg-muted disabled:opacity-30"><ArrowLeft className="h-3 w-3" /></button>
                  <button title="Preview" onClick={() => onPreview(i)} className="p-1 rounded hover:bg-muted"><Eye className="h-3 w-3" /></button>
                  <button title="Rotate" onClick={() => onRotate(i, 90)} className="p-1 rounded hover:bg-muted"><RotateCw className="h-3 w-3" /></button>
                  <button title="Retake" onClick={() => onRetake(i)} className="p-1 rounded hover:bg-muted"><Camera className="h-3 w-3" /></button>
                  <button title="Delete" onClick={() => onDelete(i)} className="p-1 rounded hover:bg-destructive/20 text-destructive"><Trash2 className="h-3 w-3" /></button>
                  <button title="Move right" onClick={() => onMove(i, 1)} disabled={i === pages.length - 1}
                    className="p-1 rounded hover:bg-muted disabled:opacity-30"><ArrowRight className="h-3 w-3" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-shrink-0 px-4 py-3 border-t bg-background flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onCopyDiagnostics}>Copy diagnostics</Button>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={onBack}>Back to Scan</Button>
          <Button onClick={() => onUpload(acknowledged)} disabled={uploadDisabled} className="gradient-primary">
            <CheckCircle2 className="h-4 w-4 mr-1" /> Upload PDF
          </Button>
        </div>
      </div>
    </div>
  );
}
