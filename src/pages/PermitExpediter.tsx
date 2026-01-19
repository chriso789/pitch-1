import { useState } from 'react';
import { 
  FileText, 
  Building2, 
  MapPin, 
  AlertCircle, 
  CheckCircle2, 
  Clock,
  Plus,
  Search,
  Filter,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useJobsReadyForPermitting, useCreatePermitCase } from '@/hooks/usePermitCases';
import { useProfile } from '@/hooks/useProfile';
import { 
  PERMIT_STATUS_LABELS, 
  PERMIT_STATUS_COLORS,
  PORTAL_TYPE_LABELS,
  type PermitExpediterJob,
} from '@/lib/permits/types';
import { PermitCaseDetailSheet } from '@/components/permits/PermitCaseDetailSheet';

export default function PermitExpediter() {
  const { data: profile } = useProfile();
  const tenantId = profile?.tenant_id;
  
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedJob, setSelectedJob] = useState<PermitExpediterJob | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const { data: jobs, isLoading, refetch } = useJobsReadyForPermitting(tenantId);
  const createPermitCase = useCreatePermitCase();

  // Filter jobs
  const filteredJobs = (jobs || []).filter(job => {
    const matchesSearch = searchQuery === '' || 
      job.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.job_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.contact_name.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || job.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  // Stats
  const stats = {
    total: jobs?.length || 0,
    notStarted: jobs?.filter(j => j.status === 'NOT_STARTED').length || 0,
    inProgress: jobs?.filter(j => ['DRAFT_BUILT', 'WAITING_ON_DOCS', 'READY_TO_SUBMIT'].includes(j.status)).length || 0,
    submitted: jobs?.filter(j => ['SUBMITTED', 'IN_REVIEW'].includes(j.status)).length || 0,
    approved: jobs?.filter(j => j.status === 'APPROVED').length || 0,
  };

  const handleCreateCase = async (job: PermitExpediterJob) => {
    if (!tenantId || !profile?.id) return;
    
    await createPermitCase.mutateAsync({
      tenantId,
      jobId: job.job_id,
      userId: profile.id,
    });
  };

  const handleViewDetails = (job: PermitExpediterJob) => {
    setSelectedJob(job);
    setIsDetailOpen(true);
  };

  const getMissingItemsBadges = (job: PermitExpediterJob) => {
    const missing: string[] = [];
    if (!job.has_measurements) missing.push('Measurements');
    if (!job.has_parcel_data) missing.push('Parcel Data');
    if (!job.has_product_approvals) missing.push('Product Approvals');
    return missing;
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Permit Expediter</h1>
          <p className="text-muted-foreground">
            Manage and expedite permit applications for your jobs
          </p>
        </div>
        <Button onClick={() => refetch()} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Jobs</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Not Started</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.notStarted}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">In Progress</CardTitle>
            <Clock className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.inProgress}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Submitted</CardTitle>
            <Building2 className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.submitted}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Approved</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.approved}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Permit Queue</CardTitle>
          <CardDescription>
            Jobs ready for permitting. Click on a row to view details and build permit packets.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by address, job number, or contact..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="NOT_STARTED">Not Started</SelectItem>
                <SelectItem value="DRAFT_BUILT">Draft Built</SelectItem>
                <SelectItem value="WAITING_ON_DOCS">Waiting on Docs</SelectItem>
                <SelectItem value="READY_TO_SUBMIT">Ready to Submit</SelectItem>
                <SelectItem value="SUBMITTED">Submitted</SelectItem>
                <SelectItem value="IN_REVIEW">In Review</SelectItem>
                <SelectItem value="CORRECTIONS_REQUIRED">Corrections Required</SelectItem>
                <SelectItem value="APPROVED">Approved</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Jobs Table */}
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No jobs found matching your criteria</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Address</TableHead>
                  <TableHead>Parcel ID</TableHead>
                  <TableHead>Jurisdiction</TableHead>
                  <TableHead>Portal</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Missing Items</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredJobs.map((job) => {
                  const missingItems = getMissingItemsBadges(job);
                  
                  return (
                    <TableRow 
                      key={job.id} 
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleViewDetails(job)}
                    >
                      <TableCell>
                        <div className="flex items-start gap-2">
                          <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                          <div>
                            <div className="font-medium">{job.address}</div>
                            {job.job_number && (
                              <div className="text-sm text-muted-foreground">
                                #{job.job_number}
                              </div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {job.parcel_id ? (
                          <code className="text-sm bg-muted px-1.5 py-0.5 rounded">
                            {job.parcel_id}
                          </code>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {job.jurisdiction_type ? (
                          <div className="flex items-center gap-1.5">
                            <Building2 className="h-4 w-4 text-muted-foreground" />
                            <span>
                              {job.jurisdiction_type === 'CITY' 
                                ? job.city_name 
                                : job.county_name} 
                              <span className="text-muted-foreground text-xs ml-1">
                                ({job.jurisdiction_type})
                              </span>
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">Not detected</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {job.portal_type ? (
                          <Badge variant="outline">
                            {PORTAL_TYPE_LABELS[job.portal_type]}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={PERMIT_STATUS_COLORS[job.status]}>
                          {PERMIT_STATUS_LABELS[job.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {missingItems.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {missingItems.map((item) => (
                              <Badge key={item} variant="destructive" className="text-xs">
                                {item}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <Badge variant="outline" className="text-green-600 border-green-600">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Complete
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant={job.status === 'NOT_STARTED' ? 'default' : 'outline'}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (job.status === 'NOT_STARTED') {
                              handleCreateCase(job);
                            } else {
                              handleViewDetails(job);
                            }
                          }}
                        >
                          {job.status === 'NOT_STARTED' ? (
                            <>
                              <Plus className="h-4 w-4 mr-1" />
                              Start Case
                            </>
                          ) : (
                            <>
                              <ExternalLink className="h-4 w-4 mr-1" />
                              View
                            </>
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Detail Sheet */}
      <PermitCaseDetailSheet
        job={selectedJob}
        open={isDetailOpen}
        onOpenChange={setIsDetailOpen}
      />
    </div>
  );
}
