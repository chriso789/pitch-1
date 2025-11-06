import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import {
  Phone,
  TrendingUp,
  Mail,
  MessageSquare,
  Calendar,
  Voicemail,
  Activity,
  DollarSign,
  Users,
  Zap
} from "lucide-react";

interface Agent {
  id: string;
  agent_type: string;
  name: string;
  status: 'active' | 'inactive' | 'paused';
  metrics: any;
}

const agentConfigs = {
  power_dialer: {
    icon: Phone,
    title: "Power Dialer",
    description: "AI-powered automated calling",
    replaces: "Mojo Dialer",
    savingsMonthly: 399,
    route: "/power-dialer-agent",
    color: "text-blue-500"
  },
  lead_scorer: {
    icon: TrendingUp,
    title: "AI Lead Scoring",
    description: "Intelligent lead prioritization",
    replaces: "LeadIQ",
    savingsMonthly: 75,
    route: "/lead-scoring-dashboard",
    color: "text-green-500"
  },
  email_sequence: {
    icon: Mail,
    title: "Email Sequences",
    description: "Automated email campaigns",
    replaces: "Outreach.io",
    savingsMonthly: 100,
    route: "/email-sequences",
    color: "text-purple-500"
  },
  sms_followup: {
    icon: MessageSquare,
    title: "SMS Follow-Up",
    description: "Automated SMS responses",
    replaces: "Salesmsg",
    savingsMonthly: 50,
    route: "/sms-automation",
    color: "text-orange-500"
  },
  meeting_scheduler: {
    icon: Calendar,
    title: "Meeting Scheduler",
    description: "Smart calendar booking",
    replaces: "Calendly",
    savingsMonthly: 12,
    route: "/meeting-scheduler-config",
    color: "text-indigo-500"
  },
  voicemail_drop: {
    icon: Voicemail,
    title: "Voicemail Drop",
    description: "Instant voicemail delivery",
    replaces: "Slybroadcast",
    savingsMonthly: 50,
    route: "/voicemail-dropper",
    color: "text-red-500"
  }
};

export default function AIAgentsCommandCenter() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAgents();
  }, []);

  const loadAgents = async () => {
    const { data } = await supabase
      .from('ai_agents' as any)
      .select('*');
    
    if (data) {
      setAgents(data as unknown as Agent[]);
    }
    setLoading(false);
  };

  const toggleAgent = async (agentId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    
    await supabase
      .from('ai_agents' as any)
      .update({ status: newStatus })
      .eq('id', agentId);

    loadAgents();
  };

  const totalSavings = Object.values(agentConfigs).reduce((sum, config) => sum + config.savingsMonthly, 0);
  const activeAgents = agents.filter(a => a.status === 'active').length;

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold">AI Agents Command Center</h1>
          <p className="text-muted-foreground mt-2">Replace $8,000+/year in sales tools with AI</p>
        </div>
        <div className="flex gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              <div>
                <div className="text-2xl font-bold">{activeAgents}</div>
                <div className="text-xs text-muted-foreground">Active Agents</div>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-green-500" />
              <div>
                <div className="text-2xl font-bold">${totalSavings}</div>
                <div className="text-xs text-muted-foreground">Saved/Month</div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Savings Calculator */}
      <Card className="p-6 bg-gradient-to-r from-primary/10 to-purple-500/10 border-primary/20">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold">Annual Savings</h3>
            <p className="text-muted-foreground">Replace expensive SaaS tools with AI agents</p>
          </div>
          <div className="text-right">
            <div className="text-4xl font-bold text-primary">${(totalSavings * 12).toLocaleString()}</div>
            <div className="text-sm text-muted-foreground">per year, per user</div>
          </div>
        </div>
      </Card>

      {/* Agent Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Object.entries(agentConfigs).map(([type, config]) => {
          const agent = agents.find(a => a.agent_type === type);
          const Icon = config.icon;
          
          return (
            <Card key={type} className="p-6 hover:shadow-lg transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`p-3 rounded-lg bg-muted`}>
                    <Icon className={`h-6 w-6 ${config.color}`} />
                  </div>
                  <div>
                    <h3 className="font-semibold">{config.title}</h3>
                    <Badge variant={agent?.status === 'active' ? 'default' : 'secondary'}>
                      {agent?.status || 'Not Set Up'}
                    </Badge>
                  </div>
                </div>
              </div>

              <p className="text-sm text-muted-foreground mb-4">{config.description}</p>

              <div className="space-y-2 mb-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Replaces:</span>
                  <span className="font-medium line-through">{config.replaces}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Savings:</span>
                  <span className="font-bold text-green-500">${config.savingsMonthly}/mo</span>
                </div>
              </div>

              {agent?.metrics && Object.keys(agent.metrics).length > 0 && (
                <div className="mb-4 p-3 bg-muted rounded-lg">
                  <div className="text-xs text-muted-foreground mb-1">Today's Activity</div>
                  <div className="flex gap-4">
                    {Object.entries(agent.metrics).slice(0, 2).map(([key, value]) => (
                      <div key={key}>
                        <div className="text-lg font-bold">{value as any}</div>
                        <div className="text-xs text-muted-foreground">{key}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button 
                  onClick={() => navigate(config.route)}
                  className="flex-1"
                  variant="outline"
                >
                  Configure
                </Button>
                {agent && (
                  <Button
                    onClick={() => toggleAgent(agent.id, agent.status)}
                    variant={agent.status === 'active' ? 'destructive' : 'default'}
                  >
                    {agent.status === 'active' ? 'Stop' : 'Start'}
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Quick Stats */}
      <Card className="p-6">
        <h3 className="text-xl font-semibold mb-4">System Overview</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <div className="text-sm text-muted-foreground">Total Calls Today</div>
            <div className="text-2xl font-bold">247</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Emails Sent</div>
            <div className="text-2xl font-bold">1,432</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">SMS Sent</div>
            <div className="text-2xl font-bold">384</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Meetings Booked</div>
            <div className="text-2xl font-bold">18</div>
          </div>
        </div>
      </Card>
    </div>
  );
}
