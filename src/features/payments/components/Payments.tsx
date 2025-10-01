import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import EnhancedPaymentForm from "./EnhancedPaymentForm";
import PaymentAnalytics from "./PaymentAnalytics";
import PaymentHistory from "./PaymentHistory";
import JobSearch from "@/features/jobs/components/JobSearch";
import { useState } from "react";

export default function Payments() {
  const [selectedJob, setSelectedJob] = useState(null);

  const handleJobSelect = (job: any) => {
    setSelectedJob(job);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Payments</h1>
          <p className="text-muted-foreground">
            Manage payments, track revenue, and process transactions with Stripe
          </p>
        </div>
      </div>

      <PaymentAnalytics />

      <Tabs defaultValue="history" className="space-y-4">
        <TabsList>
          <TabsTrigger value="history">Payment History</TabsTrigger>
          <TabsTrigger value="search">Find Job</TabsTrigger>
          <TabsTrigger value="process">Process Payment</TabsTrigger>
        </TabsList>

        <TabsContent value="history">
          <PaymentHistory />
        </TabsContent>

        <TabsContent value="search">
          <JobSearch onJobSelect={handleJobSelect} />
        </TabsContent>

        <TabsContent value="process">
          <EnhancedPaymentForm selectedJob={selectedJob} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
