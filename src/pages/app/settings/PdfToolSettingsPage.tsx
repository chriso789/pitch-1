import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { PDF_TOOLS, loadPdfToolSettings, usePdfToolGate, type PdfTool } from '@/lib/pdf-pages/featureGate';

/** Company admins switch PDF Studio tools on/off for their company. The database enforces both who may change these and which tools may save. */
export default function PdfToolSettingsPage() {
  const tenantId = useEffectiveTenantId();
  const gate = usePdfToolGate();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<PdfTool | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    (supabase as any).rpc('pdf_tool_admin', { _tenant: tenantId }).then(({ data }: any) => setIsAdmin(!!data));
  }, [tenantId]);

  const toggle = async (tool: PdfTool, enabled: boolean) => {
    if (!tenantId) return;
    setBusy(tool);
    const uid = (await supabase.auth.getUser()).data.user?.id;
    const { error } = await (supabase as any).from('tenant_pdf_tool_settings').upsert({ tenant_id: tenantId, tool, enabled, updated_by: uid }, { onConflict: 'tenant_id,tool' });
    if (error) toast.error(`Could not change this setting: ${error.message}`);
    else toast.success(enabled ? 'Turned on for your company' : 'Turned off for your company');
    await loadPdfToolSettings(tenantId);
    setBusy(null);
  };

  return (
    <GlobalLayout>
      <main className="p-4 max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold">PDF Tools</h1>
        <p className="text-sm text-muted-foreground">Choose which PDF tools your company can use. Tools other than page tools are still being verified, so they start off. Turning one on applies to everyone in this company only.</p>
        {isAdmin === false && <p className="text-sm text-muted-foreground">Only owners, corporate and office admins can change these.</p>}
        <Card><CardHeader><CardTitle className="text-base">Tools</CardTitle></CardHeader>
          <CardContent className="divide-y">
            {PDF_TOOLS.map(({ tool, label, note }) => (
              <div key={tool} className="flex items-center justify-between py-3 gap-4">
                <div><div className="font-medium text-sm">{label}</div><div className="text-xs text-muted-foreground">{note}</div></div>
                <Switch aria-label={label} checked={gate.enabled[tool]} disabled={!isAdmin || busy === tool} onCheckedChange={(v) => toggle(tool, v)} />
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </GlobalLayout>
  );
}
