import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useReferralLinks } from "@/hooks/referrals/useReferralDashboard";
import { useReferralActions } from "@/hooks/referrals/useReferralActions";
import { Copy, Plus, Send, Eye } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { CreateReferralLinkDialog } from "./CreateReferralLinkDialog";
import { SendReferralLinkDialog } from "./SendReferralLinkDialog";

const buildUrls = (code: string) => {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return { referral_url: `${origin}/ref/${code}`, reward_url: `${origin}/ref/${code}/reward` };
};

interface Props { onView?: (linkId: string) => void; canManage: boolean; }

export function ReferralLinksTable({ onView, canManage }: Props) {
  const { data: links = [], isLoading } = useReferralLinks();
  const { deactivate, reactivate } = useReferralActions();
  const [createOpen, setCreateOpen] = useState(false);
  const [sendLink, setSendLink] = useState<any | null>(null);

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <div className="text-sm text-muted-foreground">
          {links.length} referral link{links.length === 1 ? "" : "s"}
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Create link
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : links.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground text-sm">
              No referral links created yet. Create one for a completed customer.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Referrer</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Uses</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {links.map((l: any) => {
                  const urls = buildUrls(l.code);
                  return (
                    <TableRow key={l.id}>
                      <TableCell>
                        {l.contacts ? `${l.contacts.first_name ?? ""} ${l.contacts.last_name ?? ""}`.trim() : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{l.code}</TableCell>
                      <TableCell>{l.current_uses ?? 0}</TableCell>
                      <TableCell>
                        <Badge variant={l.is_active ? "default" : "secondary"}>
                          {l.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{format(new Date(l.created_at), "MMM d, yyyy")}</TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button size="icon" variant="ghost" title="Copy referral link" onClick={() => copy(urls.referral_url, "Referral link")}>
                          <Copy className="h-4 w-4" />
                        </Button>
                        {canManage && (
                          <Button size="icon" variant="ghost" title="Send" onClick={() => setSendLink({ ...l, contact: l.contacts })}>
                            <Send className="h-4 w-4" />
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" title="View" onClick={() => onView?.(l.id)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        {canManage && (
                          l.is_active ? (
                            <Button size="sm" variant="ghost" onClick={() => deactivate.mutate(l.id)}>Deactivate</Button>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => reactivate.mutate(l.id)}>Reactivate</Button>
                          )
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

      <CreateReferralLinkDialog open={createOpen} onOpenChange={setCreateOpen} />
      <SendReferralLinkDialog open={!!sendLink} onOpenChange={(v) => !v && setSendLink(null)} link={sendLink} />
    </div>
  );
}
