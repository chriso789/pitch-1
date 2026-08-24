import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { ShieldAlert, RefreshCw, CheckCircle2, XCircle, Clock, MapPin } from "lucide-react";
import { format } from "date-fns";

interface LoginAttempt {
  id: string;
  email: string | null;
  status: string;
  error_message: string | null;
  source: string | null;
  ip_address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  isp: string | null;
  user_agent: string | null;
  company_name: string | null;
  tenant_id: string | null;
  created_at: string;
}


const statusBadge = (status: string) => {
  if (status === "success") {
    return (
      <Badge variant="outline" className="gap-1 border-green-500/40 text-green-700">
        <CheckCircle2 className="h-3 w-3" /> Success
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive">
        <XCircle className="h-3 w-3" /> Failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1">
      <Clock className="h-3 w-3" /> Attempted
    </Badge>
  );
};

const formatLocation = (a: LoginAttempt) => {
  const parts = [a.city, a.region, a.country].filter(Boolean);
  return parts.length ? parts.join(", ") : "Unknown";
};

export const LoginAttemptsPanel: React.FC = () => {
  const [attempts, setAttempts] = useState<LoginAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("login_attempts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (!error && data) setAttempts(data as unknown as LoginAttempt[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const term = search.trim().toLowerCase();
  const filtered = term
    ? attempts.filter((a) =>
        [a.email, a.ip_address, a.city, a.region, a.country, a.company_name].some((v) =>
          (v || "").toLowerCase().includes(term),
        ),
      )
    : attempts;


  const failedCount = attempts.filter((a) => a.status === "failed").length;
  const successCount = attempts.filter((a) => a.status === "success").length;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-500" />
              Login Attempts
            </CardTitle>
            <CardDescription>
              Full sign-in history — email, company, IP address and location (historical records
              imported from auth logs have no IP/location captured).{" "}
              <span className="font-semibold text-destructive">{failedCount} failed</span> ·{" "}
              {successCount} succeeded · {attempts.length} total
            </CardDescription>
          </div>
          <Button variant="outline" size="icon" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <Input
          placeholder="Search email, company, IP, or location…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mt-3 max-w-sm"
        />

      </CardHeader>
      <CardContent>
        {filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {loading ? "Loading…" : "No login attempts recorded yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Network</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {format(new Date(a.created_at), "MMM d, h:mm a")}
                    </TableCell>
                    <TableCell>{statusBadge(a.status)}</TableCell>
                    <TableCell className="text-sm">{a.email || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{a.ip_address || "—"}</TableCell>
                    <TableCell className="text-sm">
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-muted-foreground" />
                        {formatLocation(a)}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate text-xs text-muted-foreground">
                      {a.isp || "—"}
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate text-xs text-destructive">
                      {a.error_message || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default LoginAttemptsPanel;
