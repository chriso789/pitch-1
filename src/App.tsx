import React, { useState, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import ContactProfile from "./pages/ContactProfile";
import JobDetails from "./pages/JobDetails";
import DemoRequest from "./pages/DemoRequest";
import NotFound from "./pages/NotFound";
import { FloatingTestButton } from "./components/FloatingTestButton";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const App = () => {
  const [openIssuesCount, setOpenIssuesCount] = useState(0);

  // Load and track open issues count
  useEffect(() => {
    const loadIssuesCount = () => {
      const issues = JSON.parse(localStorage.getItem('walkthrough-issues') || '[]');
      const openIssues = issues.filter((issue: any) => issue.status === 'open');
      setOpenIssuesCount(openIssues.length);
    };

    loadIssuesCount();
    
    // Listen for storage changes (when issues are updated)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'walkthrough-issues') {
        loadIssuesCount();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    
    // Also check periodically for updates within the same tab
    const interval = setInterval(loadIssuesCount, 5000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  const runFullSystemTest = () => {
    // Navigate to main page and start test
    if (window.location.pathname !== '/') {
      window.location.href = '/?test=true';
    } else {
      // Trigger walkthrough test on main page
      const event = new CustomEvent('start-walkthrough-test');
      window.dispatchEvent(event);
    }
  };
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/demo-request" element={<DemoRequest />} />
            <Route path="/contact/:id" element={<ContactProfile />} />
            <Route path="/job/:id" element={<JobDetails />} />
            <Route path="/" element={<Index />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          
          {/* Global floating test button for all pages */}
          <FloatingTestButton 
            onRunTest={runFullSystemTest}
            issueCount={openIssuesCount}
          />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
