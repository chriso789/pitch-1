import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  DollarSign, 
  Search, 
  CreditCard, 
  Calendar,
  CheckCircle,
  AlertCircle,
  TrendingUp,
  FileText
} from "lucide-react";
import { default as JobSearch } from "@/features/jobs/components/JobSearch";
import PaymentForm from "./PaymentForm";

const Payments = () => {
  const [selectedJob, setSelectedJob] = useState<any>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);

  // Mock data for demonstration
  const paymentStats = [
    {
      title: "Total Collected",
      value: "$847,250",
      change: "+12.3%",
      icon: DollarSign,
      color: "text-success"
    },
    {
      title: "Outstanding Balance",
      value: "$156,890",
      change: "-8.1%",
      icon: AlertCircle,
      color: "text-warning"
    },
    {
      title: "This Month",
      value: "$67,420",
      change: "+24.5%",
      icon: TrendingUp,
      color: "text-success"
    },
    {
      title: "Pending Payments",
      value: "14",
      change: "+2",
      icon: FileText,
      color: "text-primary"
    }
  ];

  const recentPayments = [
    {
      id: "PAY-2024-001",
      customer: "Johnson Residence",
      project: "P-2024-001",
      amount: 8450,
      status: "completed",
      date: "2024-01-15",
      method: "Credit Card"
    },
    {
      id: "PAY-2024-002",
      customer: "Smith Property",
      project: "P-2024-002",
      amount: 15600,
      status: "pending",
      date: "2024-01-14",
      method: "Check"
    },
    {
      id: "PAY-2024-003",
      customer: "Williams Home",
      project: "P-2024-003",
      amount: 4200,
      status: "failed",
      date: "2024-01-12",
      method: "Credit Card"
    }
  ];

  const getStatusColor = (status: string) => {
    const colors = {
      "completed": "bg-success text-success-foreground",
      "pending": "bg-warning text-warning-foreground",
      "failed": "bg-destructive text-destructive-foreground"
    };
    return colors[status as keyof typeof colors] || "bg-muted";
  };

  const handleJobSelect = (job: any) => {
    setSelectedJob(job);
    setShowPaymentForm(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold gradient-primary bg-clip-text text-transparent">
            Payment Management
          </h1>
          <p className="text-muted-foreground">
            Process payments and manage customer balances
          </p>
        </div>
        <Button 
          onClick={() => setShowPaymentForm(true)}
          className="gradient-primary text-white shadow-soft"
        >
          <CreditCard className="h-4 w-4 mr-2" />
          New Payment
        </Button>
      </div>

      {/* Payment Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {paymentStats.map((stat, index) => (
          <Card key={index} className="shadow-soft border-0 hover:shadow-medium transition-smooth">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-success flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                {stat.change} from last month
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="payments" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="payments">Recent Payments</TabsTrigger>
          <TabsTrigger value="search">Job Search</TabsTrigger>
          <TabsTrigger value="process">Process Payment</TabsTrigger>
        </TabsList>

        <TabsContent value="payments" className="space-y-6">
          <Card className="shadow-soft border-0">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-primary" />
                Recent Payments
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {recentPayments.map((payment, index) => (
                  <div key={index} className="flex items-center justify-between p-4 rounded-lg bg-muted/50 hover:bg-muted transition-smooth">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm text-muted-foreground">{payment.id}</span>
                        <Badge className={getStatusColor(payment.status)}>
                          {payment.status}
                        </Badge>
                      </div>
                      <h3 className="font-semibold mt-1">{payment.customer}</h3>
                      <p className="text-sm text-muted-foreground">
                        Project: {payment.project} • {payment.method}
                      </p>
                      <p className="text-xs text-muted-foreground">{payment.date}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold">${payment.amount.toLocaleString()}</div>
                      <Button variant="outline" size="sm" className="mt-2">
                        View Details
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="search">
          <JobSearch onJobSelect={handleJobSelect} />
        </TabsContent>

        <TabsContent value="process">
          <PaymentForm selectedJob={selectedJob} />
        </TabsContent>
      </Tabs>

      {/* Payment Form Modal */}
      {showPaymentForm && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg shadow-strong">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Process Payment</CardTitle>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setShowPaymentForm(false)}
              >
                ×
              </Button>
            </CardHeader>
            <CardContent>
              <PaymentForm selectedJob={selectedJob} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default Payments;