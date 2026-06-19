import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { SCAN_PRESETS, PDF_PROFILES, type ScanPreset, type PdfProfile } from '@/utils/scannerExtras';
import {
  clearAllScanSessions,
  getScanStorageUsage,
  listScanSessions,
  type ScanSessionSummary,
} from '@/utils/scannerSessionStore';

export interface ScannerSettings {
  preset: ScanPreset;
  pdfProfile: PdfProfile;
  autoCapture: boolean;
  burnPageNumbers: boolean;
  autosaveEnabled: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  settings: ScannerSettings;
  onChange: (next: ScannerSettings) => void;
  /** Plain text (no PII, no images) representing current session diagnostics. */
  diagnosticsText: string;
}

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

export default function ScannerSettingsPanel({
  open,
  onOpenChange,
  settings,
  onChange,
  diagnosticsText,
}: Props) {
  const [usage, setUsage] = useState<{ bytes: number; quota: number }>({ bytes: 0, quota: 0 });
  const [sessions, setSessions] = useState<ScanSessionSummary[]>([]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setUsage(await getScanStorageUsage());
      setSessions(await listScanSessions());
    })();
  }, [open]);

  const update = <K extends keyof ScannerSettings>(k: K, v: ScannerSettings[K]) =>
    onChange({ ...settings, [k]: v });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Scanner settings</DialogTitle>
          <DialogDescription>Capture preferences and local diagnostics.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Scan preset</Label>
            <Select value={settings.preset} onValueChange={(v) => update('preset', v as ScanPreset)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.values(SCAN_PRESETS).map((p) => (
                  <SelectItem key={p.preset} value={p.preset}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>PDF profile</Label>
            <Select value={settings.pdfProfile} onValueChange={(v) => update('pdfProfile', v as PdfProfile)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.values(PDF_PROFILES).map((p) => (
                  <SelectItem key={p.profile} value={p.profile}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="auto-capture">Auto-capture</Label>
            <Switch
              id="auto-capture"
              checked={settings.autoCapture}
              onCheckedChange={(v) => update('autoCapture', v)}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="burn-pages">Burn page numbers</Label>
            <Switch
              id="burn-pages"
              checked={settings.burnPageNumbers}
              onCheckedChange={(v) => update('burnPageNumbers', v)}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="autosave">Autosave to device</Label>
            <Switch
              id="autosave"
              checked={settings.autosaveEnabled}
              onCheckedChange={(v) => update('autosaveEnabled', v)}
            />
          </div>

          <div className="rounded-md border p-3 text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Local storage used</span>
              <span>{fmtBytes(usage.bytes)} / {fmtBytes(usage.quota)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Saved sessions</span>
              <span>{sessions.length}</span>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  const n = await clearAllScanSessions();
                  setUsage(await getScanStorageUsage());
                  setSessions(await listScanSessions());
                  toast.success(`Cleared ${n} saved session${n === 1 ? '' : 's'}`);
                }}
              >
                Clear saved sessions
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(diagnosticsText);
                    toast.success('Diagnostics copied');
                  } catch {
                    toast.error('Clipboard unavailable');
                  }
                }}
              >
                Copy diagnostics
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
