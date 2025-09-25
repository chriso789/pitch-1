import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Plus, Edit, Trash2, Target, TrendingUp, Users, Award, Activity } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';
import { LeadScoringActions } from '@/features/contacts/components/LeadScoringActions';

interface ScoringRule {
  id: string;
  rule_name: string;
  rule_type: string;
  field_name: string;
  condition_type: string;
  condition_value: any;
  points: number;
  is_active: boolean;
  created_at: string;
}

interface QualificationStatus {
  id: string;
  name: string;
  min_score: number;
  max_score: number;
  color: string;
  priority: number;
  auto_assign: boolean;
  default_assigned_user: string;
  is_active: boolean;
}

interface LeadScoreOverview {
  total_leads: number;
  avg_score: number;
  high_quality_leads: number;
  score_distribution: { [key: string]: number };
}

export const LeadScoring = () => {
  const [activeTab, setActiveTab] = useState('overview');
  const [scoringRules, setScoringRules] = useState<ScoringRule[]>([]);
  const [qualificationStatuses, setQualificationStatuses] = useState<QualificationStatus[]>([]);
  const [scoreOverview, setScoreOverview] = useState<LeadScoreOverview>({
    total_leads: 0,
    avg_score: 0,
    high_quality_leads: 0,
    score_distribution: {}
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isRuleDialogOpen, setIsRuleDialogOpen] = useState(false);
  const [isStatusDialogOpen, setIsStatusDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<ScoringRule | null>(null);
  const [editingStatus, setEditingStatus] = useState<QualificationStatus | null>(null);
  const { toast } = useToast();

  const [ruleFormData, setRuleFormData] = useState({
    rule_name: '',
    rule_type: 'demographic',
    field_name: '',
    condition_type: 'equals',
    condition_value: { value: '' },
    points: 0,
    is_active: true
  });

  const [statusFormData, setStatusFormData] = useState({
    name: '',
    min_score: 0,
    max_score: 100,
    color: '#22c55e',
    priority: 0,
    auto_assign: false,
    default_assigned_user: '',
    is_active: true
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      await Promise.all([
        fetchScoringRules(),
        fetchQualificationStatuses(),
        fetchScoreOverview()
      ]);
    } catch (error) {
      console.error('Error fetching lead scoring data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchScoringRules = async () => {
    try {
      const { data, error } = await supabase
        .from('lead_scoring_rules')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setScoringRules(data || []);
    } catch (error) {
      console.error('Error fetching scoring rules:', error);
    }
  };

  const fetchQualificationStatuses = async () => {
    try {
      const { data, error } = await supabase
        .from('lead_qualification_statuses')
        .select('*')
        .order('priority', { ascending: true });

      if (error) throw error;
      setQualificationStatuses(data || []);
    } catch (error) {
      console.error('Error fetching qualification statuses:', error);
    }
  };

  const fetchScoreOverview = async () => {
    try {
      const { data: contacts, error } = await supabase
        .from('contacts')
        .select('lead_score, qualification_status')
        .not('lead_score', 'is', null);

      if (error) throw error;

      const totalLeads = contacts?.length || 0;
      const avgScore = totalLeads > 0 
        ? contacts.reduce((sum, contact) => sum + (contact.lead_score || 0), 0) / totalLeads 
        : 0;
      const highQualityLeads = contacts?.filter(c => (c.lead_score || 0) >= 70).length || 0;

      // Score distribution
      const distribution: { [key: string]: number } = {
        'Hot (80-100)': 0,
        'Warm (60-79)': 0,
        'Cool (40-59)': 0,
        'Cold (0-39)': 0
      };

      contacts?.forEach(contact => {
        const score = contact.lead_score || 0;
        if (score >= 80) distribution['Hot (80-100)']++;
        else if (score >= 60) distribution['Warm (60-79)']++;
        else if (score >= 40) distribution['Cool (40-59)']++;
        else distribution['Cold (0-39)']++;
      });

      setScoreOverview({
        total_leads: totalLeads,
        avg_score: Math.round(avgScore),
        high_quality_leads: highQualityLeads,
        score_distribution: distribution
      });
    } catch (error) {
      console.error('Error fetching score overview:', error);
    }
  };

  const handleRuleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const payload = {
        ...ruleFormData,
        tenant_id: (await supabase.auth.getUser()).data.user?.user_metadata?.tenant_id
      };

      let result;
      if (editingRule) {
        result = await supabase
          .from('lead_scoring_rules')
          .update(payload)
          .eq('id', editingRule.id);
      } else {
        result = await supabase
          .from('lead_scoring_rules')
          .insert(payload);
      }

      if (result.error) throw result.error;

      toast({
        title: "Success",
        description: `Scoring rule ${editingRule ? 'updated' : 'created'} successfully`,
      });

      setIsRuleDialogOpen(false);
      resetRuleForm();
      fetchScoringRules();
    } catch (error) {
      console.error('Error saving scoring rule:', error);
      toast({
        title: "Error",
        description: "Failed to save scoring rule",
        variant: "destructive",
      });
    }
  };

  const handleStatusSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const payload = {
        ...statusFormData,
        tenant_id: (await supabase.auth.getUser()).data.user?.user_metadata?.tenant_id
      };

      let result;
      if (editingStatus) {
        result = await supabase
          .from('lead_qualification_statuses')
          .update(payload)
          .eq('id', editingStatus.id);
      } else {
        result = await supabase
          .from('lead_qualification_statuses')
          .insert(payload);
      }

      if (result.error) throw result.error;

      toast({
        title: "Success",
        description: `Qualification status ${editingStatus ? 'updated' : 'created'} successfully`,
      });

      setIsStatusDialogOpen(false);
      resetStatusForm();
      fetchQualificationStatuses();
    } catch (error) {
      console.error('Error saving qualification status:', error);
      toast({
        title: "Error",
        description: "Failed to save qualification status",
        variant: "destructive",
      });
    }
  };

  const resetRuleForm = () => {
    setRuleFormData({
      rule_name: '',
      rule_type: 'demographic',
      field_name: '',
      condition_type: 'equals',
      condition_value: { value: '' },
      points: 0,
      is_active: true
    });
    setEditingRule(null);
  };

  const resetStatusForm = () => {
    setStatusFormData({
      name: '',
      min_score: 0,
      max_score: 100,
      color: '#22c55e',
      priority: 0,
      auto_assign: false,
      default_assigned_user: '',
      is_active: true
    });
    setEditingStatus(null);
  };

  const handleEditRule = (rule: ScoringRule) => {
    setEditingRule(rule);
    setRuleFormData({
      rule_name: rule.rule_name,
      rule_type: rule.rule_type,
      field_name: rule.field_name,
      condition_type: rule.condition_type,
      condition_value: rule.condition_value,
      points: rule.points,
      is_active: rule.is_active
    });
    setIsRuleDialogOpen(true);
  };

  const handleDeleteRule = async (id: string) => {
    if (!confirm('Are you sure you want to delete this scoring rule?')) return;

    try {
      const { error } = await supabase
        .from('lead_scoring_rules')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Scoring rule deleted successfully",
      });

      fetchScoringRules();
    } catch (error) {
      console.error('Error deleting scoring rule:', error);
      toast({
        title: "Error",
        description: "Failed to delete scoring rule",
        variant: "destructive",
      });
    }
  };

  const getRuleTypeBadgeVariant = (type: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      demographic: "default",
      behavioral: "secondary",
      property: "outline",
      source: "destructive"
    };
    return variants[type] || "outline";
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-muted animate-pulse rounded" />
        <div className="h-64 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold gradient-primary bg-clip-text text-transparent">
            Lead Scoring & Qualification
          </h1>
          <p className="text-muted-foreground">
            Automatically score and qualify leads based on custom criteria
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="rules">Scoring Rules</TabsTrigger>
          <TabsTrigger value="statuses">Qualification Statuses</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* Overview Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <Users className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Leads</p>
                    <p className="text-2xl font-bold">{scoreOverview.total_leads}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <Activity className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Avg Score</p>
                    <p className="text-2xl font-bold">{scoreOverview.avg_score}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <Award className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">High Quality</p>
                    <p className="text-2xl font-bold">{scoreOverview.high_quality_leads}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Active Rules</p>
                    <p className="text-2xl font-bold">{scoringRules.filter(r => r.is_active).length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Score Distribution */}
          <Card>
            <CardHeader>
              <CardTitle>Score Distribution</CardTitle>
              <CardDescription>Distribution of lead scores across temperature categories</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Object.entries(scoreOverview.score_distribution).map(([category, count]) => (
                  <div key={category} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{category}</span>
                      <span className="text-sm text-muted-foreground">{count} leads</span>
                    </div>
                    <Progress 
                      value={scoreOverview.total_leads > 0 ? (count / scoreOverview.total_leads) * 100 : 0} 
                      className="h-2"
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rules" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Scoring Rules</CardTitle>
                  <CardDescription>Configure how leads are automatically scored</CardDescription>
                </div>
                <Dialog open={isRuleDialogOpen} onOpenChange={setIsRuleDialogOpen}>
                  <DialogTrigger asChild>
                    <Button onClick={resetRuleForm}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Rule
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>
                        {editingRule ? 'Edit Scoring Rule' : 'Add New Scoring Rule'}
                      </DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleRuleSubmit} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="rule_name">Rule Name</Label>
                        <Input
                          id="rule_name"
                          value={ruleFormData.rule_name}
                          onChange={(e) => setRuleFormData({ ...ruleFormData, rule_name: e.target.value })}
                          placeholder="e.g., High-value property"
                          required
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="rule_type">Rule Type</Label>
                        <Select
                          value={ruleFormData.rule_type}
                          onValueChange={(value) => setRuleFormData({ ...ruleFormData, rule_type: value })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="demographic">Demographic</SelectItem>
                            <SelectItem value="behavioral">Behavioral</SelectItem>
                            <SelectItem value="property">Property</SelectItem>
                            <SelectItem value="source">Source</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="field_name">Field Name</Label>
                        <Select
                          value={ruleFormData.field_name}
                          onValueChange={(value) => setRuleFormData({ ...ruleFormData, field_name: value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select field" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="lead_source">Lead Source</SelectItem>
                            <SelectItem value="type">Contact Type</SelectItem>
                            <SelectItem value="address_state">State</SelectItem>
                            <SelectItem value="address_city">City</SelectItem>
                            <SelectItem value="acquisition_cost">Acquisition Cost</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="condition_type">Condition</Label>
                        <Select
                          value={ruleFormData.condition_type}
                          onValueChange={(value) => setRuleFormData({ ...ruleFormData, condition_type: value })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="equals">Equals</SelectItem>
                            <SelectItem value="contains">Contains</SelectItem>
                            <SelectItem value="greater_than">Greater Than</SelectItem>
                            <SelectItem value="less_than">Less Than</SelectItem>
                            <SelectItem value="range">Range</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="condition_value">Value</Label>
                        <Input
                          id="condition_value"
                          value={ruleFormData.condition_value.value || ''}
                          onChange={(e) => setRuleFormData({ 
                            ...ruleFormData, 
                            condition_value: { ...ruleFormData.condition_value, value: e.target.value }
                          })}
                          placeholder="Condition value"
                          required
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="points">Points</Label>
                        <Input
                          id="points"
                          type="number"
                          value={ruleFormData.points}
                          onChange={(e) => setRuleFormData({ 
                            ...ruleFormData, 
                            points: parseInt(e.target.value) || 0 
                          })}
                          placeholder="Points to add/subtract"
                          required
                        />
                      </div>

                      <div className="flex items-center space-x-2">
                        <Switch
                          id="is_active"
                          checked={ruleFormData.is_active}
                          onCheckedChange={(checked) => setRuleFormData({ ...ruleFormData, is_active: checked })}
                        />
                        <Label htmlFor="is_active">Active</Label>
                      </div>

                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setIsRuleDialogOpen(false)}>
                          Cancel
                        </Button>
                        <Button type="submit">
                          {editingRule ? 'Update' : 'Create'}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rule Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Field</TableHead>
                    <TableHead>Condition</TableHead>
                    <TableHead>Points</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scoringRules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell className="font-medium">{rule.rule_name}</TableCell>
                      <TableCell>
                        <Badge variant={getRuleTypeBadgeVariant(rule.rule_type)}>
                          {rule.rule_type}
                        </Badge>
                      </TableCell>
                      <TableCell>{rule.field_name}</TableCell>
                      <TableCell>
                        {rule.condition_type} "{rule.condition_value.value}"
                      </TableCell>
                      <TableCell>
                        <span className={`font-medium ${
                          rule.points > 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {rule.points > 0 ? '+' : ''}{rule.points}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={rule.is_active ? "default" : "secondary"}>
                          {rule.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-2">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => handleEditRule(rule)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => handleDeleteRule(rule.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              
              {scoringRules.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  No scoring rules configured yet. Add your first rule to start scoring leads automatically.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="statuses" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Qualification Statuses</CardTitle>
                  <CardDescription>Define qualification levels based on lead scores</CardDescription>
                </div>
                <Button onClick={() => { resetStatusForm(); setIsStatusDialogOpen(true); }}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Status
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {qualificationStatuses.map((status) => (
                  <div 
                    key={status.id} 
                    className="flex items-center justify-between p-4 rounded-lg border"
                  >
                    <div className="flex items-center space-x-4">
                      <div 
                        className="w-4 h-4 rounded-full"
                        style={{ backgroundColor: status.color }}
                      />
                      <div>
                        <h3 className="font-medium">{status.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          Score: {status.min_score}-{status.max_score} | Priority: {status.priority}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Badge variant={status.is_active ? "default" : "secondary"}>
                        {status.is_active ? "Active" : "Inactive"}
                      </Badge>
                      {status.auto_assign && (
                        <Badge variant="outline">Auto-assign</Badge>
                      )}
                    </div>
                  </div>
                ))}
                
                {qualificationStatuses.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    No qualification statuses configured yet.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};