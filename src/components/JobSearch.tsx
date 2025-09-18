import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Search, 
  MapPin, 
  Calendar,
  DollarSign,
  Filter,
  User
} from "lucide-react";

interface JobSearchProps {
  onJobSelect: (job: any) => void;
}

const JobSearch = ({ onJobSelect }: JobSearchProps) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedJobs, setSelectedJobs] = useState<string[]>([]);

  // Mock job data
  const jobs = [
    {
      id: "P-2024-001",
      customer: "Johnson Residence",
      address: "123 Oak St, Austin, TX",
      projectType: "Shingle Replacement", 
      status: "active",
      totalAmount: 18450,
      paidAmount: 10000,
      remainingBalance: 8450,
      dueDate: "2024-02-15",
      phone: "(512) 555-0123",
      email: "johnson@email.com"
    },
    {
      id: "P-2024-002",
      customer: "Smith Property",
      address: "456 Pine Ave, Dallas, TX",
      projectType: "Metal Roof Install",
      status: "completed",
      totalAmount: 32800,
      paidAmount: 17200,
      remainingBalance: 15600,
      dueDate: "2024-01-30",
      phone: "(214) 555-0456",
      email: "smith@email.com"
    },
    {
      id: "P-2024-003",
      customer: "Williams Home",
      address: "789 Elm Dr, Houston, TX",
      projectType: "Tile Repair",
      status: "active",
      totalAmount: 8920,
      paidAmount: 4720,
      remainingBalance: 4200,
      dueDate: "2024-02-20",
      phone: "(713) 555-0789",
      email: "williams@email.com"
    },
    {
      id: "P-2024-004",
      customer: "Brown Estate",
      address: "321 Cedar Ln, San Antonio, TX",
      projectType: "Gutter Replacement",
      status: "pending",
      totalAmount: 12500,
      paidAmount: 0,
      remainingBalance: 12500,
      dueDate: "2024-03-01",
      phone: "(210) 555-0321",
      email: "brown@email.com"
    }
  ];

  const filteredJobs = jobs.filter(job => {
    const matchesSearch = 
      job.customer.toLowerCase().includes(searchTerm.toLowerCase()) ||
      job.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      job.address.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === "all" || job.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const getStatusColor = (status: string) => {
    const colors = {
      "active": "bg-status-project text-white",
      "completed": "bg-status-completed text-white", 
      "pending": "bg-warning text-warning-foreground"
    };
    return colors[status as keyof typeof colors] || "bg-muted";
  };

  const toggleJobSelection = (jobId: string) => {
    setSelectedJobs(prev => 
      prev.includes(jobId) 
        ? prev.filter(id => id !== jobId)
        : [...prev, jobId]
    );
  };

  const calculateTotalBalance = () => {
    return selectedJobs.reduce((total, jobId) => {
      const job = jobs.find(j => j.id === jobId);
      return total + (job?.remainingBalance || 0);
    }, 0);
  };

  return (
    <div className="space-y-6">
      {/* Search and Filters */}
      <Card className="shadow-soft border-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5 text-primary" />
            Search Jobs & Customers
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-1">
              <Input
                placeholder="Search by customer, project ID, or address..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {selectedJobs.length > 0 && (
            <div className="flex items-center justify-between p-3 bg-primary/10 rounded-lg">
              <span className="text-sm font-medium">
                {selectedJobs.length} job(s) selected • Total Balance: ${calculateTotalBalance().toLocaleString()}
              </span>
              <Button 
                onClick={() => {
                  const selectedJobData = jobs.filter(job => selectedJobs.includes(job.id));
                  onJobSelect(selectedJobData);
                }}
                className="gradient-primary text-white"
              >
                Process Selected Payments
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Job Results */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredJobs.map((job) => (
          <Card 
            key={job.id} 
            className={`shadow-soft border-0 hover:shadow-medium transition-smooth cursor-pointer ${
              selectedJobs.includes(job.id) ? 'ring-2 ring-primary bg-primary/5' : ''
            }`}
            onClick={() => toggleJobSelection(job.id)}
          >
            <CardContent className="p-6">
              <div className="space-y-4">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm text-muted-foreground">{job.id}</span>
                      <Badge className={getStatusColor(job.status)}>
                        {job.status}
                      </Badge>
                    </div>
                    <h3 className="font-semibold text-lg mt-1">{job.customer}</h3>
                  </div>
                  <input 
                    type="checkbox"
                    checked={selectedJobs.includes(job.id)}
                    onChange={(e) => e.stopPropagation()}
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                </div>

                {/* Project Details */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    {job.address}
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="text-primary font-medium">{job.projectType}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    Due: {job.dueDate}
                  </div>
                </div>

                {/* Financial Summary */}
                <div className="grid grid-cols-3 gap-4 pt-3 border-t border-border">
                  <div className="text-center">
                    <div className="text-sm text-muted-foreground">Total</div>
                    <div className="font-semibold">${job.totalAmount.toLocaleString()}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm text-muted-foreground">Paid</div>
                    <div className="font-semibold text-success">${job.paidAmount.toLocaleString()}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm text-muted-foreground">Balance</div>
                    <div className="font-semibold text-warning">${job.remainingBalance.toLocaleString()}</div>
                  </div>
                </div>

                {/* Contact Info */}
                <div className="flex justify-between text-xs text-muted-foreground pt-2 border-t border-border">
                  <span>{job.phone}</span>
                  <span>{job.email}</span>
                </div>

                {/* Action Button */}
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    onJobSelect(job);
                  }}
                >
                  <DollarSign className="h-4 w-4 mr-2" />
                  Process Payment
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredJobs.length === 0 && (
        <Card className="shadow-soft border-0">
          <CardContent className="p-12 text-center">
            <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-semibold text-lg mb-2">No jobs found</h3>
            <p className="text-muted-foreground">
              Try adjusting your search criteria or filters
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default JobSearch;