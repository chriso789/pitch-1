import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  ArrowRight, 
  DollarSign, 
  Calendar, 
  MapPin, 
  Phone,
  Mail,
  FileText,
  User,
  Home,
  AlertCircle,
  CheckCircle,
  Clock
} from "lucide-react";
import { cn } from "@/lib/utils";

const Pipeline = () => {
  const pipelineStages = [
    { name: "Lead", key: "lead", color: "bg-status-lead", icon: User },
    { name: "Legal Review", key: "legal", color: "bg-status-legal", icon: FileText },
    { name: "Contingency", key: "contingency", color: "bg-status-contingency", icon: AlertCircle },
    { name: "Project", key: "project", color: "bg-status-project", icon: Home },
    { name: "Completed", key: "completed", color: "bg-status-completed", icon: CheckCircle },
    { name: "Closed", key: "closed", color: "bg-status-closed", icon: Clock }
  ];

  const pipelineData = {
    lead: [
      {
        id: "L-2024-045",
        homeowner: "Sarah Martinez",
        address: "321 Maple Dr, Austin, TX",
        phone: "(512) 555-0123",
        email: "sarah@email.com",
        roofType: "Shingle Replacement",
        estimatedValue: "$19,500",
        leadSource: "Google Ads",
        priority: "High",
        createdAt: "2024-01-15",
        notes: "Storm damage, insurance claim pending"
      },
      {
        id: "L-2024-046",
        homeowner: "Michael Chen",
        address: "654 Cedar Ave, Dallas, TX", 
        phone: "(214) 555-0456",
        email: "mchen@email.com",
        roofType: "Metal Roof Install",
        estimatedValue: "$35,200",
        leadSource: "Referral",
        priority: "Medium",
        createdAt: "2024-01-14",
        notes: "New construction, needs full install"
      }
    ],
    legal: [
      {
        id: "P-2024-012",
        homeowner: "Robert Wilson",
        address: "987 Oak St, Houston, TX",
        phone: "(713) 555-0789",
        email: "rwilson@email.com",
        roofType: "Tile Repair",
        contractValue: "$12,400",
        legalStatus: "Contract Review",
        attorney: "Legal Partners LLC",
        priority: "High",
        submittedAt: "2024-01-10"
      }
    ],
    contingency: [
      {
        id: "P-2024-008",
        homeowner: "Jennifer Davis",
        address: "123 Pine St, San Antonio, TX",
        phone: "(210) 555-0321",
        email: "jdavis@email.com",
        roofType: "Shingle Replacement",
        contractValue: "$22,100",
        contingencies: ["Material Delivery", "Weather Permit"],
        signedAt: "2024-01-05",
        priority: "Medium"
      }
    ],
    project: [
      {
        id: "P-2024-001",
        homeowner: "Johnson Residence",
        address: "123 Oak St, Austin, TX",
        phone: "(512) 555-1234",
        roofType: "Shingle Replacement",
        contractValue: "$18,450",
        budgetSnapshot: "$18,450",
        actualCosts: "$12,120",
        profit: "32.1%",
        startDate: "2024-01-08",
        crew: "Team Alpha",
        progress: 65
      },
      {
        id: "P-2024-003",
        homeowner: "Williams Home", 
        address: "789 Elm Dr, Houston, TX",
        phone: "(713) 555-7890",
        roofType: "Tile Repair",
        contractValue: "$8,920",
        budgetSnapshot: "$8,920",
        actualCosts: "$5,780",
        profit: "35.2%",
        startDate: "2024-01-12",
        crew: "Team Beta",
        progress: 45
      }
    ],
    completed: [
      {
        id: "P-2024-005",
        homeowner: "Anderson Property",
        address: "456 Birch Ln, Fort Worth, TX",
        roofType: "Metal Roof Install",
        contractValue: "$28,900",
        finalProfit: "29.8%",
        completedAt: "2024-01-10",
        rating: 5,
        testimonial: "Excellent work and professional team!"
      }
    ],
    closed: [
      {
        id: "P-2023-892",
        homeowner: "Thompson Residence",
        address: "789 Willow St, Plano, TX",
        roofType: "Shingle Replacement",
        finalValue: "$16,750",
        status: "Paid in Full",
        closedAt: "2024-01-08",
        outcome: "Completed Successfully"
      }
    ]
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "High": return "bg-destructive text-destructive-foreground";
      case "Medium": return "bg-warning text-warning-foreground";
      case "Low": return "bg-muted text-muted-foreground";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const renderStageCard = (item: any, stage: string) => {
    return (
      <Card key={item.id} className="shadow-soft border-0 hover:shadow-medium transition-smooth">
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <span className="font-mono text-sm text-muted-foreground">{item.id}</span>
              <h3 className="font-semibold">{item.homeowner}</h3>
            </div>
            {item.priority && (
              <Badge className={getPriorityColor(item.priority)}>
                {item.priority}
              </Badge>
            )}
          </div>
          
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="h-4 w-4" />
              <span>{item.address}</span>
            </div>
            
            {item.phone && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="h-4 w-4" />
                <span>{item.phone}</span>
              </div>
            )}
            
            <div className="flex items-center gap-2 text-primary font-medium">
              <Home className="h-4 w-4" />
              <span>{item.roofType}</span>
            </div>
            
            <div className="flex items-center gap-2 font-semibold">
              <DollarSign className="h-4 w-4 text-success" />
              <span>{item.contractValue || item.estimatedValue || item.finalValue}</span>
            </div>

            {/* Stage-specific information */}
            {stage === "project" && (
              <div className="mt-3 pt-3 border-t">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs text-muted-foreground">Progress</span>
                  <span className="text-xs font-medium">{item.progress}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div 
                    className="bg-success h-2 rounded-full transition-smooth" 
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mt-2">
                  <span>Profit: {item.profit}</span>
                  <span>Crew: {item.crew}</span>
                </div>
              </div>
            )}

            {stage === "contingency" && item.contingencies && (
              <div className="mt-3 pt-3 border-t">
                <div className="text-xs text-muted-foreground mb-1">Pending:</div>
                {item.contingencies.map((cont: string, idx: number) => (
                  <Badge key={idx} variant="outline" className="mr-1 mb-1 text-xs">
                    {cont}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2 mt-4">
            <Button size="sm" variant="outline" className="flex-1">
              <FileText className="h-4 w-4 mr-1" />
              View
            </Button>
            <Button size="sm" className="flex-1">
              <ArrowRight className="h-4 w-4 mr-1" />
              Advance
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold gradient-primary bg-clip-text text-transparent">
            Sales Pipeline
          </h1>
          <p className="text-muted-foreground">
            Track leads through the complete roofing sales process
          </p>
        </div>
        <Button className="gradient-primary">
          <User className="h-4 w-4 mr-2" />
          Add New Lead
        </Button>
      </div>

      {/* Pipeline Stages */}
      <div className="grid grid-cols-1 lg:grid-cols-6 gap-6">
        {pipelineStages.map((stage, index) => (
          <div key={stage.key} className="space-y-4">
            {/* Stage Header */}
            <Card className="shadow-soft border-0">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <div className={cn("w-8 h-8 rounded-full flex items-center justify-center", stage.color)}>
                    <stage.icon className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <div>{stage.name}</div>
                    <div className="font-normal text-muted-foreground">
                      {pipelineData[stage.key as keyof typeof pipelineData].length} items
                    </div>
                  </div>
                </CardTitle>                
              </CardHeader>
            </Card>

            {/* Stage Items */}
            <div className="space-y-3">
              {pipelineData[stage.key as keyof typeof pipelineData].map((item) => 
                renderStageCard(item, stage.key)
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Pipeline;