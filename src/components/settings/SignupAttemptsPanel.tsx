import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, RefreshCw, CheckCircle2, XCircle, Clock } from "lucide-react";
import { format } from "date-fns";

interface SignupAttempt {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  phone: string | null;
  status: string;
  error_message: string | null;
  error_code: string | null;
  source: string | null;
  user_agent: string | null;
  created_at: string;
}

const statusBadge = (status: string) => {
  if (status === "success") {
    return <Badge variant="outline" className="gap-1 border-green-500/40 text-green-700"><CheckCircle2 className="h-3 w-3" /> Success</Badge>;
  }
  if (status === "error") {
    return <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive"><XCircle className="h-3 w-3" /> Error</Badge>;
  }
  return <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" /> Attempted</Badge>;
};

export const SignupAttemptsPanel: React.FC = () => {
  const [attempts, setAttempts] = useState<SignupAttempt[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("signup_attempts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (!error && data) setAttempts(data as SignupAttempt[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const errorCount = attempts.filter((a) => a.status === "error").length;
  const successCount = attempts.filter((a) => a.status === "success").length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Signup Attempts
            </CardTitle>
            <CardDescription>
              All signup form submissions, including failures.{" "}
              <span className="text-destructive font-medium">{errorCount} failed</span> · {successCount} succeeded
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {attempts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {loading ? "Loading…" : "No signup attempts logged yet. New errors will appear here."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attempts.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {format(new Date(a.created_at), "MMM d, h:mm a")}
                    </TableCell>
                    <TableCell>{statusBadge(a.status)}</TableCell>
                    <TableCell className="text-sm">
                      {[a.first_name, a.last_name].filter(Boolean).join(" ") || "—"}
                    </TableCell>
                    <TableCell className="text-sm">{a.email || "—"}</TableCell>
                    <TableCell className="text-sm">{a.company_name || "—"}</TableCell>
                    <TableCell className="text-xs text-destructive max-w-[280px] truncate" title={a.error_message || ""}>
                      {a.error_message || "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{a.source || "—"}</TableCell>
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
