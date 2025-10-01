import React, { useState, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ErrorTrackingProvider } from "@/hooks/useErrorTracking";
import Index from "./pages/Index";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import ContactProfile from "./pages/ContactProfile";
import JobDetails from "./pages/JobDetails";
import JobAnalytics from "./pages/JobAnalytics";
import LeadDetails from "./pages/LeadDetails";
import ProjectDetails from "./pages/ProjectDetails";
import EnhancedMeasurement from "./pages/EnhancedMeasurement";
import DemoRequest from "./pages/DemoRequest";
import NotFound from "./pages/NotFound";
import Pipeline from "./features/pipeline/components/Pipeline";
import QuickBooksCallback from "./pages/QuickBooksCallback";


const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorTrackingProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/demo-request" element={<DemoRequest />} />
              <Route path="/quickbooks/callback" element={<QuickBooksCallback />} />
              
              <Route path="/contact/:id" element={<ContactProfile />} />
              <Route path="/lead/:id" element={<LeadDetails />} />
              <Route path="/job/:id" element={<JobDetails />} />
              <Route path="/job-analytics" element={<JobAnalytics />} />
        <Route path="/project/:id" element={<ProjectDetails />} />
        <Route path="/enhanced-measurement/:id" element={<EnhancedMeasurement />} />
              <Route path="/" element={<Index />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </ErrorTrackingProvider>
    </QueryClientProvider>
  );
};

export default App;
