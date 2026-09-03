import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Props {
  entryId?: string;
  entityLabel: string;
}

interface LocateResult {
  found: boolean;
  tenant_id?: string;
  tenant_name?: string;
  active_tenant_id?: string;
}

/**
 * Shown when a lead/project can't be loaded. Most of the time this happens because the
 * record lives in a different company than the one currently active on the account
 * (company switching is stored server-side, so another tab/device can change it).
 * We detect that case and offer a one-click switch instead of a dead end.
 */
export const WrongCompanyNotice = ({ entryId, entityLabel }: Props) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [checking, setChecking] = useState(true);
  const [result, setResult] = useState<LocateResult | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!entryId) {
        setChecking(false);
        return;
      }
      const { data, error } = await supabase.rpc('locate_pipeline_entry_tenant' as any, {
        p_entry_id: entryId,
      });
      if (cancelled) return;
      if (!error && data) {
        setResult(data as unknown as LocateResult);
      }
      setChecking(false);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [entryId]);

  const handleSwitch = async () => {
    if (!result?.tenant_id) return;
    setSwitching(true);
    const { data, error } = await supabase.rpc('switch_active_tenant' as any, {
      p_tenant_id: result.tenant_id,
    });
    const res = data as { success?: boolean; error?: string } | null;
    if (error || !res?.success) {
      setSwitching(false);
      toast({
        title: 'Switch failed',
        description: error?.message || res?.error || 'Unable to switch company',
        variant: 'destructive',
      });
      return;
    }
    window.location.reload();
  };

  const wrongCompany =
    result?.found && result.tenant_id && result.tenant_id !== result.active_tenant_id;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen space-y-4 px-6 text-center">
      {checking ? (
        <>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Locating {entityLabel.toLowerCase()}…</p>
        </>
      ) : wrongCompany ? (
        <>
          <Building2 className="h-8 w-8 text-muted-foreground" />
          <h2 className="text-2xl font-bold">Different company</h2>
          <p className="text-muted-foreground max-w-md">
            This {entityLabel.toLowerCase()} belongs to{' '}
            <span className="font-medium text-foreground">{result?.tenant_name}</span>, but your
            account is currently active in another company.
          </p>
          <div className="flex gap-2">
            <Button onClick={handleSwitch} disabled={switching}>
              {switching ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Building2 className="h-4 w-4 mr-2" />
              )}
              Switch to {result?.tenant_name}
            </Button>
            <Button variant="outline" onClick={() => navigate('/pipeline', { replace: true })}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Go back
            </Button>
          </div>
        </>
      ) : (
        <>
          <h2 className="text-2xl font-bold">{entityLabel} not found</h2>
          <Button onClick={() => navigate('/pipeline', { replace: true })}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Go back
          </Button>
        </>
      )}
    </div>
  );
};
