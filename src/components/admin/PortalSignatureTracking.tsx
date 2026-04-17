/**
 * Portal Signature Tracking
 * Full-page view of every signature request sent to homeowners,
 * with view / open / sign status so owners can hold homeowners accountable.
 */

import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  FileSignature,
  Eye,
  EyeOff,
  CheckCircle2,
  Clock,
  XCircle,
  Search,
  Send,
  AlertCircle,
  FileText,
  ExternalLink,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type EnvelopeRow = {
  id: string;
  title: string | null;
  status: string;
  sent_at: string | null;
  completed_at: string | null;
  created_at: string;
  created_by: string | null;
  sender_name: string | null;
  sender_email: string | null;
  generated_pdf_path: string | null;
  signed_pdf_path: string | null;
  document_url: string | null;
  recipients: {
    id: string;
    recipient_name: string;
    recipient_email: string;
    status: string;
    signed_at: string | null;
  }[];
  opened_at: string | null;
  open_count: number;
};

const statusFilters = [
  { key: "all", label: "All" },
  { key: "pending", label: "Awaiting" },
  { key: "opened", label: "Opened, Not Signed" },
  { key: "signed", label: "Signed" },
  { key: "stale", label: "Stale (3+ days)" },
] as const;

export const PortalSignatureTracking: React.FC = () => {
  const tenantId = useEffectiveTenantId();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof statusFilters)[number]["key"]>("all");
  const [resending, setResending] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["portal-signature-tracking", tenantId],
    enabled: !!tenantId,
    queryFn: async (): Promise<EnvelopeRow[]> => {
      const { data: envelopes, error } = await supabase
        .from("signature_envelopes")
        .select(
          `id, title, status, sent_at, completed_at, created_at,
           signature_recipients(id, recipient_name, recipient_email, status, signed_at)`
        )
        .eq("tenant_id", tenantId!)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;

      const ids = (envelopes || []).map((e: any) => e.id);
      let openMap = new Map<string, { opened_at: string | null; open_count: number }>();
      if (ids.length) {
        const { data: events } = await supabase
          .from("signature_events")
          .select("envelope_id, event_type, created_at")
          .in("envelope_id", ids)
          .eq("event_type", "opened")
          .order("created_at", { ascending: true });

        for (const ev of events || []) {
          const cur = openMap.get((ev as any).envelope_id) || {
            opened_at: null,
            open_count: 0,
          };
          if (!cur.opened_at) cur.opened_at = (ev as any).created_at;
          cur.open_count += 1;
          openMap.set((ev as any).envelope_id, cur);
        }
      }

      return (envelopes || []).map((e: any) => ({
        id: e.id,
        title: e.title,
        status: e.status,
        sent_at: e.sent_at,
        completed_at: e.completed_at,
        created_at: e.created_at,
        recipients: e.signature_recipients || [],
        opened_at: openMap.get(e.id)?.opened_at || null,
        open_count: openMap.get(e.id)?.open_count || 0,
      }));
    },
  });

  const stats = useMemo(() => {
    const rows = data || [];
    const sent = rows.filter((r) => !!r.sent_at).length;
    const opened = rows.filter((r) => !!r.opened_at).length;
    const signed = rows.filter((r) => r.status === "completed").length;
    const stale = rows.filter((r) => {
      if (r.status === "completed") return false;
      const sentDate = r.sent_at ? new Date(r.sent_at).getTime() : 0;
      return sentDate && Date.now() - sentDate > 1000 * 60 * 60 * 24 * 3;
    }).length;
    return { sent, opened, signed, stale };
  }, [data]);

  const filtered = useMemo(() => {
    let rows = data || [];
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          (r.title || "").toLowerCase().includes(q) ||
          r.recipients.some(
            (rec) =>
              rec.recipient_name?.toLowerCase().includes(q) ||
              rec.recipient_email?.toLowerCase().includes(q)
          )
      );
    }
    if (filter === "pending") rows = rows.filter((r) => r.status !== "completed" && !r.opened_at);
    if (filter === "opened")
      rows = rows.filter((r) => !!r.opened_at && r.status !== "completed");
    if (filter === "signed") rows = rows.filter((r) => r.status === "completed");
    if (filter === "stale")
      rows = rows.filter((r) => {
        if (r.status === "completed") return false;
        const sentDate = r.sent_at ? new Date(r.sent_at).getTime() : 0;
        return sentDate && Date.now() - sentDate > 1000 * 60 * 60 * 24 * 3;
      });
    return rows;
  }, [data, search, filter]);

  const handleResend = async (envelopeId: string) => {
    setResending(envelopeId);
    try {
      const { error } = await supabase.functions.invoke("resend-signature-request", {
        body: { envelope_id: envelopeId },
      });
      if (error) throw error;
      toast({ title: "Reminder sent", description: "The homeowner has been re-notified." });
    } catch (e: any) {
      toast({
        title: "Could not resend",
        description: e.message || "Function not available",
        variant: "destructive",
      });
    } finally {
      setResending(null);
    }
  };

  const renderStatus = (row: EnvelopeRow) => {
    if (row.status === "completed")
      return (
        <Badge className="bg-green-500/10 text-green-600 gap-1">
          <CheckCircle2 className="h-3 w-3" /> Signed
        </Badge>
      );
    if (row.opened_at)
      return (
        <Badge className="bg-amber-500/10 text-amber-600 gap-1">
          <Eye className="h-3 w-3" /> Opened, not signed
        </Badge>
      );
    if (row.sent_at)
      return (
        <Badge variant="outline" className="gap-1">
          <Clock className="h-3 w-3" /> Awaiting open
        </Badge>
      );
    if (row.status === "voided" || row.status === "declined")
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" /> {row.status}
        </Badge>
      );
    return (
      <Badge variant="outline" className="gap-1">
        <EyeOff className="h-3 w-3" /> Draft
      </Badge>
    );
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Sent" value={stats.sent} icon={<Send className="h-5 w-5" />} />
        <StatCard
          label="Opened by Homeowner"
          value={stats.opened}
          icon={<Eye className="h-5 w-5" />}
          tone="blue"
        />
        <StatCard
          label="Signed"
          value={stats.signed}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="green"
        />
        <StatCard
          label="Stale (3+ days)"
          value={stats.stale}
          icon={<AlertCircle className="h-5 w-5" />}
          tone="amber"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-col lg:flex-row gap-3 lg:items-center justify-between">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
          <TabsList>
            {statusFilters.map((s) => (
              <TabsTrigger key={s.key} value={s.key}>
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative w-full lg:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by document or homeowner..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-2">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <FileSignature className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p>No signature requests match this filter.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Homeowner</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Opened</TableHead>
                  <TableHead>Signed</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => {
                  const recipient = row.recipients[0];
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium max-w-[260px] truncate">
                        {row.title || "Untitled document"}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <div className="font-medium">
                            {recipient?.recipient_name || "—"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {recipient?.recipient_email || ""}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{renderStatus(row)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.sent_at
                          ? formatDistanceToNow(new Date(row.sent_at), { addSuffix: true })
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.opened_at ? (
                          <div>
                            <div>
                              {formatDistanceToNow(new Date(row.opened_at), {
                                addSuffix: true,
                              })}
                            </div>
                            {row.open_count > 1 && (
                              <div className="text-xs text-muted-foreground">
                                {row.open_count}× viewed
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Never</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.completed_at
                          ? format(new Date(row.completed_at), "MMM d, yyyy")
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.status !== "completed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={resending === row.id}
                            onClick={() => handleResend(row.id)}
                          >
                            <Send className="h-3.5 w-3.5 mr-1" />
                            Remind
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

const StatCard: React.FC<{
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: "blue" | "green" | "amber" | "default";
}> = ({ label, value, icon, tone = "default" }) => {
  const tones: Record<string, string> = {
    default: "bg-primary/10 text-primary",
    blue: "bg-blue-500/10 text-blue-500",
    green: "bg-green-500/10 text-green-500",
    amber: "bg-amber-500/10 text-amber-500",
  };
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <p className="text-3xl font-bold">{value}</p>
          </div>
          <div className={`h-12 w-12 rounded-lg flex items-center justify-center ${tones[tone]}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
