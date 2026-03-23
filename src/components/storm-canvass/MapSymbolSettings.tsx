import { useState, useEffect } from 'react';
import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useContactStatuses } from '@/hooks/useContactStatuses';

export const AVAILABLE_SYMBOLS = [
  { value: '✓', label: '✓ Check' },
  { value: '✕', label: '✕ Cross' },
  { value: '$', label: '$ Dollar' },
  { value: '⌂', label: '⌂ House' },
  { value: '↻', label: '↻ Refresh' },
  { value: '△', label: '△ Triangle' },
  { value: '★', label: '★ Star' },
  { value: '●', label: '● Circle' },
  { value: '♦', label: '♦ Diamond' },
  { value: '!', label: '! Alert' },
  { value: '?', label: '? Question' },
  { value: '⊘', label: '⊘ No Entry' },
];

export const DEFAULT_DISPOSITION_SYMBOLS: Record<string, string> = {
  not_contacted: '',
  interested: '$',
  not_interested: '✕',
  not_home: '⌂',
  follow_up: '↻',
  new_roof: '✓',
  unqualified: '⊘',
  old_roof_marker: '△',
  past_customer: '★',
  converted: '✓',
  callback: '↻',
  qualified: '$',
  go_back: '↻',
  do_not_contact: '✕',
};

export type SymbolSettings = Record<string, string>;

function getStorageKey(tenantId: string): string {
  return `canvass_symbol_settings_${tenantId}`;
}

export function loadSymbolSettings(tenantId: string): SymbolSettings {
  try {
    const raw = localStorage.getItem(getStorageKey(tenantId));
    if (raw) return { ...DEFAULT_DISPOSITION_SYMBOLS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_DISPOSITION_SYMBOLS };
}

export function saveSymbolSettings(tenantId: string, settings: SymbolSettings) {
  localStorage.setItem(getStorageKey(tenantId), JSON.stringify(settings));
}

interface MapSymbolSettingsProps {
  tenantId: string;
  symbolSettings: SymbolSettings;
  onSettingsChange: (settings: SymbolSettings) => void;
}

export default function MapSymbolSettings({ tenantId, symbolSettings, onSettingsChange }: MapSymbolSettingsProps) {
  const [open, setOpen] = useState(false);
  const { statuses } = useContactStatuses();

  const handleSymbolChange = (key: string, symbol: string) => {
    const updated = { ...symbolSettings, [key]: symbol === 'none' ? '' : symbol };
    onSettingsChange(updated);
    saveSymbolSettings(tenantId, updated);
  };

  // Combine statuses + any known disposition keys not in statuses
  const allDispositions = [
    ...statuses.map(s => ({ key: s.key, name: s.name, color: s.color })),
    // Add any keys from DEFAULT_DISPOSITION_SYMBOLS not already in statuses
    ...Object.entries(DEFAULT_DISPOSITION_SYMBOLS)
      .filter(([key]) => !statuses.some(s => s.key === key))
      .map(([key]) => ({
        key,
        name: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        color: '#6B7280',
      })),
  ];

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-background/90 backdrop-blur-sm rounded-lg shadow-lg border border-border hover:bg-muted"
      >
        <Settings className="h-4 w-4" />
        <span className="text-xs font-medium">Pins</span>
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-80 sm:max-w-sm overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base">Pin Symbol Settings</SheetTitle>
            <SheetDescription className="text-xs">
              Customize the symbol badge shown on each disposition pin.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {allDispositions.map(({ key, name, color }) => (
              <div key={key} className="flex items-center gap-3">
                <div
                  className="w-5 h-5 rounded-full border border-border flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="text-sm flex-1 truncate">{name}</span>
                <Select
                  value={symbolSettings[key] || 'none'}
                  onValueChange={(val) => handleSymbolChange(key, val)}
                >
                  <SelectTrigger className="w-24 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {AVAILABLE_SYMBOLS.map(s => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
