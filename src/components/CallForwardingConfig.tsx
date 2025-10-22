import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Trash2, Phone, Clock, MapPin, Users } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface ForwardingRule {
  id: string;
  name: string;
  isActive: boolean;
  priority: number;
  conditions: {
    timeRouting?: Array<{
      name: string;
      startHour: number;
      endHour: number;
      days: number[];
      numbers: string[];
    }>;
    geographicRouting?: Record<string, {
      numbers: string[];
    }>;
    defaultNumbers?: string[];
  };
  distributionStrategy: 'round-robin' | 'simultaneous' | 'priority';
}

interface CallForwardingConfigProps {
  onConfigChange?: (config: any) => void;
}

export const CallForwardingConfig: React.FC<CallForwardingConfigProps> = ({ onConfigChange }) => {
  const { toast } = useToast();
  const [rules, setRules] = useState<ForwardingRule[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [newNumber, setNewNumber] = useState('');
  const [selectedRule, setSelectedRule] = useState<ForwardingRule | null>(null);

  useEffect(() => {
    loadForwardingRules();
  }, []);

  const loadForwardingRules = async () => {
    try {
      const response = await supabase.functions.invoke('call-forwarding', {
        body: { action: 'get-rules', tenantId: 'current-tenant-id', userId: 'current-user-id' }
      });

      if (response.data?.rules) {
        const formattedRules = response.data.rules.map((rule: any) => ({
          id: rule.id,
          name: rule.user_id || 'Default Rule',
          isActive: rule.is_active,
          priority: 1,
          conditions: rule.rules || {},
          distributionStrategy: rule.rules?.distributionStrategy || 'round-robin'
        }));
        setRules(formattedRules);
      }
    } catch (error) {
      console.error('Error loading forwarding rules:', error);
    }
  };

  const saveForwardingRules = async (updatedRules: ForwardingRule[]) => {
    setIsLoading(true);
    try {
      for (const rule of updatedRules) {
        await supabase.functions.invoke('call-forwarding', {
          body: {
            action: 'configure',
            tenantId: 'current-tenant-id',
            userId: 'current-user-id',
            rules: {
              ...rule.conditions,
              distributionStrategy: rule.distributionStrategy,
              isActive: rule.isActive
            }
          }
        });
      }

      toast({
        title: "Success",
        description: "Call forwarding rules saved successfully",
      });

      if (onConfigChange) {
        onConfigChange(updatedRules);
      }
    } catch (error) {
      console.error('Error saving forwarding rules:', error);
      toast({
        title: "Error",
        description: "Failed to save forwarding rules",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const addForwardingNumber = (ruleId: string, category: 'default' | 'time' | 'geographic') => {
    if (!newNumber.trim()) return;

    const updatedRules = rules.map(rule => {
      if (rule.id === ruleId) {
        const updatedRule = { ...rule };
        
        if (category === 'default') {
          if (!updatedRule.conditions.defaultNumbers) {
            updatedRule.conditions.defaultNumbers = [];
          }
          updatedRule.conditions.defaultNumbers.push(newNumber);
        }
        
        return updatedRule;
      }
      return rule;
    });

    setRules(updatedRules);
    setNewNumber('');
  };

  const removeForwardingNumber = (ruleId: string, number: string, category: 'default' | 'time' | 'geographic') => {
    const updatedRules = rules.map(rule => {
      if (rule.id === ruleId) {
        const updatedRule = { ...rule };
        
        if (category === 'default' && updatedRule.conditions.defaultNumbers) {
          updatedRule.conditions.defaultNumbers = updatedRule.conditions.defaultNumbers.filter(n => n !== number);
        }
        
        return updatedRule;
      }
      return rule;
    });

    setRules(updatedRules);
  };

  const addTimeBasedRule = (ruleId: string) => {
    const updatedRules = rules.map(rule => {
      if (rule.id === ruleId) {
        const updatedRule = { ...rule };
        
        if (!updatedRule.conditions.timeRouting) {
          updatedRule.conditions.timeRouting = [];
        }
        
        updatedRule.conditions.timeRouting.push({
          name: 'Business Hours',
          startHour: 9,
          endHour: 17,
          days: [1, 2, 3, 4, 5], // Monday to Friday
          numbers: []
        });
        
        return updatedRule;
      }
      return rule;
    });

    setRules(updatedRules);
  };

  const updateDistributionStrategy = (ruleId: string, strategy: 'round-robin' | 'simultaneous' | 'priority') => {
    const updatedRules = rules.map(rule => {
      if (rule.id === ruleId) {
        return { ...rule, distributionStrategy: strategy };
      }
      return rule;
    });

    setRules(updatedRules);
  };

  const toggleRuleActive = (ruleId: string) => {
    const updatedRules = rules.map(rule => {
      if (rule.id === ruleId) {
        return { ...rule, isActive: !rule.isActive };
      }
      return rule;
    });

    setRules(updatedRules);
  };

  const createNewRule = () => {
    const newRule: ForwardingRule = {
      id: crypto.randomUUID(),
      name: 'New Forwarding Rule',
      isActive: true,
      priority: rules.length + 1,
      conditions: {
        defaultNumbers: []
      },
      distributionStrategy: 'round-robin'
    };

    setRules([...rules, newRule]);
    setSelectedRule(newRule);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Call Forwarding Configuration</h3>
          <p className="text-sm text-muted-foreground">
            Set up multiple phone numbers and routing rules to ensure no calls are missed
          </p>
        </div>
        <Button onClick={createNewRule} className="gap-2">
          <Plus className="w-4 h-4" />
          Add Rule
        </Button>
      </div>

      <div className="grid gap-6">
        {rules.map((rule) => (
          <Card key={rule.id} className="border-2">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <div className="flex items-center gap-3">
                <Switch
                  checked={rule.isActive}
                  onCheckedChange={() => toggleRuleActive(rule.id)}
                />
                <div>
                  <CardTitle className="text-base">{rule.name}</CardTitle>
                  <CardDescription>
                    Distribution: {rule.distributionStrategy}
                  </CardDescription>
                </div>
              </div>
              <Badge variant={rule.isActive ? "default" : "secondary"}>
                {rule.isActive ? "Active" : "Inactive"}
              </Badge>
            </CardHeader>

            <CardContent>
              <Tabs defaultValue="numbers" className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="numbers" className="gap-1">
                    <Phone className="w-3 h-3" />
                    Numbers
                  </TabsTrigger>
                  <TabsTrigger value="time" className="gap-1">
                    <Clock className="w-3 h-3" />
                    Time Rules
                  </TabsTrigger>
                  <TabsTrigger value="geographic" className="gap-1">
                    <MapPin className="w-3 h-3" />
                    Geographic
                  </TabsTrigger>
                  <TabsTrigger value="distribution" className="gap-1">
                    <Users className="w-3 h-3" />
                    Distribution
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="numbers" className="space-y-4">
                  <div>
                    <Label>Default Forwarding Numbers</Label>
                    <div className="flex gap-2 mt-2">
                      <Input
                        placeholder="Enter phone number"
                        value={newNumber}
                        onChange={(e) => setNewNumber(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && addForwardingNumber(rule.id, 'default')}
                      />
                      <Button 
                        onClick={() => addForwardingNumber(rule.id, 'default')}
                        size="sm"
                      >
                        Add
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {rule.conditions.defaultNumbers?.map((number, index) => (
                      <div key={index} className="flex items-center justify-between p-2 bg-muted rounded">
                        <span className="font-mono">{number}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeForwardingNumber(rule.id, number, 'default')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="time" className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label>Time-Based Routing</Label>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => addTimeBasedRule(rule.id)}
                    >
                      Add Time Rule
                    </Button>
                  </div>

                  {rule.conditions.timeRouting?.map((timeRule, index) => (
                    <Card key={index}>
                      <CardContent className="pt-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label>Rule Name</Label>
                            <Input value={timeRule.name} readOnly />
                          </div>
                          <div>
                            <Label>Time Range</Label>
                            <div className="flex items-center gap-2">
                              <Input value={`${timeRule.startHour}:00`} readOnly />
                              <span>to</span>
                              <Input value={`${timeRule.endHour}:00`} readOnly />
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </TabsContent>

                <TabsContent value="geographic" className="space-y-4">
                  <div>
                    <Label>Geographic Routing (by Area Code / ZIP)</Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      Route calls based on caller's area code or ZIP code ranges
                    </p>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-2">
                      <Input placeholder="Area/ZIP code" id="geo-code" />
                      <Input placeholder="Forward to number" id="geo-number" />
                      <Button 
                        size="sm"
                        onClick={() => {
                          const code = (document.getElementById('geo-code') as HTMLInputElement)?.value;
                          const number = (document.getElementById('geo-number') as HTMLInputElement)?.value;
                          if (!code || !number) return;
                          
                          const updatedRules = rules.map(r => {
                            if (r.id === rule.id) {
                              const updatedRule = { ...r };
                              if (!updatedRule.conditions.geographicRouting) {
                                updatedRule.conditions.geographicRouting = {};
                              }
                              updatedRule.conditions.geographicRouting[code] = { numbers: [number] };
                              return updatedRule;
                            }
                            return r;
                          });
                          setRules(updatedRules);
                          toast({
                            title: "Geographic Rule Added",
                            description: `Calls from ${code} will route to ${number}`,
                          });
                        }}
                      >
                        Add Rule
                      </Button>
                    </div>

                    <div className="space-y-2">
                      {rule.conditions.geographicRouting && Object.entries(rule.conditions.geographicRouting).map(([code, config]) => (
                        <div key={code} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                          <div className="flex-1">
                            <div className="font-medium">Area/ZIP: {code}</div>
                            <div className="text-sm text-muted-foreground">
                              Routes to: {config.numbers.join(', ')}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const updatedRules = rules.map(r => {
                                if (r.id === rule.id) {
                                  const updatedRule = { ...r };
                                  if (updatedRule.conditions.geographicRouting) {
                                    delete updatedRule.conditions.geographicRouting[code];
                                  }
                                  return updatedRule;
                                }
                                return r;
                              });
                              setRules(updatedRules);
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>

                    {(!rule.conditions.geographicRouting || Object.keys(rule.conditions.geographicRouting).length === 0) && (
                      <div className="p-4 border rounded-lg bg-muted/50 text-center">
                        <p className="text-sm text-muted-foreground">
                          No geographic rules configured. Add rules above to route based on location.
                        </p>
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="distribution" className="space-y-4">
                  <div>
                    <Label>Distribution Strategy</Label>
                    <Select
                      value={rule.distributionStrategy}
                      onValueChange={(value: any) => updateDistributionStrategy(rule.id, value)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="round-robin">Round Robin</SelectItem>
                        <SelectItem value="simultaneous">Simultaneous Ring</SelectItem>
                        <SelectItem value="priority">Priority Order</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <div className="p-3 bg-muted rounded">
                      <strong>Round Robin:</strong> Calls are distributed sequentially through the number list
                    </div>
                    <div className="p-3 bg-muted rounded">
                      <strong>Simultaneous:</strong> All numbers ring at the same time
                    </div>
                    <div className="p-3 bg-muted rounded">
                      <strong>Priority:</strong> Numbers are tried in order until one answers
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={loadForwardingRules}>
          Reset
        </Button>
        <Button onClick={() => saveForwardingRules(rules)} disabled={isLoading}>
          {isLoading ? 'Saving...' : 'Save Configuration'}
        </Button>
      </div>
    </div>
  );
};