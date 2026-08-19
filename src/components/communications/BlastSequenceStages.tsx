import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ListOrdered, AlertTriangle } from 'lucide-react';

interface BlastSequenceStagesProps {
  templatePoolIds: string[] | null | undefined;
  maxAttemptsPerContact: number | null | undefined;
  aiFollowupEnabled: boolean | null | undefined;
  items: any[];
}

const FOLLOWUP_CATEGORIES = new Set(['storm_followup', 'grant_followup', 'reactivation', 'followup']);

const isFollowupTemplate = (t: any) =>
  FOLLOWUP_CATEGORIES.has(String(t?.category || '').toLowerCase()) ||
  (typeof t?.followup_delay_days === 'number' && t.followup_delay_days > 0);

const formatDelay = (days: number) =>
  days <= 0 ? 'Sends immediately' : days === 1 ? 'Sends 1 day later' : `Sends ${days} days later`;

export const BlastSequenceStages = ({
  templatePoolIds,
  maxAttemptsPerContact,
  aiFollowupEnabled,
  items,
}: BlastSequenceStagesProps) => {
  const poolIds = (templatePoolIds || []).filter(Boolean);

  const { data: templates } = useQuery({
    queryKey: ['blast-stage-templates', poolIds.join(',')],
    enabled: poolIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sms_templates')
        .select('id, template_name, template_body, category, followup_delay_days')
        .in('id', poolIds);
      if (error) throw error;
      return data || [];
    },
  });

  const ordered = [...(templates || [])].sort((a: any, b: any) => {
    const af = isFollowupTemplate(a) ? 1 : 0;
    const bf = isFollowupTemplate(b) ? 1 : 0;
    if (af !== bf) return af - bf;
    return (a.followup_delay_days ?? 0) - (b.followup_delay_days ?? 0);
  });

  const statOf = (templateId: string) => {
    const rows = (items || []).filter((i) => i.template_id === templateId);
    const attempted = rows.length;
    return {
      attempted,
      sent: rows.filter((r) => ['sent', 'delivered', 'replied'].includes(r.status) || r.sent_at).length,
      delivered: rows.filter((r) => r.delivered_at).length,
      replied: rows.filter((r) => r.replied_at || r.status === 'replied').length,
      opted: rows.filter((r) => r.status === 'opted_out').length,
      failed: rows.filter((r) => r.status === 'failed').length,
    };
  };

  const followupStages = ordered.filter(isFollowupTemplate);
  const cap = Number(maxAttemptsPerContact || 1);
  const followupsBlocked = followupStages.length > 0 && cap <= 1;
  const totalAttempted = (items || []).length;

  return (
    <Card className="shrink-0">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ListOrdered className="h-4 w-4 text-primary" />
          Follow-Up Sequence
          <span className="text-xs font-normal text-muted-foreground">
            {ordered.length} stage{ordered.length === 1 ? '' : 's'} selected
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {ordered.length === 0 && (
          <p className="text-muted-foreground">No templates were saved to this campaign's sequence.</p>
        )}

        {(followupsBlocked || (followupStages.length > 0 && !aiFollowupEnabled)) && (
          <div className="flex items-start gap-2 p-3 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-700">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <p>
              {followupsBlocked
                ? `Only the opening message was ever sent: this campaign is capped at ${cap} attempt per contact, so the follow-up stages below never fired.`
                : 'Follow-up stages are selected but AI follow-up is off for this campaign, so later stages were not sent.'}
            </p>
          </div>
        )}

        {ordered.map((t: any, idx: number) => {
          const follow = isFollowupTemplate(t);
          const s = statOf(t.id);
          const reachPct = totalAttempted > 0 ? Math.round((s.attempted / totalAttempted) * 100) : 0;
          const optRate = s.attempted > 0 ? Math.round((s.opted / s.attempted) * 100) : 0;
          const replyRate = s.attempted > 0 ? Math.round((s.replied / s.attempted) * 100) : 0;
          return (
            <div key={t.id} className="p-3 rounded-md border border-border bg-muted/30 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={follow ? 'secondary' : 'default'} className="text-[10px]">
                  {follow ? `Follow-up ${idx}` : 'Stage 1 · Initial message'}
                </Badge>
                <span className="font-medium">{t.template_name}</span>
                <span className="text-muted-foreground">
                  · {formatDelay(t.followup_delay_days ?? (follow ? 2 : 0))}
                </span>
                {s.attempted === 0 && (
                  <Badge variant="outline" className="text-[10px] border-amber-500/60 text-amber-700">
                    never sent
                  </Badge>
                )}
              </div>
              <p className="text-muted-foreground line-clamp-2">{t.template_body}</p>
              <Progress value={reachPct} className="h-1.5" />
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                <div><p className="font-semibold">{s.attempted}</p><p className="text-muted-foreground">Reached ({reachPct}%)</p></div>
                <div><p className="font-semibold text-green-600">{s.sent}</p><p className="text-muted-foreground">Sent</p></div>
                <div><p className="font-semibold text-blue-600">{s.delivered}</p><p className="text-muted-foreground">Delivered</p></div>
                <div><p className="font-semibold text-violet-600">{s.replied}</p><p className="text-muted-foreground">Replied ({replyRate}%)</p></div>
                <div><p className="font-semibold text-amber-500">{s.opted}</p><p className="text-muted-foreground">Opted out ({optRate}%)</p></div>
                <div><p className="font-semibold text-destructive">{s.failed}</p><p className="text-muted-foreground">Failed</p></div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};
