import { useState } from "react";
import Dashboard from "@/components/Dashboard";
import Sidebar from "@/components/Sidebar";
import Pipeline from "@/components/Pipeline";
import EstimatePreview from "@/components/EstimatePreview";

const Index = () => {
  const [activeSection, setActiveSection] = useState("dashboard");

  const renderActiveSection = () => {
    switch (activeSection) {
      case "dashboard":
        return <Dashboard />;
      case "pipeline":
        return <Pipeline />;
      case "estimates":
        return <EstimatePreview />;
      case "contacts":
        return <div className="p-8 text-center text-muted-foreground">Contacts section coming soon...</div>;
      case "projects":
        return <div className="p-8 text-center text-muted-foreground">Projects section coming soon...</div>;
      case "payments":
        return <div className="p-8 text-center text-muted-foreground">Payments section coming soon...</div>;
      case "calendar":
        return <div className="p-8 text-center text-muted-foreground">Calendar section coming soon...</div>;
      case "dialer":
        return <div className="p-8 text-center text-muted-foreground">Dialer section coming soon...</div>;
      case "settings":
        return <div className="p-8 text-center text-muted-foreground">Settings section coming soon...</div>;
      case "security":
        return <div className="p-8 text-center text-muted-foreground">Security section coming soon...</div>;
      case "help":
        return <div className="p-8 text-center text-muted-foreground">Help section coming soon...</div>;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="flex h-screen bg-background">
      <Sidebar activeSection={activeSection} onSectionChange={setActiveSection} />
      <main className="flex-1 overflow-auto">
        <div className="p-6">
          {renderActiveSection()}
        </div>
      </main>
    </div>
  );
};

export default Index;
